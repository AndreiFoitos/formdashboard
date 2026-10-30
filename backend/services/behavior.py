"""Habit profiles for smart notifications (services/smart_notifications.py):
when this user usually logs each meal, trains and weighs in, and how
regularly. Plain code, recency-weighted counts like services/log_patterns.py,
for the same reason: per-user data is thin and a model would overfit.

The prediction every reminder rests on is "would they normally have done
this by now?". A meal counts as a habit when it's logged on at least half
the days. Once the clock passes the time by which they usually have it
logged (the 80th percentile of their log times), a missing log is more
likely forgotten than skipped, and that's when a reminder helps. Things
they rarely log never get a reminder.

Times are local minutes of the day. Only entries logged on the day they
belong to count towards times, so backfilling last week doesn't read as a
habit of logging at 22:00.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from statistics import median

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import resolve_tz
from models.body_metric import BodyMetric
from models.hydration_log import HydrationLog
from models.nutrition_log import NutritionLog
from models.stimulant_log import StimulantLog
from models.training_log import TrainingLog
from models.user import User

LOOKBACK_DAYS = 28
TRAINING_LOOKBACK_DAYS = 42   # six of each weekday
ACTIVITY_LOOKBACK_DAYS = 45   # 2 quiet weeks + the 4 active weeks before
HALF_LIFE_DAYS = 14
MIN_MEAL_DAYS = 6
MIN_WEIGH_INS = 4
LATE_QUANTILE = 0.8

# Local minute-of-day windows, the same split as services/saved_meals.py.
MEALS = {
    "breakfast": (5 * 60, 11 * 60),
    "lunch": (11 * 60, 15 * 60),
    "dinner": (15 * 60, 22 * 60),
}


@dataclass(frozen=True)
class Habit:
    share: float          # recency-weighted share of days it happens, 0..1
    usual_minute: int     # weighted median
    late_minute: int      # by this minute it's usually done
    days: int             # distinct days seen


@dataclass(frozen=True)
class TrainingHabit:
    weekday_share: tuple[float, ...]   # Mon..Sun, share of those days trained
    start_minute: int                  # usual first set
    end_minute: int                    # usually done logging by
    sessions: int                      # sessions in the last 28 days


@dataclass(frozen=True)
class WeighInHabit:
    count: int            # manual weigh-ins in the last 28 days
    usual_minute: int
    gap_days: float       # median days between weigh-ins
    last: date
    synced: bool          # a connected scale logs them, so no reminders


@dataclass
class Profile:
    now: datetime                      # local
    meals: dict[str, Habit]
    training: TrainingHabit | None
    weigh_in: WeighInHabit | None
    # Today so far.
    meals_today: set[str]
    food_entries_today: int
    protein_today: float
    trained_today: bool
    weighed_today: bool
    # Days with any log (food, training, weight, water, coffee).
    active_dates: set[date]
    usual_active_minute: int | None
    # UTC times of recent logs, to tell whether a reminder was acted on.
    food_times: list[datetime] = field(default_factory=list)
    training_times: list[datetime] = field(default_factory=list)
    weigh_times: list[datetime] = field(default_factory=list)
    other_times: list[datetime] = field(default_factory=list)

    @property
    def today(self) -> date:
        return self.now.date()

    @property
    def minute(self) -> int:
        return minute_of(self.now)

    def any_times(self) -> list[datetime]:
        return self.food_times + self.training_times + self.weigh_times + self.other_times


def minute_of(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _weight(age_days: float) -> float:
    return 0.5 ** (age_days / HALF_LIFE_DAYS)


def weighted_quantile(values: list[float], weights: list[float], q: float) -> float:
    pairs = sorted(zip(values, weights))
    total = sum(w for _, w in pairs)
    acc = 0.0
    for v, w in pairs:
        acc += w
        if acc >= q * total - 1e-9:
            return v
    return pairs[-1][0]


def meal_of(minute: int) -> str | None:
    return next((m for m, (lo, hi) in MEALS.items() if lo <= minute < hi), None)


def _window(today: date, days: int, since: date | None) -> date:
    start = today - timedelta(days=days)
    return max(start, since) if since else start


def meal_habits(times: list[datetime], today: date, since: date | None = None) -> dict[str, Habit]:
    """`times`: local datetimes of food entries logged on their own day.
    Days before today only; `since` (sign-up) shortens the window for new
    accounts so a week-old account isn't measured against 28 days."""
    start = _window(today, LOOKBACK_DAYS, since)
    span = (today - start).days
    if span <= 0:
        return {}
    first: dict[tuple[date, str], int] = {}
    for t in times:
        d, m = t.date(), minute_of(t)
        meal = meal_of(m)
        if meal and start <= d < today and m < first.get((d, meal), 10_000):
            first[(d, meal)] = m
    total = sum(_weight(i + 1) for i in range(span))
    out = {}
    for meal in MEALS:
        hits = [(d, m) for (d, k), m in first.items() if k == meal]
        if len(hits) < MIN_MEAL_DAYS:
            continue
        ws = [_weight((today - d).days) for d, _ in hits]
        mins = [m for _, m in hits]
        out[meal] = Habit(
            share=round(min(1.0, sum(ws) / total), 3),
            usual_minute=int(weighted_quantile(mins, ws, 0.5)),
            late_minute=int(weighted_quantile(mins, ws, LATE_QUANTILE)),
            days=len(hits),
        )
    return out


