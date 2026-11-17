from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta, date as DateType
from typing import Literal, Optional

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
from services.exercise_taxonomy import (
    EXERCISE_ATTACHMENTS,
    clean_attachment,
    group_for_exercise,
    groups_for_exercises,
    is_per_dumbbell,
)
from services.one_rm import estimate as estimate_one_rm
from services.progression import next_target
from services.plans import history_window
from services.social_notifications import (
    notify_pr_if_applicable,
    notify_weekly_volume_overtakes,
    set_volume_kg,
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
    # DateType, not `date`: a field named `date` annotated `date` resolves
    # to the field's own default (None), so any request with a date 422'd.
    date: Optional[DateType] = None
    attachment: Optional[str] = None


class LogSetRequest(BaseModel):
    weight_kg: Optional[float] = None
    reps: Optional[int] = None
    # "drop": straight on from the set before, lighter.
    set_type: Literal["normal", "drop"] = "normal"


class LogExerciseRequest(BaseModel):
    type: str  # exercise key
    sets: list[LogSetRequest]
    # Cable attachment (rope, triangle, ...); ignored for exercises without
    # one (services/exercise_taxonomy.py EXERCISE_ATTACHMENTS).
    attachment: Optional[str] = None
    notes: Optional[str] = None
    # DateType, not `date`: a field named `date` annotated `date` resolves
    # to the field's own default (None), so any request with a date 422'd.
    date: Optional[DateType] = None
    # "plan" when logged from a Pit Crew plan, so v2 can measure adherence.
    source: Optional[Literal["plan"]] = None


class LogSupersetRequest(BaseModel):
    """Two or more exercises done back to back; their sets share a superset_id."""
    exercises: list[LogExerciseRequest]
    date: Optional[DateType] = None


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
        "set_type": t.set_type,
        "superset_id": str(t.superset_id) if t.superset_id else None,
        "attachment": t.attachment,
        "logged_at": t.logged_at.isoformat(),
    }


def _attachment_filter(exercise_key: str, attachment: str | None) -> list:
    """Where-clauses for one lift. Exercises without attachments have none."""
    if exercise_key not in EXERCISE_ATTACHMENTS:
        return []
    if attachment is None:
        return [TrainingLog.attachment.is_(None)]
    return [TrainingLog.attachment == attachment]


async def _resolve_attachment(
    user_id, exercise_key: str, requested: str | None, db: AsyncSession,
) -> str | None:
    """`requested`: an attachment, "none" for sets logged without one, or
    left out for the one used last on this exercise (what the log sheet
    opens on, so a rope regular doesn't pick rope every time)."""
    if exercise_key not in EXERCISE_ATTACHMENTS or requested == "none":
        return None
    if requested is not None:
        return clean_attachment(exercise_key, requested)
    return await db.scalar(
        select(TrainingLog.attachment)
        .where(TrainingLog.user_id == user_id, TrainingLog.type == exercise_key)
        .order_by(TrainingLog.date.desc(), TrainingLog.logged_at.desc())
        .limit(1)
    )


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

    attachment = clean_attachment(body.type, body.attachment)
    entry = TrainingLog(
        user_id=current_user.id,
        date=target_date,
        type=body.type,
        attachment=attachment,
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
                current_user, body.type, body.weight_kg, body.reps, db, redis,
                attachment=attachment,
            )
            added_kg = set_volume_kg(
                body.type, body.weight_kg, body.reps, current_user.weight_kg
            )
            await notify_weekly_volume_overtakes(current_user, added_kg, db, redis)
        except Exception:  # noqa: BLE001
            pass
    return _log_dict(entry)


def _add_exercise_sets(
    body: LogExerciseRequest,
    user: User,
    target_date: date,
    db: AsyncSession,
    superset_id: uuid.UUID | None = None,
) -> list[TrainingLog]:
    created: list[TrainingLog] = []
    attachment = clean_attachment(body.type, body.attachment)
    for s in body.sets:
        if s.reps is None and s.weight_kg is None:
            continue
        # A drop set needs a set to drop from.
        set_type = s.set_type if created else "normal"
        entry = TrainingLog(
            user_id=user.id,
            date=target_date,
            type=body.type,
            volume_sets=len(created) + 1,
            weight_kg=s.weight_kg,
            reps=s.reps,
            notes=body.notes if not created else None,
            source=body.source,
            set_type=set_type,
            superset_id=superset_id,
            attachment=attachment,
        )
        db.add(entry)
        created.append(entry)
    return created


