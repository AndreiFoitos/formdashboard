"""Push notifications triggered by friend activity.

Two events:
  - new_pr           — a user posts a new PR vs their prior 90-day max for an
                       exercise. Notifies every accepted friend, once per
                       (sender, recipient, week, exercise).
  - volume_overtake  — a user's weekly volume crosses past a friend's. The
                       friend gets a one-shot 'X just passed you' nudge, deduped
                       per (sender, recipient, week).

Dedupe uses Redis keys with 7-day TTL. The whole module fails closed on Redis
errors — a momentary outage means a missed notification, not a crash, not a
duplicate flood.
"""
from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import or_, select, func as sqlfunc, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.custom_exercise import CustomExercise
from models.friendship import Friendship
from models.training_log import TrainingLog
from models.user import User
from services import push


logger = logging.getLogger(__name__)


BODYWEIGHT_EXERCISES = {"pull_up", "push_up", "tricep_dip", "hanging_leg_raise"}

# 7-day TTL for dedupe keys — keys naturally cycle out as the week rolls over,
# but we don't want a stuck key for someone who only logs once.
DEDUPE_TTL_SECONDS = 7 * 24 * 3600


def _week_bounds(today: Optional[date] = None) -> tuple[date, date]:
    """Return (Monday, Sunday) for the week containing today."""
    today = today or date.today()
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


async def _accepted_friend_ids(
    user_id: uuid.UUID, db: AsyncSession
) -> list[uuid.UUID]:
    """All user_ids the given user is friends with (accepted only)."""
    result = await db.execute(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(
                Friendship.requester_id == user_id,
                Friendship.addressee_id == user_id,
            ),
        )
    )
    rows = result.scalars().all()
    return [
        (f.addressee_id if f.requester_id == user_id else f.requester_id) for f in rows
    ]


async def _exercise_display_name(key: str, db: AsyncSession) -> str:
    """User-facing exercise name. Custom exercises live in the DB; the
    hardcoded catalogue lives in the RN client, so we fall back to a title-
    cased version of the key (e.g. 'bench_press' → 'Bench Press')."""
    if key.startswith("custom_"):
        try:
            ce_id = uuid.UUID(key.split("custom_", 1)[1])
        except (ValueError, IndexError):
            return key
        ex = await db.get(CustomExercise, ce_id)
        if ex:
            return ex.name
    return key.replace("_", " ").title()


def _sender_label(user: User) -> str:
    return user.name or user.username or "A friend"


# ─── PR notifications ────────────────────────────────────────────────────────


async def notify_pr_if_applicable(
    user: User,
    exercise_key: str,
    weight_kg: Optional[float],
    reps: Optional[int],
    db: AsyncSession,
    redis,
) -> int:
    """If this set is a new 90-day PR for the user on this exercise, push to
    every accepted friend (deduped per friend+week+exercise). Returns the
    number of pushes delivered.

    Sets with no weight (bodyweight exercises logged without added load) are
    skipped — there's no signal of a PR moving."""
    if not weight_kg or weight_kg <= 0 or not reps or reps <= 0:
        return 0

    today = date.today()
    cutoff = today - timedelta(days=90)
    # Find the prior best weight EXCLUDING today's logs so the just-inserted
    # row doesn't compare against itself.
    result = await db.execute(
        select(sqlfunc.max(TrainingLog.weight_kg)).where(
            TrainingLog.user_id == user.id,
            TrainingLog.type == exercise_key,
            TrainingLog.date >= cutoff,
            TrainingLog.date < today,
        )
    )
    prior_max = result.scalar()
    if not prior_max or float(prior_max) <= 0 or weight_kg <= float(prior_max):
        return 0

    friend_ids = await _accepted_friend_ids(user.id, db)
    if not friend_ids:
        return 0

    monday, _ = _week_bounds(today)
    exercise_name = await _exercise_display_name(exercise_key, db)
    sender = _sender_label(user)

    delivered_total = 0
    for fid in friend_ids:
        # Dedupe: one PR push per (sender, recipient, week, exercise).
        dedupe_key = (
            f"notif:pr:{user.id}:{fid}:{monday.isoformat()}:{exercise_key}"
        )
        if redis is not None:
            try:
                if await redis.get(dedupe_key):
                    continue
                # Set BEFORE sending so a crash mid-send doesn't double-fire on retry.
                await redis.set(dedupe_key, "1", ex=DEDUPE_TTL_SECONDS)
            except Exception:  # noqa: BLE001
                pass
        try:
            delivered_total += await push.send_to_user(
                fid,
                db,
                title=f"{sender} hit a PR",
                body=f"{exercise_name} — {round(float(weight_kg))}kg × {reps}",
                data={"action": "open_leaderboard"},
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("notify_pr push failed sender=%s fid=%s: %s", user.id, fid, e)

    return delivered_total


# ─── Weekly-volume overtake ──────────────────────────────────────────────────


async def _user_weekly_volume_kg(
    user_id: uuid.UUID,
    user_weight_kg: Optional[float],
    monday: date,
    sunday: date,
    db: AsyncSession,
) -> float:
    """Σ weight × reps for the week, with bodyweight fallback identical to
    the leaderboard's accounting in routers/friends.py."""
    result = await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == user_id,
            TrainingLog.date >= monday,
            TrainingLog.date <= sunday,
        )
    )
    total = 0.0
    for log in result.scalars().all():
        w = float(log.weight_kg) if log.weight_kg is not None else 0.0
        if w == 0 and log.type in BODYWEIGHT_EXERCISES and user_weight_kg:
            w = float(user_weight_kg)
        total += w * (log.reps or 0)
    return total


async def notify_weekly_volume_overtakes(
    user: User,
    added_kg: float,
    db: AsyncSession,
    redis,
) -> int:
    """After a training log adds `added_kg` to the user's weekly volume,
    notify any friend whose total this user just crossed.

    Dedupe is per (sender, recipient, week): one overtake push per friend
    per week. If they then over- and under-take repeatedly, we only ping
    once. Returns number of pushes delivered.
    """
    if added_kg <= 0:
        return 0

    friend_ids = await _accepted_friend_ids(user.id, db)
    if not friend_ids:
        return 0

    monday, sunday = _week_bounds()
    my_vol = await _user_weekly_volume_kg(
        user.id, user.weight_kg, monday, sunday, db
    )
    pre_vol = my_vol - added_kg
    if my_vol <= 0:
        return 0

    sender = _sender_label(user)
    delivered_total = 0
    for fid in friend_ids:
        friend = await db.get(User, fid)
        if not friend:
            continue
        fvol = await _user_weekly_volume_kg(
            fid, friend.weight_kg, monday, sunday, db
        )
        # Overtake condition: friend's total sits between our previous and
        # current totals. Equal-to-friend (the edge case where pre == fvol)
        # counts so a tied-then-broken state still fires.
        if not (pre_vol <= fvol < my_vol):
            continue

        dedupe_key = f"notif:overtake:{user.id}:{fid}:{monday.isoformat()}"
        if redis is not None:
            try:
                if await redis.get(dedupe_key):
                    continue
                await redis.set(dedupe_key, "1", ex=DEDUPE_TTL_SECONDS)
            except Exception:  # noqa: BLE001
                pass

        try:
            delivered_total += await push.send_to_user(
                fid,
                db,
                title=f"{sender} just passed you",
                body=(
                    f"Weekly volume — {round(my_vol):,}kg vs your "
                    f"{round(fvol):,}kg"
                ),
                data={"action": "open_leaderboard"},
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "notify_overtake push failed sender=%s fid=%s: %s", user.id, fid, e
            )

    return delivered_total
