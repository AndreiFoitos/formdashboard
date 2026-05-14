import math
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models.stimulant_log import StimulantLog

SUBSTANCES = {
    "coffee":       {"half_life": 5.5, "caffeine_mg": 95,  "label": "Coffee"},
    "espresso":     {"half_life": 5.5, "caffeine_mg": 63,  "label": "Espresso"},
    "preworkout":   {"half_life": 5.0, "caffeine_mg": 200, "label": "Pre-workout"},
    "green_tea":    {"half_life": 5.5, "caffeine_mg": 30,  "label": "Green Tea"},
    "energy_drink": {"half_life": 5.5, "caffeine_mg": 80,  "label": "Energy Drink"},
    "black_tea":    {"half_life": 5.5, "caffeine_mg": 47,  "label": "Black Tea"},
    "custom":       {"half_life": 5.5, "caffeine_mg": 100, "label": "Custom"},
}


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

    return {
        "curve": curve,
        "current_mg": round(current_mg, 1),
        "caffeine_at_bedtime": round(caffeine_at_bed, 1),
        "sleep_impact": get_sleep_impact_label(caffeine_at_bed),
        "total_today_mg": sum(log.caffeine_mg for log in logs),
    }