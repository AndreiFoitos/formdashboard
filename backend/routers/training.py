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
from core.redis import get_redis
from middleware.auth import get_current_user
from models.user import User
from models.training_log import TrainingLog
from models.custom_exercise import CustomExercise
from models.user_split import UserSplit
from services.daily import get_or_create_today
from services.one_rm import estimate as estimate_one_rm
from services.social_notifications import (
    notify_pr_if_applicable,
    notify_weekly_volume_overtakes,
    BODYWEIGHT_EXERCISES,
)
from services.split_detection import detect_for_user as detect_split_for_user

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


async def _sync_training_summary(
    user_id, target_date: date, db: AsyncSession, *, tz_name: str | None = None,
) -> None:
    """
    Recompute trained + training_type on daily_summary for a given date.
    Called after both log and delete to keep summary accurate.
    """
    from core.timezone import user_today
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

    if target_date == user_today(tz_name):
        summary = await get_or_create_today(user_id, db, tz_name=tz_name)
        summary.trained = first_type is not None
        summary.training_type = first_type
        await db.flush()


def _effective_weight_for_volume(
    type_: str, weight_kg: Optional[float], user_weight_kg: Optional[float]
) -> float:
    """Mirrors social_notifications._user_weekly_volume_kg's bodyweight rule."""
    if weight_kg is not None and weight_kg > 0:
        return float(weight_kg)
    if type_ in BODYWEIGHT_EXERCISES and user_weight_kg:
        return float(user_weight_kg)
    return 0.0


