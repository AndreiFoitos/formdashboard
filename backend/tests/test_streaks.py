"""Logging streaks: count up, reset after a missed day, follow the user's own
midnight, and longest_streak never goes down. The DB is faked."""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.sql.dml import Insert

import services.form_score as form_score
import services.streaks as streaks
from core.timezone import resolve_tz
from models.daily_summary import DailySummary
from models.streak import Streak
from models.user import User
from services.streaks import (
    RECHECK_DAYS,
    StreakState,
    compute_streak,
    local_days,
    longest_run,
    saved_days_before,
)

TODAY = date(2026, 10, 30)
EMPTY = StreakState(0, 0, None)


def ago(n: int) -> date:
    return TODAY - timedelta(days=n)


def span(first: date, last: date) -> set[date]:
    return {first + timedelta(days=i) for i in range((last - first).days + 1)}


class Logs:
    """Fake fetch over a set of logged days; records each range it was asked for."""

    def __init__(self, days=()):
        self.days = set(days)
        self.calls: list[tuple[date, date]] = []

    async def __call__(self, since: date, until: date) -> set[date]:
        self.calls.append((since, until))
        return {d for d in self.days if since <= d <= until}


def refresh(saved: StreakState, today: date, logs: Logs) -> StreakState:
    return asyncio.run(compute_streak(saved, today, logs))


def refresh_daily(logs: Logs, first: date, last: date, state: StreakState = EMPTY) -> StreakState:
    """Open the app once a day from `first` to `last`."""
    day = first
    while day <= last:
        state = refresh(state, day, logs)
        day += timedelta(days=1)
    return state


# ─── Helpers ─────────────────────────────────────────────────────────────────


def test_longest_run():
    assert longest_run([]) == 0
    assert longest_run([ago(0)]) == 1
    # Unsorted, with a duplicate: runs of 3 and 2.
    assert longest_run([ago(1), ago(5), ago(0), ago(6), ago(2), ago(0)]) == 3


def test_saved_days_before():
    saved = StreakState(current=10, longest=10, last_date=ago(1))  # run is ago(10)..ago(1)
    assert saved_days_before(saved, ago(4)) == 6  # ago(10)..ago(5)
    assert saved_days_before(saved, ago(0)) == 10  # ends the day before the window
    assert saved_days_before(saved, ago(10)) == 0  # run starts inside the window
    assert saved_days_before(StreakState(5, 5, ago(20)), ago(14)) == 0  # ended before the window
    assert saved_days_before(StreakState(0, 9, ago(1)), ago(4)) == 0  # broken streak
    assert saved_days_before(EMPTY, ago(4)) == 0


# ─── Counting ────────────────────────────────────────────────────────────────


def test_no_logs_no_streak():
    assert refresh(EMPTY, TODAY, Logs()) == EMPTY


def test_counts_up_one_day_at_a_time():
    logs = Logs(span(ago(29), TODAY))
    state = EMPTY
    for n in range(1, 31):
        state = refresh(state, ago(30 - n), logs)
        assert (state.current, state.longest, state.last_date) == (n, n, ago(30 - n))
    # One read per refresh, plus one look further back on the day the run first
    # outgrows the re-read window. After that the saved row carries it.
    assert len(logs.calls) == 31
    assert all(since >= until - timedelta(days=RECHECK_DAYS) for since, until in logs.calls[-15:])


def test_run_older_than_the_window_continues_from_the_saved_row():
    # Only the re-read window is in the logs; the rest comes from the saved row.
    logs = Logs(span(ago(RECHECK_DAYS), TODAY))
    state = refresh(StreakState(current=30, longest=30, last_date=ago(1)), TODAY, logs)
    assert (state.current, state.longest) == (31, 31)
    assert len(logs.calls) == 1


def test_no_log_yet_today_keeps_yesterdays_streak():
    state = refresh(EMPTY, TODAY, Logs(span(ago(5), ago(1))))
    assert (state.current, state.longest, state.last_date) == (5, 5, ago(1))


def test_missed_day_resets_the_streak():
    logs = Logs(span(ago(10), ago(2)))  # nothing yesterday or today
    state = refresh_daily(logs, ago(10), TODAY)
    assert (state.current, state.longest, state.last_date) == (0, 9, ago(2))

    logs.days.add(TODAY)
    state = refresh(state, TODAY, logs)
    assert (state.current, state.longest, state.last_date) == (1, 9, TODAY)


