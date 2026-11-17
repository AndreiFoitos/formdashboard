"""Describe a meal (text → calories): parsing the model's amounts and
ranges, the USDA pick, fallbacks, the total range, and the endpoint's quota
handling. Claude and USDA are faked; nothing leaves the machine."""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.nutrition as nutrition_router
import services.nutrition_text as nt
from core.database import get_db
from middleware.auth import get_current_user
from models.user import User


def usda(fdc, description, kcal, protein=0.0, fat=0.0, carbs=0.0, measures=()):
    return {
        "fdcId": fdc,
        "description": description,
        "foodNutrients": [
            {"nutrientId": 1008, "value": kcal},
            {"nutrientId": 1003, "value": protein},
            {"nutrientId": 1004, "value": fat},
            {"nutrientId": 1005, "value": carbs},
        ],
        "foodMeasures": [{"disseminationText": t, "gramWeight": g} for t, g in measures],
    }


OIL = usda(1, "Olive oil", 884, fat=100)
MASH = usda(2, "Potato, mashed, from fresh, made with milk and butter", 110,
            protein=2, fat=4, carbs=16, measures=[("1 cup", 210)])
STEAK = usda(3, "Beef steak, broiled", 250, protein=28, fat=15)
CANDIDATES = {"olive oil": [OIL], "mashed potatoes made with milk and butter": [MASH],
              "beef steak, cooked": [STEAK]}

# What the parse step returns for the user's own example sentence.
PARSED = {
    "dish": "Steak with mashed potatoes",
    "items": [
        {"name": "olive oil", "search_name": "olive oil", "grams": 7, "grams_low": 5,
         "grams_high": 14, "kcal_per_100g": 884, "kcal_per_100g_low": 884,
         "kcal_per_100g_high": 884, "portion_guess": "about 1/2 tbsp",
         "assumption": "assumed 1/2 tbsp"},
        {"name": "mashed potatoes", "search_name": "mashed potatoes made with milk and butter",
         "grams": 250, "grams_low": 200, "grams_high": 300, "kcal_per_100g": 110,
         "kcal_per_100g_low": 110, "kcal_per_100g_high": 110, "portion_guess": "about 1 cup",
         "assumption": "assumed grams"},
        {"name": "steak", "search_name": "beef steak, cooked", "grams": 200, "grams_low": 180,
         "grams_high": 220, "kcal_per_100g": 250, "kcal_per_100g_low": 200,
         "kcal_per_100g_high": 300, "portion_guess": "1 medium steak",
         "assumption": "assumed cooked weight"},
    ],
}

PICKED = {"items": [
    {"item": 1, "match": "1.1", "portion": None, "quantity": None, "grams": 7, "skip": False},
    {"item": 2, "match": "2.1", "portion": "a", "quantity": 1, "grams": None, "skip": False},
    {"item": 3, "match": "3.1", "portion": None, "quantity": None, "grams": 200, "skip": False},
]}

TEXT = ("I had a lil bit of olive oil, with around 200-300 mashed potatos made with milk "
        "and butter, and like 200 g of stake")


@pytest.fixture
def fake_ai(monkeypatch):
    """Fakes the two structured calls, USDA candidates and the per-item
    Claude fallback. Returns the list of replies so a test can change them."""
    replies = {"parse": PARSED, "pick": PICKED}
    calls = {"pick": 0, "fallback": [], "models": set()}

    async def structured(system, messages, schema, **kw):
        calls["models"].add(kw.get("model"))
        if schema is nt.PARSE_SCHEMA:
            return replies["parse"]
        if schema is nt.PICK_SCHEMA:
            calls["pick"] += 1
            if isinstance(replies["pick"], Exception):
                raise replies["pick"]
            return replies["pick"]
        if schema is nt.DIRECT_SCHEMA:
            return replies["direct"]
        raise AssertionError("unexpected schema")

    async def candidates(name, expected, http):
        return CANDIDATES.get(name, [])

    async def claude_item(name, grams, model=None):
        calls["fallback"].append(name)
        calls["models"].add(model)
        return {"name": name, "grams": grams, "calories": 100, "protein_g": 1.0, "fat_g": 1.0,
                "carbs_g": 1.0, "source": "claude_fallback", "usda_name": None, "portion": None}

    monkeypatch.setattr(nt, "call_claude_structured", structured)
    monkeypatch.setattr(nt, "_candidates", candidates)
    monkeypatch.setattr(nt, "_claude_item", claude_item)
    return replies, calls


