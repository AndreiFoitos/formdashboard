"""Pit Crew plan builds (docs/ai-plans-design.md §6, §8).

Claude picks the exercises and foods. Every number the user sees is ours:
- calorie and macro targets come from the user's settings, checked against
  a TDEE estimate and hard safety limits (§8) that no prompt can move;
- starting weights come from the user's own estimated 1RMs;
- grams and macros come from USDA, then each day is rescaled to the target.

The model can only name exercises from an enum built per user, so equipment
and injury exclusions hold by construction. Food is checked in code against
allergies and diet style; one retry names the problem, a second failure
fails the build (the quota is refunded).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal
from core.redis import cache_get, cache_setex
from core.timezone import user_today
from models.ai_plan import AiPlan
from models.body_metric import BodyMetric
from models.custom_exercise import CustomExercise
from models.daily_summary import DailySummary
from models.onboarding import OnboardingBaseline
from models.training_log import TrainingLog
from models.user import User
from models.user_preference import UserPreference
from services import nutrition_estimate as ne
from services.ai_client import CLAUDE_MODEL, call_claude_json
from services.exercise_taxonomy import EXERCISE_TO_GROUP, VALID_GROUPS
from services.one_rm import estimate as estimate_one_rm
from services.plan_context import _slope_per_week, build_context
from services.plans import plan_for, refund_scan
from services.push import send_to_user
from services.usda import get_nutrition, portions

log = logging.getLogger(__name__)

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
SLOTS = ("breakfast", "lunch", "dinner", "snack")
STALE_AFTER = timedelta(minutes=15)  # a "generating" row older than this died with its worker


class PlanBuildError(Exception):
    """A build failure whose message is fit to show the user."""


GENERIC_ERROR = "Something went wrong building your plan. It wasn't counted, so try again."

# ─── Equipment and injuries ───────────────────────────────────────────────────

# Need a machine, cable stack or station most home setups don't have.
MACHINE_OR_CABLE = {
    "machine_chest_press", "pec_deck", "cable_fly", "low_cable_fly", "cable_row", "wide_cable_row",
    "lat_pulldown", "neutral_grip_pulldown", "straight_arm_pulldown", "leg_press", "hack_squat",
    "belt_squat", "leg_curl", "seated_leg_curl", "leg_extension", "cable_kickback", "hip_abduction",
    "seated_calf_raise", "donkey_calf_raise", "machine_shoulder_press", "cable_lateral_raise",
    "reverse_pec_deck", "face_pull", "cable_curl", "tricep_pushdown", "rope_pushdown", "cable_crunch",
    "pallof_press", "wood_chop", "tbar_row", "meadows_row", "landmine_press", "back_extension",
}

# Doable with no equipment beyond a bar to hang from and something to dip on.
BODYWEIGHT = {
    "push_up", "incline_push_up", "deficit_push_up", "chest_dip", "tricep_dip", "pull_up", "chin_up",
    "pistol_squat", "bulgarian_split_squat", "walking_lunge", "reverse_lunge", "step_up",
    "glute_bridge", "hip_thrust", "nordic_curl", "sissy_squat", "handstand_push_up", "calf_raise",
    "plank", "side_plank", "hanging_leg_raise", "hanging_knee_raise", "ab_wheel", "sit_up",
    "decline_sit_up", "russian_twist", "dead_bug", "bird_dog", "l_sit", "dragon_flag",
}

# Coarse: the movements that most load each preset injury. Free-text
# injuries only reach the prompt.
INJURY_EXCLUDES = {
    "shoulder": {
        "overhead_press", "push_press", "seated_ohp", "db_shoulder_press", "arnold_press",
        "machine_shoulder_press", "handstand_push_up", "upright_row", "chest_dip", "tricep_dip",
        "plate_front_raise", "front_raise", "decline_bench", "overhead_tri_extension",
    },
    "knee": {
        "pistol_squat", "sissy_squat", "leg_extension", "walking_lunge", "reverse_lunge",
        "bulgarian_split_squat", "step_up", "hack_squat", "pause_squat",
    },
    "lower back": {
        "deadlift", "sumo_deadlift", "rack_pull", "good_morning", "barbell_row", "pendlay_row",
        "romanian_dl", "stiff_leg_dl", "back_extension", "low_bar_squat", "box_squat", "squat",
        "front_squat", "high_bar_squat", "pause_squat", "tbar_row", "dragon_flag",
    },
    "wrist": {
        "front_squat", "wrist_curl", "reverse_wrist_curl", "handstand_push_up", "close_grip_bench",
        "jm_press", "push_up", "deficit_push_up", "reverse_curl", "zottman_curl",
    },
    "elbow": {
        "tricep_extension", "overhead_tri_extension", "jm_press", "close_grip_bench",
        "preacher_curl", "tricep_dip", "chest_dip", "spider_curl",
    },
    "hip": {
        "sumo_deadlift", "hip_abduction", "bulgarian_split_squat", "pistol_squat", "walking_lunge",
        "reverse_lunge",
    },
}

# Weekly hard-set ceiling per app muscle group. "Legs" is quads, hamstrings,
# glutes and calves together, "Arms" biceps and triceps, so those get more.
MAX_SETS_PER_GROUP = {"Legs": 34, "Back": 26, "Arms": 24, "Core": 16}
DEFAULT_MAX_SETS = 20
RIR = 2  # starting weights leave about two reps in reserve

# ─── Food rules ───────────────────────────────────────────────────────────────

MEAT = [
    "chicken", "beef", "pork", "turkey", "lamb", "bacon", "ham", "sausage", "steak", "veal", "duck",
    "venison", "prosciutto", "salami", "pepperoni", "jerky", "chorizo", "mince", "meatball",
]
FISH = [
    "salmon", "tuna", "cod", "tilapia", "fish", "sardine", "mackerel", "trout", "anchov", "halibut",
    "haddock", "pollock", "sea bass", "herring",
]
SHELLFISH = ["shrimp", "prawn", "crab", "lobster", "mussel", "clam", "oyster", "scallop", "shellfish"]
DAIRY = [
    "milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "whey", "casein", "kefir", "ghee",
    "skyr", "quark", "cottage", "mozzarella", "parmesan", "cheddar", "feta",
]
# Plant foods whose names contain a dairy word.
NOT_DAIRY = [
    "peanut butter", "almond butter", "nut butter", "cashew butter", "cocoa butter", "almond milk",
    "oat milk", "soy milk", "coconut milk", "rice milk", "coconut cream", "cream of rice",
    "cream of wheat", "butternut", "butter beans",
]
EGG = ["egg"]
GLUTEN = [
    "wheat", "bread", "pasta", "barley", "rye", "couscous", "seitan", "flour", "tortilla", "bagel",
    "noodle", "cracker", "spaghetti", "bulgur", "cream of wheat",
]
ALLERGENS = {
    "peanuts": ["peanut"],
    "tree nuts": [
        "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "brazil nut",
        "pine nut", "mixed nuts",
    ],
    "dairy": DAIRY,
    "gluten": GLUTEN,
    "eggs": EGG,
    "fish": FISH,
    "shellfish": SHELLFISH,
    "soy": ["soy", "tofu", "tempeh", "edamame", "miso"],
}
PORK = ["pork", "bacon", "ham", "prosciutto", "salami", "pepperoni", "chorizo", "lard"]
DIET_BANS = {
    "vegetarian": MEAT + FISH + SHELLFISH,
    "vegan": MEAT + FISH + SHELLFISH + DAIRY + EGG + ["honey", "gelatin"],
    "pescatarian": MEAT,
    "halal": PORK + ["wine", "beer", "gelatin"],
    "kosher": PORK + SHELLFISH,
}


def _contains(food: str, words: list[str]) -> str | None:
    """The first word from `words` in `food`, matched at a word start so
    plurals count ("egg" hits "eggs"). Plant foods named like dairy
    ("peanut butter", "oat milk") and eggplant are let through."""
    name = food.lower()
    for w in words:
        if w in DAIRY and any(nd in name for nd in NOT_DAIRY):
            continue
        if re.search(rf"\b{re.escape(w)}", name):
            if w == "egg" and "eggplant" in name:
                continue
            return w
    return None


def food_conflicts(food: str, prefs: UserPreference | None) -> tuple[list[str], list[str]]:
    """(hard problems, soft problems) for one food name."""
    if prefs is None:
        return [], []
    hard, soft = [], []
    for allergy in prefs.allergies or []:
        hit = _contains(food, ALLERGENS.get(allergy, [allergy]))
        if hit:
            hard.append(f'"{food}" contains {hit} (allergy: {allergy})')
    if prefs.diet_style in DIET_BANS:
        hit = _contains(food, DIET_BANS[prefs.diet_style])
        if hit:
            hard.append(f'"{food}" is not {prefs.diet_style} ({hit})')
    for dislike in prefs.dislikes or []:
        if _contains(food, [dislike]):
            soft.append(f'"{food}" is on their dislike list ({dislike})')
    return hard, soft


# ─── Targets ──────────────────────────────────────────────────────────────────

ACTIVITY = [(1, 1.2), (3, 1.375), (5, 1.55), (7, 1.725)]  # max days/week -> factor
FREQ_DAYS = {"0-1x": 2, "2-3x": 3, "4-5x": 4, "6x+": 5}


def training_days(prefs: UserPreference | None, freq: str | None) -> int:
    if prefs and prefs.training_days:
        return prefs.training_days
    return FREQ_DAYS.get(freq or "", 3)


def _activity(days: int) -> float:
    return next(f for d, f in ACTIVITY if days <= d)


async def compute_targets(
    user: User, prefs: UserPreference | None, days: int, today: date, db: AsyncSession
) -> dict:
    """Daily kcal and macros for the meal plan, plus how they were reached.

    The user's own calorie and protein targets win, inside the §8 limits.
    The plan doesn't silently change their settings; the chat can (step 5)."""
    notes: list[str] = []
    weights = [
        (r.date, r.weight_kg)
        for r in (await db.execute(
            select(BodyMetric)
            .where(BodyMetric.user_id == user.id, BodyMetric.date >= today - timedelta(days=28))
            .order_by(BodyMetric.date)
        )).scalars()
        if r.weight_kg
    ]
    weight = weights[-1][1] if weights else user.weight_kg

    bmr = None
    if weight and user.height_cm and user.age and user.sex in ("male", "female"):
        bmr = 10 * weight + 6.25 * user.height_cm - 5 * user.age + (5 if user.sex == "male" else -161)
    tdee_formula = bmr * _activity(days) if bmr else None

    # Measured TDEE: what they ate minus what the scale says they stored.
    tdee_measured = None
    slope = _slope_per_week(weights)
    if slope is not None and (weights[-1][0] - weights[0][0]).days >= 14:
        eaten = [
            r.calories_eaten
            for r in (await db.execute(
                select(DailySummary).where(
                    DailySummary.user_id == user.id,
                    DailySummary.date >= today - timedelta(days=28),
                    DailySummary.is_estimated.is_(False),
                )
            )).scalars()
            if r.calories_eaten and r.calories_eaten > 500
        ]
        if len(eaten) >= 14:
            est = sum(eaten) / len(eaten) - slope * 7700 / 7
            if tdee_formula is None or 0.7 * tdee_formula <= est <= 1.3 * tdee_formula:
                tdee_measured = est
    tdee = tdee_measured or tdee_formula

    goal = prefs.goal if prefs else None
    if user.calorie_target:
        kcal = float(user.calorie_target)
    elif tdee:
        kcal = tdee + {"cut": -min(500, 0.2 * tdee), "bulk": 300}.get(goal or "", 0)
    else:
        kcal = 2500.0 if user.sex == "male" else 2000.0

    floor = 1500.0 if user.sex == "male" else 1200.0
    if bmr:
        floor = max(floor, bmr)
    if tdee:
        floor = max(floor, 0.75 * tdee)
    ceiling = tdee + 500 if tdee else None
    if kcal < floor:
        notes.append(f"Raised from {round(kcal)} kcal to the safe minimum of {round(floor)} kcal.")
        kcal = floor
    elif ceiling and kcal > ceiling:
        notes.append(f"Lowered from {round(kcal)} kcal to {round(ceiling)} kcal, 500 above estimated maintenance.")
        kcal = ceiling
    kcal = round(kcal / 10) * 10

    protein = float(user.protein_target_g) if user.protein_target_g else (2.0 * weight if weight else 140.0)
    if weight:
        lo, hi = 1.6 * weight, 2.4 * weight
        if not lo <= protein <= hi:
            clamped = min(max(protein, lo), hi)
            notes.append(f"Protein set to {round(clamped)} g (1.6-2.4 g per kg) instead of {round(protein)} g.")
            protein = clamped
    protein = round(protein)
    fat = round(kcal * 0.27 / 9)
    carbs = max(0, round((kcal - 4 * protein - 9 * fat) / 4))

    return {
        "kcal": kcal,
        "protein_g": protein,
        "carbs_g": carbs,
        "fat_g": fat,
        "bmr": round(bmr) if bmr else None,
        "tdee": round(tdee) if tdee else None,
        "tdee_source": "measured" if tdee_measured else ("formula" if tdee_formula else None),
        "weight_kg": weight,
        "notes": notes,
    }


