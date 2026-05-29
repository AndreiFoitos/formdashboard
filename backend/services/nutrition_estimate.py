import asyncio
import json
import re

import httpx

from services.ai_client import call_claude
from services.ai_vision import call_claude_vision
from services.usda import (
    MATCH_THRESHOLD,
    USDANotConfigured,
    get_nutrition,
    score_match,
    search_food,
)


VISION_SYSTEM = (
    "You are a nutrition estimation assistant. When given a food photo, respond ONLY "
    "with a JSON object. No explanation, no markdown fences, no extra text.\n"
    "Format:\n"
    "{\n"
    '  "dish": "short name of the dish",\n'
    '  "ingredients": [\n'
    '    { "name": "string", "estimated_grams": number }\n'
    "  ]\n"
    "}\n"
    "Rules:\n"
    "- List every visible ingredient separately.\n"
    "- Estimate grams from visual cues. Use common references "
    "(chicken breast ≈ 150g, slice of bread ≈ 30g, tablespoon of oil ≈ 14g, "
    "egg ≈ 50g, medium banana ≈ 120g).\n"
    "- Include cooking oils, butter, and sauces you can reasonably infer from the cooking method.\n"
    "- If unsure of an ingredient, omit it rather than guess wildly."
)

FALLBACK_SYSTEM = (
    "You are a nutrition database. Return ONLY a JSON object with calories (kcal), "
    "protein_g, fat_g, and carbs_g for the given food at the given portion. No prose."
)

VISION_PROMPT = "Identify the ingredients in this food photo and estimate their quantities."


def _extract_json(text: str) -> dict:
    """Strip ``` fences if the model added them, then parse JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


async def _lookup_or_fallback(
    name: str,
    grams: float,
    http: httpx.AsyncClient,
) -> dict:
    """Resolve macros for one ingredient. USDA when match is confident, Claude otherwise."""
    food = None
    try:
        food = await search_food(name, http)
    except USDANotConfigured:
        pass  # silently fall through to Claude estimate
    except httpx.HTTPError:
        pass  # transient USDA failure — fall through

    if food is not None and score_match(name, food.get("description", "")) >= MATCH_THRESHOLD:
        macros = get_nutrition(food, grams)
        return {
            "name": name,
            "grams": grams,
            **macros,
            "source": "usda",
            "usda_name": food.get("description"),
        }

    fallback_user = (
        f'Food: "{name}". Portion: {grams}g. '
        'Return JSON: {"calories": number, "protein_g": number, "fat_g": number, "carbs_g": number}'
    )
    text = await call_claude(
        FALLBACK_SYSTEM,
        [{"role": "user", "content": fallback_user}],
        max_tokens=120,
    )
    try:
        macros = _extract_json(text)
    except json.JSONDecodeError:
        macros = {"calories": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0}

    return {
        "name": name,
        "grams": grams,
        "calories": int(round(float(macros.get("calories") or 0))),
        "protein_g": round(float(macros.get("protein_g") or 0), 1),
        "fat_g": round(float(macros.get("fat_g") or 0), 1),
        "carbs_g": round(float(macros.get("carbs_g") or 0), 1),
        "source": "claude_fallback",
        "usda_name": None,
    }


async def estimate_from_photo(image_bytes: bytes) -> dict:
    """Full pipeline: photo → Claude vision → per-ingredient USDA/Claude → totals."""
    raw = await call_claude_vision(VISION_SYSTEM, image_bytes, VISION_PROMPT)
    try:
        parsed = _extract_json(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Vision model returned malformed JSON: {raw[:200]}") from e

    dish = (parsed.get("dish") or "Unknown dish").strip()
    raw_ingredients = parsed.get("ingredients") or []

    valid = [
        (str(ing.get("name", "")).strip(), float(ing.get("estimated_grams") or 0))
        for ing in raw_ingredients
    ]
    valid = [(n, g) for n, g in valid if n and g > 0]

    items: list[dict] = []
    if valid:
        async with httpx.AsyncClient() as http:
            items = await asyncio.gather(
                *(_lookup_or_fallback(name, grams, http) for name, grams in valid)
            )

    totals = {
        "calories": sum(i["calories"] for i in items),
        "protein_g": round(sum(i["protein_g"] for i in items), 1),
        "fat_g": round(sum(i["fat_g"] for i in items), 1),
        "carbs_g": round(sum(i["carbs_g"] for i in items), 1),
    }

    n_usda = sum(1 for i in items if i["source"] == "usda")
    confidence = round(n_usda / len(items), 2) if items else 0.0

    return {
        "dish": dish,
        "items": items,
        "totals": totals,
        "confidence": confidence,
        "disclaimer": "Estimates typically within ±20–30%. Edit any item to refine.",
    }
