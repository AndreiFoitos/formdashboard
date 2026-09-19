"""Photo → calories.

Pipeline (modelled on DietAI24: an LLM grounded in USDA's FNDDS database):

1. Vision call: list the foods as eaten, each with a gram guess, an energy
   density guess and a household-portion guess ("about 1 cup").
2. Retrieval: search USDA (FNDDS + SR Legacy + Foundation) per food and keep
   the candidates whose name matches and whose kcal/100g is plausible.
3. Pick call: show the photo plus the candidates, each with its USDA
   household portions ("1 cup, cooked = 158 g"), and let the model choose the
   entry and a portion × quantity. Picking from real portions is easier to get
   right than guessing grams from pixels.

If step 3 fails, or is turned off, each food falls back to the best plausible
candidate with the step-1 gram guess, and to a Claude macro estimate when no
candidate is plausible.
"""
import asyncio
import json
import re

import anthropic
import httpx

from services.ai_client import CLAUDE_MODEL, call_claude
from services.ai_vision import call_claude_vision
from services.usda import (
    MATCH_THRESHOLD,
    USDANotConfigured,
    get_nutrition,
    kcal_per_100g,
    portions,
    score_match,
    search_foods,
)


VISION_SYSTEM = (
    "You are a nutrition estimation assistant. When given a food photo, respond ONLY "
    "with a JSON object. No explanation, no markdown fences, no extra text.\n"
    "Format:\n"
    "{\n"
    '  "dish": "short name of the dish",\n'
    '  "ingredients": [\n'
    '    { "name": "string", "estimated_grams": number, "kcal_per_100g": number, '
    '"portion_guess": "string" }\n'
    "  ]\n"
    "}\n"
    "Rules:\n"
    "- List each distinct food on the plate. A standard composite item (a pizza slice, "
    "a burger, a burrito, a sandwich, lasagna) can be ONE entry; foods that sit separately "
    "on the plate are separate entries.\n"
    "- For \"name\", use the simplest common food name plus its cooking state as it "
    "appears on the plate (e.g. \"banana\", \"cooked white rice\", \"grilled chicken breast\", "
    "\"olive oil\"). Grams are the weight on the plate, so the name must describe that same "
    "state: cooked rice and raw rice differ ~3x in calories. Do NOT add processing words "
    "like \"dehydrated\", \"powder\", \"chips\" or \"dried\" unless the food is actually in "
    "that form in the photo. These cause incorrect database matches.\n"
    "- \"kcal_per_100g\" is your best estimate of the energy density of that food in that "
    "state. It is used to sanity-check the database match.\n"
    "- \"portion_guess\" is the amount in household terms: \"about 1 cup\", \"1 medium "
    "breast\", \"2 slices\", \"10 almonds\", \"1 tablespoon\".\n"
    "- Estimate grams from visual cues. Use common references "
    "(chicken breast ≈ 150g, slice of bread ≈ 30g, tablespoon of oil ≈ 14g, "
    "egg ≈ 50g, medium banana ≈ 120g).\n"
    "- Include cooking oils, butter, and sauces you can reasonably infer from the cooking method.\n"
    "- If unsure of an ingredient, omit it rather than guess wildly."
)

VISION_PROMPT = "Identify the ingredients in this food photo and estimate their quantities."

VISION_PROMPT_MULTI = (
    "These {n} photos show the SAME plate from different angles. Use every angle to judge "
    "portion sizes (height, depth, items hidden in one view), but list each ingredient once. "
    "Identify the ingredients and estimate their quantities."
)