def meal_plan_allowed(user: User, prefs: UserPreference | None) -> bool:
    """§8: no meal plan for under-18s or anyone who ticked a health flag."""
    if user.age is not None and user.age < 18:
        return False
    return not (prefs and prefs.health_flags)


# ─── Exercises ────────────────────────────────────────────────────────────────

def _name(key: str) -> str:
    return key.replace("_", " ").title()


async def allowed_exercises(
    user: User, prefs: UserPreference | None, db: AsyncSession
) -> dict[str, tuple[str, str]]:
    """{key: (name, muscle group)} the plan may use. Built-ins filtered by
    equipment and preset injuries, plus the user's custom exercises."""
    equipment = prefs.equipment if prefs else None
    banned: set[str] = set()
    for injury in (prefs.injuries if prefs else None) or []:
        # "left elbow" from the chat counts as the preset "elbow".
        for preset, moves in INJURY_EXCLUDES.items():
            if preset in injury:
                banned |= moves
    out: dict[str, tuple[str, str]] = {}
    for key, group in EXERCISE_TO_GROUP.items():
        if key in banned:
            continue
        if equipment == "bodyweight" and key not in BODYWEIGHT:
            continue
        if equipment == "home_weights" and key in MACHINE_OR_CABLE:
            continue
        out[key] = (_name(key), group)
    customs = (await db.execute(
        select(CustomExercise).where(CustomExercise.user_id == user.id)
    )).scalars().all()
    for ex in customs:
        group = ex.group_name if ex.group_name in VALID_GROUPS else "Other"
        out[f"custom_{ex.id}"] = (ex.name, group)
    return out


