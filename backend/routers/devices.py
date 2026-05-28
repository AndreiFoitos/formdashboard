from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from core.config import settings
from core.database import get_db
from core.redis import get_redis
from middleware.auth import get_current_user
from models.user import User
from models.device_connection import DeviceConnection
from services.devices import (
    estimate_sleep_score,
    upsert_daily_summary,
    get_or_create_device_connection,
    recompute_form_scores_range,
)
from services.form_score import compute_form_score, check_and_unlock_form_score
from services.oura import (
    initiate_oura_oauth,
    handle_oura_callback,
    sync_oura_for_user,
    OuraNotConfigured,
)

router = APIRouter(prefix="/devices", tags=["devices"])


# ── Payloads ────────────────────────────────────────────────────────────────────

class HealthKitDay(BaseModel):
    date: str  # YYYY-MM-DD (the local calendar day the data belongs to)
    sleep_duration_hours: Optional[float] = None
    hrv_avg: Optional[int] = None          # SDNN in ms, stored raw as hrv_score
    steps: Optional[int] = None
    active_calories: Optional[int] = None


class HealthKitBackfillPayload(BaseModel):
    days: list[HealthKitDay]


def _summary_data(day: HealthKitDay, source: str) -> dict:
    return {
        "date": day.date,
        "sleep_score": estimate_sleep_score(day.sleep_duration_hours),
        "hrv_score": day.hrv_avg,
        "steps": day.steps,
        "active_calories": day.active_calories,
        "data_source": source,
    }


# ── HealthKit ingestion ───────────────────────────────────────────────────────

@router.post("/healthkit/backfill")
async def healthkit_backfill(
    payload: HealthKitBackfillPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bulk import of HealthKit history, called once during onboarding.

    Lets an iPhone user open the app and immediately see ~2 weeks of real, scored history.
    """
    for day in payload.days:
        await upsert_daily_summary(current_user.id, _summary_data(day, "healthkit_backfill"), db)

    conn = await get_or_create_device_connection(current_user.id, "apple_health", db)
    conn.last_sync_at = datetime.now(timezone.utc)

    # Persist scores for every backfilled day, then unlock if 5+ days now exist.
    await recompute_form_scores_range(current_user.id, current_user, days=14, db=db)
    unlocked = await check_and_unlock_form_score(current_user, db)

    await db.commit()
    return {"backfilled_days": len(payload.days), "form_score_unlocked": unlocked or current_user.form_score_unlocked}


@router.post("/healthkit/daily")
async def healthkit_daily(
    payload: HealthKitDay,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ongoing daily push from the RN companion at app open — typically yesterday's data."""
    # Only sync for a device the user has actually connected (and not disabled).
    # If they disconnected in Settings the connection row is gone, so this becomes
    # a no-op — otherwise the daily push would silently re-create the connection.
    result = await db.execute(
        select(DeviceConnection).where(
            DeviceConnection.user_id == current_user.id,
            DeviceConnection.provider == "apple_health",
        )
    )
    conn = result.scalar_one_or_none()
    if conn is None or not conn.sync_enabled:
        return {"synced": False, "reason": "not_connected"}

    summary = await upsert_daily_summary(current_user.id, _summary_data(payload, "apple_health"), db)
    conn.last_sync_at = datetime.now(timezone.utc)

    if current_user.form_score_unlocked:
        score, _ = await compute_form_score(summary, current_user, db)
        summary.form_score = score
    else:
        await check_and_unlock_form_score(current_user, db)

    await db.commit()
    return {"synced": True, "date": payload.date}


# ── Oura (OAuth2) ───────────────────────────────────────────────────────────────

@router.get("/connect/oura")
async def connect_oura(
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Return the Oura authorize URL for the app to open in a browser session."""
    try:
        url = await initiate_oura_oauth(current_user.id, redis)
    except OuraNotConfigured:
        raise HTTPException(503, "Oura integration is not configured on the server")
    return {"authorize_url": url}


@router.get("/callback/oura")
async def callback_oura(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Oura redirects the browser here. We exchange + backfill, then hand control
    back to the app via its deep-link scheme."""
    return_url = settings.OAUTH_APP_RETURN_URL
    if error or not code or not state:
        return RedirectResponse(f"{return_url}?status=error")
    try:
        await handle_oura_callback(code, state, db, redis)
    except Exception:
        return RedirectResponse(f"{return_url}?status=error")
    return RedirectResponse(f"{return_url}?status=success")


@router.post("/sync/oura")
async def sync_oura(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    synced = await sync_oura_for_user(current_user, db)
    return {"synced": synced}


# ── Connection management ───────────────────────────────────────────────────────

@router.get("/connected")
async def list_connected(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeviceConnection).where(DeviceConnection.user_id == current_user.id)
    )
    connections = result.scalars().all()
    return [
        {
            "provider": c.provider,
            "sync_enabled": c.sync_enabled,
            "connected_at": c.connected_at.isoformat() if c.connected_at else None,
            "last_sync_at": c.last_sync_at.isoformat() if c.last_sync_at else None,
        }
        for c in connections
    ]


@router.delete("/disconnect/{provider}", status_code=204)
async def disconnect(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeviceConnection).where(
            DeviceConnection.user_id == current_user.id,
            DeviceConnection.provider == provider,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Device not connected")
    await db.delete(conn)
    await db.commit()
