from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.stimulant_log import StimulantLog
from services.stimulants import SUBSTANCES, get_caffeine_curve

router = APIRouter(prefix="/stimulants", tags=["stimulants"])


class LogStimulantRequest(BaseModel):
    substance: str
    caffeine_mg: int | None = None  # overrides preset if provided
    note: str | None = None


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

    entry = StimulantLog(
        user_id=current_user.id,
        substance=body.substance,
        caffeine_mg=caffeine_mg,
        half_life_hours=half_life,
        note=body.note,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return {
        "id": str(entry.id),
        "substance": entry.substance,
        "caffeine_mg": entry.caffeine_mg,
        "logged_at": entry.logged_at.isoformat(),
    }


@router.get("/today")
async def get_today_stimulants(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(StimulantLog)
        .where(StimulantLog.user_id == current_user.id, StimulantLog.logged_at >= day_start)
        .order_by(StimulantLog.logged_at)
    )
    logs = result.scalars().all()
    return [
        {"id": str(l.id), "substance": l.substance, "caffeine_mg": l.caffeine_mg, "logged_at": l.logged_at.isoformat()}
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
    await db.delete(entry)
    await db.commit()


@router.get("/curve")
async def get_curve(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_caffeine_curve(current_user.id, db)


@router.get("/substances")
async def list_substances():
    return [{"key": k, **v} for k, v in SUBSTANCES.items()]