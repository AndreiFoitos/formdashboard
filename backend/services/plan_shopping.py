"""Shopping list for the next 7 days of a Pit Crew meal plan. Pure code, no AI.

Plan foods are named the way they're eaten ("white rice, cooked", "chicken
breast, cooked"), so amounts are converted to what you'd buy: cooked grains,
pasta and legumes to dry weight, cooked meat and fish to raw weight. The
ratios are rough kitchen averages and the app labels converted amounts
"about". Eggs become a count, milks become ml.

Today's meals already logged are left out, and today's chat rescale
(adjust_today) is applied, so the list is what's still to buy.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from models.ai_plan import AiPlan
from models.user import User
from services.plan_builder import FISH, MEAT, SHELLFISH
from services.plan_today import logged_meals, todays_meals

DAYS = 7

# cooked weight / bought weight. Grains roughly triple when boiled, pasta a
# bit over doubles, dried legumes about 2.5x; meat and fish lose ~25% cooking.
COOKED_PER_DRY = [
    (("rice",), 3.0),
    (("quinoa",), 2.7),
    (("couscous", "bulgur"), 2.5),
    (("pasta", "spaghetti", "noodle", "macaroni", "penne"), 2.25),
    (("lentil", "chickpea", "bean", "split pea"), 2.5),
]
RAW_PER_COOKED = 1.33
COOKED_STATES = ("cooked", "boiled", "baked", "grilled", "roasted", "steamed", "pan-fried", "fried", "broiled")

LIQUIDS = ("milk", "juice", "kefir", "broth", "stock")
EGG_GRAMS = 50

AISLES: list[tuple[str, tuple[str, ...]]] = [
    ("Meat & fish", tuple(MEAT + FISH + SHELLFISH)),
    ("Plant protein", ("tofu", "tempeh", "seitan", "edamame")),
    ("Dairy & eggs", (
        "milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "kefir", "skyr", "quark",
        "cottage", "mozzarella", "parmesan", "cheddar", "feta", "egg",
    )),
    ("Grains & bread", (
        "rice", "oat", "pasta", "spaghetti", "noodle", "bread", "bagel", "tortilla", "wrap", "quinoa",
        "couscous", "bulgur", "cereal", "granola", "cracker", "macaroni", "penne",
    )),
    ("Fruit & veg", (
        "apple", "banana", "berr", "orange", "grape", "mango", "pineapple", "pear", "peach", "kiwi",
        "melon", "lemon", "lime", "avocado", "tomato", "broccoli", "spinach", "kale", "lettuce",
        "pepper", "onion", "garlic", "carrot", "cucumber", "zucchini", "courgette", "potato",
        "sweet potato", "mushroom", "cauliflower", "cabbage", "asparagus", "green bean", "pea",
        "corn", "celery", "salad", "squash", "beet", "eggplant", "aubergine",
    )),
    ("Pantry", (
        "oil", "nut", "almond", "walnut", "cashew", "peanut", "seed", "lentil", "chickpea", "bean",
        "sauce", "honey", "syrup", "hummus", "powder", "protein", "spice", "salt", "vinegar",
        "jam", "chocolate", "cocoa", "raisin", "date",
    )),
]
# Checked first: plant foods named like dairy (plant milks, butternut squash,
# eggplant) and nut butters.
AISLE_OVERRIDES = [
    (("almond milk", "oat milk", "soy milk", "rice milk", "coconut milk"), "Dairy & eggs"),
    (("peanut butter", "almond butter", "nut butter", "cashew butter"), "Pantry"),
    (("eggplant", "butternut", "butter bean", "buttercup"), "Fruit & veg"),
    (("tomato sauce", "pasta sauce", "soy sauce"), "Pantry"),
    (("protein powder", "whey"), "Pantry"),
]
AISLE_ORDER = ["Fruit & veg", "Meat & fish", "Plant protein", "Dairy & eggs", "Grains & bread", "Pantry", "Other"]


def _has(name: str, words) -> bool:
    return any(re.search(rf"\b{re.escape(w)}", name) for w in words)


def aisle(name: str) -> str:
    n = name.lower()
    for words, a in AISLE_OVERRIDES:
        if any(w in n for w in words):
            return a
    for a, words in AISLES:
        if _has(n, words):
            return a
    return "Other"


def to_bought(food: str, grams: float) -> tuple[str, float, str | None]:
    """(item name, grams to buy, note). Converts cooked weights back to dry
    or raw, so "white rice, cooked 900 g" becomes "white rice, ~300 g dry"."""
    base, _, state = (s.strip() for s in food.lower().partition(","))
    cooked = any(st in state for st in COOKED_STATES) or "cooked" in base
    base = re.sub(r"\bcooked\b", "", base).strip()
    if cooked:
        for words, ratio in COOKED_PER_DRY:
            if _has(base, words):
                return base, grams / ratio, "dry weight"
        if _has(base, MEAT + FISH + SHELLFISH):
            return base, grams * RAW_PER_COOKED, "raw weight"
    return base, grams, None


def _amount(name: str, grams: float) -> tuple[float, str]:
    if re.search(r"\beggs?\b", name) and "plant" not in name:
        return max(1, math.ceil(grams / EGG_GRAMS)), "eggs"
    unit = "ml" if _has(name, LIQUIDS) else "g"
    if grams >= 1000:
        return round(grams / 1000, 1), "l" if unit == "ml" else "kg"
    return max(10, round(grams / 10) * 10), unit


async def build_list(user: User, row: AiPlan, today: date, db: AsyncSession) -> dict:
    nutrition = (row.plan or {}).get("nutrition")
    if not nutrition:
        return {"from": today.isoformat(), "to": (today + timedelta(days=DAYS - 1)).isoformat(), "aisles": []}
    by_weekday = {d["weekday"]: d for d in nutrition["days"]}
    done = await logged_meals(user, row, today, db)

    totals: dict[str, float] = defaultdict(float)
    notes: dict[str, str | None] = {}
    for offset in range(DAYS):
        day = today + timedelta(days=offset)
        if offset == 0:
            meals = [m for m in todays_meals(row, today) if m["id"] not in done]
        else:
            meals = (by_weekday.get(day.weekday()) or {}).get("meals", [])
        for m in meals:
            for i in m["items"]:
                name, grams, note = to_bought(i["food"], i["grams"])
                totals[name] += grams
                notes[name] = note

    groups: dict[str, list[dict]] = defaultdict(list)
    for name, grams in sorted(totals.items()):
        amount, unit = _amount(name, grams)
        groups[aisle(name)].append({
            "key": name,
            "name": name[:1].upper() + name[1:],
            "amount": amount,
            "unit": unit,
            "note": notes[name],
        })
    return {
        "from": today.isoformat(),
        "to": (today + timedelta(days=DAYS - 1)).isoformat(),
        "aisles": [{"name": a, "items": groups[a]} for a in AISLE_ORDER if groups.get(a)],
    }
