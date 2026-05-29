from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.training_log import TrainingLog
from services.daily import get_or_create_today

router = APIRouter(prefix="/training", tags=["training"])


class LogTrainingRequest(BaseModel):
    type: str  # exercise key (bench_press, squat, ...) or legacy muscle group
    duration_min: Optional[int] = None
    intensity: Optional[int] = None
    volume_sets: Optional[int] = None  # set number within session (1, 2, 3...)
    weight_kg: Optional[float] = None
    reps: Optional[int] = None
    notes: Optional[str] = None
    date: Optional[date] = None


class LogSetRequest(BaseModel):
    weight_kg: Optional[float] = None
    reps: Optional[int] = None


class LogExerciseRequest(BaseModel):
    type: str  # exercise key
    sets: list[LogSetRequest]
    notes: Optional[str] = None
    date: Optional[date] = None


def _log_dict(t: TrainingLog) -> dict:
    return {
        "id": str(t.id),
        "date": t.date.isoformat(),
        "type": t.type,
        "duration_min": t.duration_min,
        "intensity": t.intensity,
        "volume_sets": t.volume_sets,
        "weight_kg": t.weight_kg,
        "reps": t.reps,
        "notes": t.notes,
        "source": t.source,
        "logged_at": t.logged_at.isoformat(),
    }


async def _sync_training_summary(user_id, target_date: date, db: AsyncSession) -> None:
    """
    Recompute trained + training_type on daily_summary for a given date.
    Called after both log and delete to keep summary accurate.
    """
    result = await db.execute(
        select(TrainingLog.type)
        .where(
            TrainingLog.user_id == user_id,
            TrainingLog.date == target_date,
        )
        .order_by(TrainingLog.logged_at)
        .limit(1)
    )
    first_type = result.scalar()

    if target_date == date.today():
        summary = await get_or_create_today(user_id, db)
        summary.trained = first_type is not None
        summary.training_type = first_type
        await db.flush()


@router.post("/log", status_code=201)
async def log_training(
    body: LogTrainingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_date = body.date or date.today()

    entry = TrainingLog(
        user_id=current_user.id,
        date=target_date,
        type=body.type,
        duration_min=body.duration_min,
        intensity=body.intensity,
        volume_sets=body.volume_sets,
        weight_kg=body.weight_kg,
        reps=body.reps,
        notes=body.notes,
    )
    db.add(entry)
    await db.flush()

    await _sync_training_summary(current_user.id, target_date, db)

    await db.commit()
    await db.refresh(entry)
    return _log_dict(entry)


@router.post("/log-exercise", status_code=201)
async def log_exercise(
    body: LogExerciseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Log a whole exercise session as N rows (one per set)."""
    if not body.sets:
        raise HTTPException(400, "At least one set is required")

    target_date = body.date or date.today()
    created: list[TrainingLog] = []

    for i, s in enumerate(body.sets, start=1):
        if s.reps is None and s.weight_kg is None:
            continue
        entry = TrainingLog(
            user_id=current_user.id,
            date=target_date,
            type=body.type,
            volume_sets=i,
            weight_kg=s.weight_kg,
            reps=s.reps,
            notes=body.notes if i == 1 else None,
        )
        db.add(entry)
        created.append(entry)

    if not created:
        raise HTTPException(400, "No valid sets to log")

    await db.flush()
    await _sync_training_summary(current_user.id, target_date, db)

    await db.commit()
    for e in created:
        await db.refresh(e)
    return [_log_dict(e) for e in created]


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


@router.get("/volume-weekly")
async def get_volume_weekly(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Total kg moved per day for the last 7 days (Mon..Sun of the current week)."""
    today = date.today()
    monday = today - timedelta(days=(today.weekday()))
    sunday = monday + timedelta(days=6)

    result = await db.execute(
        select(TrainingLog)
        .where(
            TrainingLog.user_id == current_user.id,
            TrainingLog.date >= monday,
            TrainingLog.date <= sunday,
        )
    )
    logs = result.scalars().all()

    volume_by_day: dict[str, float] = defaultdict(float)
    for log in logs:
        if log.weight_kg is not None and log.reps is not None:
            volume_by_day[log.date.isoformat()] += float(log.weight_kg) * log.reps

    days = []
    for i in range(7):
        d = monday + timedelta(days=i)
        days.append({
            "date": d.isoformat(),
            "volume_kg": round(volume_by_day.get(d.isoformat(), 0.0), 1),
        })

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "total_volume_kg": round(sum(d["volume_kg"] for d in days), 1),
        "days": days,
    }


@router.get("/by-exercise/{exercise_key}")
async def get_by_exercise(
    exercise_key: str,
    days: int = 90,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """All logs for a specific exercise, grouped by session date, plus PR progression."""
    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(TrainingLog)
        .where(
            TrainingLog.user_id == current_user.id,
            TrainingLog.type == exercise_key,
            TrainingLog.date >= cutoff,
        )
        .order_by(TrainingLog.date.asc(), TrainingLog.logged_at.asc())
    )
    logs = result.scalars().all()

    sessions: dict[str, list[TrainingLog]] = defaultdict(list)
    for log in logs:
        sessions[log.date.isoformat()].append(log)

    progression = []
    for d in sorted(sessions.keys()):
        sets = sessions[d]
        top = max(
            (s for s in sets if s.weight_kg is not None and s.reps is not None),
            key=lambda s: float(s.weight_kg or 0),
            default=None,
        )
        volume = sum(
            float(s.weight_kg or 0) * (s.reps or 0)
            for s in sets
            if s.weight_kg is not None and s.reps is not None
        )
        progression.append({
            "date": d,
            "top_weight_kg": float(top.weight_kg) if top and top.weight_kg is not None else None,
            "top_reps": top.reps if top else None,
            "total_volume_kg": round(volume, 1),
            "sets": len(sets),
        })

    return {
        "exercise": exercise_key,
        "progression": progression,
        "logs": [_log_dict(t) for t in logs],
    }


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

    target_date = entry.date
    await db.delete(entry)
    await db.flush()

    await _sync_training_summary(current_user.id, target_date, db)

    await db.commit()
