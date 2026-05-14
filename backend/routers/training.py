from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.training_log import TrainingLog

router = APIRouter(prefix="/training", tags=["training"])


class LogTrainingRequest(BaseModel):
    type: str                          # push, pull, legs, upper, lower, cardio, full_body
    duration_min: Optional[int] = None
    intensity: Optional[int] = None    # 1-5
    volume_sets: Optional[int] = None
    notes: Optional[str] = None
    date: Optional[date] = None        # defaults to today


def _log_dict(t: TrainingLog) -> dict:
    return {
        "id": str(t.id),
        "date": t.date.isoformat(),
        "type": t.type,
        "duration_min": t.duration_min,
        "intensity": t.intensity,
        "volume_sets": t.volume_sets,
        "notes": t.notes,
        "source": t.source,
        "logged_at": t.logged_at.isoformat(),
    }


@router.post("/log", status_code=201)
async def log_training(
    body: LogTrainingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = TrainingLog(
        user_id=current_user.id,
        date=body.date or date.today(),
        type=body.type,
        duration_min=body.duration_min,
        intensity=body.intensity,
        volume_sets=body.volume_sets,
        notes=body.notes,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return _log_dict(entry)


@router.get("/history")
async def get_history(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TrainingLog)
        .where(TrainingLog.user_id == current_user.id)
        .order_by(TrainingLog.date.desc(), TrainingLog.logged_at.desc())
        .limit(limit)
    )
    return [_log_dict(t) for t in result.scalars().all()]


@router.get("/today")
async def get_today(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TrainingLog)
        .where(TrainingLog.user_id == current_user.id, TrainingLog.date == date.today())
        .order_by(TrainingLog.logged_at.desc())
    )
    return [_log_dict(t) for t in result.scalars().all()]


@router.delete("/{log_id}", status_code=204)
async def delete_training(
    log_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TrainingLog).where(
            TrainingLog.id == log_id,
            TrainingLog.user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Training log not found")
    await db.delete(entry)
    await db.commit()