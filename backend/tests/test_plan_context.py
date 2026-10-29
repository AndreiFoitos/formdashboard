"""The coach context tells days before signup apart from skipped logging."""
from datetime import date, datetime, timezone

from models.daily_summary import DailySummary
from models.user import User
from services.plan_context import _account_age, _days, signup_date

TODAY = date(2026, 10, 29)


def test_signup_date_is_in_the_users_timezone():
    # 03:00 UTC on Oct 27 is still Oct 26 in Los Angeles.
    user = User(created_at=datetime(2026, 10, 27, 3, tzinfo=timezone.utc), timezone="America/Los_Angeles")
    assert signup_date(user) == date(2026, 10, 26)
    assert signup_date(User(created_at=None)) is None


def test_account_age_line():
    assert "signed up on 2026-10-26 (3 days ago)" in _account_age(date(2026, 10, 26), TODAY)[0]
    assert "(1 day ago)" in _account_age(date(2026, 10, 28), TODAY)[0]
    assert _account_age(None, TODAY) == []


def test_days_before_signup_are_not_missed_logs():
    rows = [DailySummary(date=date(2026, 10, 27), calories_eaten=1515, trained=False, is_estimated=False)]
    lines = _days(rows, TODAY, 30, {}, signup=date(2026, 10, 26))
    by_date = {line.split(" ")[0]: line for line in lines[2:]}
    assert by_date["2026-10-25"].endswith("before signup")
    assert by_date["2026-10-16"].endswith("before signup")
    assert by_date["2026-10-26"].endswith("nothing logged")
    assert "1515" in by_date["2026-10-27"]


def test_days_without_signup_keep_the_old_label():
    lines = _days([], TODAY, 30, {})
    assert all(line.endswith("nothing logged") for line in lines[2:])
