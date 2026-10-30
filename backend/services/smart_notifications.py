"""Smart notifications: reminders timed by each user's own habits.

Runs every 15 minutes next to the water/coffee nudges (services/scheduler.py).
For each user with a push token it builds a habit profile
(services/behavior.py), lists what is due right now (`due`, plain code, no
DB) and sends at most one, subject to:

- the user's switches in Settings (NotificationSettings.off),
- quiet hours: nothing before 08:00, or later than an hour before bedtime,
- MAX_PER_DAY a day, at least MIN_GAP apart,
- once per dedupe key (a unique PushEvent row; survives restarts), and
- backoff: when the last BACKOFF_AFTER reminders of a kind were neither
  opened nor followed by the log they were about, that kind pauses for
  BACKOFF_DAYS. One more goes out after the pause; ignored again, it pauses
  again.

Kinds, in priority order:
- workout_preview: a Pit Crew training day, 90 min before their usual time
  (09:00 without one), with the progressive-overload call for the main
  lifts (services/plan_today.py).
- meal: a meal they log on at least half of days isn't logged by the time
  they usually have it logged.
- workout_log: a day they'd normally train (plan, or 60%+ of those
  weekdays) with nothing logged an hour after they're usually done.
- protein: in the evening, tracking food today, under 75% of the target.
- weigh_in: a regular weigher, overdue by twice their usual gap.
- comeback: 3 days with no logs at all (once more at 7) for someone who
  was logging before. Then nothing until they're back.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal
from core.timezone import user_now
from models.ai_plan import AiPlan
from models.push_event import NotificationSettings, PushEvent
from models.push_token import PushToken
from models.user import User
from services import push
from services.behavior import MEALS, Profile, load_profile
from services.plan_edit import day_for_date
from services.plan_today import target_lines, todays_targets

logger = logging.getLogger(__name__)

MAX_PER_DAY = 3
MIN_GAP = timedelta(minutes=90)
BACKOFF_AFTER = 4
BACKOFF_DAYS = 7
KEEP_EVENTS_DAYS = 60
DAY_START = 8 * 60
MIN_MEAL_SHARE = 0.5
TRAIN_DAY_SHARE = 0.6
MIN_SESSIONS = 4
PROTEIN_SHORT = 0.75
PROTEIN_MIN_GAP_G = 30

# Settings switches. "water_coffee" gates services/notifier.py.
CATEGORIES = {
    "meals": ("Meal reminders", "When a meal you usually log isn't logged yet."),
    "training": ("Training days", "Your targets before you train, and a reminder to log your sets."),
    "protein": ("Protein check", "One evening reminder when you're well short of your protein target."),
    "weigh_in": ("Weigh-ins", "When you're overdue for your usual weigh-in."),
    "comeback": ("After a break", "After 3 days without logging, and once more after 7."),
    "water_coffee": ("Water and coffee", "At the times you usually log them, with a Log button."),
}
KIND_CATEGORY = {
    "workout_preview": "training",
    "meal": "meals",
    "workout_log": "training",
    "protein": "protein",
    "weigh_in": "weigh_in",
    "comeback": "comeback",
}
# How long after a reminder a log still counts as acting on it.
ACT_WINDOW = {
    "workout_preview": timedelta(hours=16),
    "meal": timedelta(hours=3),
    "workout_log": timedelta(hours=6),
    "protein": timedelta(hours=4),
    "weigh_in": timedelta(hours=12),
    "comeback": timedelta(hours=24),
}
# Screens a tap may open (the app keeps the same list).
ROUTES = {"/", "/ask", "/training", "/nutrition", "/nutrition-snap", "/body"}
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


@dataclass(frozen=True)
class Reminder:
    kind: str
    key: str
    title: str
    body: str
    route: str


@dataclass
class Context:
    """What `due` needs besides the habit profile."""
    last_minute: int                     # quiet hours start after this
    protein_target: float | None = None
    plan_day: str | None = None          # name of today's Pit Crew session
    plan_lines: list[str] = field(default_factory=list)
    has_plan: bool = False


def quiet_after(sleep_hour: int | None) -> int:
    """Last minute of the day a reminder may go out: an hour before bedtime,
    never past 23:00. Bedtimes after midnight count as 24+."""
    h = 23 if sleep_hour is None else sleep_hour
    if h < 12:
        h += 24
    return min(h * 60 - 60, 23 * 60)


def preview_minute(p: Profile) -> int:
    t = p.training
    return max(DAY_START, t.start_minute - 90) if t else 9 * 60


def due(p: Profile, ctx: Context) -> list[Reminder]:
    """Reminders that would make sense right now, most urgent first.
    Switches, caps, dedupe and backoff are the caller's job."""
    now, today = p.minute, p.today
    if now < DAY_START or now > ctx.last_minute:
        return []
    out: list[Reminder] = []
    t = p.training

    if ctx.plan_day and not p.trained_today:
        at = preview_minute(p)
        if at <= now <= at + 120:
            body = " · ".join(ctx.plan_lines) or "Open your plan for today's weights."
            out.append(Reminder("workout_preview", f"workout_preview:{today}", f"{ctx.plan_day} today", body, "/ask"))

    order = list(MEALS)
    for meal, h in p.meals.items():
        later_logged = any(m in p.meals_today for m in order[order.index(meal):])
        if later_logged or h.share < MIN_MEAL_SHARE:
            continue
        at = max(h.late_minute + 20, h.usual_minute + 30)
        if at <= now <= MEALS[meal][1] + 60:
            out.append(Reminder(
                "meal", f"meal:{meal}:{today}", f"{meal.capitalize()} not logged yet",
                "You usually have it logged by now. A photo takes a few seconds.",
                "/nutrition-snap",
            ))

    expected = bool(ctx.plan_day) or bool(t and t.weekday_share[today.weekday()] >= TRAIN_DAY_SHARE)
    if expected and t and t.sessions >= MIN_SESSIONS and not p.trained_today:
        if now >= max(t.end_minute + 60, 18 * 60):
            body = (
                f"{ctx.plan_day} is still open in your plan. Log your sets so next session's targets update."
                if ctx.plan_day else
                f"You usually train on {WEEKDAY_NAMES[today.weekday()]}s. Log your sets so your next targets update."
            )
            out.append(Reminder("workout_log", f"workout_log:{today}", "Trained today?", body,
                                "/ask" if ctx.plan_day else "/training"))

    target = ctx.protein_target
    if target and p.food_entries_today >= 2 and len(p.meals_today) >= 2:
        gap = target - p.protein_today
        if now >= max(18 * 60, ctx.last_minute - 120) and p.protein_today < PROTEIN_SHORT * target and gap >= PROTEIN_MIN_GAP_G:
            out.append(Reminder(
                "protein", f"protein:{today}", f"{round(gap)} g of protein to go",
                f"You're at {round(p.protein_today)} of {round(target)} g today. "
                "A protein-rich snack this evening closes most of the gap.",
                "/nutrition",
            ))

    w = p.weigh_in
    if w and not w.synced and not p.weighed_today:
        days = (today - w.last).days
        if days >= max(2, round(w.gap_days * 2)):
            at = max(DAY_START, w.usual_minute + 30)
            if at <= now <= at + 180:
                out.append(Reminder(
                    "weigh_in", f"weigh_in:{w.last}", "Time for a weigh-in",
                    f"It's been {days} days. Same time of day as usual keeps your trend accurate.",
                    "/body",
                ))

    last = max(p.active_dates) if p.active_dates else None
    if last and last < today:
        quiet = (today - last).days
        stage = 7 if quiet >= 7 else 3 if quiet >= 3 else None
        before = sum(1 for d in p.active_dates if last - timedelta(days=28) <= d <= last)
        at = min(max(p.usual_active_minute or 18 * 60, 9 * 60), 20 * 60)
        if stage and quiet <= 14 and before >= 5 and now >= at:
            if stage == 3:
                title, body = "Pick up where you left off", (
                    "3 days since your last log. Log one thing today, a meal or a glass of water, to get going again."
                )
            else:
                title = "Your plan is still here" if ctx.has_plan else "Your progress is still here"
                body = "A week off happens. Log one thing today and everything picks up from there."
            out.append(Reminder("comeback", f"comeback:{last}:{stage}", title, body, "/"))
    return out


