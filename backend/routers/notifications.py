"""Notification + quick-log routes.

- POST /notifications/register-token — call on app open after permission grant.
  Upserts on the unique token string so the same device re-installing won't
  blow up the table.
- DELETE /notifications/token — for explicit sign-out / opt-out.
- POST /logs/quick — single endpoint the notification action handler hits.
  Dispatches to hydration / stimulant log paths. Idempotent on `request_id`
  (Redis dedupe, 5 min) so a double-tap from the lock screen doesn't double-log.
- GET /notifications/patterns — debug/preview endpoint; lets the app show
  "these are the times we'd nudge you" inside Settings.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from core.database import get_db
from core.redis import get_redis
from middleware.auth import get_current_user
from models.hydration_log import HydrationLog
from models.push_token import PushToken
from models.stimulant_log import StimulantLog
from models.user import User
from services.daily import increment_daily_field
from services.log_patterns import get_patterns_for_user
from services.stimulants import SUBSTANCES


notif_router = APIRouter(prefix="/notifications", tags=["notifications"])
quick_log_router = APIRouter(prefix="/logs", tags=["quick-log"])


# ── Push token registration ────────────────────────────────────────────────────

class RegisterTokenRequest(BaseModel):
    token: str = Field(..., min_length=10)
    platform: Literal["ios", "android"]


@notif_router.post("/register-token", status_code=201)
async def register_token(
    body: RegisterTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upsert by token. Re-activates a previously-deactivated token if it comes
    back online, and re-binds it to the current user if they signed in elsewhere."""
    from datetime import datetime, timezone

    result = await db.execute(select(PushToken).where(PushToken.token == body.token))
    existing = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if existing:
        existing.user_id = current_user.id
        existing.platform = body.platform
        existing.active = True
        existing.last_seen_at = now
    else:
        db.add(PushToken(
            user_id=current_user.id,
            token=body.token,
            platform=body.platform,
            last_seen_at=now,
        ))
    await db.commit()
    return {"status": "ok"}


@notif_router.delete("/token", status_code=204)
async def delete_token(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PushToken).where(
            PushToken.token == token, PushToken.user_id == current_user.id
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Token not found")
    await db.delete(row)
    await db.commit()


# ── Pattern preview ────────────────────────────────────────────────────────────

@notif_router.get("/patterns")
async def get_patterns(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns the slots that would be nudged. Mostly for a Settings preview."""
    slots = await get_patterns_for_user(current_user.id, db, current_user.timezone)
    return [
        {
            "log_type": s.log_type,
            "weekday": s.weekday,
            "slot_minute": s.slot_minute,
            "time_label": f"{s.slot_minute // 60:02d}:{s.slot_minute % 60:02d}",
            "confidence": s.confidence,
            "sample_count": s.sample_count,
            "suggested_amount_ml": s.suggested_amount_ml,
            "suggested_substance": s.suggested_substance,
            "suggested_caffeine_mg": s.suggested_caffeine_mg,
        }
        for s in slots
    ]


# ── Quick-log from notification action ─────────────────────────────────────────

class QuickLogRequest(BaseModel):
    type: Literal["hydration", "stimulant"]
    # Client generates this per notification tap so we can dedupe replays.
    request_id: str = Field(..., min_length=8, max_length=64)
    amount_ml: int | None = Field(None, gt=0)
    substance: str | None = None
    caffeine_mg: int | None = Field(None, gt=0)


@quick_log_router.post("/quick", status_code=201)
async def quick_log(
    body: QuickLogRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """One endpoint for both log types. Idempotent on request_id.

    A double-tap on the iOS lock-screen action (a real failure mode — the
    system can deliver the same response twice if the network is flaky) must
    not create two log rows.
    """
    if redis is not None:
        dedupe_key = f"quicklog:{current_user.id}:{body.request_id}"
        try:
            # SET NX with 5-min TTL — first writer wins.
            was_set = await redis.set(dedupe_key, "1", ex=300, nx=True)
            if not was_set:
                return {"status": "duplicate", "request_id": body.request_id}
        except Exception:  # noqa: BLE001 — fall through if redis is down
            pass

    if body.type == "hydration":
        if not body.amount_ml:
            raise HTTPException(400, "amount_ml required for hydration")
        entry = HydrationLog(user_id=current_user.id, amount_ml=body.amount_ml, source="water")
        db.add(entry)
        await increment_daily_field(current_user.id, db, "water_ml", body.amount_ml, mode="add")
        await db.commit()
        await db.refresh(entry)
        return {"id": str(entry.id), "type": "hydration", "amount_ml": entry.amount_ml}

    # stimulant
    substance = body.substance or "coffee"
    preset = SUBSTANCES.get(substance)
    caffeine = body.caffeine_mg or (preset["caffeine_mg"] if preset else None)
    if not caffeine:
        raise HTTPException(400, "caffeine_mg required for unknown substance")
    half_life = preset["half_life"] if preset else 5.5
    entry = StimulantLog(
        user_id=current_user.id,
        substance=substance,
        caffeine_mg=caffeine,
        half_life_hours=half_life,
    )
    db.add(entry)
    await increment_daily_field(current_user.id, db, "caffeine_mg", caffeine, mode="add")
    await db.commit()
    await db.refresh(entry)
    return {
        "id": str(entry.id),
        "type": "stimulant",
        "substance": entry.substance,
        "caffeine_mg": entry.caffeine_mg,
    }
