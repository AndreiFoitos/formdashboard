import re

import httpx

from core.config import settings


USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

# Nutrient IDs from USDA FoodData Central reference.
NUTRIENT_CALORIES = 1008
# Foundation foods don't carry 1008; they report energy computed with Atwater
# factors instead. Specific factors are the closer match to SR Legacy values.
NUTRIENT_CALORIES_ATWATER_SPECIFIC = 2048
NUTRIENT_CALORIES_ATWATER_GENERAL = 2047
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
    # "Pizza, no cheese" must not win for "cheese pizza": a negated query word
    # means the entry is explicitly NOT the food asked for.
    negated = {
        _stem(w) for w in re.findall(r"\b(?:no|without|non)[\s-]+([a-z]+)", food_name.lower())
    }
    penalty = 0.6 if negated & q else 0.0
    return coverage * 0.7 + head_match * 0.3 - extras * 0.05 - penalty


# SR Legacy + Foundation are USDA's curated ingredient tables; FNDDS (the
# "Survey" table) is foods as people eat them — cooked, mixed dishes — and is
# the only one with household portions ("1 cup, cooked"). Branded foods are
# manufacturer-submitted and much noisier, so they stay out.
DATA_TYPES = ["Survey (FNDDS)", "SR Legacy", "Foundation"]


async def _search(query: str, client: httpx.AsyncClient, page_size: int) -> list[dict]:
    if not settings.USDA_API_KEY:
        raise USDANotConfigured("USDA_API_KEY is not set on the server")
    # POST: the GET form rejects "Survey (FNDDS)" in the dataType list.
    resp = await client.post(
        f"{USDA_BASE}/foods/search",
        params={"api_key": settings.USDA_API_KEY},
        json={"query": query, "dataType": DATA_TYPES, "pageSize": page_size},
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json().get("foods") or []


async def search_food(query: str, client: httpx.AsyncClient) -> dict | None:
    """Search USDA FDC and return the top match (or None)."""
    # A wide page matters: the canonical entry ("Rice, white, ... cooked") is
    # often outside USDA's top 5 behind shorter, wrong ones ("Rice crackers").
    foods = await _search(query, client, page_size=25)
    if not foods:
        return None
    # USDA's relevance sort sometimes ranks a less-specific entry first; re-pick
    # by our token-overlap score on the top page.
    return max(foods, key=lambda f: score_match(query, f.get("description", "")))


async def search_foods(query: str, n: int, client: httpx.AsyncClient) -> list[dict]:
    """Search USDA FDC and return up to N matches re-ranked by score_match desc.

    Uses USDA's first 40 results as the candidate pool (one page; enough for
    typical queries across the three tables), re-sorts with our token-overlap
    scorer, and trims to N.
    """
    foods = await _search(query, client, page_size=40)
    foods.sort(key=lambda f: score_match(query, f.get("description", "")), reverse=True)
    return foods[:n]


def portions(food: dict) -> list[tuple[str, float]]:
    """Household portions for a food as (label, grams). Only FNDDS entries
    carry them. USDA's "Quantity not specified" is its typical serving."""
    out = []
    for m in food.get("foodMeasures") or []:
        label = (m.get("disseminationText") or "").strip()
        grams = m.get("gramWeight")
        if not label or not grams:
            continue
        if label == "Quantity not specified":
            label = "typical serving"
        out.append((label, float(grams)))
    return out


def kcal_per_100g(food: dict) -> float:
    """Energy per 100 g. Reads SR Legacy's 1008, then Foundation's Atwater
    values, then derives it from macros so an entry never reports 0 kcal just
    because it uses a different energy field."""
    by_id = {n.get("nutrientId"): n.get("value") for n in food.get("foodNutrients", [])}
    for nid in (NUTRIENT_CALORIES, NUTRIENT_CALORIES_ATWATER_SPECIFIC, NUTRIENT_CALORIES_ATWATER_GENERAL):
        if by_id.get(nid):
            return float(by_id[nid])
    return (
        4 * float(by_id.get(NUTRIENT_PROTEIN) or 0)
        + 9 * float(by_id.get(NUTRIENT_FAT) or 0)
        + 4 * float(by_id.get(NUTRIENT_CARBS) or 0)
    )


def get_nutrition(food: dict, grams: float) -> dict:
    """Extract kcal + macros from a USDA food doc, scaled from /100g to the given grams."""
    by_id = {n.get("nutrientId"): n.get("value", 0) for n in food.get("foodNutrients", [])}
    scale = grams / 100.0
    return {
        "calories": int(round(kcal_per_100g(food) * scale)),
        "protein_g": round(by_id.get(NUTRIENT_PROTEIN, 0) * scale, 1),
        "fat_g": round(by_id.get(NUTRIENT_FAT, 0) * scale, 1),
        "carbs_g": round(by_id.get(NUTRIENT_CARBS, 0) * scale, 1),
    }
