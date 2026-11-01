"""Creatine: a daily tick on Home instead of a log.

Same dose every day, so each day is just taken or not (models/creatine_log.py).
A tick counts towards the logging streak, and the creatine reminder
(services/smart_notifications.py) is timed by when the user usually ticks it.
Its push has a Taken button that calls POST /creatine/today.

- GET /creatine: on/off, dose, ticked today, days in a row.
- PUT /creatine/settings: turn it on or off, change the dose.
- POST / DELETE /creatine/today: tick and untick today. Ticking twice is fine.
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.timezone import user_today
from middleware.auth import get_current_user
from models.creatine_log import CreatineLog
from models.user import User
from models.user_preference import UserPreference
from services.streaks import run_ending

router = APIRouter(prefix="/creatine", tags=["creatine"])

DEFAULT_DOSE_G = 5.0
# How far back "days in a row" looks.
STREAK_LOOKBACK_DAYS = 400


class CreatineSettings(BaseModel):
    enabled: bool | None = None
    dose_g: float | None = Field(None, ge=1, le=25)


async def _status(user: User, db: AsyncSession) -> dict:
    prefs = await db.get(UserPreference, user.id)
    today = user_today(user.timezone)
    since = today - timedelta(days=STREAK_LOOKBACK_DAYS)
    days = set((await db.execute(
        select(CreatineLog.date).where(CreatineLog.user_id == user.id, CreatineLog.date >= since)
    )).scalars().all())
    # Like the logging streak: not ticked yet today doesn't break it.
    end = today if today in days else today - timedelta(days=1)
    return {
        "enabled": bool(prefs and prefs.creatine_on),
        "dose_g": prefs.creatine_dose_g if prefs else DEFAULT_DOSE_G,
        "taken_today": today in days,
        "streak_days": run_ending(days, end, since),
    }


@router.get("")
async def get_creatine(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _status(current_user, db)


@router.put("/settings")
async def update_settings(
    body: CreatineSettings,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await db.get(UserPreference, current_user.id)
    if prefs is None:
        prefs = UserPreference(user_id=current_user.id)
        db.add(prefs)
    if body.enabled is not None:
        prefs.creatine_on = body.enabled
    if body.dose_g is not None:
        prefs.creatine_dose_g = round(body.dose_g, 1)
    await db.commit()
    return await _status(current_user, db)


@router.post("/today")
async def tick_today(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await db.get(UserPreference, current_user.id)
    await db.execute(
        pg_insert(CreatineLog)
        .values(
            user_id=current_user.id,
            date=user_today(current_user.timezone),
            dose_g=prefs.creatine_dose_g if prefs else DEFAULT_DOSE_G,
        )
        .on_conflict_do_nothing(constraint="uq_creatine_log_day")
    )
    await db.commit()
    return await _status(current_user, db)


@router.delete("/today")
async def untick_today(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(CreatineLog).where(
        CreatineLog.user_id == current_user.id,
        CreatineLog.date == user_today(current_user.timezone),
    ))
    await db.commit()
    return await _status(current_user, db)