async def best_one_rms(user: User, today: date, db: AsyncSession) -> dict[str, float]:
    logs = (await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == user.id,
            TrainingLog.date >= today - timedelta(weeks=16),
            TrainingLog.weight_kg.is_not(None),
            TrainingLog.reps.is_not(None),
        )
    )).scalars().all()
    best: dict[str, float] = {}
    for log_ in logs:
        if log_.weight_kg <= 0 or log_.reps <= 0:
            continue
        est = estimate_one_rm(float(log_.weight_kg), int(log_.reps))["mean"]
        if est and est > best.get(log_.type, 0):
            best[log_.type] = est
    return best


def start_weight(one_rm: float | None, reps_max: int) -> float | None:
    """Epley inverted for the top of the rep range with RIR reps to spare."""
    if not one_rm:
        return None
    w = one_rm / (1 + (reps_max + RIR) / 30)
    step = 1.0 if w < 20 else 2.5
    return round(round(w / step) * step, 1)


# ─── Schema and prompt ────────────────────────────────────────────────────────

def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


def plan_schema(exercise_keys: list[str], with_meals: bool) -> dict:
    exercise = _obj({
        "key": {"type": "string", "enum": exercise_keys},
        "sets": {"type": "integer"},
        "reps_min": {"type": "integer"},
        "reps_max": {"type": "integer"},
        "rest_seconds": {"type": "integer"},
        "note": {"type": "string"},
    })
    day = _obj({
        "weekday": {"type": "string", "enum": list(WEEKDAYS)},
        "name": {"type": "string"},
        "focus": {"type": "string"},
        "exercises": {"type": "array", "items": exercise},
    })
    props = {
        "rationale": {"type": "string"},
        "training": _obj({"days": {"type": "array", "items": day}}),
    }
    if with_meals:
        item = _obj({
            "food": {"type": "string"},
            "grams": {"type": "number"},
            "per_100g": _obj({
                "kcal": {"type": "number"},
                "protein": {"type": "number"},
                "carbs": {"type": "number"},
                "fat": {"type": "number"},
            }),
        })
        meal = _obj({
            "id": {"type": "string"},
            "name": {"type": "string"},
            "slot": {"type": "string", "enum": list(SLOTS)},
            "items": {"type": "array", "items": item},
        })
        props["nutrition"] = _obj({
            "meals": {"type": "array", "items": meal},
            "week": {"type": "array", "items": _obj({
                "weekday": {"type": "string", "enum": list(WEEKDAYS)},
                "meal_ids": {"type": "array", "items": {"type": "string"}},
            })},
        })
    return _obj(props)


