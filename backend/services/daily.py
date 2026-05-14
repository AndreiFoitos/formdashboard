from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, func as sqlfunc, exists
from sqlalchemy.ext.asyncio import AsyncSession

from models.daily_summary import DailySummary
from models.energy_log import EnergyLog
from models.hydration_log import HydrationLog
from models.nutrition_log import NutritionLog
from models.training_log import TrainingLog


async def get_or_create_today(
    user_id,
    db: AsyncSession,
) -> DailySummary:
    today = date.today()

    result = await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == user_id,
            DailySummary.date == today,
        )
    )

    summary = result.scalar_one_or_none()

    if summary:
        return summary

    summary = DailySummary(
        user_id=user_id,
        date=today,
    )

    db.add(summary)

    await db.flush()

    return summary


async def aggregate_today(
    user_id,
    db: AsyncSession,
) -> dict:
    today = date.today()

    day_start = datetime.now(
        timezone.utc,
    ).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )

    hydration_result = await db.execute(
        select(
            sqlfunc.coalesce(
                sqlfunc.sum(HydrationLog.amount_ml),
                0,
            )
        ).where(
            HydrationLog.user_id == user_id,
            HydrationLog.logged_at >= day_start,
        )
    )

    nutrition_result = await db.execute(
        select(
            sqlfunc.coalesce(
                sqlfunc.sum(NutritionLog.calories),
                0,
            ),
            sqlfunc.coalesce(
                sqlfunc.sum(NutritionLog.protein_g),
                0,
            ),
            sqlfunc.coalesce(
                sqlfunc.sum(NutritionLog.carbs_g),
                0,
            ),
            sqlfunc.coalesce(
                sqlfunc.sum(NutritionLog.fat_g),
                0,
            ),
        ).where(
            NutritionLog.user_id == user_id,
            NutritionLog.date == today,
        )
    )

    energy_result = await db.execute(
        select(
            sqlfunc.avg(EnergyLog.level)
        ).where(
            EnergyLog.user_id == user_id,
            EnergyLog.logged_at >= day_start,
        )
    )

    training_result = await db.execute(
        select(
            exists().where(
                TrainingLog.user_id == user_id,
                TrainingLog.date == today,
            )
        )
    )

    training_type_result = await db.execute(
        select(TrainingLog.type)
        .where(
            TrainingLog.user_id == user_id,
            TrainingLog.date == today,
        )
        .limit(1)
    )

    water_ml = hydration_result.scalar()

    cal, protein, carbs, fat = nutrition_result.one()

    energy_avg = energy_result.scalar()

    trained = training_result.scalar()

    training_type = training_type_result.scalar()

    return {
        "water_ml": water_ml,
        "calories_eaten": cal,
        "protein_g": protein,
        "carbs_g": carbs,
        "fat_g": fat,
        "energy_avg": round(float(energy_avg), 2)
        if energy_avg is not None
        else None,
        "trained": trained,
        "training_type": training_type,
    }


async def refresh_daily_summary(
    user_id,
    db: AsyncSession,
) -> DailySummary:
    summary = await get_or_create_today(
        user_id,
        db,
    )

    agg = await aggregate_today(
        user_id,
        db,
    )

    for k, v in agg.items():
        setattr(summary, k, v)

    await db.commit()

    return summary


async def get_week_summaries(
    user_id,
    db: AsyncSession,
) -> list[DailySummary]:
    cutoff = date.today() - timedelta(days=6)

    result = await db.execute(
        select(DailySummary)
        .where(
            DailySummary.user_id == user_id,
            DailySummary.date >= cutoff,
        )
        .order_by(DailySummary.date)
    )

    return result.scalars().all()