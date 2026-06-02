"""Per-user logging-rhythm detector.

For each user × log-type, finds the 30-minute slots in the week where they
consistently log something, and what they typically log there. Powers the
predictive notification scheduler (services/scheduler.py::dispatch_predictive_nudges)
and the notification payload it sends.

The "model" here is intentionally a recency-weighted histogram, not ML — see
the project notes for why (thin per-user data, ML overfits, baseline is fine
until we have ≥60 days × ~50 users). Same I/O so a real classifier can drop
in later behind `get_patterns_for_user`.
"""
from __future__ import annotations

import uuid
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.hydration_log import HydrationLog
from models.stimulant_log import StimulantLog


def _resolve_tz(tz_name: str | None) -> ZoneInfo:
    if not tz_name:
        return ZoneInfo("UTC")
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


LogType = Literal["hydration", "stimulant"]

LOOKBACK_DAYS = 30
RECENCY_HALF_LIFE_DAYS = 14
SLOT_MINUTES = 30
MIN_DISTINCT_DAYS = 3        # slot must fire on ≥3 different days in window
MIN_CONFIDENCE = 0.55        # below this, slot is too noisy to notify on


@dataclass(frozen=True)
class PatternSlot:
    log_type: LogType
    weekday: int               # 0=Mon ... 6=Sun, in user's local tz
    slot_minute: int           # minute-of-day, aligned to SLOT_MINUTES
    confidence: float          # 0..1
    sample_count: int          # distinct days the slot fired on
    suggested_amount_ml: int | None = None
    suggested_substance: str | None = None
    suggested_caffeine_mg: int | None = None

    def matches_now(self, now_local_min: int, now_weekday: int, window_min: int = 15) -> bool:
        if now_weekday != self.weekday:
            return False
        delta = abs(now_local_min - self.slot_minute)
        # Handle wrap across midnight: a slot at 23:45 vs now at 00:00 = 15 min apart
        delta = min(delta, 1440 - delta)
        return delta <= window_min


def _recency_weight(log_age_days: float) -> float:
    return 0.5 ** (log_age_days / RECENCY_HALF_LIFE_DAYS)


def _slot_minute(dt: datetime) -> int:
    """Round dt's time-of-day down to the nearest SLOT_MINUTES boundary."""
    mins = dt.hour * 60 + dt.minute
    return (mins // SLOT_MINUTES) * SLOT_MINUTES


def _summarise_slots(
    log_type: LogType,
    entries: Iterable[tuple[datetime, float, str | None, int | None]],
    now: datetime,
    tz: ZoneInfo,
) -> list[PatternSlot]:
    """entries: iterable of (logged_at_utc, weight_or_amount, substance, caffeine_mg).

    For hydration `weight_or_amount` is amount_ml; for stimulant it's caffeine_mg
    (so we can use the same median calc for "typical dose"). The actual recency
    weighting is computed inside. Weekday/slot are computed in the user's local
    timezone so a 6 AM PST coffee groups with other 6 AM PST coffees regardless
    of DST or how the row was stored.
    """
    # Index: (weekday, slot_min) → list of (date, amount, substance, caffeine, weight)
    buckets: dict[tuple[int, int], list[tuple]] = defaultdict(list)

    for logged_at, amount, substance, caffeine in entries:
        if logged_at.tzinfo is None:
            logged_at = logged_at.replace(tzinfo=timezone.utc)
        age_days = (now - logged_at).total_seconds() / 86400.0
        if age_days < 0 or age_days > LOOKBACK_DAYS:
            continue
        w = _recency_weight(age_days)
        local = logged_at.astimezone(tz)
        key = (local.weekday(), _slot_minute(local))
        buckets[key].append((local.date(), amount, substance, caffeine, w))

    # Window has ~LOOKBACK_DAYS/7 ≈ 4.3 occurrences of each weekday. A slot
    # that fires every one of those gets confidence 1.0.
    max_possible = LOOKBACK_DAYS / 7.0

    slots: list[PatternSlot] = []
    for (weekday, slot_min), rows in buckets.items():
        distinct_days = {r[0] for r in rows}
        if len(distinct_days) < MIN_DISTINCT_DAYS:
            continue

        # Confidence = raw "how often does this slot fire on this weekday"
        # frequency. We deliberately do NOT discount old hits here — a user
        # who has consistently drunk water at 9 AM for 4 weeks shouldn't
        # need a fresh hit today to qualify; the recency-weighting role is
        # to make the *amount* median lean on recent behavior (below).
        raw_freq = len(distinct_days) / max_possible
        # Soft staleness penalty: if the most-recent hit is >14d old, decay.
        # most_recent_weight = max of recency weights across logs.
        most_recent_weight = max(r[4] for r in rows)
        confidence = min(1.0, raw_freq) * (0.6 + 0.4 * most_recent_weight)

        if confidence < MIN_CONFIDENCE:
            continue

        amounts = [r[1] for r in rows if r[1] is not None]
        substances = [r[2] for r in rows if r[2]]
        caffeines = [r[3] for r in rows if r[3] is not None]

        slot = PatternSlot(
            log_type=log_type,
            weekday=weekday,
            slot_minute=slot_min,
            confidence=round(confidence, 3),
            sample_count=len(distinct_days),
            suggested_amount_ml=int(statistics.median(amounts)) if log_type == "hydration" and amounts else None,
            suggested_substance=Counter(substances).most_common(1)[0][0] if substances else None,
            suggested_caffeine_mg=int(statistics.median(caffeines)) if log_type == "stimulant" and caffeines else None,
        )
        slots.append(slot)

    slots.sort(key=lambda s: (-s.confidence, s.weekday, s.slot_minute))
    return slots


async def get_hydration_patterns(
    user_id: uuid.UUID, db: AsyncSession, tz_name: str | None = None
) -> list[PatternSlot]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    result = await db.execute(
        select(HydrationLog.logged_at, HydrationLog.amount_ml)
        .where(HydrationLog.user_id == user_id, HydrationLog.logged_at >= cutoff)
    )
    rows = [(r[0], r[1], None, None) for r in result.all()]
    return _summarise_slots("hydration", rows, datetime.now(timezone.utc), _resolve_tz(tz_name))


async def get_stimulant_patterns(
    user_id: uuid.UUID, db: AsyncSession, tz_name: str | None = None
) -> list[PatternSlot]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    result = await db.execute(
        select(StimulantLog.logged_at, StimulantLog.caffeine_mg, StimulantLog.substance)
        .where(StimulantLog.user_id == user_id, StimulantLog.logged_at >= cutoff)
    )
    rows = [(r[0], r[1], r[2], r[1]) for r in result.all()]
    return _summarise_slots("stimulant", rows, datetime.now(timezone.utc), _resolve_tz(tz_name))


async def get_patterns_for_user(
    user_id: uuid.UUID, db: AsyncSession, tz_name: str | None = None
) -> list[PatternSlot]:
    """All patterns across enabled log types, sorted by confidence desc."""
    hydration = await get_hydration_patterns(user_id, db, tz_name)
    stimulants = await get_stimulant_patterns(user_id, db, tz_name)
    combined = hydration + stimulants
    combined.sort(key=lambda s: -s.confidence)
    return combined
