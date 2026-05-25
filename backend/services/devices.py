from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.daily_summary import DailySummary
from models.device_connection import DeviceConnection
from services.form_score import compute_form_score

# Device-owned columns. These are written by sync and never by manual logging,
# so the two write-paths never clobber each other.
DEVICE_FIELDS = ("sleep_score", "hrv_score", "readiness_score", "steps", "active_calories")


def estimate_sleep_score(hours: float | None) -> int | None:
    """Map sleep duration (hours) to a 0-100 score. HealthKit gives duration, not a score.

    Peaks around 8h; tapers gently past 9h to discourage oversleeping.
    """
    if hours is None:
        return None
    if hours <= 0:
        return 0
    if hours >= 7.5:
        score = 100 - max(0.0, hours - 9) * 8
    else:
        score = (hours / 7.5) * 100
    return max(0, min(100, round(score)))


async def get_or_create_device_connection(
    user_id,
    provider: str,
    db: AsyncSession,
) -> DeviceConnection:
    result = await db.execute(
        select(DeviceConnection).where(
            DeviceConnection.user_id == user_id,
            DeviceConnection.provider == provider,
        )
    )
    conn = result.scalar_one_or_none()
    if conn is None:
        conn = DeviceConnection(user_id=user_id, provider=provider)
        db.add(conn)
        await db.flush()
    return conn


async def upsert_daily_summary(
    user_id,
    data: dict,
    db: AsyncSession,
) -> DailySummary:
    """Write device-owned fields onto the (user_id, date) summary, creating it if missing.

    `data` must contain a `date`. Only device fields that are present and non-null are
    written, so a sync that lacks HRV won't wipe an existing HRV value. A `data_source`
    may be supplied; real device data also clears the cold-start `is_estimated` flag.
    """
    target_date = data["date"]
    if isinstance(target_date, str):
        target_date = date.fromisoformat(target_date)

    result = await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == user_id,
            DailySummary.date == target_date,
        )
    )
    summary = result.scalar_one_or_none()
    if summary is None:
        summary = DailySummary(user_id=user_id, date=target_date)
        db.add(summary)

    for field in DEVICE_FIELDS:
        value = data.get(field)
        if value is not None:
            setattr(summary, field, value)

    if data.get("data_source"):
        summary.data_source = data["data_source"]
        # Real device data supersedes a cold-start estimate for this day.
        summary.is_estimated = False

    await db.flush()
    return summary


async def recompute_form_scores_range(
    user_id,
    user,
    days: int,
    db: AsyncSession,
) -> int:
    """Recompute and persist form_score for each summary in the last `days` days.

    Needed after a backfill: the dashboard computes the score on read for *today* only,
    so historical rows would otherwise keep a null score and never appear in week/history
    views once the score unlocks.
    """
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == user_id,
            DailySummary.date >= cutoff,
        )
    )
    summaries = result.scalars().all()
    for summary in summaries:
        score, _ = await compute_form_score(summary, user, db)
        summary.form_score = score
    await db.flush()
    return len(summaries)
