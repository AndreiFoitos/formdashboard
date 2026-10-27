"""Per-dumbbell logging and drop sets: volume and progression rules."""
from services.exercise_taxonomy import (
    DUMBBELL_PAIR,
    DUMBBELL_SINGLE,
    EXERCISE_TO_GROUP,
)
from services.plan_builder import start_weight
from services.progression import next_target
from services.social_notifications import set_volume_kg


def _sets(*rows):
    return [{"weight_kg": w, "reps": r, "set_type": t} for w, r, t in rows]


def test_dumbbell_pair_counts_both_hands():
    # 2 x 12 kg dumbbells for 10 reps moved 240 kg.
    assert set_volume_kg("db_curl", 12, 10, 80) == 240


def test_single_dumbbell_counts_once():
    assert set_volume_kg("one_arm_db_row", 30, 10, 80) == 300


def test_barbell_and_bodyweight_unchanged():
    assert set_volume_kg("bench_press", 100, 5, 80) == 500
    assert set_volume_kg("pull_up", None, 10, 80) == 800
    assert set_volume_kg("pull_up", None, 10, None) == 0


def test_dumbbell_sets_are_real_exercises():
    assert (DUMBBELL_PAIR | DUMBBELL_SINGLE) <= set(EXERCISE_TO_GROUP)
    assert not DUMBBELL_PAIR & DUMBBELL_SINGLE


def test_drop_sets_ignored_by_progression():
    # The 10 kg drop set at 8 reps must not hold back the +weight target.
    t = next_target([_sets((20, 12, "normal"), (20, 12, "normal"), (10, 8, "drop"))], "Arms")
    assert t["kind"] == "weight"
    assert all(s["weight_kg"] != 10 for s in t["sets"])


def test_dumbbell_steps_follow_the_rack():
    t = next_target([_sets((16, 12, "normal"), (16, 12, "normal"))], "Arms", dumbbell=True)
    assert t["weight_kg"] == 18
    t = next_target([_sets((16, 12, "normal"), (16, 12, "normal"))], "Arms")
    assert t["weight_kg"] == 17


def test_start_weight_rounds_to_a_dumbbell():
    # 18.5 kg est. 1RM -> ~13.2 kg for 10 reps: the 14s on a 2 kg rack,
    # 13 kg on a cable stack.
    assert start_weight(18.5, 10, dumbbell=True) == 14
    assert start_weight(18.5, 10) == 13
