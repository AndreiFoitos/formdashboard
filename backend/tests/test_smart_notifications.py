"""Smart reminders: habit detection (services/behavior.py), what is due when
(services/smart_notifications.due), backoff, and the per-user dispatch with
push sending and the DB faked. Also the plan's next-time targets."""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import services.plan_today as plan_today
import services.smart_notifications as sn
from models.push_event import PushEvent
from models.user import User
from services.behavior import (
    Habit,
    Profile,
    TrainingHabit,
    WeighInHabit,
    meal_habits,
    training_habit,
    weigh_in_habit,
)

TODAY = date(2026, 10, 29)  # a Thursday


def at(hour, minute=0, day=TODAY):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)


def profile(hour, minute=0, **kw):
    base = dict(
        now=at(hour, minute),
        meals={},
        training=None,
        weigh_in=None,
        meals_today=set(),
        food_entries_today=0,
        protein_today=0.0,
        trained_today=False,
        weighed_today=False,
        active_dates={TODAY},
        usual_active_minute=None,
    )
    base.update(kw)
    return Profile(**base)


def ctx(**kw):
    return sn.Context(last_minute=22 * 60, **kw)


def kinds(p, c=None):
    return [r.kind for r in sn.due(p, c or ctx())]


LUNCH = Habit(share=0.8, usual_minute=13 * 60, late_minute=13 * 60 + 30, days=20)


# ─── Habits ──────────────────────────────────────────────────────────────────


def test_meal_habit_from_regular_lunches():
    times = [at(12, 50, TODAY - timedelta(days=d)) + timedelta(minutes=d % 3 * 10) for d in range(1, 21)]
    habits = meal_habits(times, TODAY)
    assert set(habits) == {"lunch"}
    lunch = habits["lunch"]
    assert lunch.days == 20 and lunch.share >= 0.6
    assert 12 * 60 + 50 <= lunch.usual_minute <= 13 * 60 + 10 <= lunch.late_minute


def test_rare_meals_and_backfills_are_not_habits():
    # Five breakfasts isn't enough; today's entry doesn't count either.
    times = [at(8, 0, TODAY - timedelta(days=d)) for d in range(0, 6)]
    assert meal_habits(times, TODAY) == {}


def test_new_account_is_measured_from_sign_up():
    since = TODAY - timedelta(days=8)
    times = [at(19, 0, TODAY - timedelta(days=d)) for d in range(1, 8)]
    assert meal_habits(times, TODAY, since)["dinner"].share > 0.8
    assert meal_habits(times, TODAY)["dinner"].share < 0.5


def test_training_habit_by_weekday():
    days = (TODAY - timedelta(days=n) for n in range(1, 43))
    sessions = {d: (18 * 60, 19 * 60 + 15) for d in days if d.weekday() in (0, 3)}  # Mon, Thu
    t = training_habit(sessions, TODAY)
    assert t.weekday_share[0] == 1.0 and t.weekday_share[3] == 1.0 and t.weekday_share[2] == 0
    assert t.start_minute == 18 * 60 and t.end_minute == 19 * 60 + 15


def test_weigh_in_habit():
    entries = [(TODAY - timedelta(days=d), at(7, 30, TODAY - timedelta(days=d)), "manual") for d in (3, 5, 7, 9, 11)]
    w = weigh_in_habit(entries, TODAY)
    assert w.count == 5 and w.gap_days == 2 and w.last == TODAY - timedelta(days=3)
    assert w.usual_minute == 7 * 60 + 30 and not w.synced
    assert weigh_in_habit(entries[:3], TODAY) is None


# ─── What's due ──────────────────────────────────────────────────────────────


def test_meal_reminder_after_the_usual_time_only():
    assert kinds(profile(13, 40, meals={"lunch": LUNCH})) == []
    assert kinds(profile(13, 50, meals={"lunch": LUNCH})) == ["meal"]
    # Too late to be useful.
    assert kinds(profile(16, 30, meals={"lunch": LUNCH})) == []


def test_no_meal_reminder_once_logged_or_past_it():
    assert kinds(profile(14, meals={"lunch": LUNCH}, meals_today={"lunch"})) == []
    assert kinds(profile(14, meals={"lunch": LUNCH}, meals_today={"dinner"})) == []
    weak = Habit(share=0.3, usual_minute=13 * 60, late_minute=13 * 60 + 30, days=8)
    assert kinds(profile(14, meals={"lunch": weak})) == []


