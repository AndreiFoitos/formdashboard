"""Server-side mirror of the frontend GROUPS catalogue in
protocol-native/app/(tabs)/training.tsx. Lets routers + detection services
ask 'what muscle group does this exercise belong to?' without depending on
the client.

Sync rule: any time you add or rename a hardcoded exercise in training.tsx,
update this dict too. Custom exercises are not listed here — their group is
stored on the CustomExercise row directly.
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.custom_exercise import CustomExercise


# Valid muscle-group buckets. Must match the GROUPS array in
# protocol-native/app/(tabs)/training.tsx plus an 'Other' fallback for
# custom exercises whose owner didn't pick a group.
VALID_GROUPS: set[str] = {
    "Chest",
    "Back",
    "Legs",
    "Shoulders",
    "Arms",
    "Core",
    "Other",
}

# exercise_key → muscle group. Keys here MUST match the keys in
# training.tsx GROUPS. Categories follow the same client-side taxonomy.
EXERCISE_TO_GROUP: dict[str, str] = {
    # Chest
    "bench_press":            "Chest",
    "incline_bench":          "Chest",
    "decline_bench":          "Chest",
    "dumbbell_press":         "Chest",
    "incline_db_press":       "Chest",
    "decline_db_press":       "Chest",
    "machine_chest_press":    "Chest",
    "pec_deck":               "Chest",
    "chest_fly":              "Chest",
    "cable_fly":              "Chest",
    "low_cable_fly":          "Chest",
    "svend_press":            "Chest",
    "push_up":                "Chest",
    "incline_push_up":        "Chest",
    "deficit_push_up":        "Chest",
    "chest_dip":              "Chest",
    "landmine_press":         "Chest",
    # Back
    "deadlift":               "Back",
    "sumo_deadlift":          "Back",
    "trap_bar_deadlift":      "Back",
    "rack_pull":              "Back",
    "barbell_row":            "Back",
    "pendlay_row":            "Back",
    "seal_row":               "Back",
    "tbar_row":               "Back",
    "one_arm_db_row":         "Back",
    "meadows_row":            "Back",
    "cable_row":              "Back",
    "wide_cable_row":         "Back",
    "pull_up":                "Back",
    "chin_up":                "Back",
    "weighted_pull_up":       "Back",
    "lat_pulldown":           "Back",
    "neutral_grip_pulldown":  "Back",
    "straight_arm_pulldown":  "Back",
    "shrug":                  "Back",
    "db_shrug":               "Back",
    "back_extension":         "Back",
    "good_morning":           "Back",
    "hip_thrust_back":        "Back",
    # Legs
    "squat":                  "Legs",
    "front_squat":            "Legs",
    "high_bar_squat":         "Legs",
    "low_bar_squat":          "Legs",
    "box_squat":              "Legs",
    "pause_squat":            "Legs",
    "goblet_squat":           "Legs",
    "bulgarian_split_squat":  "Legs",
    "walking_lunge":          "Legs",
    "reverse_lunge":          "Legs",
    "step_up":                "Legs",
    "pistol_squat":           "Legs",
    "leg_press":              "Legs",
    "hack_squat":             "Legs",
    "belt_squat":             "Legs",
    "romanian_dl":            "Legs",
    "stiff_leg_dl":           "Legs",
    "single_leg_rdl":         "Legs",
    "leg_curl":               "Legs",
    "seated_leg_curl":        "Legs",
    "nordic_curl":            "Legs",
    "leg_extension":          "Legs",
    "sissy_squat":            "Legs",
    "hip_thrust":             "Legs",
    "glute_bridge":           "Legs",
    "cable_kickback":         "Legs",
    "hip_abduction":          "Legs",
    "calf_raise":             "Legs",
    "seated_calf_raise":      "Legs",
    "donkey_calf_raise":      "Legs",
    # Shoulders
    "overhead_press":         "Shoulders",
    "push_press":             "Shoulders",
    "seated_ohp":             "Shoulders",
    "db_shoulder_press":      "Shoulders",
    "arnold_press":           "Shoulders",
    "machine_shoulder_press": "Shoulders",
    "lateral_raise":          "Shoulders",
    "cable_lateral_raise":    "Shoulders",
    "leaning_lateral_raise":  "Shoulders",
    "front_raise":            "Shoulders",
    "plate_front_raise":      "Shoulders",
    "rear_delt_fly":          "Shoulders",
    "reverse_pec_deck":       "Shoulders",
    "face_pull":              "Shoulders",
    "upright_row":            "Shoulders",
    "handstand_push_up":      "Shoulders",
    # Arms
    "bicep_curl":             "Arms",
    "db_curl":                "Arms",
    "hammer_curl":            "Arms",
    "preacher_curl":          "Arms",
    "incline_db_curl":        "Arms",
    "cable_curl":             "Arms",
    "spider_curl":            "Arms",
    "concentration_curl":     "Arms",
    "reverse_curl":           "Arms",
    "zottman_curl":           "Arms",
    "tricep_extension":       "Arms",
    "overhead_tri_extension": "Arms",
    "tricep_pushdown":        "Arms",
    "rope_pushdown":          "Arms",
    "tricep_dip":             "Arms",
    "close_grip_bench":       "Arms",
    "jm_press":               "Arms",
    "kickback":               "Arms",
    "wrist_curl":             "Arms",
    "reverse_wrist_curl":     "Arms",
    "farmer_carry":           "Arms",
    # Core
    "plank":                  "Core",
    "side_plank":             "Core",
    "cable_crunch":           "Core",
    "hanging_leg_raise":      "Core",
    "hanging_knee_raise":     "Core",
    "ab_wheel":               "Core",
    "sit_up":                 "Core",
    "decline_sit_up":         "Core",
    "russian_twist":          "Core",
    "pallof_press":           "Core",
    "wood_chop":              "Core",
    "dead_bug":               "Core",
    "bird_dog":               "Core",
    "l_sit":                  "Core",
    "dragon_flag":            "Core",
}


async def group_for_exercise(
    exercise_key: str, db: AsyncSession
) -> Optional[str]:
    """Resolve any exercise_key (hardcoded or custom_<uuid>) to a muscle
    group. Returns None if unknown — caller decides whether to bucket as
    'Other' or skip."""
    if not exercise_key:
        return None
    direct = EXERCISE_TO_GROUP.get(exercise_key)
    if direct is not None:
        return direct
    if exercise_key.startswith("custom_"):
        try:
            ce_id = uuid.UUID(exercise_key.split("custom_", 1)[1])
        except (ValueError, IndexError):
            return None
        ex = await db.get(CustomExercise, ce_id)
        if ex and ex.group_name in VALID_GROUPS:
            return ex.group_name
        return "Other"
    return None


async def groups_for_exercises(
    exercise_keys: list[str], db: AsyncSession
) -> dict[str, str]:
    """Batched version: returns {exercise_key: group_name}. Skips unknown
    keys. One DB query for any custom_ exercises in the input."""
    out: dict[str, str] = {}
    custom_ids: list[uuid.UUID] = []
    for key in set(exercise_keys):
        direct = EXERCISE_TO_GROUP.get(key)
        if direct is not None:
            out[key] = direct
            continue
        if key.startswith("custom_"):
            try:
                custom_ids.append(uuid.UUID(key.split("custom_", 1)[1]))
            except (ValueError, IndexError):
                pass

    if custom_ids:
        result = await db.execute(
            select(CustomExercise).where(CustomExercise.id.in_(custom_ids))
        )
        for ex in result.scalars().all():
            key = f"custom_{ex.id}"
            out[key] = ex.group_name if ex.group_name in VALID_GROUPS else "Other"
    return out