PLAN_SYSTEM = """You are the planning engine behind Pit Crew, the training and nutrition planner in the GainRace app. Build one week of strength training and, when asked, a meal plan for the user whose data follows. The app repeats the week until the user rebuilds it.

Training rules:
- Use exactly the number of training days given. Put rest days between hard sessions where you can, and keep their usual split if it fits.
- Fit each session in the time given: about 2.5 minutes per working set including rest, plus 5 minutes of warm-up.
- Compound lifts first, isolation after. 10-20 hard sets per major muscle group per week; 8-12 for new lifters.
- Rep ranges: heavy compounds 4-8, hypertrophy work 8-12, small isolation 10-20. New lifters get fewer exercises and 8-12 reps.
- Prefer exercises the user already does (see Strength) so their progress carries over.
- Use only the allowed exercises. The list already leaves out equipment they lack and movements that load their listed injuries.
- note: one short cue when useful (tempo, form), otherwise an empty string.

Meal rules (only when a meal plan is requested):
- Hit the daily calorie and protein targets within about 10%. The app rescales grams to the exact target, so get the proportions right.
- Build from foods the user already logs where you can. Never use an allergen. Follow their diet style. Avoid their dislikes. Match their cooking time.
- 3-5 meals a day. Reuse meals across days: a library of 6-12 meals is enough.
- Food names: one plain ingredient a nutrition database knows, with its state: "chicken breast, cooked", "white rice, cooked", "rolled oats, dry", "whole milk". No recipes or brands.
- per_100g: your estimate for that food as named (cooked and dry differ).

rationale: 3-5 plain sentences to the user that cite their own numbers (weight trend, lifts, intake) and say why the plan looks the way it does. No markdown, no medical claims."""


