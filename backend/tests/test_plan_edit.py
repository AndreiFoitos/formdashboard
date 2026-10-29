"""Skipping a workout (the week slides up to the next rest day) and hand
edits to the plan."""
from datetime import date, timedelta

import pytest

from services.plan_edit import (
    EditError,
    apply_training,
    day_for_date,
    edit_meal,
    remove_meal,
    skip_today,
    this_week,
    undo_skip,
)

MONDAY = date(2026, 10, 26)
CATALOG = {"squat": ("Squat", "Legs"), "bench_press": ("Bench Press", "Chest"), "pull_up": ("Pull-up", "Back")}


def ex(key="squat"):
    return {"key": key, "name": key, "group": "Legs", "sets": 3, "reps_min": 8, "reps_max": 10,
            "rest_seconds": 90, "note": "", "start_weight_kg": None, "basis": "none"}


def plan_with(**days):
    """plan_with(mon="Legs", tue="Push", thu="Pull", fri="Legs")"""
    idx = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
    return {"training": {"days": [
        {"weekday": idx.index(k), "name": v, "focus": "", "exercises": [ex()]} for k, v in days.items()
    ]}}


def names(plan, start=MONDAY):
    out = []
    for i in range(7):
        d = day_for_date(plan, start + timedelta(days=i))
        out.append(d["name"] if d else "-")
    return out


def test_skip_slides_up_to_the_next_rest_day():
    plan = plan_with(mon="Legs", tue="Push", thu="Pull", fri="Legs")
    new, summary = skip_today(plan, MONDAY)
    assert names(new) == ["-", "Legs", "Push", "Pull", "Legs", "-", "-"]
    assert "Wednesday" in summary
    # The template is untouched; next week runs as planned.
    assert names(new, MONDAY + timedelta(weeks=1)) == ["Legs", "Push", "-", "Pull", "Legs", "-", "-"]


def test_skip_into_a_rest_day_tomorrow():
    plan = plan_with(mon="Legs", wed="Push")
    new, summary = skip_today(plan, MONDAY)
    assert names(new) == ["-", "Legs", "Push", "-", "-", "-", "-"]
    assert "rest day" in summary


def test_no_rest_day_left_drops_the_last_session():
    plan = plan_with(fri="A", sat="B", sun="C")
    new, summary = skip_today(plan, MONDAY + timedelta(days=4))
    assert names(new)[4:] == ["-", "A", "B"]
    assert "C drops off" in summary


def test_skip_twice_then_undo_once():
    plan = plan_with(mon="Legs", tue="Push", thu="Pull")
    once, _ = skip_today(plan, MONDAY)
    twice, _ = skip_today(once, MONDAY + timedelta(days=1))
    assert names(twice) == ["-", "-", "Legs", "Push", "Pull", "-", "-"]
    assert this_week(twice, MONDAY)["days"][1]["skipped"]
    back = undo_skip(twice, MONDAY + timedelta(days=1))
    assert names(back) == names(once)
    assert names(undo_skip(back, MONDAY)) == names(plan)


def test_skip_on_a_rest_day_fails():
    with pytest.raises(EditError):
        skip_today(plan_with(tue="Push"), MONDAY)


def test_moving_days_clears_this_weeks_skip():
    plan, _ = skip_today(plan_with(mon="Legs", wed="Push"), MONDAY)
    edit = [{"weekday": 1, "name": "Legs", "focus": "", "exercises": [
        {"key": "squat", "sets": 4, "reps_min": 10, "reps_max": 6, "rest_seconds": 120, "note": ""}]},
        {"weekday": 3, "name": "Push", "focus": "", "exercises": [
        {"key": "bench_press", "sets": 3, "reps_min": 8, "reps_max": 12, "rest_seconds": 90, "note": ""}]}]
    new = apply_training(plan, edit, CATALOG, {}, MONDAY)
    assert names(new) == ["-", "Legs", "-", "Push", "-", "-", "-"]
    first = new["training"]["days"][0]["exercises"][0]
    assert (first["reps_min"], first["reps_max"], first["name"]) == (6, 10, "Squat")
    assert new["days_per_week"] == 2


def test_renaming_keeps_this_weeks_skip():
    plan, _ = skip_today(plan_with(mon="Legs", wed="Push"), MONDAY)
    edit = [{"weekday": 0, "name": "Leg day", "focus": "", "exercises": [
        {"key": "squat", "sets": 3, "reps_min": 8, "reps_max": 10, "rest_seconds": 90, "note": ""}]},
        {"weekday": 2, "name": "Push", "focus": "", "exercises": [
        {"key": "bench_press", "sets": 3, "reps_min": 8, "reps_max": 12, "rest_seconds": 90, "note": ""}]}]
    new = apply_training(plan, edit, CATALOG, {}, MONDAY)
    assert names(new) == ["-", "Leg day", "Push", "-", "-", "-", "-"]


def test_edit_rejects_unknown_exercises_and_empty_days():
    plan = plan_with(mon="Legs")
    bad = [{"weekday": 0, "name": "X", "focus": "", "exercises": [
        {"key": "nope", "sets": 3, "reps_min": 8, "reps_max": 10, "rest_seconds": 90, "note": ""}]}]
    with pytest.raises(EditError):
        apply_training(plan, bad, CATALOG, {}, MONDAY)
    with pytest.raises(EditError):
        apply_training(plan, [{"weekday": 0, "name": "X", "focus": "", "exercises": []}], CATALOG, {}, MONDAY)


def meal_plan():
    item = lambda food, g, kcal: {"food": food, "grams": g, "calories": kcal, "protein_g": 10.0,
                                  "carbs_g": 20.0, "fat_g": 5.0, "source": "usda", "portions": []}
    m = {"id": "m1", "name": "Oats", "slot": "breakfast", "items": [item("oats", 80, 300), item("whey", 30, 120)],
         "totals": {"calories": 420, "protein_g": 20.0, "carbs_g": 40.0, "fat_g": 10.0}}
    return {"nutrition": {"days": [{"weekday": 0, "meals": [m], "totals": m["totals"]}]}}


def test_edit_meal_scales_macros_and_drops_zero_items():
    new = edit_meal(meal_plan(), 0, "m1", [160, 0])
    meal = new["nutrition"]["days"][0]["meals"][0]
    assert [i["food"] for i in meal["items"]] == ["oats"]
    assert meal["items"][0]["calories"] == 600
    assert meal["totals"]["calories"] == 600
    assert new["nutrition"]["days"][0]["totals"]["calories"] == 600


def test_remove_meal():
    new = remove_meal(meal_plan(), 0, "m1")
    assert new["nutrition"]["days"][0]["meals"] == []
    assert new["nutrition"]["days"][0]["totals"]["calories"] == 0
    with pytest.raises(EditError):
        edit_meal(meal_plan(), 0, "m1", [0, 0])
