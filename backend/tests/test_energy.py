"""Burn estimate, calorie target and weekly suggestions (services/energy.py,
services/adaptive_calories.py)."""
from datetime import date, timedelta

from services.adaptive_calories import MAX_STEP, explain, propose
from services.energy import EnergyInputs, estimate

TODAY = date(2026, 10, 30)


def inputs(**kw) -> EnergyInputs:
    base = dict(
        sex="male", age=25, height_cm=193, weight_kg=102.6, weights=[], body_fat=None, intake=[],
        training_days=6, goal="cut", pace=None, today=TODAY,
    )
    return EnergyInputs(**{**base, **kw})


def logged(days: int, kcal: int, loss_per_week: float, start_kg: float = 102.6):
    """Daily weigh-ins and intake over `days`, ending yesterday."""
    first = TODAY - timedelta(days=days)
    weights = [(first + timedelta(days=d), start_kg - loss_per_week * d / 7) for d in range(days)]
    intake = [(first + timedelta(days=d), kcal) for d in range(days)]
    return weights, intake


def test_formula_only_uses_mifflin_and_steady_pace():
    est = estimate(inputs())
    bmr = 10 * 102.6 + 6.25 * 193 - 5 * 25 + 5
    assert est.bmr_method == "mifflin" and est.bmr == round(bmr)
    assert est.formula_tdee == round(bmr * 1.725)
    assert est.measured_tdee is None and est.confidence == 0
    assert est.pace == "steady" and est.rate_kg_week == round(-0.005 * 102.6, 2)
    assert est.target_kcal == round((bmr * 1.725 - 0.005 * 102.6 * 1100) / 10) * 10


def test_recent_body_fat_switches_to_lean_mass():
    est = estimate(inputs(body_fat=(TODAY - timedelta(days=10), 20.0)))
    assert est.bmr_method == "katch"
    assert est.bmr == round(370 + 21.6 * 102.6 * 0.8)
    old = estimate(inputs(body_fat=(TODAY - timedelta(days=120), 20.0)))
    assert old.bmr_method == "mifflin" and old.body_fat_pct is None


def test_logs_and_weigh_ins_measure_the_burn():
    weights, intake = logged(28, 2600, 0.5)
    est = estimate(inputs(weights=weights, intake=intake))
    # 2600 eaten + 0.5 kg/week lost (550 kcal/day) = 3150 burned.
    assert abs(est.measured_tdee - 3150) <= 5
    assert est.confidence == 1.0 and est.tdee == est.measured_tdee
    assert est.logged_days == 28 and est.weigh_ins == 28
    assert est.weight_trend_kg_week == -0.5


def test_little_data_leans_on_the_formula():
    weights, intake = logged(16, 2600, 0.5)
    est = estimate(inputs(weights=weights, intake=intake))
    assert 0 < est.confidence < 1
    assert est.measured_tdee < est.tdee < est.formula_tdee
    few = estimate(inputs(weights=weights[:3], intake=intake))
    assert few.measured_tdee is None and few.confidence == 0


def test_half_logged_days_are_not_counted():
    weights, intake = logged(28, 2600, 0.5)
    intake = [(d, 600 if i % 2 else k) for i, (d, k) in enumerate(intake)]
    est = estimate(inputs(weights=weights, intake=intake))
    assert est.logged_days == 14 and est.avg_intake == 2600


def test_implausible_logs_are_clamped():
    weights, intake = logged(28, 1200, 0.0)  # "eats" 1200 and holds weight
    est = estimate(inputs(weights=weights, intake=intake))
    assert est.measured_tdee == round(0.7 * est.formula_tdee)
    assert any("Missed food logs" in n for n in est.notes)


def test_paces_and_goals():
    slow = estimate(inputs(pace="slow"))
    fast = estimate(inputs(pace="fast"))
    assert slow.target_kcal > estimate(inputs()).target_kcal > fast.target_kcal
    bulk = estimate(inputs(goal="bulk", pace="steady"))
    assert bulk.rate_kg_week > 0 and bulk.target_kcal > bulk.tdee
    hold = estimate(inputs(goal="maintain", pace="fast"))
    assert hold.rate_kg_week == 0 and hold.target_kcal == round(hold.tdee / 10) * 10


def test_lean_users_cut_no_faster_than_steady():
    lean = estimate(inputs(pace="fast", body_fat=(TODAY, 10.0)))
    assert lean.rate_kg_week == round(-0.005 * 102.6, 2)
    assert any("protect muscle" in n for n in lean.notes)


def test_safety_floor_wins():
    est = estimate(inputs(sex="female", age=40, height_cm=155, weight_kg=50, training_days=1, pace="fast"))
    assert est.target_kcal == round(est.floor / 10) * 10
    assert any("safe minimum" in n for n in est.notes)


def test_propose_skips_small_moves_and_caps_big_ones():
    est = estimate(inputs())
    full = est.target_kcal
    assert propose(full + 40, est) == (None, full)
    assert propose(None, est) == (full, full)
    # Inside the limits: a step of at most MAX_STEP towards it.
    assert propose(full + 450, est) == (full + 450 - MAX_STEP, full)
    # Below the safety floor: straight back inside.
    assert propose(1500, est) == (full, full)


def test_explain_says_where_the_number_comes_from():
    weights, intake = logged(28, 2600, 0.5)
    est = estimate(inputs(weights=weights, intake=intake))
    text = explain(est, est.target_kcal, est.target_kcal, "metric")
    assert "2,600 kcal a day on 28 logged days" in text and "went down 0.5 kg a week" in text
    assert "lose about 0.5 kg a week" in text
    formula = estimate(inputs())
    text = explain(formula, formula.target_kcal - 300, formula.target_kcal, "imperial")
    assert "226.2 lb" in text and "6 training days a week" in text
    assert "step towards it" in text and "gets more accurate" in text
