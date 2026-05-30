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


def _stem(t: str) -> str:
    """Crude English singular form so 'banana' matches 'Bananas'."""
    if len(t) <= 3:
        return t
    if t.endswith("ies"):
        return t[:-3] + "y"  # berries -> berry
    if t.endswith(("ses", "xes", "zes", "ches", "shes", "oes")):
        return t[:-2]  # tomatoes -> tomato, boxes -> box
    if t.endswith("s") and not t.endswith("ss"):
        return t[:-1]  # bananas -> banana
    return t


def _tokens(s: str) -> list[str]:
    """Ordered, stemmed tokens; order is preserved so callers can read the head token."""
    return [_stem(t) for t in re.findall(r"[a-z]+", s.lower()) if len(t) > 2]


def score_match(query: str, food_name: str) -> float:
    """Match score: query coverage, with a head-token bonus and modifier penalty.

    Without this, a query like 'banana' silently picks 'Bananas, dehydrated, or
    banana powder' over 'Bananas, raw' — the plural breaks naive overlap, and
    ties go to USDA's first result.
    """
    q_list = _tokens(query)
    q = set(q_list)
    if not q:
        return 0.0
    f_list = _tokens(food_name)
    f = set(f_list)
    if not f:
        return 0.0
    coverage = len(q & f) / len(q)
    # USDA names food as "<food>, <modifier>" (e.g. "Bananas, raw"); a head-token
    # match means the entry's primary noun is the thing we're looking for, not a
    # qualifier on something else ("Melon, banana").
    head_match = 1.0 if f_list[0] in q else 0.0
    # Fewer extra tokens -> prefer canonical raw forms over modified/processed ones.
    extras = len(f - q)
    return coverage * 0.7 + head_match * 0.3 - extras * 0.05


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