async def _after_log(
    user: User, target_date: date, created: list[TrainingLog], db: AsyncSession, redis
) -> None:
    """Commit, then friend notifications for today's logs. The PR check uses
    each exercise's heaviest set; weekly volume sums all of them."""
    await db.flush()
    await _sync_training_summary(user.id, target_date, db, tz_name=user.timezone)
    await db.commit()
    for e in created:
        await db.refresh(e)

    if target_date == date.today() and created:
        try:
            by_lift: dict[tuple, list[TrainingLog]] = defaultdict(list)
            for e in created:
                by_lift[(e.type, e.attachment)].append(e)
            for (type_, attachment), sets in by_lift.items():
                top = max(sets, key=lambda e: float(e.weight_kg or 0))
                await notify_pr_if_applicable(
                    user, type_, top.weight_kg, top.reps, db, redis, attachment=attachment,
                )
            added_kg = sum(
                set_volume_kg(e.type, e.weight_kg, e.reps, user.weight_kg)
                for e in created
            )
            await notify_weekly_volume_overtakes(user, added_kg, db, redis)
        except Exception:  # noqa: BLE001
            pass


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
    created = _add_exercise_sets(body, current_user, target_date, db)
    if not created:
        raise HTTPException(400, "No valid sets to log")

    await _after_log(current_user, target_date, created, db, redis)
    return [_log_dict(e) for e in created]


