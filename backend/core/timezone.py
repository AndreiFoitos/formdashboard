"""
Per-user timezone helpers.

Backend tasks that resolve "today" or "now" should use the user's local time,
not the server's wall clock. A user in PST logging at 8 PM local (= 04:00 UTC
next day) needs their hydration entry to count toward the SAME day's summary
they see on the dashboard. Without these helpers `date.today()` on a UTC server
silently routes the log into tomorrow.

Usage:
    from core.timezone import user_today, user_now
    today = user_today(user.timezone)

`tz_name` is the IANA name from `user.timezone` (e.g. "America/Los_Angeles").
Unknown / empty / non-IANA strings fall back to UTC rather than raising — the
field is user-editable text and a bad value should degrade gracefully.
"""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


_UTC = ZoneInfo("UTC")


def resolve_tz(tz_name: str | None) -> ZoneInfo:
    """Return a ZoneInfo for the given IANA name, or UTC if invalid/empty."""
    if not tz_name:
        return _UTC
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return _UTC


def user_now(tz_name: str | None) -> datetime:
    """Current wall-clock time in the user's timezone (aware datetime)."""
    return datetime.now(resolve_tz(tz_name))


def user_today(tz_name: str | None) -> date:
    """Today's date in the user's timezone."""
    return user_now(tz_name).date()
