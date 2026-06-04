from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, func as sqlfunc, exists
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import resolve_tz, user_today
from models.daily_summary import DailySummary
from models.hydration_log import HydrationLog
from models.nutrition_log import NutritionLog
from models.training_log import TrainingLog


async def get_or_create_today(
    user_id,
    db: AsyncSession,
    *,
    tz_name: str | None = None,
) -> DailySummary:
    """Return today's DailySummary, creating it if missing.

    MEDIUM-32: uses INSERT ... ON CONFLICT DO NOTHING so two concurrent
    requests (e.g. dashboard load + hydration log fired together) can't both
    pass the existence check and then race to INSERT, one of which fails on
    the (user_id, date) unique constraint with an IntegrityError. With ON
    CONFLICT one wins, one no-ops, and both end up with the same row.

    Returns a fresh ORM-loaded instance — the inserted row from a winning
    race is re-fetched so the session has a managed object to mutate.
    """
    today = user_today(tz_name)

    stmt = (
        pg_insert(DailySummary)
        .values(user_id=user_id, date=today)
        .on_conflict_do_nothing(index_elements=["user_id", "date"])
    )
    await db.execute(stmt)

    # Always re-fetch via ORM so the caller gets a session-managed instance
    # whether it was just inserted or already existed. One extra SELECT is
    # cheaper than the IntegrityError 500 + transaction reset we used to hit.
    result = await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == user_id,
            DailySummary.date == today,
        )
    )
    return result.scalar_one()


async def increment_daily_field(
    user_id,
    db: AsyncSession,
    field: str,
    value,
    mode: str = "add",
    *,
    tz_name: str | None = None,
) -> None:
    """
    Incrementally update a single field on today's daily_summary.

    mode="add"  → summary.field += value  (for water_ml, calories, protein, etc.)
    mode="set"  → summary.field  = value  (for training_type, trained, etc.)
    """
    summary = await get_or_create_today(user_id, db, tz_name=tz_name)

    if mode == "add":
        current = getattr(summary, field) or 0
        setattr(summary, field, current + value)
    else:
        setattr(summary, field, value)

    await db.flush()


async def aggregate_today(
    user_id,
    db: AsyncSession,
    *,
    tz_name: str | None = None,
) -> dict:
    today = user_today(tz_name)

    # day_start is the user-local midnight expressed as an aware datetime.
    # Hydration / stimulant logs are queried by `logged_at >=` so the comparison
    # is against the same tz-aware boundary, not server-UTC midnight.
    tz = resolve_tz(tz_name)
    day_start = datetime.combine(today, datetime.min.time()).replace(tzinfo=tz)

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
    trained = training_result.scalar()
    training_type = training_type_result.scalar()

    return {
        "water_ml": water_ml,
        "calories_eaten": cal,
        "protein_g": protein,
        "carbs_g": carbs,
        "fat_g": fat,
        "trained": trained,
        "training_type": training_type,
    }


async def refresh_daily_summary(
    user_id,
    db: AsyncSession,
    *,
    tz_name: str | None = None,
) -> DailySummary:
    summary = await get_or_create_today(
        user_id,
        db,
        tz_name=tz_name,
    )

    agg = await aggregate_today(
        user_id,
        db,
        tz_name=tz_name,
    )

    for k, v in agg.items():
        setattr(summary, k, v)

    await db.flush()

    return summary


async def get_week_summaries(
    user_id,
    db: AsyncSession,
    *,
    tz_name: str | None = None,
) -> list[DailySummary]:
    cutoff = user_today(tz_name) - timedelta(days=6)

    result = await db.execute(
        select(DailySummary)
        .where(
            DailySummary.user_id == user_id,
            DailySummary.date >= cutoff,
        )
        .order_by(DailySummary.date)
    )

    return result.scalars().all()