def by_name(result):
    return {i["name"]: i for i in result["items"]}


def test_example_sentence_end_to_end(fake_ai):
    r = asyncio.run(nt.estimate_from_text(TEXT))
    items = by_name(r)
    assert r["kind"] == "text" and r["dish"] == "Steak with mashed potatoes"
    assert all(i["source"] == "usda" for i in r["items"]) and r["confidence"] == 1.0

    # Stated weight kept; the density spread (200-300 vs 250) widens kcal only.
    steak = items["steak"]
    assert steak["grams"] == 200 and steak["calories"] == 500
    assert (steak["calories_low"], steak["calories_high"]) == (360, 660)
    assert steak["assumption"] == "assumed cooked weight"

    # Household portion picked: 1 cup = 210 g; the 200-300 range keeps its shape.
    mash = items["mashed potatoes"]
    assert mash["grams"] == 210 and mash["portion"] == "1 × 1 cup"
    assert (mash["grams_low"], mash["grams_high"]) == (168, 252)
    assert mash["calories"] == 231

    oil = items["olive oil"]
    assert (oil["grams_low"], oil["grams_high"]) == (5, 14)
    assert oil["calories"] == 62

    assert r["totals"]["calories"] == 500 + 231 + 62
    low, high = nt.total_range(r["items"])
    assert (r["calories_low"], r["calories_high"]) == (low, high)
    assert low < r["totals"]["calories"] < high


def test_skip_drops_fat_already_counted(fake_ai):
    replies, _ = fake_ai
    replies["pick"] = {"items": [dict(PICKED["items"][0], skip=True), *PICKED["items"][1:]]}
    assert "olive oil" not in by_name(asyncio.run(nt.estimate_from_text(TEXT)))


def test_no_matching_candidate_uses_claude_fallback_with_range(fake_ai):
    replies, calls = fake_ai
    replies["pick"] = {"items": [*PICKED["items"][:2], dict(PICKED["items"][2], match=None)]}
    steak = by_name(asyncio.run(nt.estimate_from_text(TEXT)))["steak"]
    assert steak["source"] == "claude_fallback" and calls["fallback"] == ["steak"]
    # 100 kcal for 200 g, spread by 180-220 g and the 0.8-1.2 density ratios.
    assert (steak["calories_low"], steak["calories_high"]) == (72, 132)


def test_every_call_runs_on_the_text_model(fake_ai):
    replies, calls = fake_ai
    replies["pick"] = {"items": [*PICKED["items"][:2], dict(PICKED["items"][2], match=None)]}
    asyncio.run(nt.estimate_from_text(TEXT))
    # Parse, pick and the per-food fallback all on Haiku 5.5 (eval decision).
    assert calls["models"] == {nt.TEXT_MODEL} == {"claude-haiku-5-5"}


def test_eval_can_override_the_model(fake_ai):
    _, calls = fake_ai
    asyncio.run(nt.estimate_from_text(TEXT, model="claude-sonnet-5-5"))
    assert calls["models"] == {"claude-sonnet-5-5"}


def test_failed_pick_falls_back_to_best_candidate_at_parsed_amount(fake_ai):
    replies, calls = fake_ai
    replies["pick"] = ValueError("bad json")
    items = by_name(asyncio.run(nt.estimate_from_text(TEXT)))
    assert calls["pick"] == 1
    assert items["mashed potatoes"]["grams"] == 250 and items["mashed potatoes"]["portion"] is None
    assert items["steak"]["source"] == "usda"


def test_wild_portion_pick_is_guarded(fake_ai):
    replies, _ = fake_ai
    # "4 cups" of mash = 840 g, more than 2x the parsed 250 g: keep 250 g.
    replies["pick"] = {"items": [PICKED["items"][0], dict(PICKED["items"][1], quantity=4),
                                 PICKED["items"][2]]}
    mash = by_name(asyncio.run(nt.estimate_from_text(TEXT)))["mashed potatoes"]
    assert mash["grams"] == 250 and mash["portion"] is None


def test_no_food_in_text(fake_ai):
    replies, calls = fake_ai
    replies["parse"] = {"dish": "", "items": []}
    r = asyncio.run(nt.estimate_from_text("hello there"))
    assert r["items"] == [] and calls["pick"] == 0