def test_quiet_hours():
    early = Habit(share=0.9, usual_minute=6 * 60, late_minute=6 * 60 + 30, days=20)
    assert kinds(profile(7, 30, meals={"breakfast": early})) == []
    assert sn.quiet_after(23) == 22 * 60
    assert sn.quiet_after(1) == 23 * 60
    assert sn.quiet_after(21) == 20 * 60
    late = profile(21, 30, meals={}, training=TrainingHabit((0.9,) * 7, 18 * 60, 19 * 60, 8))
    assert kinds(late, sn.Context(last_minute=sn.quiet_after(21))) == []


def test_workout_preview_with_targets():
    t = TrainingHabit((0.0,) * 7, 18 * 60, 19 * 60, 2)
    c = ctx(plan_day="Push", plan_lines=["Bench press ↑ 82.5 kg", "Rows +1 rep at 60 kg"])
    assert kinds(profile(16, 0, training=t), c) == []
    reminders = sn.due(profile(16, 30, training=t), c)
    assert [r.kind for r in reminders] == ["workout_preview"]
    assert reminders[0].title == "Push today"
    assert reminders[0].body == "Bench press ↑ 82.5 kg · Rows +1 rep at 60 kg"
    assert kinds(profile(16, 30, training=t, trained_today=True), c) == []
    # No habit yet: 09:00.
    assert kinds(profile(9, 15), c) == ["workout_preview"]


def test_workout_log_on_usual_training_days():
    shares = [0.0] * 7
    shares[TODAY.weekday()] = 0.8
    t = TrainingHabit(tuple(shares), 17 * 60, 18 * 60 + 30, 8)
    assert kinds(profile(19, 0, training=t)) == []
    r = sn.due(profile(19, 45, training=t), ctx())
    assert [x.kind for x in r] == ["workout_log"] and r[0].route == "/training"
    assert "Thursdays" in r[0].body
    assert kinds(profile(19, 45, training=t, trained_today=True)) == []
    # Doesn't usually log workouts: no reminder.
    rare = TrainingHabit(tuple(shares), 17 * 60, 18 * 60 + 30, 2)
    assert kinds(profile(19, 45, training=rare)) == []


def test_protein_gap_in_the_evening():
    p = dict(meals_today={"breakfast", "lunch"}, food_entries_today=4, protein_today=70.0)
    assert kinds(profile(17, 0, **p), ctx(protein_target=160)) == []
    r = sn.due(profile(20, 0, **p), ctx(protein_target=160))
    assert [x.kind for x in r] == ["protein"] and r[0].title == "90 g of protein to go"
    assert kinds(profile(20, 0, **{**p, "protein_today": 130.0}), ctx(protein_target=160)) == []
    # Not tracking today: no nudge.
    assert kinds(profile(20, 0, food_entries_today=1, meals_today={"lunch"}), ctx(protein_target=160)) == []


def test_weigh_in_when_overdue():
    w = WeighInHabit(count=10, usual_minute=7 * 60 + 30, gap_days=1.0, last=TODAY - timedelta(days=2), synced=False)
    assert kinds(profile(8, 15, weigh_in=w)) == ["weigh_in"]
    assert kinds(profile(12, 0, weigh_in=w)) == []
    recent = WeighInHabit(10, 7 * 60 + 30, 1.0, TODAY - timedelta(days=1), False)
    assert kinds(profile(8, 15, weigh_in=recent)) == []
    assert kinds(profile(8, 15, weigh_in=w, weighed_today=True)) == []


def test_comeback_after_three_and_seven_quiet_days():
    def active(last):
        return {last - timedelta(days=d) for d in range(10)}

    r = sn.due(profile(18, 0, active_dates=active(TODAY - timedelta(days=3))), ctx())
    assert [x.kind for x in r] == ["comeback"] and r[0].key.endswith(":3")
    r = sn.due(profile(18, 0, active_dates=active(TODAY - timedelta(days=8))), ctx(has_plan=True))
    assert r[0].key.endswith(":7") and r[0].title == "Your plan is still here"
    assert kinds(profile(18, 0, active_dates=active(TODAY - timedelta(days=2)))) == []
    # Never really started, or gone for weeks: leave them be.
    assert kinds(profile(18, 0, active_dates={TODAY - timedelta(days=4)})) == []
    assert kinds(profile(18, 0, active_dates=active(TODAY - timedelta(days=20)))) == []


# ─── Backoff and acted-on ────────────────────────────────────────────────────


def event(kind, hours_ago, opened=False, acted=False):
    sent = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    return PushEvent(id=uuid.uuid4(), kind=kind, dedupe_key=f"{kind}:{hours_ago}", sent_at=sent,
                     opened_at=sent if opened else None, acted_at=sent if acted else None)