def mark_acted(events: list[PushEvent], p: Profile) -> None:
    """Fill acted_at on reminders followed by the log they were about."""
    times = {
        "meal": p.food_times,
        "protein": p.food_times,
        "workout_preview": p.training_times,
        "workout_log": p.training_times,
        "weigh_in": p.weigh_times,
    }
    for e in events:
        if e.acted_at is not None or e.kind not in ACT_WINDOW:
            continue
        pool = times[e.kind] if e.kind in times else p.any_times()
        end = e.sent_at + ACT_WINDOW[e.kind]
        hit = min((t for t in pool if e.sent_at <= _utc(t) <= end), default=None, key=_utc)
        if hit is not None:
            e.acted_at = _utc(hit)


def paused_until(kind: str, events: list[PushEvent]) -> datetime | None:
    """When a kind the user keeps ignoring may go out again, or None."""
    same = sorted((e for e in events if e.kind == kind), key=lambda e: e.sent_at, reverse=True)[:BACKOFF_AFTER]
    if len(same) < BACKOFF_AFTER or any(e.opened_at or e.acted_at for e in same):
        return None
    until = same[0].sent_at + timedelta(days=BACKOFF_DAYS)
    return until if until > datetime.now(timezone.utc) else None


def _utc(t: datetime) -> datetime:
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


async def switched_off(user_id: uuid.UUID, db: AsyncSession) -> set[str]:
    row = await db.get(NotificationSettings, user_id)
    return set(row.off or []) if row else set()


