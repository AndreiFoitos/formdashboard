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

from core.config import settings
from core.database import AsyncSessionLocal
from core.timezone import user_now
from models.ai_plan import AiPlan
from models.push_event import NotificationSettings, PushEvent
from models.push_token import PushToken
from models.user import User
from services import push
from services.behavior import MEALS, Profile, load_profile, meal_of
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


def clock(minute: int) -> str:
    """Minute of the day → "1:30 PM", the app's format."""
    h, m = divmod(minute % 1440, 60)
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


# The texts. Real reminders and the tester's "Send a test" share them.

def preview_reminder(day_name: str, lines: list[str], today: date) -> Reminder:
    body = " · ".join(lines) or "Open your plan for today's weights."
    return Reminder("workout_preview", f"workout_preview:{today}", f"{day_name} today", body, "/ask")


def meal_reminder(meal: str, today: date) -> Reminder:
    return Reminder(
        "meal", f"meal:{meal}:{today}", f"{meal.capitalize()} not logged yet",
        "You usually have it logged by now. A photo takes a few seconds.", "/nutrition-snap",
    )


def workout_log_reminder(plan_day: str | None, today: date) -> Reminder:
    body = (
        f"{plan_day} is still open in your plan. Log your sets so next session's targets update."
        if plan_day else
        f"You usually train on {WEEKDAY_NAMES[today.weekday()]}s. Log your sets so your next targets update."
    )
    return Reminder("workout_log", f"workout_log:{today}", "Trained today?", body, "/ask" if plan_day else "/training")


def protein_reminder(eaten: float, target: float, today: date) -> Reminder:
    return Reminder(
        "protein", f"protein:{today}", f"{round(target - eaten)} g of protein to go",
        f"You're at {round(eaten)} of {round(target)} g today. "
        "A protein-rich snack this evening closes most of the gap.",
        "/nutrition",
    )


def weigh_in_reminder(days: int, last: date) -> Reminder:
    return Reminder(
        "weigh_in", f"weigh_in:{last}", "Time for a weigh-in",
        f"It's been {days} days. Same time of day as usual keeps your trend accurate.", "/body",
    )


def comeback_reminder(stage: int, last: date, has_plan: bool) -> Reminder:
    if stage == 3:
        title = "Pick up where you left off"
        body = "3 days since your last log. Log one thing today, a meal or a glass of water, to get going again."
    else:
        title = "Your plan is still here" if has_plan else "Your progress is still here"
        body = "A week off happens. Log one thing today and everything picks up from there."
    return Reminder("comeback", f"comeback:{last}:{stage}", title, body, "/")


@dataclass(frozen=True)
class Check:
    """One reminder's verdict right now: `due` sends the ones with a
    reminder, and testers see every reason (GET /notifications/debug)."""
    kind: str
    label: str
    reminder: Reminder | None
    reason: str


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