def test_ignored_kinds_pause_for_a_week():
    ignored = [event("meal", 24 * d) for d in range(1, 5)]
    assert sn.paused_until("meal", ignored) is not None
    assert sn.paused_until("protein", ignored) is None
    assert sn.paused_until("meal", ignored[:3]) is None
    assert sn.paused_until("meal", ignored[:3] + [event("meal", 100, opened=True)]) is None
    old = [event("meal", 24 * (7 + d)) for d in range(1, 5)]
    assert sn.paused_until("meal", old) is None  # the week is up


def test_a_log_after_a_reminder_counts_as_acted_on():
    e = event("meal", 2)
    other = event("weigh_in", 2)
    p = profile(14, food_times=[datetime.now(timezone.utc) - timedelta(hours=1)])
    sn.mark_acted([e, other], p)
    assert e.acted_at is not None and other.acted_at is None


# ─── Dispatch ────────────────────────────────────────────────────────────────


class FakeDB:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        pass


@pytest.fixture
def dispatch(monkeypatch):
    state = SimpleNamespace(events=[], off=set(), sent=[], due=[])

    async def events(*a, **kw):
        return state.events

    async def off(*a, **kw):
        return state.off

    async def load(user, db, now):
        return profile(now.hour, now.minute)

    async def context(user, p, db):
        return ctx()

    async def send(user_id, db, **kw):
        state.sent.append(kw)
        return 1

    monkeypatch.setattr(sn, "recent_events", events)
    monkeypatch.setattr(sn, "switched_off", off)
    monkeypatch.setattr(sn, "load_profile", load)
    monkeypatch.setattr(sn, "build_context", context)
    monkeypatch.setattr(sn, "due", lambda p, c: state.due)
    monkeypatch.setattr(sn.push, "send_to_user", send)
    # Mid-afternoon wherever the test runs.
    monkeypatch.setattr(sn, "user_now", lambda tz: at(15))
    return state


def reminder(kind="meal", key="meal:lunch:x"):
    return sn.Reminder(kind, key, "Lunch not logged yet", "…", "/nutrition-snap")


def run(user=None, db=None):
    user = user or User(id=uuid.uuid4(), timezone="UTC", sleep_hour=23)
    return asyncio.run(sn.process_user(user, db or FakeDB()))


def test_sends_the_first_due_and_records_it(dispatch):
    dispatch.due = [reminder("meal", "a"), reminder("protein", "b")]
    db = FakeDB()
    assert run(db=db) is True
    assert len(dispatch.sent) == 1
    data = dispatch.sent[0]["data"]
    assert data["type"] == "smart" and data["route"] == "/nutrition-snap"
    assert [e.dedupe_key for e in db.added] == ["a"] and str(db.added[0].id) == data["event_id"]


def test_dedupe_switches_and_backoff(dispatch):
    dispatch.due = [reminder("meal", "a"), reminder("protein", "b"), reminder("weigh_in", "c")]
    dispatch.events = [event("meal", 5)] + [event("protein", 24 * d) for d in range(1, 5)]
    dispatch.events[0].dedupe_key = "a"
    dispatch.off = {"weigh_in"}
    assert run() is False and dispatch.sent == []


def test_daily_cap_and_gap(dispatch):
    dispatch.due = [reminder()]
    dispatch.events = [event("protein", 0.5)]
    assert run() is False  # sent 30 min ago
    dispatch.events = [event("protein", h) for h in (2, 4, 6)]
    for e in dispatch.events:
        e.sent_at = at(15) - (datetime.now(timezone.utc) - e.sent_at)
    assert run() is False  # three today already


# ─── Plan: next time ─────────────────────────────────────────────────────────


def ex(key, name, lo=8, hi=10):
    return {"key": key, "name": name, "group": "Chest", "sets": 3, "reps_min": lo, "reps_max": hi,
            "rest_seconds": 90, "note": "", "start_weight_kg": None, "basis": "none"}


def sets(w, *reps):
    return [SimpleNamespace(weight_kg=w, reps=r, set_type="normal") for r in reps]


