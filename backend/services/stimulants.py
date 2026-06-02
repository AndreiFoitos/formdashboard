import math
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.stimulant_log import StimulantLog

# Per-serving nutrition for each substance. Calorie / macro values are USDA
# FoodData Central reference entries; pre-workout and energy_drink are typical
# commercial-product values (sugar-free RedBull 250ml, ~10g pre-workout scoop).
SUBSTANCES = {
    "coffee":       {"label": "Coffee",       "serving": "240 ml brewed", "half_life": 5.5, "caffeine_mg": 95,  "calories": 2,  "protein_g": 0.3, "carbs_g": 0.0, "fat_g": 0.0},
    "espresso":     {"label": "Espresso",     "serving": "30 ml shot",    "half_life": 5.5, "caffeine_mg": 63,  "calories": 1,  "protein_g": 0.1, "carbs_g": 0.0, "fat_g": 0.0},
    "preworkout":   {"label": "Pre-workout",  "serving": "10 g scoop",    "half_life": 5.0, "caffeine_mg": 200, "calories": 5,  "protein_g": 0.0, "carbs_g": 1.0, "fat_g": 0.0},
    "green_tea":    {"label": "Green Tea",    "serving": "240 ml brewed", "half_life": 5.5, "caffeine_mg": 30,  "calories": 2,  "protein_g": 0.5, "carbs_g": 0.5, "fat_g": 0.0},
    "energy_drink": {"label": "Energy Drink", "serving": "250 ml can",    "half_life": 5.5, "caffeine_mg": 80,  "calories": 10, "protein_g": 1.0, "carbs_g": 2.0, "fat_g": 0.0},
    "black_tea":    {"label": "Black Tea",    "serving": "240 ml brewed", "half_life": 5.5, "caffeine_mg": 47,  "calories": 2,  "protein_g": 0.0, "carbs_g": 0.5, "fat_g": 0.0},
    "custom":       {"label": "Custom",       "serving": "—",             "half_life": 5.5, "caffeine_mg": 100, "calories": 0,  "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0},
}

# Optional add-ons mixed into the drink. Calorie / macro values from USDA
# FoodData Central (whole/skim milk per 100 ml scaled to 50 ml; sugar/honey
# per tsp ≈ 4 g / 7 g). Oat milk uses the Oatly Original reference panel.
ADDITIONS = {
    "whole_milk_50ml":  {"label": "Whole milk (50 ml)", "calories": 31, "protein_g": 1.6, "carbs_g": 2.4, "fat_g": 1.7},
    "skim_milk_50ml":   {"label": "Skim milk (50 ml)",  "calories": 17, "protein_g": 1.7, "carbs_g": 2.4, "fat_g": 0.1},
    "oat_milk_50ml":    {"label": "Oat milk (50 ml)",   "calories": 22, "protein_g": 0.5, "carbs_g": 3.5, "fat_g": 0.75},
    "almond_milk_50ml": {"label": "Almond milk (50 ml)","calories":  7, "protein_g": 0.3, "carbs_g": 0.4, "fat_g": 0.6},
    "sugar_tsp":        {"label": "Sugar (1 tsp)",      "calories": 16, "protein_g": 0.0, "carbs_g": 4.0, "fat_g": 0.0},
    "honey_tsp":        {"label": "Honey (1 tsp)",      "calories": 21, "protein_g": 0.0, "carbs_g": 5.8, "fat_g": 0.0},
}

# Which substances surface the add-ons picker. Pre-workout/energy drink are
# usually drunk as-is, and "custom" is too undefined.
SUBSTANCES_WITH_ADDITIONS = {"coffee", "espresso", "green_tea", "black_tea"}


def compute_nutrition(substance_key: str, additions: list[str] | None) -> dict:
    """Sum base substance + additions into a single nutrition dict."""
    preset = SUBSTANCES.get(substance_key, SUBSTANCES["custom"])
    totals = {
        "calories": float(preset["calories"]),
        "protein_g": float(preset["protein_g"]),
        "carbs_g":   float(preset["carbs_g"]),
        "fat_g":     float(preset["fat_g"]),
    }
    for key in additions or []:
        a = ADDITIONS.get(key)
        if not a:
            continue
        totals["calories"]  += a["calories"]
        totals["protein_g"] += a["protein_g"]
        totals["carbs_g"]   += a["carbs_g"]
        totals["fat_g"]     += a["fat_g"]
    # Round at the end so accumulated rounding doesn't drift on multi-add logs.
    totals["calories"]  = round(totals["calories"])
    totals["protein_g"] = round(totals["protein_g"], 1)
    totals["carbs_g"]   = round(totals["carbs_g"], 1)
    totals["fat_g"]     = round(totals["fat_g"], 1)
    return totals


def caffeine_at_time(dose_mg: float, logged_at: datetime, half_life: float, query_time: datetime) -> float:
    hours_elapsed = (query_time - logged_at).total_seconds() / 3600
    if hours_elapsed < 0:
        return 0.0
    return dose_mg * math.pow(0.5, hours_elapsed / half_life)


def get_zone(mg: float) -> str:
    if mg < 50:  return "low"
    if mg < 200: return "optimal"
    if mg < 300: return "elevated"
    return "high"


def get_sleep_impact_label(mg_at_bed: float) -> str:
    if mg_at_bed < 50:  return "Minimal sleep impact"
    if mg_at_bed < 100: return "Mild impact — may affect deep sleep"
    if mg_at_bed < 200: return "Moderate impact — expect reduced sleep quality"
    return "High impact — cut caffeine earlier tomorrow"


async def get_today_stimulant_logs(user_id, db: AsyncSession) -> list[StimulantLog]:
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(StimulantLog)
        .where(StimulantLog.user_id == user_id, StimulantLog.logged_at >= day_start)
        .order_by(StimulantLog.logged_at)
    )
    return result.scalars().all()


