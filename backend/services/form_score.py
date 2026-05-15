import asyncio
from datetime import date, timedelta, datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc

from models.daily_summary import DailySummary
from models.streak import Streak
from models.stimulant_log import StimulantLog
from services.stimulants import caffeine_at_time

WEIGHTS = {
    "sleep":       0.25,
    "hrv":         0.20,
    "hydration":   0.15,
    "nutrition":   0.15,
    "training":    0.10,
    "stimulants":  0.10,
    "consistency": 0.05,
}


async def get_30day_hrv_avg(user_id, db: AsyncSession) -> float | None:
    cutoff = date.today() - timedelta(days=30)
    result = await db.execute(
        select(sqlfunc.avg(DailySummary.hrv_score))
        .where(DailySummary.user_id == user_id, DailySummary.date >= cutoff, DailySummary.hrv_score.isnot(None))
    )
    return result.scalar()


async def normalize_hrv(user_id, current_hrv: int, db: AsyncSession) -> int:
    avg = await get_30day_hrv_avg(user_id, db)
    if not avg:
        return 50
    ratio = current_hrv / avg
    return max(0, min(100, round((ratio - 0.5) * 100)))


async def days_since_last_training(user_id, current_date: date, db: AsyncSession) -> int | None:
    cutoff = current_date - timedelta(days=7)
    result = await db.execute(
        select(DailySummary.date)
        .where(
            DailySummary.user_id == user_id,
            DailySummary.trained == True,
            DailySummary.date < current_date,
            DailySummary.date >= cutoff,
        )
        .order_by(DailySummary.date.desc())
        .limit(1)
    )
    last = result.scalar()
    if not last:
        return None
    return (current_date - last).days


async def estimate_caffeine_at_sleep(user_id, target_date: date, sleep_hour: int, db: AsyncSession) -> float:
    day_start = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    result = await db.execute(
        select(StimulantLog).where(
            StimulantLog.user_id == user_id,
            StimulantLog.logged_at >= day_start,
            StimulantLog.logged_at < day_end,
        )
    )
    logs = result.scalars().all()
    bedtime = day_start.replace(hour=sleep_hour)
    return sum(caffeine_at_time(log.caffeine_mg, log.logged_at, log.half_life_hours, bedtime) for log in logs)


async def compute_form_score(day: DailySummary, user, db: AsyncSession) -> tuple[int, dict]:
    scores = {}

    # ── Run all independent DB queries in parallel ────────────────────────────
    hrv_task = normalize_hrv(user.id, day.hrv_score, db) if day.hrv_score else None
    training_task = days_since_last_training(user.id, day.date, db)
    caffeine_task = estimate_caffeine_at_sleep(user.id, day.date, 23, db)
    streak_task = db.get(Streak, user.id)

    # Gather all at once — saves 3 sequential round trips
    results = await asyncio.gather(
        hrv_task if hrv_task else asyncio.sleep(0),  # no-op if no HRV
        training_task,
        caffeine_task,
        streak_task,
    )

    hrv_normalized = results[0] if day.hrv_score else 50
    days_since = results[1]
    caffeine_at_bed = results[2]
    streak_row = results[3]

    # ── Sleep ─────────────────────────────────────────────────────────────────
    scores["sleep"] = day.sleep_score if day.sleep_score else 50

    # ── HRV ───────────────────────────────────────────────────────────────────
    scores["hrv"] = hrv_normalized if day.hrv_score else 50

    # ── Hydration ─────────────────────────────────────────────────────────────
    target_water = user.water_target_ml or (int(user.weight_kg * 35) if user.weight_kg else 2500)
    if day.water_ml:
        scores["hydration"] = min(100, round((day.water_ml / target_water) * 100))
    else:
        scores["hydration"] = 0

    # ── Nutrition ─────────────────────────────────────────────────────────────
    target_protein = user.protein_target_g or (user.weight_kg * 2 if user.weight_kg else None)
    if day.protein_g and target_protein:
        scores["nutrition"] = min(100, round((day.protein_g / target_protein) * 100))
    else:
        scores["nutrition"] = 50

    # ── Training ──────────────────────────────────────────────────────────────
    if day.trained:
        scores["training"] = 100
    else:
        decay_map = {1: 70, 2: 40}
        scores["training"] = decay_map.get(days_since, 0) if days_since else 0

    # ── Stimulants ────────────────────────────────────────────────────────────
    scores["stimulants"] = max(0, 100 - round(caffeine_at_bed / 3))

    # ── Consistency ───────────────────────────────────────────────────────────
    current_streak = streak_row.current_streak if streak_row else 0
    scores["consistency"] = min(100, round(current_streak * 3.33))

    total = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)
    return round(total), scores


async def count_recent_logged_days(user_id, days: int, db: AsyncSession) -> int:
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(sqlfunc.count()).select_from(DailySummary).where(
            DailySummary.user_id == user_id,
            DailySummary.date >= cutoff,
        )
    )
    return result.scalar() or 0


async def check_and_unlock_form_score(user, db: AsyncSession) -> bool:
    """Returns True if form score was just unlocked."""
    if user.form_score_unlocked:
        return False

    days_logged = await count_recent_logged_days(user.id, 7, db)
    if days_logged >= 5:
        user.form_score_unlocked = True
        await db.commit()
        return True
    return False