def test_logged_today_gives_next_time_and_up_next(monkeypatch):
    plan = {"training": {"days": [
        {"weekday": TODAY.weekday(), "name": "Push", "focus": "", "exercises": [ex("bench_press", "Bench press")]},
        {"weekday": (TODAY.weekday() + 2) % 7, "name": "Push B", "focus": "", "exercises": [ex("bench_press", "Bench press")]},
    ]}}
    history = {
        TODAY - timedelta(days=5): sets(80, 9, 9, 8),
        TODAY: sets(80, 10, 10, 10),  # top of the range on every set
    }

    async def sessions(user, keys, today, db):
        return {"bench_press": history}

    monkeypatch.setattr(plan_today, "_sessions_by_key", sessions)
    monkeypatch.setattr(plan_today, "user_today", lambda tz: TODAY)
    user = User(id=uuid.uuid4(), timezone="UTC")
    out = asyncio.run(plan_today.build_today(user, SimpleNamespace(plan=plan), None))

    row = out["workout"]["exercises"][0]
    assert row["suggestion"]["kind"] == "reps"           # today's target, from last time
    assert row["next"]["kind"] == "weight" and row["next"]["weight_kg"] == 82.5
    up = out["up_next"]
    assert up["name"] == "Push B" and up["in_days"] == 2
    assert up["exercises"][0]["suggestion"]["weight_kg"] == 82.5


def test_target_lines_put_weight_jumps_first():
    exs = [
        {"name": "Rows", "suggestion": {"kind": "reps", "weight_kg": 60.0}},
        {"name": "Bench press", "suggestion": {"kind": "weight", "weight_kg": 82.5}},
        {"name": "Curls", "suggestion": {"kind": "first", "weight_kg": None}},
        {"name": "Squat", "suggestion": {"kind": "stall", "weight_kg": 100.0}},
    ]
    assert plan_today.target_lines(exs, "metric") == [
        "Bench press ↑ 82.5 kg", "Rows +1 rep at 60 kg", "Squat: add a set",
    ]
    assert plan_today.target_lines(exs, "imperial")[0] == "Bench press ↑ 182 lb"


# ─── Testing tools ───────────────────────────────────────────────────────────


def test_every_kind_explains_itself():
    p = profile(13, 0, meals={"lunch": LUNCH})
    rows = sn.checks(p, ctx(protein_target=160))
    assert [c.kind for c in rows] == [
        "workout_preview", "meal", "meal", "meal", "workout_log", "protein", "weigh_in", "comeback",
    ]
    lunch = next(c for c in rows if c.label == "Lunch")
    assert lunch.reminder is None
    assert lunch.reason == "You usually log it around 1:00 PM. Reminder after 1:50 PM if it's still missing."
    assert all(c.reason for c in rows)
    due_lunch = next(c for c in sn.checks(profile(14, 0, meals={"lunch": LUNCH}), ctx()) if c.label == "Lunch")
    assert due_lunch.reminder is not None and due_lunch.reason.startswith("Due:")


def test_clock_matches_the_app():
    assert sn.clock(0) == "12:00 AM" and sn.clock(13 * 60 + 5) == "1:05 PM" and sn.clock(12 * 60) == "12:00 PM"


def test_testers_come_from_settings(monkeypatch):
    monkeypatch.setattr(sn.settings, "REMINDER_TESTERS", "demo@gainrace.com, Me@Example.com")
    assert sn.is_tester(User(email="me@example.com"))
    assert sn.is_tester(User(email="DEMO@gainrace.com"))
    assert not sn.is_tester(User(email="someone@else.com"))
    assert not sn.is_tester(User(email=None))


def test_send_test_uses_the_users_numbers(monkeypatch):
    sent = []

    async def load(user, db, now):
        return profile(15, 0, protein_today=60.0)

    async def context(user, p, db, all_lines=False):
        return ctx(protein_target=160)

    async def send(user_id, db, **kw):
        sent.append(kw)
        return 1

    monkeypatch.setattr(sn, "load_profile", load)
    monkeypatch.setattr(sn, "build_context", context)
    monkeypatch.setattr(sn.push, "send_to_user", send)
    user = User(id=uuid.uuid4(), timezone="UTC")
    delivered, r = asyncio.run(sn.send_test(user, "protein", FakeDB()))
    assert delivered == 1 and r.title == "100 g of protein to go"
    assert sent[0]["data"]["route"] == "/nutrition" and sent[0]["data"]["type"] == "smart"
    _, r = asyncio.run(sn.send_test(user, "workout_preview", FakeDB()))
    assert r.title == "Push day today"  # no plan: a sample


def test_timezone_must_be_real():
    from pydantic import ValidationError
    from schemas.user import UserUpdate

    assert UserUpdate(timezone="Europe/Bucharest").timezone == "Europe/Bucharest"
    assert UserUpdate().timezone is None
    with pytest.raises(ValidationError):
        UserUpdate(timezone="Mars/Olympus")
