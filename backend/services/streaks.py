"""Logging streak: consecutive days, in the user's own timezone, with at least
one log of food, training, water, caffeine or body weight / body fat.

The streak is worked out from the logs whenever something reads it (Form
Score, avatar milestones) instead of being bumped by each log endpoint. That
way deleting a log (the undo toast) or adding one for an earlier day changes
it too, and a new log endpoint doesn't have to remember to call anything.

Each refresh re-reads only the last RECHECK_DAYS of logs. A longer run carries
on from the saved row: last_processed_date is the latest day with a log and
current_streak the run ending on it, so the saved run says how many of its
days fall before the re-read window. When the saved run doesn't reach that far
(an earlier day was filled in, or nothing refreshed for a while), older logs
are read in pages instead. A user's first refresh reads up to a year of
history, so a run from before streaks were tracked counts toward the longest.

No log yet today doesn't break the streak: it stands through yesterday until
the user's own midnight. longest_streak never goes down.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable, Iterable

from sqlalchemy import select, union, union_all
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import resolve_tz, user_today
from models.body_metric import BodyMetric
from models.hydration_log import HydrationLog
from models.nutrition_log import NutritionLog
from models.stimulant_log import StimulantLog
from models.streak import Streak
from models.training_log import TrainingLog
from models.user import User

# Days re-read from the logs on every refresh; older days trust the saved row.
RECHECK_DAYS = 14
# How far each extra read goes back when a run is longer than the saved row knows.
PAGE_DAYS = 60
# Never look further back than this.
MAX_LOOKBACK_DAYS = 366

ONE_DAY = timedelta(days=1)


@dataclass(frozen=True)
class StreakState:
    current: int
    longest: int
    last_date: date | None  # latest day with a log, as of the last refresh


# (since, until) -> local days in that range, both ends included, with a log.
FetchDays = Callable[[date, date], Awaitable[set[date]]]


def run_ending(logged: set[date], end: date, start: date) -> int:
    """Consecutive logged days counting back from `end`, not looking before `start`."""
    n = 0
    day = end
    while day >= start and day in logged:
        n += 1
        day -= ONE_DAY
    return n


def longest_run(logged: Iterable[date]) -> int:
    best = run = 0
    prev = None
    for day in sorted(set(logged)):
        run = run + 1 if prev is not None and day - prev == ONE_DAY else 1
        best = max(best, run)
        prev = day
    return best


def saved_days_before(saved: StreakState, start: date) -> int:
    """How many days of the saved run fall before `start`. 0 when the saved
    run doesn't reach the day before `start`."""
    if not saved.current or saved.last_date is None or saved.last_date < start - ONE_DAY:
        return 0
    run_start = saved.last_date - timedelta(days=saved.current - 1)
    return max(0, (start - run_start).days)


async def compute_streak(saved: StreakState, today: date, fetch: FetchDays) -> StreakState:
    floor = today - timedelta(days=MAX_LOOKBACK_DAYS)
    start = floor if saved.last_date is None else today - timedelta(days=RECHECK_DAYS)
    logged = await fetch(start, today)

    end = today if today in logged else today - ONE_DAY
    current = run_ending(logged, end, start)
    # Logged all the way back to the start of what was read: continue from the
    # saved run, or read further back when it doesn't reach that far.
    while current and end - timedelta(days=current - 1) == start and start > floor:
        carried = saved_days_before(saved, start)
        if carried:
            current += carried
            break
        older = max(floor, start - timedelta(days=PAGE_DAYS))
        logged = logged | await fetch(older, start - ONE_DAY)
        start = older
        current = run_ending(logged, end, start)

    return StreakState(
        current=current,
        longest=max(saved.longest, current, longest_run(logged)),
        last_date=max(logged, default=saved.last_date),
    )


def local_days(stamps: Iterable[datetime], tz_name: str | None) -> set[date]:
    """The user's local calendar day of each timestamp."""
    tz = resolve_tz(tz_name)
    days = set()
    for ts in stamps:
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        days.add(ts.astimezone(tz).date())
    return days


async def logged_days(user: User, db: AsyncSession, since: date, until: date) -> set[date]:
    """Local days from `since` to `until` (both included) with any log."""
    uid = user.id
    dated = union(
        select(NutritionLog.date).where(
            NutritionLog.user_id == uid, NutritionLog.date >= since, NutritionLog.date <= until,
        ),
        select(TrainingLog.date).where(
            TrainingLog.user_id == uid, TrainingLog.date >= since, TrainingLog.date <= until,
        ),
        select(BodyMetric.date).where(
            BodyMetric.user_id == uid, BodyMetric.date >= since, BodyMetric.date <= until,
        ),
    )
    days = set((await db.execute(dated)).scalars().all())

    # Water and caffeine only have a timestamp: bound it by the user's local
    # midnights, then turn each one into their local day.
    tz = resolve_tz(user.timezone)
    lo = datetime.combine(since, datetime.min.time()).replace(tzinfo=tz)
    hi = datetime.combine(until + ONE_DAY, datetime.min.time()).replace(tzinfo=tz)
    stamped = union_all(
        select(HydrationLog.logged_at).where(
            HydrationLog.user_id == uid, HydrationLog.logged_at >= lo, HydrationLog.logged_at < hi,
        ),
        select(StimulantLog.logged_at).where(
            StimulantLog.user_id == uid, StimulantLog.logged_at >= lo, StimulantLog.logged_at < hi,
        ),
    )
    stamps = (await db.execute(stamped)).scalars().all()
    days |= {d for d in local_days(stamps, user.timezone) if since <= d <= until}
    return days


async def refresh_streak(user: User, db: AsyncSession) -> Streak:
    """Bring the user's streak row up to date with their logs and return it.
    Flushes; the caller commits."""
    row = await db.get(Streak, user.id)
    if row is None:
        # Sign-up creates the row; this covers accounts made any other way.
        await db.execute(
            pg_insert(Streak)
            .values(user_id=user.id, current_streak=0, longest_streak=0)
            .on_conflict_do_nothing(index_elements=["user_id"])
        )
        row = await db.get(Streak, user.id)

    saved = StreakState(row.current_streak or 0, row.longest_streak or 0, row.last_processed_date)

    async def fetch(since: date, until: date) -> set[date]:
        return await logged_days(user, db, since, until)

    new = await compute_streak(saved, user_today(user.timezone), fetch)
    if new != saved:
        row.current_streak = new.current
        row.longest_streak = new.longest
        row.last_processed_date = new.last_date
        await db.flush()
    return row