async def get_caffeine_curve(user_id, db: AsyncSession, sleep_hour: int = 23) -> dict:
    logs = await get_today_stimulant_logs(user_id, db)
    now = datetime.now(timezone.utc)

    # Curve runs 6 AM to 1 AM (next day) in 30-min steps = 38 points
    start = now.replace(hour=6, minute=0, second=0, microsecond=0)
    curve = []

    for i in range(38):
        t = start + timedelta(minutes=i * 30)
        total = sum(
            caffeine_at_time(log.caffeine_mg, log.logged_at, log.half_life_hours, t)
            for log in logs
        )
        curve.append({
            "time": t.isoformat(),
            "time_label": t.strftime("%I:%M %p").lstrip("0") if hasattr(t, 'strftime') else t.strftime("%I:%M %p").lstrip("0"),
            "caffeine_mg": round(total, 1),
            "in_past": t <= now,
            "zone": get_zone(total),
        })

    bedtime = now.replace(hour=sleep_hour, minute=0, second=0, microsecond=0)
    caffeine_at_bed = sum(
        caffeine_at_time(log.caffeine_mg, log.logged_at, log.half_life_hours, bedtime)
        for log in logs
    )
    current_mg = sum(
        caffeine_at_time(log.caffeine_mg, log.logged_at, log.half_life_hours, now)
        for log in logs
    )

    # Most-recent log for the "repeat last" dashboard chip. Today's last, else
    # fall back to the most-recent ever so first-of-the-day still gets a shortcut.
    last_log_obj = logs[-1] if logs else None
    if last_log_obj is None:
        recent = await db.execute(
            select(StimulantLog)
            .where(StimulantLog.user_id == user_id)
            .order_by(StimulantLog.logged_at.desc())
            .limit(1)
        )
        last_log_obj = recent.scalar_one_or_none()

    last_log = None
    if last_log_obj is not None:
        preset = SUBSTANCES.get(last_log_obj.substance)
        last_log = {
            "substance": last_log_obj.substance,
            "label": preset["label"] if preset else "Custom",
            "caffeine_mg": last_log_obj.caffeine_mg,
            "additions": list(last_log_obj.additions or []),
        }

    return {
        "curve": curve,
        "current_mg": round(current_mg, 1),
        "caffeine_at_bedtime": round(caffeine_at_bed, 1),
        "sleep_impact": get_sleep_impact_label(caffeine_at_bed),
        "total_today_mg": sum(log.caffeine_mg for log in logs),
        "last_log": last_log,
    }
