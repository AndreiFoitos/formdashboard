"""Auto-detection of recurring meal patterns.

Definition: a meal occurrence is the set of NutritionLog rows for one user
on one date in one time bucket (morning / midday / evening / late). Two
occurrences describe the same pattern iff they have the same (normalised,
sorted) set of meal_names AND the same time bucket — a 'breakfast eggs+oats'
is a different pattern from 'dinner eggs+oats'.

When a pattern hits >= MIN_OCCURRENCES inside the lookback window, we create
a SavedMeal with averaged macros per food. Already-saved or
explicitly-dismissed patterns are skipped, so the detector is safe to run
nightly without churning the table.
"""
from __future__ import annotations

import hashlib
import logging
from collections import defaultdict
from datetime import date, timedelta
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal
from models.nutrition_log import NutritionLog
from models.saved_meal import DismissedMealPattern, SavedMeal, SavedMealItem
from models.user import User


# Tuning knobs — keep them here so the threshold can be moved without
# touching multiple files. 3 in 14 days matches the spec.
LOOKBACK_DAYS = 14
MIN_OCCURRENCES = 3

BUCKET_DEFAULT_NAMES = {
    "morning": "Usual breakfast",
    "midday": "Usual lunch",
    "evening": "Usual dinner",
    "late": "Usual snack",
}


def _bucket_for_hour(hour: int) -> str:
    """5–11 morning, 11–15 midday, 15–22 evening, else late.

    'late' wraps midnight intentionally — late-night snacks and early-morning
    pre-dawn coffee land in the same bucket because both are atypical eating
    times and rarely repeat together with regular meals.
    """
    if 5 <= hour < 11:
        return "morning"
    if 11 <= hour < 15:
        return "midday"
    if 15 <= hour < 22:
        return "evening"
    return "late"


def _normalize(name: str) -> str:
    return name.strip().lower()


def _hash_food_set(normalized_names: Iterable[str]) -> str:
    """SHA-256 over the sorted, normalised set, truncated to 32 hex chars.

    Collisions at 2^128 namespace are not a concern for our scale; truncating
    keeps the FK index lean.
    """
    sorted_names = sorted(normalized_names)
    raw = "\x1f".join(sorted_names)  # \x1f (unit separator) is not a food name char
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