def plan_inputs(
    days: int, minutes: int, experience: str | None, goal: str | None, targets: dict | None,
    exercises: dict[str, tuple[str, str]],
) -> str:
    by_group: dict[str, list[str]] = {}
    for key, (name, group) in exercises.items():
        by_group.setdefault(group, []).append(f"{key} ({name})" if key.startswith("custom_") else key)
    lines = [
        "## Plan inputs",
        f"- training days per week: {days}",
        f"- session length: {minutes} min",
        f"- experience: {experience or 'unknown (assume some)'}",
        f"- goal: {goal or 'not set'}",
    ]
    if targets:
        lines.append(
            f"- meal plan: yes. Daily target {targets['kcal']} kcal, protein {targets['protein_g']} g "
            f"(fat about {targets['fat_g']} g, carbs about {targets['carbs_g']} g)"
        )
    else:
        lines.append("- meal plan: no. Return training only.")
    lines += ["", "## Allowed exercises by muscle group"]
    lines += [f"{g}: {', '.join(keys)}" for g, keys in sorted(by_group.items())]
    return "\n".join(lines)


# ─── Training clean-up ────────────────────────────────────────────────────────

def resolve_training(
    raw: dict, exercises: dict[str, tuple[str, str]], one_rms: dict[str, float], days: int
) -> dict:
    seen: set[str] = set()
    out_days = []
    for d in raw.get("days", []):
        if d["weekday"] in seen or len(out_days) >= days:
            continue
        seen.add(d["weekday"])
        exs = []
        for e in d.get("exercises", []):
            if e["key"] not in exercises:
                continue
            name, group = exercises[e["key"]]
            lo = min(max(int(e["reps_min"]), 1), 30)
            hi = min(max(int(e["reps_max"]), lo), 30)
            body = e["key"] in BODYWEIGHT
            exs.append({
                "key": e["key"],
                "name": name,
                "group": group,
                "sets": min(max(int(e["sets"]), 1), 6),
                "reps_min": lo,
                "reps_max": hi,
                "rest_seconds": min(max(int(e["rest_seconds"]), 30), 300),
                "note": e.get("note", "").strip(),
                "start_weight_kg": None if body else start_weight(one_rms.get(e["key"]), hi),
                "basis": "bodyweight" if body else ("e1rm" if one_rms.get(e["key"]) else "none"),
            })
        if exs:
            out_days.append({
                "weekday": WEEKDAYS.index(d["weekday"]),
                "name": d["name"].strip(),
                "focus": d.get("focus", "").strip(),
                "exercises": exs,
            })
    out_days.sort(key=lambda d: d["weekday"])

    # Weekly volume cap per muscle group. Take one set at a time, round-robin
    # from the end of each day, so accessories shrink before the main lifts
    # and nothing drops below 2 sets.
    per_group = Counter()
    for d in out_days:
        for e in d["exercises"]:
            per_group[e["group"]] += e["sets"]
    for group, total in per_group.items():
        excess = total - MAX_SETS_PER_GROUP.get(group, DEFAULT_MAX_SETS)
        order = [e for d in out_days for e in reversed(d["exercises"]) if e["group"] == group]
        order.sort(key=lambda e: -_position(out_days, e))
        while excess > 0:
            trimmable = [e for e in order if e["sets"] > 2]
            if not trimmable:
                break
            for e in trimmable:
                if excess <= 0:
                    break
                e["sets"] -= 1
                excess -= 1
    return {"days": out_days}