PICK_SYSTEM = (
    "You match the foods in a meal photo to USDA database entries and pick how much of "
    "each is on the plate. Respond ONLY with a JSON object, no prose, no markdown fences.\n"
    "Format:\n"
    "{\n"
    '  "items": [\n'
    '    { "item": 1, "match": "1.2" | null, "portion": "a" | null, "quantity": number | null, '
    '"grams": number | null, "skip": boolean }\n'
    "  ]\n"
    "}\n"
    "Rules:\n"
    "- One entry per listed food, using its item number.\n"
    "- \"match\" is the candidate id that best describes the food as it appears, including "
    "cooking method and added fat. Use null if no candidate is the same food.\n"
    "- Amount: pick the household portion letter that best fits what you see and a "
    "\"quantity\" multiplier (e.g. portion \"b\" = \"1 cup, cooked\", quantity 1.5). If no "
    "portion fits, set portion null and give \"grams\" directly. \"typical serving\" is "
    "USDA's usual serving, not necessarily what is on this plate: judge from the photo.\n"
    "- Check the arithmetic: portion grams × quantity should land close to a realistic "
    "weight for what you see. Each item shows a first gram guess; if your pick is far from "
    "it, re-check whether the portion unit (piece, slice, cup) matches the food's size.\n"
    "- Set \"skip\": true for a separately listed fat, oil, butter or sauce when the entry "
    "you matched for the food it was cooked with already includes it (e.g. \"made with "
    "oil\"), so it is not counted twice."
)

FALLBACK_SYSTEM = (
    "You are a nutrition database. Return ONLY a JSON object with calories (kcal), "
    "protein_g, fat_g, and carbs_g for the given food at the given portion. No prose."
)

# A USDA entry is only trusted if its energy density is within this factor of
# the vision model's own estimate. Token overlap alone happily maps "black
# olives" to "Olive loaf, pork" or "brown rice" to "Rice flour, brown".
DENSITY_TOLERANCE = 1.5
CANDIDATES_PER_FOOD = 5
MAX_PORTIONS_SHOWN = 8
MAX_ITEM_GRAMS = 2000
PORTION_GUARD = 2.0

# Step 3 on/off. The offline eval (scripts/eval_food_views.py) compares both.
PICK_PORTIONS = True

# Cost knobs, tried in the offline eval (conditions v1pick_haiku, v1low).
# 2026-09-19, 100 Nutrition5k plates: Haiku for step 3 cut $/scan 0.0102 ->
# 0.0073 but raised kcal MAE 108 -> 119 (worse on 62/100); adding effort
# "low" on step 1 gave 0.0069 at MAE 116. Kept on Sonnet at default effort:
# accuracy is the product and the saving is ~$0.003/scan.
# Re-run the eval before changing either.
PICK_MODEL = CLAUDE_MODEL
VISION_EFFORT: str | None = None


