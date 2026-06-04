from __future__ import annotations
import asyncio
import json
import uuid
from datetime import date, timedelta
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc
from sqlalchemy.orm import selectinload

import httpx
import redis.asyncio as aioredis

from core.database import get_db
from core.redis import get_redis
from core.timezone import user_today
from middleware.auth import get_current_user
from models.user import User
from models.nutrition_log import NutritionLog
from models.saved_meal import DismissedMealPattern, SavedMeal, SavedMealItem
from services.ai_client import AINotConfigured
from services.daily import increment_daily_field
from services.nutrition_estimate import estimate_from_photo
from core.config import settings
from services.usda import (
    USDANotConfigured,
    get_nutrition,
    search_food,
    search_foods,
)

router = APIRouter(prefix="/nutrition", tags=["nutrition"])

# Max image payload for the photo estimate endpoint (~5MB; matches typical
# camera capture after RN-side JPEG compression).
MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


class LogNutritionRequest(BaseModel):
    calories: int | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    meal_name: str | None = None
    # How the entry was logged. Defaults to "manual" so legacy clients keep working.
    source: str | None = "manual"


@router.post("/log", status_code=201)
async def log_nutrition(
    body: LogNutritionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = NutritionLog(
        user_id=current_user.id,
        date=user_today(current_user.timezone),
        **body.model_dump(),
    )
    db.add(entry)
    tz = current_user.timezone

    # Incrementally update each macro field that was provided
    if body.calories is not None:
        await increment_daily_field(current_user.id, db, "calories_eaten", body.calories, mode="add", tz_name=tz)
    if body.protein_g is not None:
        await increment_daily_field(current_user.id, db, "protein_g", body.protein_g, mode="add", tz_name=tz)
    if body.carbs_g is not None:
        await increment_daily_field(current_user.id, db, "carbs_g", body.carbs_g, mode="add", tz_name=tz)
    if body.fat_g is not None:
        await increment_daily_field(current_user.id, db, "fat_g", body.fat_g, mode="add", tz_name=tz)

    await db.commit()
    await db.refresh(entry)
    return {"id": str(entry.id), "logged_at": entry.logged_at.isoformat()}


class BatchLogRequest(BaseModel):
    entries: list[LogNutritionRequest]


@router.post("/log-batch", status_code=201)
async def log_nutrition_batch(
    body: BatchLogRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create N NutritionLog rows in one transaction.

    Primary caller is the photo-confirm screen, which used to collapse a
    multi-ingredient meal into one summed row labelled with the dish name
    ('Chicken rice bowl') — useless for Frequent autocomplete. With this
    endpoint the screen sends one row per ingredient instead, so each
    ingredient surfaces in /frequent on its own.
    """
    if not body.entries:
        raise HTTPException(400, "At least one entry is required")
    if len(body.entries) > 50:
        # Safety valve. A real meal won't have 50 ingredients; this guards
        # against pathological payloads.
        raise HTTPException(400, "Too many entries in one batch (max 50)")

    created: list[NutritionLog] = []
    today = user_today(current_user.timezone)
    tz = current_user.timezone
    total_calories = 0
    total_protein = 0.0
    total_carbs = 0.0
    total_fat = 0.0

    for entry_body in body.entries:
        entry = NutritionLog(
            user_id=current_user.id,
            date=today,
            **entry_body.model_dump(),
        )
        db.add(entry)
        created.append(entry)
        # Aggregate the daily-summary increments so we only call
        # increment_daily_field 4× instead of 4×N. The function takes a lock
        # on the daily_summary row, so collapsing the writes is meaningfully
        # faster when N is large.
        if entry_body.calories is not None:
            total_calories += entry_body.calories
        if entry_body.protein_g is not None:
            total_protein += entry_body.protein_g
        if entry_body.carbs_g is not None:
            total_carbs += entry_body.carbs_g
        if entry_body.fat_g is not None:
            total_fat += entry_body.fat_g

    if total_calories:
        await increment_daily_field(current_user.id, db, "calories_eaten", total_calories, mode="add", tz_name=tz)
    if total_protein:
        await increment_daily_field(current_user.id, db, "protein_g", total_protein, mode="add", tz_name=tz)
    if total_carbs:
        await increment_daily_field(current_user.id, db, "carbs_g", total_carbs, mode="add", tz_name=tz)
    if total_fat:
        await increment_daily_field(current_user.id, db, "fat_g", total_fat, mode="add", tz_name=tz)

    await db.commit()
    for e in created:
        await db.refresh(e)
    return [
        {"id": str(e.id), "logged_at": e.logged_at.isoformat(), "meal_name": e.meal_name}
        for e in created
    ]


@router.get("/today")
async def get_today_nutrition(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = user_today(current_user.timezone)

    totals = await db.execute(
        select(
            sqlfunc.sum(NutritionLog.calories),
            sqlfunc.sum(NutritionLog.protein_g),
            sqlfunc.sum(NutritionLog.carbs_g),
            sqlfunc.sum(NutritionLog.fat_g),
        ).where(NutritionLog.user_id == current_user.id, NutritionLog.date == today)
    )
    cal, protein, carbs, fat = totals.one()

    entries_result = await db.execute(
        select(NutritionLog)
        .where(NutritionLog.user_id == current_user.id, NutritionLog.date == today)
        .order_by(NutritionLog.logged_at)
    )
    entries = entries_result.scalars().all()

    return {
        "totals": {
            "calories": cal or 0,
            "protein_g": protein or 0,
            "carbs_g": carbs or 0,
            "fat_g": fat or 0,
        },
        "targets": {
            "calories": current_user.calorie_target,
            "protein_g": current_user.protein_target_g,
        },
        "entries": [
            {
                "id": str(e.id),
                "meal_name": e.meal_name,
                "calories": e.calories,
                "protein_g": e.protein_g,
                "carbs_g": e.carbs_g,
                "fat_g": e.fat_g,
                "logged_at": e.logged_at.isoformat(),
            }
            for e in entries
        ],
    }


@router.delete("/{log_id}", status_code=204)
async def delete_nutrition(
    log_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NutritionLog).where(NutritionLog.id == log_id, NutritionLog.user_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Log entry not found")

    # Decrement summary fields before deleting
    tz = current_user.timezone
    if entry.calories is not None:
        await increment_daily_field(current_user.id, db, "calories_eaten", -entry.calories, mode="add", tz_name=tz)
    if entry.protein_g is not None:
        await increment_daily_field(current_user.id, db, "protein_g", -entry.protein_g, mode="add", tz_name=tz)
    if entry.carbs_g is not None:
        await increment_daily_field(current_user.id, db, "carbs_g", -entry.carbs_g, mode="add", tz_name=tz)
    if entry.fat_g is not None:
        await increment_daily_field(current_user.id, db, "fat_g", -entry.fat_g, mode="add", tz_name=tz)

    await db.delete(entry)
    await db.commit()


PHOTO_DAILY_LIMIT = 10
"""Per-user daily cap on Claude Vision food-photo calls. Vision is the most
expensive op in the app — at scale a buggy or hostile client can burn through
the entire daily Anthropic budget on this endpoint alone. 10/day is generous
for a real user (a heavy logger averages 4 meals) and falls comfortably under
the global ceiling in services.ai_client."""


@router.post("/estimate/photo")
async def estimate_from_photo_endpoint(
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    redis: aioredis.Redis = Depends(get_redis),
):
    """Identify ingredients from a food photo and return estimated macros.

    The phone POSTs the captured image; we run Claude vision + USDA lookup and
    return a structured estimate the user can review and edit before logging.
    Nothing is persisted here — the phone calls POST /nutrition/log on confirm.
    """
    # HIGH-27 per-user rate limit. Pre-deducts before the upload bytes are
    # read so a hot loop can't even pay the network cost of repeated tries.
    rate_key = f"photo_estimate:{current_user.id}:{date.today().isoformat()}"
    count = await redis.incr(rate_key)
    await redis.expire(rate_key, 86400)
    if count > PHOTO_DAILY_LIMIT:
        raise HTTPException(429, f"Daily photo estimate limit reached ({PHOTO_DAILY_LIMIT}/day)")

    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(415, f"Unsupported image type: {image.content_type}")
    body = await image.read()
    if not body:
        raise HTTPException(400, "Empty image upload")
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image too large (max 5MB)")

    try:
        return await estimate_from_photo(body)
    except AINotConfigured as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        # Vision model returned malformed JSON or similar parsing failure.
        raise HTTPException(502, str(e))


# ─── Food autocomplete ───────────────────────────────────────────────────────
#
# Powers the search-first LogModal. Two endpoints:
#   /search    — type-as-you-go USDA lookup
#   /frequent  — empty-state list of foods this user logs often
#
# Both return the same shape: name + per-100g macros + USDA fdc_id, so the
# frontend can scale by user-entered grams without an extra round trip.

# Strings to exclude from /frequent — the existing manual LogModal happily lets
# users log under meal classifications, so those rows would otherwise pollute
# the frequent list with a "food" literally called Lunch.
_MEAL_CLASSIFICATION_NAMES = {"breakfast", "lunch", "dinner", "snack"}
_FREQUENT_LIMIT = 10
_FREQUENT_LOOKBACK_DAYS = 30
_USDA_CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7d — USDA reference data doesn't move


def _normalize_food_key(name: str) -> str:
    return name.lower().strip()


def _per_100g_payload(food: dict) -> dict:
    macros = get_nutrition(food, 100.0)
    return {
        "fdc_id": food.get("fdcId"),
        "name": food.get("description") or "Unknown food",
        "per_100g": macros,
    }


@router.get("/search")
async def search_nutrition(
    q: str,
    current_user: User = Depends(get_current_user),
):
    """Type-as-you-go food search. Returns top 8 USDA results re-ranked by
    score_match. Empty query → empty list (frontend should call /frequent)."""
    q = q.strip()
    if not q:
        return {"results": []}

    try:
        async with httpx.AsyncClient() as http:
            foods = await search_foods(q, n=8, client=http)
    except USDANotConfigured:
        raise HTTPException(503, "Food search is unavailable on this server")
    except httpx.HTTPError:
        raise HTTPException(502, "Could not reach the food database. Try again.")

    return {"results": [_per_100g_payload(f) for f in foods]}


async def _resolve_frequent_food(
    name: str,
    http: httpx.AsyncClient,
    redis,
) -> dict | None:
    """Resolve one user-typed meal_name into USDA per-100g macros, with a Redis
    cache so a 10-entry frequent list doesn't fire 10 USDA calls on every load.

    Returns None if USDA has no good match — caller drops those rows from the
    response rather than surface 'no macros' entries (future: keep them with a
    'tap to refine' affordance)."""
    cache_key = f"usda:{_normalize_food_key(name)}"

    # Cache hit short-circuits the USDA call entirely.
    if redis is not None:
        try:
            cached = await redis.get(cache_key)
            if cached:
                try:
                    return json.loads(cached)
                except json.JSONDecodeError:
                    pass  # bad cache entry, fall through and re-resolve
        except Exception:
            pass  # Redis down — fall through to USDA

    try:
        food = await search_food(name, http)
    except (USDANotConfigured, httpx.HTTPError):
        return None
    if food is None:
        return None

    payload = _per_100g_payload(food)
    # logged_name = the string the user actually typed when logging, so the
    # frontend can show 'Chicken breast' (user-friendly) over 'Chicken,
    # broilers or fryers, breast, meat only, raw' (USDA canonical).
    payload["logged_name"] = name

    if redis is not None:
        try:
            await redis.setex(cache_key, _USDA_CACHE_TTL_SECONDS, json.dumps(payload))
        except Exception:
            pass

    return payload


@router.get("/frequent")
async def frequent_nutrition(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """Empty-state list for the search modal — top distinct meal_names this
    user has logged in the lookback window, enriched with USDA per-100g
    macros (parallel + Redis-cached). Excludes the legacy
    breakfast/lunch/dinner/snack chips so they don't appear as 'foods'.

    Filters out source='photo' rows: photo logs use the composed *dish* name
    as meal_name (e.g. 'Chicken rice bowl'), not its individual ingredients.
    Frequent is meant for single-ingredient autocomplete, so dishes don't
    belong here. Search-logged and saved-meal-relogged rows are kept (those
    already store the ingredient name in meal_name)."""
    if not settings.USDA_API_KEY:
        # Match /search behaviour: if the server can't resolve macros, fail
        # loudly rather than silently return an empty list (which would look
        # like 'you have no frequent foods yet').
        raise HTTPException(503, "Food search is unavailable on this server")

    cutoff = date.today() - timedelta(days=_FREQUENT_LOOKBACK_DAYS)

    # Pull more than _FREQUENT_LIMIT so we still have N after filtering out
    # excluded meal-classification names + USDA misses.
    result = await db.execute(
        select(
            NutritionLog.meal_name,
            sqlfunc.count(NutritionLog.id).label("n"),
        )
        .where(
            NutritionLog.user_id == current_user.id,
            NutritionLog.date >= cutoff,
            NutritionLog.meal_name.is_not(None),
            NutritionLog.meal_name != "",
            # Exclude photo-logged composed dishes.
            sqlfunc.coalesce(NutritionLog.source, "manual") != "photo",
        )
        .group_by(NutritionLog.meal_name)
        .order_by(sqlfunc.count(NutritionLog.id).desc())
        .limit(_FREQUENT_LIMIT * 3)
    )
    candidates: list[str] = []
    for name, _n in result.all():
        if name and _normalize_food_key(name) not in _MEAL_CLASSIFICATION_NAMES:
            candidates.append(name)
        if len(candidates) >= _FREQUENT_LIMIT:
            break

    if not candidates:
        return {"results": []}

    try:
        async with httpx.AsyncClient() as http:
            resolved = await asyncio.gather(
                *(_resolve_frequent_food(name, http, redis) for name in candidates)
            )
    except USDANotConfigured:
        raise HTTPException(503, "Food search is unavailable on this server")

    results = [r for r in resolved if r is not None]
    return {"results": results}


# ─── Saved meals (auto-detected) ─────────────────────────────────────────────
#
# Powered by services/saved_meals.py — the nightly detect_all_saved_meals job
# creates SavedMeal rows whose food set + time bucket has hit the threshold.
# Endpoints here are CRUD on those rows: list, rename, delete (with dismiss),
# and re-log to today.


class RenameSavedMealRequest(BaseModel):
    name: str


class SavedMealItemPayload(BaseModel):
    food_name: str
    grams: float | None = None
    calories: int = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0


class CreateSavedMealRequest(BaseModel):
    name: str
    items: list[SavedMealItemPayload]


def _saved_meal_payload(meal: SavedMeal) -> dict:
    items = sorted(meal.items, key=lambda i: i.food_name.lower())
    total_calories = sum(i.calories for i in items)
    return {
        "id": str(meal.id),
        "name": meal.name,
        "time_bucket": meal.time_bucket,
        "source": meal.source,
        "auto_generated_name": meal.auto_generated_name,
        "created_at": meal.created_at.isoformat(),
        "items": [
            {
                "id": str(i.id),
                "food_name": i.food_name,
                "grams": i.grams,
                "calories": i.calories,
                "protein_g": i.protein_g,
                "carbs_g": i.carbs_g,
                "fat_g": i.fat_g,
            }
            for i in items
        ],
        "total_calories": total_calories,
        "total_protein_g": round(sum(i.protein_g for i in items), 1),
        "total_carbs_g": round(sum(i.carbs_g for i in items), 1),
        "total_fat_g": round(sum(i.fat_g for i in items), 1),
    }


def _hash_food_set_from_names(names: list[str]) -> str:
    """Mirror of services.saved_meals._hash_food_set for the manual-create
    path. Kept inline rather than imported to avoid the dependency
    inversion (router → service is fine; service → router is not)."""
    import hashlib
    normalised = sorted(n.strip().lower() for n in names if n.strip())
    raw = "\x1f".join(normalised)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


@router.get("/saved-meals")
async def list_saved_meals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the current user's saved meals (manual + auto-detected) with
    their items. Client groups by `source` for the Saved tab UI."""
    result = await db.execute(
        select(SavedMeal)
        .where(SavedMeal.user_id == current_user.id)
        .options(selectinload(SavedMeal.items))
        .order_by(SavedMeal.created_at.desc())
    )
    meals = result.scalars().all()
    return {"meals": [_saved_meal_payload(m) for m in meals]}


@router.post("/saved-meals", status_code=201)
async def create_saved_meal(
    body: CreateSavedMealRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a manual saved meal. The Saved tab's '+ Build meal' modal and
    the Nutrition page's swipe-right-to-save both hit this endpoint —
    one-item payload for the swipe path, multi-item for the builder."""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name can't be empty")
    if len(name) > 80:
        raise HTTPException(400, "Name is too long (max 80 chars)")
    if not body.items:
        raise HTTPException(400, "At least one ingredient is required")

    meal = SavedMeal(
        user_id=current_user.id,
        name=name,
        time_bucket="",  # Manual meals don't carry a time-of-day bucket.
        food_set_hash=_hash_food_set_from_names([i.food_name for i in body.items]),
        source="manual",
        auto_generated_name=False,  # User typed this name themselves.
    )
    db.add(meal)
    await db.flush()  # need meal.id for items

    for item in body.items:
        db.add(
            SavedMealItem(
                saved_meal_id=meal.id,
                food_name=item.food_name.strip() or "Item",
                grams=item.grams,
                calories=int(round(item.calories)),
                protein_g=round(float(item.protein_g), 1),
                carbs_g=round(float(item.carbs_g), 1),
                fat_g=round(float(item.fat_g), 1),
            )
        )

    await db.commit()
    # Reload with items for the response.
    refreshed = await db.execute(
        select(SavedMeal)
        .where(SavedMeal.id == meal.id)
        .options(selectinload(SavedMeal.items))
    )
    return _saved_meal_payload(refreshed.scalar_one())


@router.patch("/saved-meals/{meal_id}")
async def rename_saved_meal(
    meal_id: uuid.UUID,
    body: RenameSavedMealRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a saved meal. First successful rename flips auto_generated_name
    to False so the UI stops nudging the user to rename it."""
    result = await db.execute(
        select(SavedMeal)
        .where(SavedMeal.id == meal_id, SavedMeal.user_id == current_user.id)
        .options(selectinload(SavedMeal.items))
    )
    meal = result.scalar_one_or_none()
    if not meal:
        raise HTTPException(404, "Saved meal not found")

    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name can't be empty")
    if len(name) > 80:
        raise HTTPException(400, "Name is too long (max 80 chars)")

    meal.name = name
    meal.auto_generated_name = False
    meal.updated_at = sqlfunc.now()
    await db.commit()
    await db.refresh(meal)
    # Reload items because refresh on a parent doesn't re-eager-load relationships.
    return _saved_meal_payload(meal)


@router.delete("/saved-meals/{meal_id}", status_code=204)
async def delete_saved_meal(
    meal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete + add the pattern to the dismissed blocklist so the nightly
    detector doesn't resurface it."""
    result = await db.execute(
        select(SavedMeal).where(
            SavedMeal.id == meal_id, SavedMeal.user_id == current_user.id
        )
    )
    meal = result.scalar_one_or_none()
    if not meal:
        raise HTTPException(404, "Saved meal not found")

    # Capture before delete cascades the row away.
    food_set_hash = meal.food_set_hash
    time_bucket = meal.time_bucket

    # Upsert into the blocklist. The unique constraint means a duplicate
    # dismissal is a no-op; insert + catch is cleaner than a SELECT-then-INSERT.
    existing_block = await db.execute(
        select(DismissedMealPattern).where(
            DismissedMealPattern.user_id == current_user.id,
            DismissedMealPattern.food_set_hash == food_set_hash,
            DismissedMealPattern.time_bucket == time_bucket,
        )
    )
    if existing_block.scalar_one_or_none() is None:
        db.add(
            DismissedMealPattern(
                user_id=current_user.id,
                food_set_hash=food_set_hash,
                time_bucket=time_bucket,
            )
        )

    await db.delete(meal)
    await db.commit()


@router.post("/saved-meals/{meal_id}/log")
async def log_saved_meal(
    meal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-log every item in a saved meal as a NutritionLog row for today.
    Returns the number of rows created so the client can show a confirmation."""
    result = await db.execute(
        select(SavedMeal)
        .where(SavedMeal.id == meal_id, SavedMeal.user_id == current_user.id)
        .options(selectinload(SavedMeal.items))
    )
    meal = result.scalar_one_or_none()
    if not meal:
        raise HTTPException(404, "Saved meal not found")

    today = user_today(current_user.timezone)
    tz = current_user.timezone
    created_count = 0
    for item in meal.items:
        entry = NutritionLog(
            user_id=current_user.id,
            date=today,
            meal_name=item.food_name,
            calories=item.calories or None,
            protein_g=item.protein_g or None,
            carbs_g=item.carbs_g or None,
            fat_g=item.fat_g or None,
            source="manual",
        )
        db.add(entry)

        # Keep the daily totals in sync the same way /log does.
        if item.calories:
            await increment_daily_field(
                current_user.id, db, "calories_eaten", item.calories, mode="add", tz_name=tz,
            )
        if item.protein_g:
            await increment_daily_field(
                current_user.id, db, "protein_g", item.protein_g, mode="add", tz_name=tz,
            )
        if item.carbs_g:
            await increment_daily_field(
                current_user.id, db, "carbs_g", item.carbs_g, mode="add", tz_name=tz,
            )
        if item.fat_g:
            await increment_daily_field(
                current_user.id, db, "fat_g", item.fat_g, mode="add", tz_name=tz,
            )
        created_count += 1

    await db.commit()
    return {"logged_count": created_count, "meal_name": meal.name}