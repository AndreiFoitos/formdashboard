"""Standalone sanity test for services/log_patterns._summarise_slots.

Runs without pytest or a real DB by feeding the pure-logic helper with synthetic
log tuples. Verifies:

  1. A strong daily 9 AM hydration pattern is detected at slot 540 with median
     amount intact and confidence near 1.0.
  2. Random noise (one-off late-night logs) does NOT produce a spurious slot.
  3. A weekday-only coffee pattern is detected only on weekdays.
  4. Slots respect timezone — same UTC timestamps shifted into PST produce
     different (weekday, slot) groupings.

Run:  python -m scripts.test_log_patterns  (from backend/)
      or: python backend/scripts/test_log_patterns.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# Allow running as both `python -m scripts.test_log_patterns` from backend/
# and `python backend/scripts/test_log_patterns.py` from repo root.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.log_patterns import _summarise_slots  # noqa: E402


UTC = timezone.utc
NOW = datetime(2026, 5, 31, 12, 0, tzinfo=UTC)  # Sunday noon UTC


def _make_hydration_logs() -> list[tuple]:
    """28 days of 9 AM (local) drinks at 250 ml, every day."""
    rows = []
    for days_ago in range(0, 28):
        day = NOW - timedelta(days=days_ago)
        logged_at = day.replace(hour=9, minute=0, second=0, microsecond=0)
        rows.append((logged_at, 250, None, None))
    return rows


def _make_noise_logs() -> list[tuple]:
    """Sparse one-off 11:30 PM logs that should NOT cross the confidence floor."""
    rows = []
    for days_ago in (1, 9, 22):
        day = NOW - timedelta(days=days_ago)
        logged_at = day.replace(hour=23, minute=30)
        rows.append((logged_at, 500, None, None))
    return rows


def _make_weekday_coffee_logs() -> list[tuple]:
    """Coffee at 7 AM every Mon-Fri for 4 weeks."""
    rows = []
    for days_ago in range(0, 28):
        day = NOW - timedelta(days=days_ago)
        if day.weekday() >= 5:  # skip Sat/Sun
            continue
        logged_at = day.replace(hour=7, minute=0)
        rows.append((logged_at, 95, "coffee", 95))
    return rows


def test_strong_daily_hydration_detected() -> None:
    rows = _make_hydration_logs()
    slots = _summarise_slots("hydration", rows, NOW, ZoneInfo("UTC"))
    # Should have one slot per weekday (7) at slot_minute=540 (9 AM).
    morning_slots = [s for s in slots if s.slot_minute == 540]
    assert len(morning_slots) == 7, f"expected 7 weekday morning slots, got {len(morning_slots)}"
    for s in morning_slots:
        assert s.suggested_amount_ml == 250
        assert s.confidence >= 0.55, f"weekday {s.weekday} confidence too low: {s.confidence}"
        assert s.sample_count >= 3


def test_noise_does_not_fire() -> None:
    rows = _make_noise_logs()
    slots = _summarise_slots("hydration", rows, NOW, ZoneInfo("UTC"))
    # 3 isolated logs scattered across weekdays → none meets MIN_DISTINCT_DAYS=3
    # for any single (weekday, slot) bucket.
    assert slots == [], f"expected zero slots from noise, got {slots}"


def test_weekday_only_coffee_pattern() -> None:
    rows = _make_weekday_coffee_logs()
    slots = _summarise_slots("stimulant", rows, NOW, ZoneInfo("UTC"))
    morning = [s for s in slots if s.slot_minute == 420]
    weekdays_hit = sorted(s.weekday for s in morning)
    assert weekdays_hit == [0, 1, 2, 3, 4], f"expected Mon–Fri only, got {weekdays_hit}"
    for s in morning:
        assert s.suggested_substance == "coffee"
        assert s.suggested_caffeine_mg == 95


def test_timezone_shifts_slot() -> None:
    """A 14:00 UTC log is 6 AM PST — bucketing must respect the user's tz."""
    rows = [(NOW.replace(hour=14, minute=0) - timedelta(days=d), 250, None, None)
            for d in range(0, 21)]
    utc_slots = _summarise_slots("hydration", rows, NOW, ZoneInfo("UTC"))
    pst_slots = _summarise_slots("hydration", rows, NOW, ZoneInfo("America/Los_Angeles"))
    utc_minutes = {s.slot_minute for s in utc_slots}
    pst_minutes = {s.slot_minute for s in pst_slots}
    assert 840 in utc_minutes, f"UTC 14:00 -> slot 840 missing: {utc_minutes}"
    # PST is UTC-7 or UTC-8 depending on DST; either way far from 840.
    assert 840 not in pst_minutes, f"PST should not group at UTC slot: {pst_minutes}"


def main() -> int:
    tests = [
        test_strong_daily_hydration_detected,
        test_noise_does_not_fire,
        test_weekday_only_coffee_pattern,
        test_timezone_shifts_slot,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL  {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"ERROR {t.__name__}: {e!r}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
