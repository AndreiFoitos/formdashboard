from datetime import date, datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc

from models.daily_summary import DailySummary
from models.energy_log import EnergyLog
from models.hydration_log import HydrationLog
from models.nutrition_log import NutritionLog
from models.training_log import TrainingLog


async def get_or_create_today(user_id, db: AsyncSession) -> DailySummary:
    today = date.today()
    result = await db.execute(
        select(DailySummary).where(DailySummary.user_id == user_id, DailySummary.date == today)
    )
    summary = result.scalar_one_or_none()
    if not summary:
        summary = DailySummary(user_id=user_id, date=today)
        db.add(summary)
        await db.commit()
        await db.refresh(summary)
    return summary


async def aggregate_today(user_id, db: AsyncSession) -> dict:
    today = date.today()
    now = datetime.now(timezone.utc)
    day_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)

    # Hydration total
    hydration_result = await db.execute(
        select(sqlfunc.sum(HydrationLog.amount_ml)).where(
            HydrationLog.user_id == user_id, HydrationLog.logged_at >= day_start
        )
    )
    water_ml = hydration_result.scalar() or 0

    # Nutrition totals
    nutrition_result = await db.execute(
        select(
            sqlfunc.sum(NutritionLog.calories),
            sqlfunc.sum(NutritionLog.protein_g),
            sqlfunc.sum(NutritionLog.carbs_g),
            sqlfunc.sum(NutritionLog.fat_g),
        ).where(NutritionLog.user_id == user_id, NutritionLog.date == today)
    )
    cal, protein, carbs, fat = nutrition_result.one()

    # Energy average
    energy_result = await db.execute(
        select(sqlfunc.avg(EnergyLog.level)).where(
            EnergyLog.user_id == user_id, EnergyLog.logged_at >= day_start
        )
    )
    energy_avg = energy_result.scalar()

    # Training
    training_result = await db.execute(
        select(TrainingLog).where(TrainingLog.user_id == user_id, TrainingLog.date == today).limit(1)
    )
    training = training_result.scalar_one_or_none()

    return {
        "water_ml": water_ml,
        "calories_eaten": cal,
        "protein_g": protein,
        "carbs_g": carbs,
        "fat_g": fat,
        "energy_avg": round(float(energy_avg), 2) if energy_avg else None,
        "trained": training is not None,
        "training_type": training.type if training else None,
    }


async def refresh_daily_summary(user_id, db: AsyncSession) -> DailySummary:
    """Pull live logs into today's daily_summary row and return it."""
    summary = await get_or_create_today(user_id, db)
    agg = await aggregate_today(user_id, db)
    for k, v in agg.items():
        setattr(summary, k, v)
    await db.commit()
    await db.refresh(summary)
    return summary


async def get_week_summaries(user_id, db: AsyncSession) -> list[DailySummary]:
    cutoff = date.today() - timedelta(days=6)
    result = await db.execute(
        select(DailySummary)
        .where(DailySummary.user_id == user_id, DailySummary.date >= cutoff)
        .order_by(DailySummary.date)
    )
    return result.scalars().all()