def _extract_json(text: str) -> dict:
    """Strip ``` fences if the model added them, then parse JSON."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _plausible(food: dict, expected_kcal_100g: float | None) -> bool:
    if not expected_kcal_100g or expected_kcal_100g <= 0:
        return True  # nothing to check against
    actual = kcal_per_100g(food)
    # Near-zero foods (water, black coffee, spices): compare absolutely.
    if actual < 15 and expected_kcal_100g < 15:
        return True
    if actual <= 0:
        return False
    ratio = actual / expected_kcal_100g
    return 1 / DENSITY_TOLERANCE <= ratio <= DENSITY_TOLERANCE


async def _candidates(
    name: str, expected_kcal_100g: float | None, http: httpx.AsyncClient
) -> list[dict]:
    """USDA entries that match the name and have a plausible energy density,
    best first. Empty when USDA is unconfigured or unreachable."""
    try:
        found = await search_foods(name, n=40, client=http)
    except (USDANotConfigured, httpx.HTTPError):
        return []
    ok = [
        c for c in found
        if score_match(name, c.get("description", "")) >= MATCH_THRESHOLD
        and _plausible(c, expected_kcal_100g)
    ]
    # Our token scorer favours short names, USDA's own relevance order favours
    # full matches ("Pizza, cheese, from restaurant, thin crust"). Take the
    # head of both so the right entry is usually among the candidates; the
    # pick step (or the scorer, on the grams path) decides between them.
    by_usda = sorted(ok, key=lambda c: -(c.get("score") or 0))
    out: list[dict] = []
    for c in ok[:CANDIDATES_PER_FOOD] + by_usda[:CANDIDATES_PER_FOOD]:
        if all(c.get("fdcId") != o.get("fdcId") for o in out):
            out.append(c)
    return out


def _usda_item(name: str, food: dict, grams: float, portion: str | None = None) -> dict:
    return {
        "name": name,
        "grams": round(grams, 1),
        **get_nutrition(food, grams),
        "source": "usda",
        "usda_name": food.get("description"),
        "portion": portion,
    }


async def _claude_item(name: str, grams: float) -> dict:
    fallback_user = (
        f'Food: "{name}". Portion: {grams}g. '
        'Return JSON: {"calories": number, "protein_g": number, "fat_g": number, "carbs_g": number}'
    )
    text = await call_claude(
        FALLBACK_SYSTEM,
        [{"role": "user", "content": fallback_user}],
        max_tokens=120,
        thinking=False,
    )
    try:
        macros = _extract_json(text)
    except json.JSONDecodeError:
        macros = {"calories": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0}

    return {
        "name": name,
        "grams": grams,
        "calories": int(round(_num(macros.get("calories")))),
        "protein_g": round(_num(macros.get("protein_g")), 1),
        "fat_g": round(_num(macros.get("fat_g")), 1),
        "carbs_g": round(_num(macros.get("carbs_g")), 1),
        "source": "claude_fallback",
        "usda_name": None,
        "portion": None,
    }


async def _lookup_or_fallback(
    name: str,
    grams: float,
    http: httpx.AsyncClient,
    expected_kcal_100g: float | None = None,
) -> dict:
    """Grams path: best plausible USDA candidate, else a Claude estimate."""
    cands = await _candidates(name, expected_kcal_100g, http)
    if cands:
        return _usda_item(name, cands[0], grams)
    return await _claude_item(name, grams)


def _pick_prompt(foods: list[dict], cands: list[list[dict]]) -> str:
    lines = []
    for i, (f, cs) in enumerate(zip(foods, cands), start=1):
        lines.append(
            f'Item {i}: "{f["name"]}" (first guess: {f["portion_guess"] or "?"}, '
            f'~{round(f["grams"])} g)'
        )
        if not cs:
            lines.append("  no database candidates")
        for j, c in enumerate(cs, start=1):
            ps = portions(c)[:MAX_PORTIONS_SHOWN]
            ptxt = "; ".join(
                f"{chr(97 + k)}) {label} = {g:g} g" for k, (label, g) in enumerate(ps)
            ) or "no household portions, give grams"
            lines.append(
                f"  {i}.{j} {c.get('description')} ({kcal_per_100g(c):.0f} kcal/100 g). "
                f"Portions: {ptxt}"
            )
    return (
        "Foods seen in the photo and their USDA candidates:\n"
        + "\n".join(lines)
        + "\n\nPick the matching entry and amount for each item. Follow the JSON spec exactly."
    )


async def _pick(
    images: list[bytes], foods: list[dict], cands: list[list[dict]], model: str
) -> list[dict | None]:
    """Step 3. Returns one resolved item (or None to drop it) per food; raises
    on a malformed reply so the caller can fall back to the grams path."""
    photo: bytes | list[tuple[str | None, bytes]] = (
        images[0] if len(images) == 1
        else [(f"Angle {i + 1}", img) for i, img in enumerate(images)]
    )
    raw = await call_claude_vision(
        PICK_SYSTEM, photo, _pick_prompt(foods, cands), max_tokens=2000, model=model
    )
    picks = {int(p.get("item", 0)): p for p in _extract_json(raw).get("items") or []}

    out: list[dict | None] = []
    for i, (f, cs) in enumerate(zip(foods, cands), start=1):
        p = picks.get(i) or {}
        if p.get("skip"):
            out.append(None)
            continue
        food = None
        m = str(p.get("match") or "")
        if m.startswith(f"{i}."):
            j = int(_num(m.split(".", 1)[1]))
            if 1 <= j <= len(cs):
                food = cs[j - 1]
        if food is None:
            out.append({"name": f["name"], "grams": f["grams"], "unresolved": True})
            continue

        grams, portion = _num(p.get("grams")), None
        ps = portions(food)[:MAX_PORTIONS_SHOWN]
        letter = str(p.get("portion") or "").strip().lower()[:1]
        qty = _num(p.get("quantity")) or 1.0
        if letter and 0 <= ord(letter) - 97 < len(ps) and 0 < qty <= 20:
            label, g = ps[ord(letter) - 97]
            grams = qty * g
            portion = f"{qty:g} × {label}"
        # Guard: a portion pick more than PORTION_GUARD x away from the step-1
        # gram guess is usually a unit mix-up ("4 x 1 piece, large pizza" for
        # one slice). Keep the step-1 guess then.
        if not 0 < grams <= MAX_ITEM_GRAMS or not (
            f["grams"] / PORTION_GUARD <= grams <= f["grams"] * PORTION_GUARD
        ):
            grams = f["grams"]
            portion = None
        out.append(_usda_item(f["name"], food, grams, portion))
    return out


async def estimate_from_photo(image_bytes: bytes) -> dict:
    """Full pipeline for one photo (the app's endpoint)."""
    return await estimate_from_photos([image_bytes])


async def estimate_from_photos(
    images: list[bytes],
    system: str = VISION_SYSTEM,
    pick_portions: bool | None = None,
    pick_model: str | None = None,
    vision_effort: str | None = None,
) -> dict:
    """Same pipeline for one or more angles of one plate. One image uses the
    exact single-photo prompt. The keyword arguments let the offline eval try
    variants without touching the production defaults."""
    if pick_portions is None:
        pick_portions = PICK_PORTIONS
    pick_model = pick_model or PICK_MODEL
    vision_effort = vision_effort or VISION_EFFORT

    if len(images) == 1:
        raw = await call_claude_vision(system, images[0], VISION_PROMPT, effort=vision_effort)
    else:
        labelled = [(f"Angle {i + 1}", img) for i, img in enumerate(images)]
        raw = await call_claude_vision(
            system, labelled, VISION_PROMPT_MULTI.format(n=len(images)), effort=vision_effort
        )
    try:
        parsed = _extract_json(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Vision model returned malformed JSON: {raw[:200]}") from e

    dish = (parsed.get("dish") or "Unknown dish").strip()
    foods = [
        {
            "name": str(ing.get("name", "")).strip(),
            "grams": _num(ing.get("estimated_grams")),
            "kcal_100g": _num(ing.get("kcal_per_100g")) or None,
            "portion_guess": str(ing.get("portion_guess") or "").strip(),
        }
        for ing in parsed.get("ingredients") or []
    ]
    foods = [f for f in foods if f["name"] and f["grams"] > 0]

    items: list[dict] = []
    if foods:
        async with httpx.AsyncClient() as http:
            cands = await asyncio.gather(
                *(_candidates(f["name"], f["kcal_100g"], http) for f in foods)
            )
            picked: list[dict | None] | None = None
            if pick_portions and any(cands):
                try:
                    picked = await _pick(images, foods, cands, pick_model)
                except (
                    json.JSONDecodeError, ValueError, TypeError, AttributeError,
                    anthropic.APIError,
                ):
                    picked = None  # bad or failed pick call: use the grams path

            async def resolve(i: int) -> dict | None:
                f, cs = foods[i], cands[i]
                if picked is not None:
                    p = picked[i]
                    if p is None or not p.get("unresolved"):
                        return p
                    # The model saw the candidates and said none is this food.
                    return await _claude_item(f["name"], f["grams"])
                if cs:
                    return _usda_item(f["name"], cs[0], f["grams"])
                return await _claude_item(f["name"], f["grams"])

            resolved = await asyncio.gather(*(resolve(i) for i in range(len(foods))))
            items = [r for r in resolved if r is not None]

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
