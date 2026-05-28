import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.user import User
from models.device_connection import DeviceConnection
from services.devices import upsert_daily_summary, recompute_form_scores_range
from services.form_score import check_and_unlock_form_score

OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize"
OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token"
OURA_API_BASE = "https://api.ouraring.com/v2/usercollection"
OURA_SCOPES = "daily heartrate personal"
STATE_TTL_SECONDS = 600
BACKFILL_DAYS = 14


class OuraNotConfigured(Exception):
    pass


def _require_config() -> None:
    if not (settings.OURA_CLIENT_ID and settings.OURA_CLIENT_SECRET and settings.OURA_REDIRECT_URI):
        raise OuraNotConfigured("Oura OAuth is not configured on the server")


# ── OAuth ───────────────────────────────────────────────────────────────────────

async def initiate_oura_oauth(user_id, redis) -> str:
    """Build the Oura authorize URL and stash a CSRF state → user_id in Redis."""
    _require_config()
    state = secrets.token_urlsafe(32)
    await redis.setex(f"oura_oauth_state:{state}", STATE_TTL_SECONDS, str(user_id))
    params = {
        "response_type": "code",
        "client_id": settings.OURA_CLIENT_ID,
        "redirect_uri": settings.OURA_REDIRECT_URI,
        "scope": OURA_SCOPES,
        "state": state,
    }
    return f"{OURA_AUTH_URL}?{urlencode(params)}"


async def handle_oura_callback(code: str, state: str, db: AsyncSession, redis) -> None:
    """Validate state, exchange the code for tokens, store the connection, backfill."""
    _require_config()
    user_id = await redis.get(f"oura_oauth_state:{state}")
    if not user_id:
        raise ValueError("Invalid or expired OAuth state")
    await redis.delete(f"oura_oauth_state:{state}")

    user = await db.get(User, uuid.UUID(str(user_id)))
    if not user:
        raise ValueError("User not found for OAuth state")

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(OURA_TOKEN_URL, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.OURA_REDIRECT_URI,
            "client_id": settings.OURA_CLIENT_ID,
            "client_secret": settings.OURA_CLIENT_SECRET,
        })
        resp.raise_for_status()
        tokens = resp.json()

    result = await db.execute(
        select(DeviceConnection).where(
            DeviceConnection.user_id == user.id,
            DeviceConnection.provider == "oura",
        )
    )
    conn = result.scalar_one_or_none()
    if conn is None:
        conn = DeviceConnection(user_id=user.id, provider="oura")
        db.add(conn)
    conn.access_token = tokens["access_token"]
    conn.refresh_token = tokens.get("refresh_token")
    conn.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 86400))
    conn.sync_enabled = True
    await db.flush()

    await _sync(conn, user, db, days_back=BACKFILL_DAYS)
    await db.commit()


async def _refresh_if_needed(conn: DeviceConnection, db: AsyncSession) -> None:
    fresh = conn.token_expires_at and conn.token_expires_at > datetime.now(timezone.utc) + timedelta(minutes=5)
    if fresh or not conn.refresh_token:
        return
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(OURA_TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": conn.refresh_token,
            "client_id": settings.OURA_CLIENT_ID,
            "client_secret": settings.OURA_CLIENT_SECRET,
        })
        resp.raise_for_status()
        tokens = resp.json()
    conn.access_token = tokens["access_token"]
    if tokens.get("refresh_token"):
        conn.refresh_token = tokens["refresh_token"]
    conn.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 86400))
    await db.flush()


# ── Sync ──────────────────────────────────────────────────────────────────────

async def _get(client: httpx.AsyncClient, path: str, token: str, start: str, end: str) -> list[dict]:
    resp = await client.get(
        f"{OURA_API_BASE}/{path}",
        headers={"Authorization": f"Bearer {token}"},
        params={"start_date": start, "end_date": end},
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


async def _sync(conn: DeviceConnection, user: User, db: AsyncSession, days_back: int) -> None:
    await _refresh_if_needed(conn, db)

    end = date.today()
    start = end - timedelta(days=days_back)
    s, e = start.isoformat(), end.isoformat()

    async with httpx.AsyncClient(timeout=20) as client:
        token = conn.access_token
        daily_sleep = await _get(client, "daily_sleep", token, s, e)
        daily_readiness = await _get(client, "daily_readiness", token, s, e)
        sleep_periods = await _get(client, "sleep", token, s, e)
        daily_activity = await _get(client, "daily_activity", token, s, e)

    sleep_score = {d["day"]: d.get("score") for d in daily_sleep if d.get("day")}
    readiness = {d["day"]: d.get("score") for d in daily_readiness if d.get("day")}
    activity = {d["day"]: d for d in daily_activity if d.get("day")}

    # Raw HRV (ms) from the longest sleep period per day — matches HealthKit's SDNN-in-ms.
    hrv_by_day: dict[str, int] = {}
    best_duration: dict[str, int] = {}
    for p in sleep_periods:
        day = p.get("day")
        hrv = p.get("average_hrv")
        duration = p.get("total_sleep_duration") or 0
        if not day or hrv is None:
            continue
        if duration >= best_duration.get(day, -1):
            best_duration[day] = duration
            hrv_by_day[day] = round(hrv)

    for day in set(sleep_score) | set(readiness) | set(activity) | set(hrv_by_day):
        act = activity.get(day, {})
        await upsert_daily_summary(user.id, {
            "date": day,
            "sleep_score": sleep_score.get(day),
            "readiness_score": readiness.get(day),
            "hrv_score": hrv_by_day.get(day),
            "steps": act.get("steps"),
            "active_calories": act.get("active_calories"),
            "data_source": "oura",
        }, db)

    conn.last_sync_at = datetime.now(timezone.utc)
    await recompute_form_scores_range(user.id, user, days=max(days_back, BACKFILL_DAYS), db=db)
    await check_and_unlock_form_score(user, db)
    await db.flush()


async def sync_oura_for_user(user: User, db: AsyncSession) -> bool:
    """Manual / app-open sync. No-op (returns False) if Oura isn't connected."""
    result = await db.execute(
        select(DeviceConnection).where(
            DeviceConnection.user_id == user.id,
            DeviceConnection.provider == "oura",
        )
    )
    conn = result.scalar_one_or_none()
    if conn is None or not conn.sync_enabled:
        return False
    await _sync(conn, user, db, days_back=2)
    await db.commit()
    return True
