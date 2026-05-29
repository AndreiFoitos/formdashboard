import re

import httpx

from core.config import settings


USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

# Nutrient IDs from USDA FoodData Central reference.
NUTRIENT_CALORIES = 1008
NUTRIENT_PROTEIN = 1003
NUTRIENT_FAT = 1004
NUTRIENT_CARBS = 1005

# Below this score we treat the USDA match as unreliable and fall back to a
# Claude estimate for that ingredient instead.
MATCH_THRESHOLD = 0.4


class USDANotConfigured(Exception):
    pass


def _tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z]+", s.lower()) if len(t) > 2}


def score_match(query: str, food_name: str) -> float:
    """Token-overlap score in [0, 1], biased toward query coverage."""
    q = _tokens(query)
    if not q:
        return 0.0
    f = _tokens(food_name)
    return len(q & f) / len(q)


async def search_food(query: str, client: httpx.AsyncClient) -> dict | None:
    """Search USDA FDC and return the top match (or None). Prefers curated tables."""
    if not settings.USDA_API_KEY:
        raise USDANotConfigured("USDA_API_KEY is not set on the server")

    # SR Legacy + Foundation are USDA's curated reference tables. Branded foods
    # are manufacturer-submitted and much noisier — skip them for now.
    resp = await client.get(
        f"{USDA_BASE}/foods/search",
        params={
            "query": query,
            "dataType": "SR Legacy,Foundation",
            "pageSize": 5,
            "api_key": settings.USDA_API_KEY,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    foods = resp.json().get("foods") or []
    if not foods:
        return None
    # USDA's relevance sort sometimes ranks a less-specific entry first; re-pick
    # by our token-overlap score on the top page.
    return max(foods, key=lambda f: score_match(query, f.get("description", "")))


def get_nutrition(food: dict, grams: float) -> dict:
    """Extract kcal + macros from a USDA food doc, scaled from /100g to the given grams."""
    by_id = {n.get("nutrientId"): n.get("value", 0) for n in food.get("foodNutrients", [])}
    scale = grams / 100.0
    return {
        "calories": int(round(by_id.get(NUTRIENT_CALORIES, 0) * scale)),
        "protein_g": round(by_id.get(NUTRIENT_PROTEIN, 0) * scale, 1),
        "fat_g": round(by_id.get(NUTRIENT_FAT, 0) * scale, 1),
        "carbs_g": round(by_id.get(NUTRIENT_CARBS, 0) * scale, 1),
    }