def checks(p: Profile, ctx: Context) -> list[Check]:
    """Every kind of reminder, most urgent first, each with why it is or
    isn't due right now. Ignores quiet hours (see `due`)."""
    now, today = p.minute, p.today
    out: list[Check] = []
    t = p.training

    label = "Training targets"
    if not ctx.plan_day:
        out.append(Check("workout_preview", label, None, "No Pit Crew session in your plan today."))
    elif p.trained_today:
        out.append(Check("workout_preview", label, None, "Training is already logged today."))
    else:
        at = preview_minute(p)
        when = f"90 minutes before you usually train ({clock(t.start_minute)})" if t else "no usual training time yet"
        if now < at:
            out.append(Check("workout_preview", label, None, f"Goes out at {clock(at)}: {when}."))
        elif now <= at + 120:
            out.append(Check("workout_preview", label, preview_reminder(ctx.plan_day, ctx.plan_lines, today),
                             f"Due: {ctx.plan_day} is on your plan today, {when}."))
        else:
            out.append(Check("workout_preview", label, None, f"Its window was {clock(at)} to {clock(at + 120)}."))

    order = list(MEALS)
    for meal in order:
        h, label = p.meals.get(meal), meal.capitalize()
        if h is None:
            reason = "Not a habit yet: it needs logging on 6 or more days in 4 weeks."
        elif h.share < MIN_MEAL_SHARE:
            reason = f"Logged on {round(h.share * 100)}% of days. Reminders start at 50%."
        elif meal in p.meals_today:
            reason = "Already logged today."
        elif any(m in p.meals_today for m in order[order.index(meal) + 1:]):
            reason = "A later meal is already logged today."
        else:
            at, end = max(h.late_minute + 20, h.usual_minute + 30), MEALS[meal][1] + 60
            if now < at:
                reason = f"You usually log it around {clock(h.usual_minute)}. Reminder after {clock(at)} if it's still missing."
            elif now <= end:
                out.append(Check("meal", label, meal_reminder(meal, today),
                                 f"Due: you usually have it logged by {clock(h.late_minute)}."))
                continue
            else:
                reason = f"Too late to be useful today (until {clock(end)})."
        out.append(Check("meal", label, None, reason))

    label = "Log your sets"
    share = t.weekday_share[today.weekday()] if t else 0.0
    if not t or t.sessions < MIN_SESSIONS:
        out.append(Check("workout_log", label, None,
                         f"Needs 4 logged sessions in 4 weeks ({t.sessions if t else 0} so far)."))
    elif not (ctx.plan_day or share >= TRAIN_DAY_SHARE):
        out.append(Check("workout_log", label, None,
                         f"Not a usual training day: {WEEKDAY_NAMES[today.weekday()]}s {round(share * 100)}% of weeks."))
    elif p.trained_today:
        out.append(Check("workout_log", label, None, "Training is already logged today."))
    else:
        at = max(t.end_minute + 60, 18 * 60)
        if now < at:
            out.append(Check("workout_log", label, None, f"Reminder after {clock(at)} if nothing is logged."))
        else:
            out.append(Check("workout_log", label, workout_log_reminder(ctx.plan_day, today),
                             f"Due: you're usually done by {clock(t.end_minute)}."))

    label, target = "Protein check", ctx.protein_target
    if not target:
        out.append(Check("protein", label, None, "No protein target set."))
    elif p.food_entries_today < 2 or len(p.meals_today) < 2:
        out.append(Check("protein", label, None, "Needs at least 2 meals logged today."))
    else:
        eaten, at = p.protein_today, max(18 * 60, ctx.last_minute - 120)
        so_far = f"{round(eaten)} of {round(target)} g so far."
        if eaten >= PROTEIN_SHORT * target or target - eaten < PROTEIN_MIN_GAP_G:
            out.append(Check("protein", label, None, f"On track: {so_far}"))
        elif now < at:
            out.append(Check("protein", label, None, f"{so_far} Checks again after {clock(at)}."))
        else:
            out.append(Check("protein", label, protein_reminder(eaten, target, today), f"Due: {so_far}"))

    label, w = "Weigh-in", p.weigh_in
    if not w:
        out.append(Check("weigh_in", label, None, "Needs 4 weigh-ins in the last 4 weeks."))
    elif w.synced:
        out.append(Check("weigh_in", label, None, "A connected scale logs your weigh-ins."))
    elif p.weighed_today:
        out.append(Check("weigh_in", label, None, "Already weighed in today."))
    else:
        days, after = (today - w.last).days, max(2, round(w.gap_days * 2))
        at = max(DAY_START, w.usual_minute + 30)
        if days < after:
            out.append(Check("weigh_in", label, None,
                             f"Last one {_days(days)} ago. Reminder once it's been {_days(after)}."))
        elif now < at:
            out.append(Check("weigh_in", label, None, f"Overdue. Goes out at {clock(at)}."))
        elif now <= at + 180:
            out.append(Check("weigh_in", label, weigh_in_reminder(days, w.last),
                             f"Due: {_days(days)} since the last one."))
        else:
            out.append(Check("weigh_in", label, None,
                             f"Overdue, but its window was {clock(at)} to {clock(at + 180)}. Tries again tomorrow."))

    label = "After a break"
    last = max(p.active_dates) if p.active_dates else None
    if last is None:
        out.append(Check("comeback", label, None, "No logs yet."))
    elif last >= today:
        out.append(Check("comeback", label, None, "You've logged today."))
    else:
        quiet = (today - last).days
        stage = 7 if quiet >= 7 else 3 if quiet >= 3 else None
        before = sum(1 for d in p.active_dates if last - timedelta(days=28) <= d <= last)
        at = min(max(p.usual_active_minute or 18 * 60, 9 * 60), 20 * 60)
        if stage is None:
            reason = f"Last log {_days(quiet)} ago. Starts after 3 quiet days."
        elif quiet > 14:
            reason = "More than 2 weeks away: it has stopped."
        elif before < 5:
            reason = "Only for people who were logging regularly before."
        elif now < at:
            reason = f"{_days(quiet)} without a log. Goes out at {clock(at)}."
        else:
            out.append(Check("comeback", label, comeback_reminder(stage, last, ctx.has_plan),
                             f"Due: {_days(quiet)} without a log."))
            return out
        out.append(Check("comeback", label, None, reason))
    return out