@router.post("/log", status_code=201)
async def log_training(
    body: LogTrainingRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    from core.timezone import user_today
    today_local = user_today(current_user.timezone)
    target_date = body.date or today_local

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

    await _sync_training_summary(
        current_user.id, target_date, db, tz_name=current_user.timezone,
    )

    await db.commit()
    await db.refresh(entry)

    # Friend notifications — fire after commit so a failed push never aborts
    # the user's log. Skipped silently if anything fails.
    if target_date == today_local:
        try:
            await notify_pr_if_applicable(
                current_user, body.type, body.weight_kg, body.reps, db, redis
            )
            added_kg = _effective_weight_for_volume(
                body.type, body.weight_kg, current_user.weight_kg
            ) * (body.reps or 0)
            await notify_weekly_volume_overtakes(current_user, added_kg, db, redis)
        except Exception:  # noqa: BLE001
            pass
    return _log_dict(entry)


@router.post("/log-exercise", status_code=201)
async def log_exercise(
    body: LogExerciseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Log a whole exercise session as N rows (one per set)."""
    if not body.sets:
        raise HTTPException(400, "At least one set is required")

    from core.timezone import user_today
    target_date = body.date or user_today(current_user.timezone)
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
    await _sync_training_summary(
        current_user.id, target_date, db, tz_name=current_user.timezone,
    )

    await db.commit()
    for e in created:
        await db.refresh(e)

    # Friend notifications — only for today's logs. PR check uses the heaviest
    # set in the session; weekly volume sums all of them.
    if target_date == date.today() and created:
        try:
            top = max(created, key=lambda e: float(e.weight_kg or 0))
            await notify_pr_if_applicable(
                current_user,
                body.type,
                top.weight_kg,
                top.reps,
                db,
                redis,
            )
            added_kg = sum(
                _effective_weight_for_volume(
                    body.type, e.weight_kg, current_user.weight_kg
                )
                * (e.reps or 0)
                for e in created
            )
            await notify_weekly_volume_overtakes(
                current_user, added_kg, db, redis
            )
        except Exception:  # noqa: BLE001
            pass

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


# ─── Custom exercises ────────────────────────────────────────────────────────


_VALID_GROUPS = {"Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Other"}


class CustomExerciseRequest(BaseModel):
    name: str
    group_name: str = "Other"


@router.get("/custom-exercises")
async def list_custom_exercises(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CustomExercise)
        .where(CustomExercise.user_id == current_user.id)
        .order_by(CustomExercise.group_name, CustomExercise.name)
    )
    return [
        {
            "id": str(c.id),
            # Key used as TrainingLog.type: 'custom_<id>' prevents collision
            # with hardcoded keys and stays stable across renames if we add
            # those later.
            "key": f"custom_{c.id}",
            "name": c.name,
            "group_name": c.group_name,
            "created_at": c.created_at.isoformat(),
        }
        for c in result.scalars().all()
    ]


@router.post("/custom-exercises", status_code=201)
async def create_custom_exercise(
    body: CustomExerciseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name can't be empty")
    if len(name) > 80:
        raise HTTPException(400, "Name is too long (max 80 chars)")
    group = body.group_name if body.group_name in _VALID_GROUPS else "Other"

    # Check duplicate up-front for a friendly 409 instead of a constraint
    # violation with a noisy message.
    existing = await db.execute(
        select(CustomExercise).where(
            CustomExercise.user_id == current_user.id,
            sqlfunc.lower(CustomExercise.name) == name.lower(),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "You already have an exercise with that name")

    exercise = CustomExercise(user_id=current_user.id, name=name, group_name=group)
    db.add(exercise)
    await db.commit()
    await db.refresh(exercise)
    return {
        "id": str(exercise.id),
        "key": f"custom_{exercise.id}",
        "name": exercise.name,
        "group_name": exercise.group_name,
        "created_at": exercise.created_at.isoformat(),
    }


@router.delete("/custom-exercises/{exercise_id}", status_code=204)
async def delete_custom_exercise(
    exercise_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CustomExercise).where(
            CustomExercise.id == exercise_id,
            CustomExercise.user_id == current_user.id,
        )
    )
    exercise = result.scalar_one_or_none()
    if not exercise:
        raise HTTPException(404, "Custom exercise not found")
    # Note: existing TrainingLog rows that reference this key are *not*
    # cascaded — they stay in the history with `type='custom_<id>'` so logs
    # don't vanish if the user cleans up their picker.
    await db.delete(exercise)
    await db.commit()


# ─── Detected weekly split ───────────────────────────────────────────────────


@router.get("/split")
async def get_split(
    refresh: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the user's detected per-weekday split. weekday uses Python's
    Mon=0..Sun=6 convention. Pass ?refresh=true to re-run detection inline —
    useful right after a session log so the user sees an immediate update
    instead of waiting for the nightly job."""
    if refresh:
        try:
            await detect_split_for_user(current_user.id, db)
        except Exception:  # noqa: BLE001
            # Detection failures should never block returning whatever
            # split we already have on file.
            pass

    result = await db.execute(
        select(UserSplit)
        .where(UserSplit.user_id == current_user.id)
        .order_by(UserSplit.weekday.asc())
    )
    rows = result.scalars().all()
    return {
        "split": [
            {
                "weekday": r.weekday,
                "group_name": r.group_name,
                "confidence": r.confidence,
                "sample_count": r.sample_count,
                "updated_at": r.updated_at.isoformat(),
            }
            for r in rows
        ]
    }


# ─── 1RM estimates ───────────────────────────────────────────────────────────


@router.get("/one-rm")
async def one_rm(
    days: int = 90,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Best estimated 1RM per exercise from the user's last `days` of sets.

    For each (exercise, set), we compute the mean of Epley/Brzycki/Lombardi
    estimates. The reported per-exercise 1RM is the *max* of those means —
    i.e. the set that, by our formulas, implies the highest 1RM. We surface
    the source set so the UI can show 'from {weight}kg × {reps} on {date}'.
    """
    cutoff = date.today() - timedelta(days=max(7, min(days, 365)))
    result = await db.execute(
        select(TrainingLog)
        .where(
            TrainingLog.user_id == current_user.id,
            TrainingLog.date >= cutoff,
            TrainingLog.weight_kg.is_not(None),
            TrainingLog.reps.is_not(None),
        )
    )
    logs = result.scalars().all()

    # exercise -> best estimate so far + source set
    best: dict[str, dict] = {}
    for log in logs:
        if log.weight_kg is None or log.reps is None:
            continue
        if log.weight_kg <= 0 or log.reps <= 0:
            continue
        est = estimate_one_rm(float(log.weight_kg), int(log.reps))
        mean = est["mean"]
        if mean is None:
            continue
        existing = best.get(log.type)
        if existing is None or mean > existing["mean"]:
            best[log.type] = {
                "exercise": log.type,
                "mean": mean,
                "epley": est["epley"],
                "brzycki": est["brzycki"],
                "lombardi": est["lombardi"],
                "source": {
                    "weight_kg": float(log.weight_kg),
                    "reps": int(log.reps),
                    "date": log.date.isoformat(),
                    "log_id": str(log.id),
                },
            }

    rows = sorted(best.values(), key=lambda r: r["mean"], reverse=True)
    return {"window_days": cutoff and (date.today() - cutoff).days, "estimates": rows}


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

    await _sync_training_summary(
        current_user.id, target_date, db, tz_name=current_user.timezone,
    )

    await db.commit()
