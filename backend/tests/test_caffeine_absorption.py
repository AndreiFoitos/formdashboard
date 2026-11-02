"""Caffeine builds up over the drinking time plus ~1 h of absorption instead
of landing all at once, and each drink has a fixed drinking time."""
from datetime import datetime, timedelta, timezone

from services.stimulants import caffeine_at_time, drink_minutes

START = datetime(2026, 11, 2, 14, 0, tzinfo=timezone.utc)


def mg(minutes_after: float, drink_min: float, dose: float = 160, half_life: float = 5.5) -> float:
    return caffeine_at_time(dose, START, half_life, START + timedelta(minutes=minutes_after), drink_min)


def test_drink_times_are_fixed_per_drink():
    assert drink_minutes("espresso") == 5
    assert drink_minutes("preworkout") == 5
    assert drink_minutes("coffee") == 20
    assert drink_minutes("ed_red_bull") == 20
    assert drink_minutes("ed_monster") == 40
    assert drink_minutes("energy_custom") == 20
    assert drink_minutes("something_unknown") == 20


def test_nothing_before_the_drink_starts():
    assert mg(0, 40) == 0
    assert mg(-30, 40) == 0


def test_builds_up_then_peaks_below_the_dose():
    curve = [mg(m, 40) for m in range(0, 301, 5)]
    peak = max(curve)
    peak_at = curve.index(peak) * 5
    assert curve[3] < 30  # 15 min into a 500 ml can: 60 mg sipped, ~22 mg absorbed
    assert 60 <= peak_at <= 90
    assert 130 < peak < 160


def test_slower_drinks_rise_later():
    assert mg(30, 5) > mg(30, 20) > mg(30, 40)


def test_sipping_matches_downing_it_once_drinking_is_long_over():
    # A 1-minute sip window and an instant dose are effectively the same drink.
    assert abs(mg(120, 1 / 60) - mg(120, 0)) < 0.1
    # Hours later only the half-life matters; the later start keeps a bit more.
    instant_old_model = 160 * 0.5 ** (9 / 5.5)
    assert instant_old_model < mg(9 * 60, 40) < instant_old_model * 1.15


def test_every_sip_is_absorbed_eventually():
    # With no elimination the whole dose ends up in the body.
    no_elimination = caffeine_at_time(160, START, 1e9, START + timedelta(hours=8), 40)
    assert abs(no_elimination - 160) < 0.5