def test_streak_starts_over_and_longest_keeps_the_best():
    days = span(ago(20), ago(13)) | span(ago(11), TODAY)  # 8 days, miss one, 12 days
    logs = Logs(days)
    state = refresh_daily(logs, ago(20), ago(12))
    assert (state.current, state.longest) == (8, 8)  # the missed day isn't over yet
    state = refresh_daily(logs, ago(11), ago(11), state)
    assert (state.current, state.longest) == (1, 8)
    state = refresh_daily(logs, ago(10), TODAY, state)
    assert (state.current, state.longest) == (12, 12)


def test_longest_never_goes_down():
    saved = StreakState(current=3, longest=50, last_date=ago(1))
    state = refresh(saved, TODAY, Logs(span(ago(3), ago(1))))
    assert (state.current, state.longest) == (3, 50)
    state = refresh(state, TODAY + timedelta(days=2), Logs(span(ago(3), ago(1))))
    assert (state.current, state.longest) == (0, 50)


def test_first_refresh_reads_the_history():
    # A 12-day run in the summer, then the current 4-day run.
    logs = Logs(span(ago(100), ago(89)) | span(ago(3), TODAY))
    state = refresh(EMPTY, TODAY, logs)
    assert (state.current, state.longest, state.last_date) == (4, 12, TODAY)


# ─── Logs that change after the fact ─────────────────────────────────────────


def test_deleting_todays_only_log_takes_the_day_back():
    logs = Logs(span(ago(5), TODAY))
    state = refresh_daily(logs, ago(5), TODAY)
    assert (state.current, state.longest) == (6, 6)

    logs.days.discard(TODAY)  # the undo toast
    state = refresh(state, TODAY, logs)
    assert (state.current, state.longest, state.last_date) == (5, 6, ago(1))


def test_filling_in_a_missed_day_joins_the_runs():
    logs = Logs(span(ago(8), ago(4)) | span(ago(2), TODAY))
    state = refresh_daily(logs, ago(8), TODAY)
    assert (state.current, state.longest) == (3, 5)

    logs.days.add(ago(3))  # e.g. a workout logged for an earlier day
    state = refresh(state, TODAY, logs)
    assert (state.current, state.longest) == (9, 9)


def test_filling_in_a_day_rejoins_a_run_older_than_the_window():
    logs = Logs(span(ago(40), ago(2)) | {TODAY})  # missed yesterday
    state = refresh_daily(logs, ago(40), TODAY)
    assert (state.current, state.longest) == (1, 39)

    # The saved row only knows the 1-day run, so older logs are read again.
    logs.days.add(ago(1))
    state = refresh(state, TODAY, logs)
    assert (state.current, state.longest) == (41, 41)


def test_catches_up_after_weeks_without_a_refresh():
    logs = Logs(span(ago(34), TODAY))
    state = refresh_daily(logs, ago(34), ago(30))
    assert (state.current, state.last_date) == (5, ago(30))
    # Logged every day since (say from notifications) but nothing read the
    # streak for a month.
    state = refresh(state, TODAY, logs)
    assert (state.current, state.longest, state.last_date) == (35, 35, TODAY)


# ─── Timezones ───────────────────────────────────────────────────────────────


def test_local_days_use_the_users_timezone():
    late = datetime(2026, 10, 30, 23, 30, tzinfo=timezone.utc)
    early = datetime(2026, 10, 30, 3, 0, tzinfo=timezone.utc)
    assert local_days([late, early], "UTC") == {date(2026, 10, 30)}
    assert local_days([late, early], "America/Los_Angeles") == {date(2026, 10, 30), date(2026, 10, 29)}
    assert local_days([late, early], "Asia/Tokyo") == {date(2026, 10, 31), date(2026, 10, 30)}
    assert local_days([datetime(2026, 10, 30, 18, 45, tzinfo=timezone.utc)], "Asia/Kolkata") == {date(2026, 10, 31)}
    # Bad zone names fall back to UTC; naive timestamps are read as UTC.
    assert local_days([late], "Not/AZone") == {date(2026, 10, 30)}
    assert local_days([datetime(2026, 10, 30, 23, 30)], "Asia/Tokyo") == {date(2026, 10, 31)}


class FakeResult:
    def __init__(self, values):
        self.values = list(values)

    def scalars(self):
        return self

    def all(self):
        return self.values