def _position(days: list[dict], ex: dict) -> int:
    """Index of an exercise within its day: later means more expendable."""
    for d in days:
        for i, e in enumerate(d["exercises"]):
            if e is ex:
                return i
    return 0


# ─── Nutrition ────────────────────────────────────────────────────────────────

FOOD_CACHE_TTL = 7 * 24 * 3600


async def _per_100g(food: str, guess: dict, http: httpx.AsyncClient) -> dict:
    """Macros per 100 g from USDA (cached), else the model's own estimate."""
    key = f"planfood:{food.strip().lower()}"
    cached = await cache_get(key)
    if cached:
        return json.loads(cached)
    cands = await ne._candidates(food, guess.get("kcal") or None, http)
    if cands:
        c = cands[0]
        out = {
            **get_nutrition(c, 100),
            "source": "usda",
            "usda_name": c.get("description"),
            "portions": [[label, g] for label, g in portions(c)[:3]],
        }
        await cache_setex(key, FOOD_CACHE_TTL, json.dumps(out))
        return out
    return {
        "calories": round(guess.get("kcal") or 0),
        "protein_g": round(guess.get("protein") or 0, 1),
        "carbs_g": round(guess.get("carbs") or 0, 1),
        "fat_g": round(guess.get("fat") or 0, 1),
        "source": "estimate",
        "usda_name": None,
        "portions": [],
    }


def _scaled(per100: dict, grams: float) -> dict:
    f = grams / 100
    return {
        "calories": round(per100["calories"] * f),
        "protein_g": round(per100["protein_g"] * f, 1),
        "carbs_g": round(per100["carbs_g"] * f, 1),
        "fat_g": round(per100["fat_g"] * f, 1),
    }