def due(p: Profile, ctx: Context) -> list[Reminder]:
    """Reminders that would make sense right now, most urgent first.
    Switches, caps, dedupe and backoff are the caller's job."""
    if p.minute < DAY_START or p.minute > ctx.last_minute:
        return []
    return [c.reminder for c in checks(p, ctx) if c.reminder]


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


async def build_context(user: User, p: Profile, db: AsyncSession, all_lines: bool = False) -> Context:
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
    # The per-lift targets need a log query: only when the preview is due
    # (or a tester asks).
    at = preview_minute(p)
    if all_lines or (not p.trained_today and at <= p.minute <= at + 120):
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


# ─── Testing tools (Settings > Notifications > Reminders, testers only) ──────

TEST_KINDS = ("workout_preview", "meal", "workout_log", "protein", "weigh_in", "comeback")


def is_tester(user: User) -> bool:
    """Accounts that see the testing tools: the emails in REMINDER_TESTERS."""
    allowed = {e.strip().lower() for e in settings.REMINDER_TESTERS.split(",") if e.strip()}
    return bool(user.email) and user.email.lower() in allowed


async def debug_report(user: User, db: AsyncSession) -> dict:
    """Each kind of reminder with what it would do right now and why, plus
    anything holding all of them back (quiet hours, the daily limit, the
    gap since the last one)."""
    now = user_now(user.timezone)
    p = await load_profile(user, db, now)
    ctx = await build_context(user, p, db, all_lines=True)
    off = await switched_off(user.id, db)
    events = await recent_events(user.id, db)
    mark_acted(events, p)
    await db.commit()

    blocked = []
    if p.minute < DAY_START or p.minute > ctx.last_minute:
        blocked.append(f"Quiet hours: reminders go out between {clock(DAY_START)} and {clock(ctx.last_minute)}.")
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    sent_today = sum(1 for e in events if e.sent_at >= day_start)
    if sent_today >= MAX_PER_DAY:
        blocked.append(f"{MAX_PER_DAY} already sent today, the daily limit.")
    last = max((e.sent_at for e in events), default=None)
    if last and datetime.now(timezone.utc) - last < MIN_GAP:
        nxt = (last + MIN_GAP).astimezone(now.tzinfo)
        blocked.append(f"The last one went out less than 90 minutes ago. Next one from {clock(nxt.hour * 60 + nxt.minute)}.")

    sent_keys = {e.dedupe_key for e in events}
    rows = []
    for c in checks(p, ctx):
        if KIND_CATEGORY[c.kind] in off:
            status = "off"
        elif c.reminder and c.reminder.key in sent_keys:
            status = "sent"
        elif paused_until(c.kind, events):
            status = "paused"
        else:
            status = "due" if c.reminder else "waiting"
        rows.append({"kind": c.kind, "label": c.label, "status": status, "reason": c.reason})
    return {
        "local_time": clock(p.minute),
        "timezone": user.timezone or "UTC",
        "sent_today": sent_today,
        "blocked": blocked,
        "checks": rows,
    }


async def send_test(user: User, kind: str, db: AsyncSession) -> tuple[int, Reminder]:
    """Send one reminder of `kind` right now, with the user's own numbers
    where there are any. Not recorded, so it doesn't count towards the daily
    limit, dedupe or backoff."""
    now = user_now(user.timezone)
    p = await load_profile(user, db, now)
    ctx = await build_context(user, p, db, all_lines=True)
    today = p.today
    if kind == "workout_preview":
        r = (preview_reminder(ctx.plan_day, ctx.plan_lines, today) if ctx.plan_day else
             preview_reminder("Push day", ["Bench press ↑ 82.5 kg", "Rows +1 rep at 60 kg"], today))
    elif kind == "meal":
        r = meal_reminder(meal_of(p.minute) or "lunch", today)
    elif kind == "workout_log":
        r = workout_log_reminder(ctx.plan_day, today)
    elif kind == "protein":
        target = ctx.protein_target or 150
        eaten = p.protein_today if p.protein_today < PROTEIN_SHORT * target else target / 2
        r = protein_reminder(eaten, target, today)
    elif kind == "weigh_in":
        w = p.weigh_in
        r = weigh_in_reminder(max(2, (today - w.last).days) if w else 3, w.last if w else today)
    else:
        r = comeback_reminder(3, today - timedelta(days=3), ctx.has_plan)
    delivered = await push.send_to_user(
        user.id, db, title=r.title, body=r.body,
        data={"type": "smart", "kind": r.kind, "event_id": str(uuid.uuid4()), "route": r.route},
    )
    return delivered, r
