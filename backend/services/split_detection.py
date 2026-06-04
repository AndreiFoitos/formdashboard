"""Auto-detected per-weekday training split.

Definition: for each weekday (Mon..Sun), look at every distinct date in the
lookback window the user trained. Bucket each date's training logs into
muscle groups. The 'dominant group' for that date is the group whose
exercises were trained MOST. The split for a weekday = the dominant-group
that appeared most often across dates, provided it hit MIN_SAMPLES.

We use 'distinct dates' rather than raw log count so a 12-set chest day
isn't 12× the weight of a 1-set legs day on the same weekday.

Nightly job: detect_all_user_splits, mirrors saved_meals' pattern.
"""
from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal
from models.training_log import TrainingLog
from models.user import User
from models.user_split import UserSplit
from services.exercise_taxonomy import groups_for_exercises


LOOKBACK_DAYS = 28
MIN_SAMPLES = 3  # distinct dates on a weekday before we commit a split


async def detect_for_user(user_id, db: AsyncSession) -> int:
    """Detect this user's split. Upserts UserSplit rows for every weekday
    that hit MIN_SAMPLES. Deletes rows for weekdays that no longer qualify
    so a stale 'Mon = Chest' from two months ago doesn't linger after the
    user pivots their schedule. Returns the count of weekdays with a
    detected group."""
    cutoff = date.today() - timedelta(days=LOOKBACK_DAYS)
    result = await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == user_id,
            TrainingLog.date >= cutoff,
        )
    )
    logs = list(result.scalars().all())
    if not logs:
        # Clear any stale rows for a user who hasn't trained in 28 days.
        existing = await db.execute(
            select(UserSplit).where(UserSplit.user_id == user_id)
        )
        for row in existing.scalars().all():
            await db.delete(row)
        await db.commit()
        return 0

    # Look up the group for every exercise_key in one query.
    group_map = await groups_for_exercises([l.type for l in logs], db)

    # date → Counter(group → count of sets on that date)
    per_date: dict[date, Counter] = defaultdict(Counter)
    for log in logs:
        group = group_map.get(log.type)
        if not group:
            continue
        per_date[log.date][group] += 1

    # weekday → Counter(group → number of distinct dates that group dominated)
    per_weekday: dict[int, Counter] = defaultdict(Counter)
    # weekday → total distinct dates this user trained on that weekday
    weekday_totals: dict[int, int] = defaultdict(int)
    for d, group_counts in per_date.items():
        if not group_counts:
            continue
        dominant_group, _n = group_counts.most_common(1)[0]
        wd = d.weekday()  # Monday=0..Sunday=6
        per_weekday[wd][dominant_group] += 1
        weekday_totals[wd] += 1

    # Wipe + rewrite the user's rows. Two operations per nightly run is fine.
    existing = await db.execute(
        select(UserSplit).where(UserSplit.user_id == user_id)
    )
    for row in existing.scalars().all():
        await db.delete(row)
    await db.flush()

    detected = 0
    for wd, counter in per_weekday.items():
        top_group, top_count = counter.most_common(1)[0]
        if top_count < MIN_SAMPLES:
            continue
        total = weekday_totals.get(wd, top_count)
        confidence = top_count / total if total > 0 else 0.0
        db.add(
            UserSplit(
                user_id=user_id,
                weekday=wd,
                group_name=top_group,
                sample_count=top_count,
                confidence=round(confidence, 2),
            )
        )
        detected += 1

    await db.commit()
    return detected


async def detect_all_user_splits() -> None:
    """Scheduler entry — fan out across all users with isolated failures."""
    logger = logging.getLogger(__name__)
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id))
        user_ids = [row[0] for row in result.all()]

    success = 0
    skipped = 0
    total_detected = 0
    for user_id in user_ids:
        async with AsyncSessionLocal() as db:
            try:
                total_detected += await detect_for_user(user_id, db)
                success += 1
            except Exception as e:  # noqa: BLE001
                skipped += 1
                logger.warning(
                    "detect_for_user_split user=%s failed: %s", user_id, e
                )
    logger.info(
        "detect_all_user_splits: success=%d skipped=%d total=%d weekdays=%d",
        success,
        skipped,
        len(user_ids),
        total_detected,
    )