def _sum(rows: list[dict]) -> dict:
    return {
        "calories": round(sum(r["calories"] for r in rows)),
        "protein_g": round(sum(r["protein_g"] for r in rows), 1),
        "carbs_g": round(sum(r["carbs_g"] for r in rows), 1),
        "fat_g": round(sum(r["fat_g"] for r in rows), 1),
    }


async def resolve_nutrition(raw: dict, targets: dict) -> tuple[dict, list[str]]:
    """Look every food up, then rescale each day's grams to the kcal target.
    Returns the resolved nutrition and soft warnings (protein short etc.)."""
    meals = {m["id"]: m for m in raw.get("meals", []) if m.get("items")}
    foods = {i["food"]: i["per_100g"] for m in meals.values() for i in m["items"]}
    sem = asyncio.Semaphore(5)

    async with httpx.AsyncClient(timeout=20) as http:
        async def one(name: str, guess: dict):
            async with sem:
                return name, await _per_100g(name, guess, http)
        per100 = dict(await asyncio.gather(*(one(n, g) for n, g in foods.items())))

    days, warnings = [], []
    for wd in raw.get("week", []):
        ids = [i for i in wd["meal_ids"] if i in meals]
        if not ids:
            continue
        base = sum(_scaled(per100[i["food"]], i["grams"])["calories"] for mid in ids for i in meals[mid]["items"])
        factor = min(max(targets["kcal"] / base, 0.7), 1.4) if base else 1.0
        day_meals = []
        for mid in ids:
            m = meals[mid]
            items = []
            for i in m["items"]:
                grams = max(5, round(i["grams"] * factor / 5) * 5)
                p = per100[i["food"]]
                items.append({
                    "food": i["food"], "grams": grams, **_scaled(p, grams),
                    "source": p["source"], "usda_name": p["usda_name"], "portions": p["portions"],
                })
            day_meals.append({"id": mid, "name": m["name"], "slot": m["slot"], "items": items, "totals": _sum(items)})
        totals = _sum([m["totals"] for m in day_meals])
        days.append({"weekday": WEEKDAYS.index(wd["weekday"]), "meals": day_meals, "totals": totals})
        day = WEEKDAYS[days[-1]["weekday"]]
        if abs(totals["calories"] - targets["kcal"]) > 0.1 * targets["kcal"]:
            warnings.append(f"{day}: {totals['calories']} kcal vs target {targets['kcal']}")
        if totals["protein_g"] < 0.85 * targets["protein_g"]:
            warnings.append(f"{day}: protein {totals['protein_g']:.0f} g vs target {targets['protein_g']}")
    days.sort(key=lambda d: d["weekday"])
    estimated = sorted({n for n, p in per100.items() if p["source"] != "usda"})
    return {"targets": {k: targets[k] for k in ("kcal", "protein_g", "carbs_g", "fat_g")},
            "days": days, "estimated_foods": estimated}, warnings


def food_problems(raw: dict, prefs: UserPreference | None) -> tuple[list[str], list[str]]:
    hard, soft = [], []
    for m in (raw.get("nutrition") or {}).get("meals", []):
        for i in m.get("items", []):
            h, s = food_conflicts(i["food"], prefs)
            hard += h
            soft += s
    return sorted(set(hard)), sorted(set(soft))


# ─── The build ────────────────────────────────────────────────────────────────

