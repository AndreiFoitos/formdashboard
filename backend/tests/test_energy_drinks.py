"""Energy drinks by brand: looked up like any other substance, and listed
apart from the main tiles."""
from fastapi.testclient import TestClient

from main import app
from services.stimulants import ENERGY_DRINKS, PRESETS, SUBSTANCES, compute_nutrition


def test_brand_macros_count_sugar_as_carbs():
    m = compute_nutrition("ed_red_bull", [])
    assert m["calories"] == 113
    assert m["carbs_g"] == 27.5
    assert compute_nutrition("ed_monster_ultra", [])["calories"] == 10


def test_brands_are_presets_but_not_main_tiles():
    assert set(ENERGY_DRINKS) <= set(PRESETS)
    assert not set(ENERGY_DRINKS) & set(SUBSTANCES)
    assert all(d["sugar_g"] <= d["carbs_g"] for d in ENERGY_DRINKS.values())


def test_substances_endpoint_lists_energy_drinks():
    body = TestClient(app).get("/stimulants/substances").json()
    keys = [d["key"] for d in body["energy_drinks"]]
    assert "ed_red_bull" in keys and "energy_custom" in keys
    assert "ed_red_bull" not in [s["key"] for s in body["substances"]]