def test_clean_food_makes_ranges_consistent():
    f = nt._clean_food({
        "name": "rice", "search_name": "", "grams": 150, "grams_low": 400, "grams_high": 100,
        "kcal_per_100g": 130, "kcal_per_100g_low": 200, "kcal_per_100g_high": 900,
        "portion_guess": "", "assumption": "  ",
    })
    assert (f["grams_low"], f["grams"], f["grams_high"]) == (150, 150, 150)
    assert (f["density_low"], f["density_high"]) == (1.0, nt.MAX_DENSITY_RATIO)
    assert f["search_name"] == "rice" and f["assumption"] is None
    assert nt._clean_food({"name": "x", "grams": 0}) is None


def test_total_range_adds_spreads_in_quadrature_and_stretches_the_low_side():
    items = [
        {"calories": 500, "calories_low": 400, "calories_high": 600},
        {"calories": 300, "calories_low": 200, "calories_high": 400},
    ]
    # sqrt(100² + 100²) ≈ 141 either side of 800; the low side is doubled
    # (800 - 283 = 517), rounded to tens.
    assert nt.total_range(items) == (520, 940)


def test_total_range_is_never_narrower_than_the_minimum():
    # Every amount exact: no spread from the words, but the database and the
    # food match still aren't exact, so -20% / +10%.
    assert nt.total_range([{"calories": 500, "calories_low": 500, "calories_high": 500}]) == (400, 550)


def test_describe_has_its_own_allowance():
    from services.plans import DESCRIBE, KINDS, NOUNS, PLANS

    assert DESCRIBE in KINDS and set(NOUNS) == set(KINDS)
    assert [PLANS[p].describe.count for p in ("free", "plus", "pro")] == [5, 20, 50]
    assert all(PLANS[p].describe.window == "day" for p in PLANS)


def test_direct_estimate_shape(fake_ai):
    replies, _ = fake_ai
    replies["direct"] = {"dish": "Toast", "items": [
        {"name": "toast", "grams": 30, "calories": 80, "protein_g": 3, "fat_g": 1,
         "carbs_g": 15, "calories_low": 90, "calories_high": 70, "assumption": None},
    ]}
    r = asyncio.run(nt.estimate_from_text_direct("a slice of toast"))
    item = r["items"][0]
    assert item["source"] == "claude_direct"
    # A low above the best (or a high below it) is pulled back to the best.
    assert (item["calories_low"], item["calories_high"]) == (80, 80)


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@pytest.fixture
def endpoint(monkeypatch):
    state = {"consumed": 0, "refunded": 0, "result": None}

    async def consume(user, kind, db):
        assert kind == "describe"  # its own allowance, not photo scans
        state["consumed"] += 1
        return uuid.uuid4()

    async def refund(scan_id, db):
        state["refunded"] += 1

    async def estimate(text):
        if isinstance(state["result"], Exception):
            raise state["result"]
        return state["result"]

    monkeypatch.setattr(nutrition_router, "consume_scan", consume)
    monkeypatch.setattr(nutrition_router, "refund_scan", refund)
    monkeypatch.setattr(nutrition_router, "estimate_from_text", estimate)

    app = FastAPI()
    app.include_router(nutrition_router.router)
    user = User(id=uuid.uuid4(), email="u@test.com", username="tester", timezone="UTC",
                created_at=datetime.now(timezone.utc))

    async def fake_db():
        yield None

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = fake_db
    return TestClient(app), state


def test_endpoint_returns_estimate_and_keeps_the_scan(endpoint):
    client, state = endpoint
    state["result"] = {"items": [{"name": "toast"}], "totals": {}}
    r = client.post("/nutrition/estimate/text", json={"text": "a slice of toast"})
    assert r.status_code == 200 and r.json()["items"][0]["name"] == "toast"
    assert (state["consumed"], state["refunded"]) == (1, 0)


def test_endpoint_refunds_when_no_food_found(endpoint):
    client, state = endpoint
    state["result"] = {"items": []}
    r = client.post("/nutrition/estimate/text", json={"text": "hello there"})
    assert r.status_code == 422
    assert (state["consumed"], state["refunded"]) == (1, 1)


def test_endpoint_refunds_on_refusal(endpoint):
    client, state = endpoint
    state["result"] = nt.AIRefused(None)
    assert client.post("/nutrition/estimate/text", json={"text": "x" * 10}).status_code == 422
    assert state["refunded"] == 1


def test_endpoint_rejects_bad_text_before_charging(endpoint):
    client, state = endpoint
    assert client.post("/nutrition/estimate/text", json={"text": "x" * 501}).status_code == 422
    assert client.post("/nutrition/estimate/text", json={"text": "   "}).status_code == 422
    assert state["consumed"] == 0
