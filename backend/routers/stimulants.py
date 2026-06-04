from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.stimulant_log import StimulantLog
from services.daily import increment_daily_field
from services.stimulants import (
    ADDITIONS,
    SUBSTANCES,
    SUBSTANCES_WITH_ADDITIONS,
    compute_nutrition,
    get_caffeine_curve,
)

router = APIRouter(prefix="/stimulants", tags=["stimulants"])


class LogStimulantRequest(BaseModel):
    substance: str
    caffeine_mg: int | None = None
    additions: list[str] = Field(default_factory=list)
    note: str | None = None


async def _apply_nutrition_delta(
    user_id, db: AsyncSession, entry: StimulantLog, sign: int, *, tz_name: str | None = None,
) -> None:
    """Increment (sign=+1) or decrement (sign=-1) today's summary by an entry's macros."""
    await increment_daily_field(user_id, db, "caffeine_mg", sign * entry.caffeine_mg, mode="add", tz_name=tz_name)
    await increment_daily_field(user_id, db, "calories_eaten", sign * entry.calories, mode="add", tz_name=tz_name)
    await increment_daily_field(user_id, db, "protein_g", sign * entry.protein_g, mode="add", tz_name=tz_name)
    await increment_daily_field(user_id, db, "carbs_g", sign * entry.carbs_g, mode="add", tz_name=tz_name)
    await increment_daily_field(user_id, db, "fat_g", sign * entry.fat_g, mode="add", tz_name=tz_name)


@router.post("/log", status_code=201)
async def log_stimulant(
    body: LogStimulantRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    preset = SUBSTANCES.get(body.substance)
    if not preset and body.caffeine_mg is None:
        raise HTTPException(400, "Unknown substance — provide caffeine_mg explicitly")

    caffeine_mg = body.caffeine_mg if body.caffeine_mg is not None else preset["caffeine_mg"]
    half_life = preset["half_life"] if preset else 5.5

    # Add-ons are only allowed for substances that surface them; silently drop
    # any others so a stale client can't bypass the UI gate.
    valid_additions = [
        a for a in body.additions
        if a in ADDITIONS and body.substance in SUBSTANCES_WITH_ADDITIONS
    ]
    macros = compute_nutrition(body.substance, valid_additions)

    entry = StimulantLog(
        user_id=current_user.id,
        substance=body.substance,
        caffeine_mg=caffeine_mg,
        half_life_hours=half_life,
        calories=macros["calories"],
        protein_g=macros["protein_g"],
        carbs_g=macros["carbs_g"],
        fat_g=macros["fat_g"],
        additions=valid_additions,
        note=body.note,
    )
    db.add(entry)
    await db.flush()

    await _apply_nutrition_delta(current_user.id, db, entry, sign=1, tz_name=current_user.timezone)

    await db.commit()
    await db.refresh(entry)
    return {
        "id": str(entry.id),
        "substance": entry.substance,
        "caffeine_mg": entry.caffeine_mg,
        "calories": entry.calories,
        "protein_g": entry.protein_g,
        "carbs_g": entry.carbs_g,
        "fat_g": entry.fat_g,
        "additions": list(entry.additions or []),
        "logged_at": entry.logged_at.isoformat(),
    }


@router.get("/today")
async def get_today_stimulants(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime
    from core.timezone import resolve_tz, user_today
    today = user_today(current_user.timezone)
    day_start = datetime.combine(today, datetime.min.time()).replace(
        tzinfo=resolve_tz(current_user.timezone)
    )
    result = await db.execute(
        select(StimulantLog)
        .where(StimulantLog.user_id == current_user.id, StimulantLog.logged_at >= day_start)
        .order_by(StimulantLog.logged_at)
    )
    logs = result.scalars().all()
    return [
        {
            "id": str(l.id),
            "substance": l.substance,
            "caffeine_mg": l.caffeine_mg,
            "calories": l.calories,
            "protein_g": l.protein_g,
            "carbs_g": l.carbs_g,
            "fat_g": l.fat_g,
            "additions": list(l.additions or []),
            "logged_at": l.logged_at.isoformat(),
        }
        for l in logs
    ]


@router.delete("/{log_id}", status_code=204)
async def delete_stimulant(
    log_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StimulantLog).where(StimulantLog.id == log_id, StimulantLog.user_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Log entry not found")

    # Decrement summary before deleting so the totals stay consistent.
    await _apply_nutrition_delta(current_user.id, db, entry, sign=-1, tz_name=current_user.timezone)

    await db.delete(entry)
    await db.commit()


@router.get("/curve")
async def get_curve(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_caffeine_curve(
        current_user.id, db, current_user.sleep_hour, tz_name=current_user.timezone,
    )


@router.get("/substances")
async def list_substances():
    return {
        "substances": [
            {
                "key": k,
                "supports_additions": k in SUBSTANCES_WITH_ADDITIONS,
                **v,
            }
            for k, v in SUBSTANCES.items()
        ],
        "additions": [{"key": k, **v} for k, v in ADDITIONS.items()],
    }
