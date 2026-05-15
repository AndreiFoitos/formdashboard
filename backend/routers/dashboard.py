from __future__ import annotations
import asyncio
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.goal import Goal
from models.daily_summary import DailySummary
from services.form_score import compute_form_score, check_and_unlock_form_score
from services.stimulants import get_caffeine_curve

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()

    # ── Run independent queries in parallel ───────────────────────────────────
    summary_task = db.execute(
        select(DailySummary).where(
            DailySummary.user_id == current_user.id,
            DailySummary.date == today,
        )
    )
    goals_task = db.execute(
        select(Goal)
        .where(Goal.user_id == current_user.id, Goal.date == today)
        .order_by(Goal.position, Goal.created_at)
    )

    summary_result, goals_result, caffeine = await asyncio.gather(
        summary_task,
        goals_task,
        get_caffeine_curve(current_user.id, db),
    )

    summary = summary_result.scalar_one_or_none()

    # Create today's row if missing (first visit of the day)
    if summary is None:
        summary = DailySummary(user_id=current_user.id, date=today)
        db.add(summary)
        await db.flush()

    goals = goals_result.scalars().all()

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
            "sleep_score": summary.sleep_score,
            "hrv_score": summary.hrv_score,
            "energy_avg": summary.energy_avg,
            "water_ml": summary.water_ml,
            "caffeine_mg": summary.caffeine_mg,
            "calories_eaten": summary.calories_eaten,
            "protein_g": summary.protein_g,
            "trained": summary.trained,
            "training_type": summary.training_type,
        },
        "goals": [
            {
                "id": str(g.id),
                "text": g.text,
                "done": g.done,
                "position": g.position,
            }
            for g in goals
        ],
        "caffeine": caffeine,
        "targets": {
            "water_target_ml": current_user.water_target_ml,
            "protein_target_g": current_user.protein_target_g,
            "calorie_target": current_user.calorie_target,
        },
    }