async def detect_for_user(user_id, db: AsyncSession) -> int:
    """Run pattern detection for a single user. Returns the number of new
    SavedMeals created. Idempotent — skips already-saved and dismissed
    patterns, so calling this twice in a row creates zero on the second run."""
    cutoff = date.today() - timedelta(days=LOOKBACK_DAYS)

    logs_result = await db.execute(
        select(NutritionLog).where(
            NutritionLog.user_id == user_id,
            NutritionLog.date >= cutoff,
            NutritionLog.meal_name.is_not(None),
        )
    )
    logs = list(logs_result.scalars().all())
    if not logs:
        return 0

    # Step 1: group logs into meal occurrences keyed by (date, bucket).
    occurrences: dict[tuple[date, str], list[NutritionLog]] = defaultdict(list)
    for log in logs:
        bucket = _bucket_for_hour(log.logged_at.hour)
        occurrences[(log.date, bucket)].append(log)

    # Step 2: for each occurrence, normalise food names, compute the hash,
    # and within-occurrence-sum macros per food name (same food logged twice
    # in one sitting counts once).
    # pattern_buckets[(bucket, hash)] = list of per-food aggregates per occurrence
    pattern_buckets: dict[tuple[str, str], list[dict[str, dict]]] = defaultdict(list)
    for (_occ_date, bucket), occ_logs in occurrences.items():
        named = [l for l in occ_logs if l.meal_name and l.meal_name.strip()]
        if not named:
            continue
        per_food: dict[str, dict] = {}
        for l in named:
            key = _normalize(l.meal_name)
            agg = per_food.setdefault(
                key,
                {
                    "display_name": l.meal_name.strip(),
                    "calories": 0,
                    "protein_g": 0.0,
                    "carbs_g": 0.0,
                    "fat_g": 0.0,
                },
            )
            agg["calories"] += l.calories or 0
            agg["protein_g"] += l.protein_g or 0.0
            agg["carbs_g"] += l.carbs_g or 0.0
            agg["fat_g"] += l.fat_g or 0.0
        h = _hash_food_set(per_food.keys())
        pattern_buckets[(bucket, h)].append(per_food)

    # Step 3: load already-saved + dismissed pairs so we don't dup-create.
    # Only consider source='auto' rows here — manual meals with the same
    # food set aren't duplicates of an auto-detected suggestion, they're
    # the user's own composition.
    existing_result = await db.execute(
        select(SavedMeal.food_set_hash, SavedMeal.time_bucket).where(
            SavedMeal.user_id == user_id,
            SavedMeal.source == "auto",
        )
    )
    existing = {(h, b) for h, b in existing_result.all()}

    dismissed_result = await db.execute(
        select(
            DismissedMealPattern.food_set_hash, DismissedMealPattern.time_bucket
        ).where(DismissedMealPattern.user_id == user_id)
    )
    dismissed = {(h, b) for h, b in dismissed_result.all()}

    # Step 4: create SavedMeal for any pattern that hits threshold + isn't
    # already saved / dismissed. Macros are averages over qualifying occurrences.
    created = 0
    for (bucket, h), occs in pattern_buckets.items():
        if len(occs) < MIN_OCCURRENCES:
            continue
        if (h, bucket) in existing or (h, bucket) in dismissed:
            continue

        n = len(occs)
        # Pivot from "per-occurrence per-food" to "per-food list of aggregates".
        food_aggs: dict[str, list[dict]] = defaultdict(list)
        for occ in occs:
            for key, agg in occ.items():
                food_aggs[key].append(agg)

        meal = SavedMeal(
            user_id=user_id,
            name=BUCKET_DEFAULT_NAMES.get(bucket, "Usual meal"),
            time_bucket=bucket,
            food_set_hash=h,
            source="auto",
            auto_generated_name=True,
        )
        db.add(meal)
        # Need meal.id to attach items; flush keeps everything in one txn.
        await db.flush()

        for key, aggs in food_aggs.items():
            avg_cal = sum(a["calories"] for a in aggs) / n
            avg_prot = sum(a["protein_g"] for a in aggs) / n
            avg_carb = sum(a["carbs_g"] for a in aggs) / n
            avg_fat = sum(a["fat_g"] for a in aggs) / n
            display = next(
                (a["display_name"] for a in aggs if a.get("display_name")), key
            )
            db.add(
                SavedMealItem(
                    saved_meal_id=meal.id,
                    food_name=display,
                    grams=None,  # NutritionLog has no grams column today
                    calories=round(avg_cal),
                    protein_g=round(avg_prot, 1),
                    carbs_g=round(avg_carb, 1),
                    fat_g=round(avg_fat, 1),
                )
            )
        created += 1

    if created > 0:
        await db.commit()
    return created


async def detect_all_saved_meals() -> None:
    """Nightly scheduler job. Walks every user; per-user failures isolated."""
    logger = logging.getLogger(__name__)
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id))
        user_ids = [row[0] for row in result.all()]

    success = 0
    skipped = 0
    total_meals = 0
    for user_id in user_ids:
        async with AsyncSessionLocal() as db:
            try:
                total_meals += await detect_for_user(user_id, db)
                success += 1
            except Exception as e:  # noqa: BLE001 — log + continue, never block the run
                skipped += 1
                logger.warning(
                    "detect_for_user user=%s failed: %s", user_id, e
                )
    logger.info(
        "detect_all_saved_meals: success=%d skipped=%d total=%d created=%d",
        success,
        skipped,
        len(user_ids),
        total_meals,
    )