@router.post("/log-superset", status_code=201)
async def log_superset(
    body: LogSupersetRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Log exercises done back to back. Every set gets the same superset_id
    so history can show them together."""
    if len(body.exercises) < 2:
        raise HTTPException(400, "A superset needs at least two exercises")

    from core.timezone import user_today
    target_date = body.date or user_today(current_user.timezone)
    superset_id = uuid.uuid4()
    created: list[TrainingLog] = []
    for ex in body.exercises:
        created += _add_exercise_sets(ex, current_user, target_date, db, superset_id)
    if not created:
        raise HTTPException(400, "No valid sets to log")

    await _after_log(current_user, target_date, created, db, redis)
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


@router.get("/sessions")
async def get_sessions(
    days: int | None = None,
    limit: int = 30,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Training history as SESSIONS, newest first — one entry per day trained.

    /history returns raw sets in one flat list, which is fine for a feed but
    useless for "what did I do last Tuesday". This groups a day's sets into a
    session with a summary (exercises, set count, volume, top lift) and pages
    over days rather than rows, so a long history stays cheap to browse.
    """
    window, clamped = history_window(current_user, days)
    cutoff = date.today() - timedelta(days=window)

    # Page over distinct DAYS, not rows, so a limit of 30 means 30 sessions.
    day_rows = await db.execute(
        select(TrainingLog.date)
        .where(TrainingLog.user_id == current_user.id, TrainingLog.date >= cutoff)
        .group_by(TrainingLog.date)
        .order_by(TrainingLog.date.desc())
        .limit(max(1, min(limit, 100)))
        .offset(max(0, offset))
    )
    dates = [d for (d,) in day_rows.all()]
    if not dates:
        return {"sessions": [], "window_days": window, "clamped": clamped, "has_more": False}

    result = await db.execute(
        select(TrainingLog)
        .where(TrainingLog.user_id == current_user.id, TrainingLog.date.in_(dates))
        .order_by(TrainingLog.date.desc(), TrainingLog.logged_at.asc())
    )
    by_day: dict[date, list[TrainingLog]] = defaultdict(list)
    for log in result.scalars().all():
        by_day[log.date].append(log)

    sessions = []
    for d in dates:
        logs = by_day.get(d, [])
        # One row per lift: a rope and a triangle pushdown on the same day
        # are listed apart, each with its own top set.
        by_exercise: dict[tuple, list[TrainingLog]] = defaultdict(list)
        for log in logs:
            by_exercise[(log.type, log.attachment)].append(log)

        volume = sum(
            set_volume_kg(log.type, log.weight_kg, log.reps, current_user.weight_kg)
            for log in logs
        )
        top = max(
            (l for l in logs if l.weight_kg is not None and l.reps),
            key=lambda l: float(l.weight_kg or 0),
            default=None,
        )
        sessions.append({
            "date": d.isoformat(),
            "exercises": [
                {
                    "type": key,
                    "attachment": attachment,
                    "sets": len(sets),
                    "top_weight_kg": max(
                        (float(x.weight_kg) for x in sets if x.weight_kg is not None),
                        default=None,
                    ),
                    "top_reps": next(
                        (x.reps for x in sorted(
                            sets,
                            key=lambda y: float(y.weight_kg or 0),
                            reverse=True,
                        )),
                        None,
                    ),
                    "drop_sets": sum(1 for x in sets if x.set_type == "drop"),
                    # Exercises sharing one were done back to back.
                    "superset_id": next(
                        (str(x.superset_id) for x in sets if x.superset_id), None
                    ),
                    # Each set, so the app can delete one.
                    "logs": [
                        {
                            "id": str(x.id),
                            "weight_kg": float(x.weight_kg) if x.weight_kg is not None else None,
                            "reps": x.reps,
                            "set_type": x.set_type,
                        }
                        for x in sets
                    ],
                }
                for (key, attachment), sets in by_exercise.items()
            ],
            "exercise_count": len(by_exercise),
            "set_count": len(logs),
            "volume_kg": round(volume, 1),
            "top_lift": (
                {
                    "type": top.type, "attachment": top.attachment,
                    "weight_kg": float(top.weight_kg), "reps": top.reps,
                }
                if top else None
            ),
            "duration_min": next((l.duration_min for l in logs if l.duration_min), None),
        })

    # One extra day beyond the page tells the client whether to keep paging.
    more = await db.execute(
        select(TrainingLog.date)
        .where(TrainingLog.user_id == current_user.id, TrainingLog.date >= cutoff)
        .group_by(TrainingLog.date)
        .order_by(TrainingLog.date.desc())
        .limit(1)
        .offset(max(0, offset) + len(dates))
    )
    return {
        "sessions": sessions,
        "window_days": window,
        "clamped": clamped,
        "has_more": more.first() is not None,
    }


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
        volume_by_day[log.date.isoformat()] += set_volume_kg(
            log.type, log.weight_kg, log.reps, current_user.weight_kg
        )

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
    attachment: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """All logs for a specific exercise, grouped by session date, plus PR progression.

    Cable exercises are one attachment at a time (`attachment`: see
    _resolve_attachment); `attachments` lists every one logged in the
    window, so the chart can offer a switch only when there is a choice."""
    # The range picker offers 7/30/90/365; the plan decides how far back it can
    # actually reach (free 30, plus 90, pro 365), and `clamped` lets the app say
    # so rather than silently showing a shorter chart than the button promised.
    window, clamped = history_window(current_user, days)
    cutoff = date.today() - timedelta(days=window)
    attachment = await _resolve_attachment(current_user.id, exercise_key, attachment, db)

    result = await db.execute(
        select(TrainingLog)
        .where(
            TrainingLog.user_id == current_user.id,
            TrainingLog.type == exercise_key,
            TrainingLog.date >= cutoff,
        )
        .order_by(TrainingLog.date.asc(), TrainingLog.logged_at.asc())
    )
    all_logs = result.scalars().all()
    if exercise_key in EXERCISE_ATTACHMENTS:
        attachments = list(dict.fromkeys(log.attachment for log in all_logs))
        logs = [log for log in all_logs if log.attachment == attachment]
    else:
        attachments, logs = [], all_logs

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
            set_volume_kg(s.type, s.weight_kg, s.reps, current_user.weight_kg)
            for s in sets
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
        "attachment": attachment,
        "attachments": attachments,
        "progression": progression,
        "logs": [_log_dict(t) for t in logs],
        "window_days": window,
        "clamped": clamped,
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


# ─── Progressive overload ─────────────────────────────────────────────────────

PROGRESSION_LOOKBACK_DAYS = 120  # long enough to see 3 sessions of a weekly lift


def _sessions(logs: list[TrainingLog]) -> list[list[TrainingLog]]:
    """One exercise's logs grouped by day, oldest first, sets in order."""
    by_day: dict = defaultdict(list)
    for lg in sorted(logs, key=lambda x: (x.date, x.volume_sets or 0)):
        by_day[lg.date].append(lg)
    return [by_day[d] for d in sorted(by_day)]


@router.get("/progression")
async def progression_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per exercise logged lately: is it ready for more weight, or stalled?
    Drives the badges in the exercise list."""
    from core.timezone import user_today
    today = user_today(current_user.timezone)
    logs = (await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == current_user.id,
            TrainingLog.date >= today - timedelta(days=PROGRESSION_LOOKBACK_DAYS),
            TrainingLog.reps.is_not(None),
        )
    )).scalars().all()
    # Per exercise, the attachment it was done with last: that is the lift
    # the log sheet opens on, so it is the one the badge is about.
    latest: dict[str, TrainingLog] = {}
    for lg in logs:
        cur = latest.get(lg.type)
        if cur is None or (lg.date, lg.logged_at) > (cur.date, cur.logged_at):
            latest[lg.type] = lg
    by_key: dict[str, list[TrainingLog]] = defaultdict(list)
    for lg in logs:
        if lg.attachment == latest[lg.type].attachment:
            by_key[lg.type].append(lg)
    groups = await groups_for_exercises(list(by_key), db)
    out = {}
    for key, rows in by_key.items():
        t = next_target(_sessions(rows), groups.get(key), dumbbell=is_per_dumbbell(key))
        out[key] = {
            "kind": t["kind"], "ready_for_weight": t["ready_for_weight"], "stalled": t["stalled"],
            "attachment": latest[key].attachment,
        }
    return {"exercises": out}


@router.get("/progression/{exercise_key}")
async def progression_for_exercise(
    exercise_key: str,
    attachment: str | None = None,
    reps_min: int | None = None,
    reps_max: int | None = None,
    sets: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Next-session target for one exercise (services/progression.py): the
    "+1 rep" or "+weight" line and pre-filled sets in the log sheet.

    Cable exercises target one attachment (see _resolve_attachment). A Pit
    Crew plan passes its rep range and set count, for when the attachment
    is switched in the plan's log sheet."""
    from core.timezone import user_today
    today = user_today(current_user.timezone)
    attachment = await _resolve_attachment(current_user.id, exercise_key, attachment, db)
    logs = (await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == current_user.id,
            TrainingLog.type == exercise_key,
            TrainingLog.date >= today - timedelta(days=PROGRESSION_LOOKBACK_DAYS),
            TrainingLog.reps.is_not(None),
            *_attachment_filter(exercise_key, attachment),
        )
    )).scalars().all()
    sessions = _sessions(logs)
    # A session logged today is "this session", not the one to beat: target
    # off the one before so reopening the sheet mid-workout stays stable.
    done_today = bool(sessions) and sessions[-1][0].date == today
    basis = sessions[:-1] if done_today else sessions
    group = await group_for_exercise(exercise_key, db)
    plan = {
        "rep_range": (reps_min, reps_max) if reps_min and reps_max and reps_min <= reps_max else None,
        "planned_sets": sets if sets and sets > 0 else None,
        "dumbbell": is_per_dumbbell(exercise_key),
    }
    target = next_target(basis, group, **plan)
    nxt = next_target(sessions, group, **plan) if done_today else None
    return {
        "exercise": exercise_key,
        "attachment": attachment,
        "target": target,
        "last_date": basis[-1][0].date.isoformat() if basis else None,
        "logged_today": done_today,
        # After today's session: what to aim for next time.
        "next": nxt,
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

    # (exercise, attachment) -> best estimate so far + source set
    best: dict[tuple, dict] = {}
    for log in logs:
        if log.weight_kg is None or log.reps is None:
            continue
        if log.weight_kg <= 0 or log.reps <= 0:
            continue
        est = estimate_one_rm(float(log.weight_kg), int(log.reps))
        mean = est["mean"]
        if mean is None:
            continue
        # Per lift: a rope and a triangle pushdown are different numbers.
        lift = (log.type, log.attachment)
        existing = best.get(lift)
        if existing is None or mean > existing["mean"]:
            best[lift] = {
                "exercise": log.type,
                "attachment": log.attachment,
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


class AttachmentRequest(BaseModel):
    log_ids: list[uuid.UUID]
    attachment: Optional[str] = None  # None: no attachment


@router.patch("/attachment")
async def set_attachment(
    body: AttachmentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Say which attachment some sets were done with, from History: sets
    logged before attachments existed, or a wrong pick."""
    if not body.log_ids:
        return {"updated": 0}
    rows = (await db.execute(
        select(TrainingLog).where(
            TrainingLog.id.in_(body.log_ids[:200]),
            TrainingLog.user_id == current_user.id,
        )
    )).scalars().all()
    for row in rows:
        row.attachment = clean_attachment(row.type, body.attachment)
    await db.commit()
    return {"updated": len(rows)}


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