async def recent_events(user_id: uuid.UUID, db: AsyncSession, days: int = 30) -> list[PushEvent]:
    return list((await db.execute(
        select(PushEvent).where(
            PushEvent.user_id == user_id,
            PushEvent.sent_at >= datetime.now(timezone.utc) - timedelta(days=days),
        )
    )).scalars().all())


async def _ready_plan(user_id: uuid.UUID, db: AsyncSession) -> AiPlan | None:
    return (await db.execute(
        select(AiPlan)
        .where(AiPlan.user_id == user_id, AiPlan.status == "ready")
        .order_by(AiPlan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()


async def build_context(user: User, p: Profile, db: AsyncSession) -> Context:
    ctx = Context(
        last_minute=quiet_after(user.sleep_hour),
        protein_target=user.protein_target_g or (user.weight_kg * 2 if user.weight_kg else None),
    )
    row = await _ready_plan(user.id, db)
    if row is None:
        return ctx
    ctx.has_plan = True
    day = day_for_date(row.plan or {}, p.today)
    if day is None:
        return ctx
    ctx.plan_day = day["name"]
    # The per-lift targets need a log query: only when the preview is due.
    at = preview_minute(p)
    if not p.trained_today and at <= p.minute <= at + 120:
        found = await todays_targets(user, row, p.today, db)
        if found:
            ctx.plan_lines = target_lines(found[1], user.units)
    return ctx


async def process_user(user: User, db: AsyncSession) -> bool:
    """Send this user's most urgent due reminder, if any. True if sent."""
    now = user_now(user.timezone)
    minute = now.hour * 60 + now.minute
    if minute < DAY_START or minute > quiet_after(user.sleep_hour):
        return False  # cheap exit before any log query
    off = await switched_off(user.id, db)
    if all(c in off for c in KIND_CATEGORY.values()):
        return False

    events = await recent_events(user.id, db)
    now_utc = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    if sum(1 for e in events if e.sent_at >= day_start) >= MAX_PER_DAY:
        return False
    if events and now_utc - max(e.sent_at for e in events) < MIN_GAP:
        return False

    p = await load_profile(user, db, now)
    mark_acted(events, p)
    ctx = await build_context(user, p, db)
    sent_keys = {e.dedupe_key for e in events}
    for r in due(p, ctx):
        if KIND_CATEGORY[r.kind] in off or r.key in sent_keys or paused_until(r.kind, events):
            continue
        event_id = uuid.uuid4()
        delivered = await push.send_to_user(
            user.id, db, title=r.title, body=r.body,
            data={"type": "smart", "kind": r.kind, "event_id": str(event_id), "route": r.route},
        )
        if delivered:
            db.add(PushEvent(id=event_id, user_id=user.id, kind=r.kind, dedupe_key=r.key, sent_at=now_utc))
            await db.commit()
            return True
        break  # no device took it; try again next run
    await db.commit()  # acted_at updates
    return False


async def dispatch_smart_notifications() -> None:
    """Scheduler entry point: every user with an active push token."""
    async with AsyncSessionLocal() as db:
        user_ids = (await db.execute(
            select(PushToken.user_id).where(PushToken.active == True).distinct()  # noqa: E712
        )).scalars().all()
    sent = failed = 0
    for user_id in user_ids:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None:
                continue
            try:
                sent += await process_user(user, db)
            except Exception as e:  # noqa: BLE001
                failed += 1
                logger.warning("dispatch_smart_notifications: user=%s failed: %s", user_id, e)
    logger.info("dispatch_smart_notifications: users=%d sent=%d failed=%d", len(user_ids), sent, failed)


async def prune_push_events() -> None:
    """Nightly: drop rows older than KEEP_EVENTS_DAYS. Dedupe keys are per
    day or per stretch, so nothing older matters."""
    async with AsyncSessionLocal() as db:
        await db.execute(delete(PushEvent).where(
            PushEvent.sent_at < datetime.now(timezone.utc) - timedelta(days=KEEP_EVENTS_DAYS)
        ))
        await db.commit()


def habits_summary(p: Profile) -> dict:
    """What Settings shows under "What the app has learned"."""
    t, w = p.training, p.weigh_in
    return {
        "meals": [
            {
                "meal": meal,
                "usual_minute": h.usual_minute,
                "remind_minute": max(h.late_minute + 20, h.usual_minute + 30),
                "share": h.share,
            }
            for meal, h in p.meals.items() if h.share >= MIN_MEAL_SHARE
        ],
        "training": {
            "weekdays": [i for i, s in enumerate(t.weekday_share) if s >= TRAIN_DAY_SHARE],
            "start_minute": t.start_minute,
            "sessions": t.sessions,
        } if t and t.sessions >= MIN_SESSIONS else None,
        "weigh_in": {
            "usual_minute": w.usual_minute,
            "every_days": w.gap_days,
        } if w and not w.synced else None,
    }