async def _generate(user: User, db: AsyncSession) -> dict:
    today = user_today(user.timezone)
    prefs = await db.get(UserPreference, user.id)
    freq = (await db.execute(
        select(OnboardingBaseline.training_frequency).where(OnboardingBaseline.user_id == user.id)
    )).scalar_one_or_none()
    days = training_days(prefs, freq)
    minutes = (prefs.session_minutes if prefs else None) or 60
    with_meals = meal_plan_allowed(user, prefs)
    targets = await compute_targets(user, prefs, days, today, db)
    exercises = await allowed_exercises(user, prefs, db)
    one_rms = await best_one_rms(user, today, db)

    context = await build_context(user, db, min(plan_for(user).history_days, 90))
    inputs = plan_inputs(
        days, minutes, prefs.experience if prefs else None, prefs.goal if prefs else None,
        targets if with_meals else None, exercises,
    )
    system = [{"type": "text", "text": PLAN_SYSTEM, "cache_control": {"type": "ephemeral"}}]
    messages: list[dict] = [{"role": "user", "content": f"{context}\n\n{inputs}"}]
    schema = plan_schema(sorted(exercises), with_meals)

    usage_in = usage_out = 0
    nutrition, warnings = None, []
    for attempt in (1, 2):
        raw, message = await call_claude_json(system, messages, schema, effort="high")
        u = message.usage
        usage_in += u.input_tokens + (u.cache_read_input_tokens or 0) + (u.cache_creation_input_tokens or 0)
        usage_out += u.output_tokens
        hard, soft = food_problems(raw, prefs)
        if with_meals and not hard:
            nutrition, warnings = await resolve_nutrition(raw["nutrition"], targets)
        if attempt == 2 or not (hard or soft or warnings):
            break
        problems = hard + soft + [w for w in warnings if "protein" in w]
        if not problems:
            break
        messages += [
            {"role": "assistant", "content": message.content},
            {"role": "user", "content": (
                "Fix these problems and return the complete plan again:\n- " + "\n- ".join(problems)
            )},
        ]
    if hard:
        log.warning("plan build for %s broke food rules twice: %s", user.id, hard)
        raise PlanBuildError(
            "Pit Crew couldn't fit a meal plan to your food rules this time. It wasn't counted, "
            "so try again, or check your allergies and diet under Settings > Training & food."
        )

    return {
        "plan": {
            "training": resolve_training(raw["training"], exercises, one_rms, days),
            "nutrition": nutrition,
            "days_per_week": days,
            "session_minutes": minutes,
            "model": CLAUDE_MODEL,
        },
        "targets": {**targets, "warnings": warnings},
        "rationale": raw["rationale"].strip(),
        "meal_plan_enabled": with_meals,
        "input_tokens": usage_in,
        "output_tokens": usage_out,
    }


async def run_build(plan_id: uuid.UUID) -> None:
    """Background task: fill one `generating` row. Never raises."""
    async with AsyncSessionLocal() as db:
        row = await db.get(AiPlan, plan_id)
        if row is None or row.status != "generating":
            return
        user = await db.get(User, row.user_id)
        try:
            result = await _generate(user, db)
        except Exception as e:  # noqa: BLE001
            log.exception("plan build %s failed", plan_id)
            row.status = "failed"
            row.error = str(e) if isinstance(e, PlanBuildError) else GENERIC_ERROR
            await db.commit()
            if row.scan_id:
                await refund_scan(row.scan_id, db)
            return

        await db.execute(
            update(AiPlan)
            .where(AiPlan.user_id == user.id, AiPlan.status == "ready")
            .values(status="archived")
        )
        for k, v in result.items():
            setattr(row, k, v)
        row.status = "ready"
        await db.commit()
        try:
            await send_to_user(
                user.id, db,
                title="Your plan is ready",
                body="Pit Crew built your week. Open GainRace to see it.",
                data={"type": "plan_ready", "plan_id": str(plan_id)},
            )
        except Exception:  # noqa: BLE001
            log.warning("plan_ready push failed for %s", user.id)


async def expire_stale(user_id: uuid.UUID, db: AsyncSession) -> None:
    """A build whose worker died (deploy, restart) stays `generating` forever.
    Fail it and hand the quota back so the user can try again."""
    cutoff = datetime.now(timezone.utc) - STALE_AFTER
    stale = (await db.execute(
        select(AiPlan).where(
            AiPlan.user_id == user_id, AiPlan.status == "generating", AiPlan.created_at < cutoff
        )
    )).scalars().all()
    for row in stale:
        row.status = "failed"
        row.error = "Your plan build was interrupted. It wasn't counted, so try again."
        if row.scan_id:
            await refund_scan(row.scan_id, db)
    if stale:
        await db.commit()