def training_habit(sessions: dict[date, tuple[int, int]], today: date, since: date | None = None) -> TrainingHabit | None:
    """`sessions`: {date: (first set minute, last set minute)}, local."""
    start = _window(today, TRAINING_LOOKBACK_DAYS, since)
    past = {d: v for d, v in sessions.items() if start <= d < today}
    if not past:
        return None
    shares = []
    days = [start + timedelta(days=i) for i in range((today - start).days)]
    for wd in range(7):
        on = [d for d in days if d.weekday() == wd]
        total = sum(_weight((today - d).days) for d in on)
        hit = sum(_weight((today - d).days) for d in on if d in past)
        shares.append(round(hit / total, 3) if total else 0.0)
    dates = list(past)
    ws = [_weight((today - d).days) for d in dates]
    return TrainingHabit(
        weekday_share=tuple(shares),
        start_minute=int(weighted_quantile([past[d][0] for d in dates], ws, 0.5)),
        end_minute=int(weighted_quantile([past[d][1] for d in dates], ws, LATE_QUANTILE)),
        sessions=sum(1 for d in dates if d >= today - timedelta(days=LOOKBACK_DAYS)),
    )


def weigh_in_habit(entries: list[tuple[date, datetime, str]], today: date) -> WeighInHabit | None:
    """`entries`: (date, local logged_at, source) per weigh-in."""
    start = today - timedelta(days=LOOKBACK_DAYS)
    recent = [e for e in entries if start <= e[0] <= today]
    # Earliest per day wins: iterate latest first so it's written last.
    by_day = {d: (d, t) for d, t, src in sorted(recent, key=lambda e: e[1], reverse=True) if src == "manual"}
    if len(by_day) < MIN_WEIGH_INS:
        return None
    dates = sorted(by_day)
    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    same_day = [minute_of(by_day[d][1]) for d in dates if by_day[d][1].date() == d]
    return WeighInHabit(
        count=len(dates),
        usual_minute=int(median(same_day)) if same_day else 8 * 60,
        gap_days=float(median(gaps)),
        last=dates[-1],
        synced=any(src != "manual" for _, _, src in recent),
    )


def usual_active_minute(firsts: dict[date, int]) -> int | None:
    """Median time of a user's first log of the day."""
    return int(median(firsts.values())) if len(firsts) >= MIN_MEAL_DAYS else None


async def load_profile(user: User, db: AsyncSession, now: datetime | None = None) -> Profile:
    """Four or five small queries over the last few weeks of logs."""
    tz = resolve_tz(user.timezone)
    now = now or datetime.now(tz)
    today = now.date()
    since = user.created_at.astimezone(tz).date() if user.created_at else None
    cutoff = datetime.now(timezone.utc) - timedelta(days=ACTIVITY_LOOKBACK_DAYS)
    uid: uuid.UUID = user.id

    def local(t: datetime) -> datetime:
        return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).astimezone(tz)

    active: set[date] = set()
    firsts: dict[date, int] = {}

    def seen(d: date, t: datetime | None = None) -> None:
        active.add(d)
        if t is not None and t.date() == d:
            m = minute_of(t)
            firsts[d] = min(firsts.get(d, m), m)

    food = (await db.execute(
        select(NutritionLog.date, NutritionLog.logged_at, NutritionLog.protein_g)
        .where(NutritionLog.user_id == uid, NutritionLog.date >= today - timedelta(days=ACTIVITY_LOOKBACK_DAYS))
    )).all()
    food_local = []
    meals_today: set[str] = set()
    protein_today, entries_today = 0.0, 0
    for d, at, protein in food:
        t = local(at)
        seen(d, t)
        if t.date() == d:
            food_local.append(t)
        if d == today:
            entries_today += 1
            protein_today += protein or 0
            if meal := meal_of(minute_of(t)):
                meals_today.add(meal)

    training = (await db.execute(
        select(TrainingLog.date, TrainingLog.logged_at)
        .where(TrainingLog.user_id == uid, TrainingLog.date >= today - timedelta(days=ACTIVITY_LOOKBACK_DAYS))
    )).all()
    sessions: dict[date, tuple[int, int]] = {}
    for d, at in training:
        t = local(at)
        seen(d, t)
        if t.date() == d:
            m = minute_of(t)
            lo, hi = sessions.get(d, (m, m))
            sessions[d] = (min(lo, m), max(hi, m))

    body = (await db.execute(
        select(BodyMetric.date, BodyMetric.logged_at, BodyMetric.source)
        .where(
            BodyMetric.user_id == uid,
            BodyMetric.weight_kg.is_not(None),
            BodyMetric.date >= today - timedelta(days=ACTIVITY_LOOKBACK_DAYS),
        )
    )).all()
    for d, at, _ in body:
        seen(d, local(at))

    other = []
    for model in (HydrationLog, StimulantLog):
        for (at,) in (await db.execute(
            select(model.logged_at).where(model.user_id == uid, model.logged_at >= cutoff)
        )).all():
            t = local(at)
            seen(t.date(), t)
            other.append(at)

    return Profile(
        now=now,
        meals=meal_habits(food_local, today, since),
        training=training_habit(sessions, today, since),
        weigh_in=weigh_in_habit([(d, local(at), src or "manual") for d, at, src in body], today),
        meals_today=meals_today,
        food_entries_today=entries_today,
        protein_today=protein_today,
        trained_today=any(d == today for d, _ in training),
        weighed_today=any(d == today for d, _, _ in body),
        active_dates=active,
        usual_active_minute=usual_active_minute(firsts),
        food_times=[at for _, at, _ in food],
        training_times=[at for _, at in training],
        weigh_times=[at for _, at, _ in body],
        other_times=other,
    )
