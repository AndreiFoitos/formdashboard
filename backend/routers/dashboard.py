from __future__ import annotations
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from core.timezone import user_today
from middleware.auth import get_current_user
from models.user import User
from models.daily_summary import DailySummary
from models.body_metric import BodyMetric
from models.training_log import TrainingLog
from services.plans import history_window, plan_for
from services.social_notifications import BODYWEIGHT_EXERCISES
from services.form_score import compute_form_score, check_and_unlock_form_score
from services.stimulants import get_caffeine_curve

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = user_today(current_user.timezone)

    summary_result = await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == current_user.id,
            DailySummary.date == today,
        )
    )
    caffeine = await get_caffeine_curve(
        current_user.id, db, current_user.sleep_hour, tz_name=current_user.timezone,
    )

    summary = summary_result.scalar_one_or_none()

    # Create today's row if missing (first visit of the day)
    if summary is None:
        summary = DailySummary(user_id=current_user.id, date=today)
        db.add(summary)
        await db.flush()

    # ── Form score (only when unlocked) ───────────────────────────────────────
    score_breakdown = None
    if current_user.form_score_unlocked:
        score, score_breakdown = await compute_form_score(summary, current_user, db)
        summary.form_score = score
        await db.flush()
    else:
        await check_and_unlock_form_score(current_user, db)

    await db.commit()

    return {
        "date": today.isoformat(),
        "summary": {
            "form_score": summary.form_score,
            "form_score_unlocked": current_user.form_score_unlocked,
            "score_breakdown": score_breakdown,
            # sleep_score / hrv_score dropped (HIGH-16 Path A).
            "water_ml": summary.water_ml,
            "caffeine_mg": summary.caffeine_mg,
            "calories_eaten": summary.calories_eaten,
            "protein_g": summary.protein_g,
            "trained": summary.trained,
            "training_type": summary.training_type,
        },
        "caffeine": caffeine,
        "targets": {
            "water_target_ml": current_user.water_target_ml,
            "protein_target_g": current_user.protein_target_g,
            "calorie_target": current_user.calorie_target,
        },
    }

@router.get("/trends")
async def get_trends(
    days: int = 30,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Long-range charts: Form Score, body weight, weekly training volume.

    How far back you can look is a plan perk (services/plans.py): 30 days on
    Free, 90 on Plus, a year on Pro. Raw logs and the existing history screens
    are never limited — you can always see and export what you logged. When
    the plan cut the request short, `capped` says so and the app offers the
    upgrade.
    """
    window, capped = history_window(current_user, days)
    today = user_today(current_user.timezone)
    since = today - timedelta(days=window - 1)

    summaries = (await db.execute(
        select(DailySummary)
        .where(
            DailySummary.user_id == current_user.id,
            DailySummary.date >= since,
            DailySummary.date <= today,
        )
        .order_by(DailySummary.date)
    )).scalars().all()

    metrics = (await db.execute(
        select(BodyMetric)
        .where(
            BodyMetric.user_id == current_user.id,
            BodyMetric.date >= since,
            BodyMetric.date <= today,
        )
        .order_by(BodyMetric.date)
    )).scalars().all()

    logs = (await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == current_user.id,
            TrainingLog.date >= since,
            TrainingLog.date <= today,
        )
    )).scalars().all()

    # kg moved per ISO week, bodyweight moves counted at the user's weight.
    volume_by_week: dict[str, float] = defaultdict(float)
    days_by_week: dict[str, set] = defaultdict(set)
    for log in logs:
        weight = log.weight_kg
        if weight is None and log.type in BODYWEIGHT_EXERCISES:
            weight = current_user.weight_kg
        year, week, _ = log.date.isocalendar()
        key = f"{year}-W{week:02d}"
        volume_by_week[key] += float(weight or 0) * (log.reps or 0)
        days_by_week[key].add(log.date)

    return {
        "days": window,
        "capped": capped,
        "plan_max_days": plan_for(current_user).history_days,
        "form_score": [
            {"date": s.date.isoformat(), "value": s.form_score}
            for s in summaries if s.form_score is not None
        ],
        "weight_kg": [
            {"date": m.date.isoformat(), "value": float(m.weight_kg)}
            for m in metrics if m.weight_kg is not None
        ],
        "body_fat_pct": [
            {"date": m.date.isoformat(), "value": float(m.body_fat_pct)}
            for m in metrics if m.body_fat_pct is not None
        ],
        "volume_weekly": [
            {"week": k, "value": round(volume_by_week[k]), "sessions": len(days_by_week[k])}
            for k in sorted(volume_by_week)
        ],
        "protein_g": [
            {"date": s.date.isoformat(), "value": round(s.protein_g)}
            for s in summaries if s.protein_g
        ],
    }
