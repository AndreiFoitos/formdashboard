from __future__ import annotations
from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.daily_summary import DailySummary
from services.daily import refresh_daily_summary, get_week_summaries
from services.form_score import compute_form_score, check_and_unlock_form_score

router = APIRouter(prefix="/daily", tags=["daily"])


def _summary_dict(s: DailySummary, score_breakdown: dict | None = None) -> dict:
    return {
        "id": str(s.id),
        "date": s.date.isoformat(),
        "form_score": s.form_score,
        "score_breakdown": score_breakdown,
        "sleep_score": s.sleep_score,
        "hrv_score": s.hrv_score,
        "readiness_score": s.readiness_score,
        "steps": s.steps,
        "active_calories": s.active_calories,
        "energy_avg": s.energy_avg,
        "water_ml": s.water_ml,
        "caffeine_mg": s.caffeine_mg,
        "calories_eaten": s.calories_eaten,
        "protein_g": s.protein_g,
        "carbs_g": s.carbs_g,
        "fat_g": s.fat_g,
        "trained": s.trained,
        "training_type": s.training_type,
        "notes": s.notes,
        "ai_digest": s.ai_digest,
        "data_source": s.data_source,
        "is_estimated": s.is_estimated,
    }


@router.get("/summary")
async def get_today_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    summary = await refresh_daily_summary(current_user.id, db)

    score_breakdown = None
    if current_user.form_score_unlocked:
        score, breakdown = await compute_form_score(summary, current_user, db)
        summary.form_score = score
        await db.commit()
        score_breakdown = breakdown
    else:
        # Check if they've just hit 5 days
        await check_and_unlock_form_score(current_user, db)

    return {
        **_summary_dict(summary, score_breakdown),
        "form_score_unlocked": current_user.form_score_unlocked,
    }


@router.get("/summary/{target_date}")
async def get_summary_by_date(
    target_date: date,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == current_user.id,
            DailySummary.date == target_date,
        )
    )
    summary = result.scalar_one_or_none()
    if not summary:
        return None

    score_breakdown = None
    if current_user.form_score_unlocked and summary.form_score:
        score, score_breakdown = await compute_form_score(summary, current_user, db)

    return _summary_dict(summary, score_breakdown)


@router.get("/week")
async def get_week(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    summaries = await get_week_summaries(current_user.id, db)
    return [_summary_dict(s) for s in summaries]