class FakeDB:
    """refresh_streak's queries: the streak row, then per read the dated logs
    (food / training / body) and the timestamped ones (water / caffeine)."""

    def __init__(self, row=None, dated=(), stamps=()):
        self.row = row
        self.dated = list(dated)
        self.stamps = list(stamps)
        self.reads = 0
        self.flushes = 0

    async def get(self, model, key):
        return self.row

    async def execute(self, stmt):
        if isinstance(stmt, Insert):
            self.row = Streak(user_id=uuid.uuid4(), current_streak=0, longest_streak=0)
            return None
        self.reads += 1
        return FakeResult(self.dated if self.reads % 2 else self.stamps)

    async def flush(self):
        self.flushes += 1


def make_user(tz: str) -> User:
    return User(id=uuid.uuid4(), email="u@test.com", username="tester", timezone=tz)


def freeze(monkeypatch, now: datetime):
    monkeypatch.setattr(streaks, "user_today", lambda tz: now.astimezone(resolve_tz(tz)).date())


def refresh_row(user: User, db: FakeDB) -> Streak:
    return asyncio.run(streaks.refresh_streak(user, db))


def test_streak_days_follow_the_users_timezone(monkeypatch):
    freeze(monkeypatch, datetime(2026, 10, 30, 23, 45, tzinfo=timezone.utc))
    water = [
        datetime(2026, 10, 29, 6, 0, tzinfo=timezone.utc),
        datetime(2026, 10, 30, 23, 30, tzinfo=timezone.utc),
    ]
    expected = {
        "UTC": (2, date(2026, 10, 30)),  # Oct 29 and Oct 30
        "America/Los_Angeles": (1, date(2026, 10, 30)),  # Oct 28 late, then Oct 30
        "Asia/Tokyo": (1, date(2026, 10, 31)),  # Oct 29, then Oct 31 morning
    }
    for tz, (current, last) in expected.items():
        row = refresh_row(make_user(tz), FakeDB(Streak(current_streak=0, longest_streak=0), stamps=water))
        assert (row.current_streak, row.last_processed_date) == (current, last), tz


def test_streak_lasts_until_the_users_own_midnight(monkeypatch):
    # Water at 13:00 in Los Angeles on Oct 29. It's now Oct 31 01:00 UTC, which
    # is still Oct 30 in Los Angeles: their streak stands, a UTC user's doesn't.
    freeze(monkeypatch, datetime(2026, 10, 31, 1, 0, tzinfo=timezone.utc))
    water = [datetime(2026, 10, 29, 20, 0, tzinfo=timezone.utc)]
    la = refresh_row(make_user("America/Los_Angeles"), FakeDB(Streak(), stamps=water))
    assert (la.current_streak, la.longest_streak) == (1, 1)
    utc = refresh_row(make_user("UTC"), FakeDB(Streak(), stamps=water))
    assert (utc.current_streak, utc.longest_streak) == (0, 1)


def test_food_training_and_weight_count_by_their_logged_day(monkeypatch):
    freeze(monkeypatch, datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc))
    db = FakeDB(Streak(), dated=[date(2026, 10, 29), date(2026, 10, 30)])
    row = refresh_row(make_user("UTC"), db)
    assert (row.current_streak, row.longest_streak, row.last_processed_date) == (2, 2, date(2026, 10, 30))


def test_refresh_creates_a_missing_row_and_skips_unchanged_writes(monkeypatch):
    freeze(monkeypatch, datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc))
    db = FakeDB(None, dated=[date(2026, 10, 30)])
    row = refresh_row(make_user("UTC"), db)
    assert (row.current_streak, row.longest_streak) == (1, 1)
    assert db.flushes == 1

    refresh_row(make_user("UTC"), db)
    assert db.flushes == 1


# ─── Readers ─────────────────────────────────────────────────────────────────


def test_form_score_uses_the_refreshed_streak(monkeypatch):
    async def refreshed(user, db):
        return Streak(current_streak=7, longest_streak=7, last_processed_date=TODAY)

    async def none(*a, **kw):
        return None

    async def zero(*a, **kw):
        return 0.0

    async def no_volume(*a, **kw):
        return 0.0, 0.0

    monkeypatch.setattr(form_score, "refresh_streak", refreshed)
    monkeypatch.setattr(form_score, "days_since_last_training", none)
    monkeypatch.setattr(form_score, "estimate_caffeine_at_sleep", zero)
    monkeypatch.setattr(form_score, "_volume_today_and_baseline_kg", no_volume)

    user = make_user("UTC")
    user.sleep_hour = 23
    _, breakdown = asyncio.run(form_score.compute_form_score(DailySummary(date=TODAY), user, None))
    assert breakdown["streak"] == 50  # 7 of 14 days
    assert breakdown["context"]["streak"] == "7-day streak"
