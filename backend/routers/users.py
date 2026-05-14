from __future__ import annotations
from datetime import date, timedelta
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.daily_summary import DailySummary
from models.onboarding import OnboardingBaseline
from schemas.user import UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


class OnboardingStepRequest(BaseModel):
    step: str
    data: dict


class BaselineRequest(BaseModel):
    goal: str | None = None
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    avg_sleep_hours: float | None = None
    training_frequency: str | None = None
    caffeine_habit: str | None = None
    energy_rating: int | None = None
    device_connected: str | None = None


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserOut)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.put("/me/onboarding")
async def save_onboarding_step(
    body: OnboardingStepRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = body.data
    if body.step == "goal":
        current_user.goal = data.get("goal")
    elif body.step == "stats":
        current_user.age = data.get("age")
        current_user.height_cm = data.get("height_cm")
        current_user.weight_kg = data.get("weight_kg")
        if current_user.weight_kg:
            current_user.protein_target_g = round(current_user.weight_kg * 2)
            current_user.water_target_ml = int(current_user.weight_kg * 35)
    elif body.step == "targets":
        current_user.protein_target_g = data.get("protein_target_g", current_user.protein_target_g)
        current_user.water_target_ml = data.get("water_target_ml", current_user.water_target_ml)
        current_user.calorie_target = data.get("calorie_target", current_user.calorie_target)
    await db.commit()
    return {"ok": True}


@router.post("/me/baseline")
async def submit_baseline(
    body: BaselineRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field in ("goal", "age", "height_cm", "weight_kg"):
        val = getattr(body, field, None)
        if val is not None:
            setattr(current_user, field, val)

    if current_user.weight_kg and not current_user.protein_target_g:
        current_user.protein_target_g = round(current_user.weight_kg * 2)
    if current_user.weight_kg and not current_user.water_target_ml:
        current_user.water_target_ml = int(current_user.weight_kg * 35)

    result = await db.execute(select(OnboardingBaseline).where(OnboardingBaseline.user_id == current_user.id))
    baseline = result.scalar_one_or_none() or OnboardingBaseline(user_id=current_user.id)
    baseline.avg_sleep_hours = body.avg_sleep_hours
    baseline.training_frequency = body.training_frequency
    baseline.caffeine_habit = body.caffeine_habit
    baseline.energy_rating = body.energy_rating
    baseline.device_connected = body.device_connected
    db.add(baseline)

    await _seed_estimated_summaries(current_user, body, db)

    current_user.onboarding_complete = True
    await db.commit()
    return {"ok": True}


async def _seed_estimated_summaries(user: User, baseline: BaselineRequest, db: AsyncSession):
    sleep_score = min(100, round(((baseline.avg_sleep_hours or 7.5) / 8) * 100))
    energy_map = {1: 30, 2: 45, 3: 60, 4: 75, 5: 90}
    energy_score = energy_map.get(baseline.energy_rating or 3, 60)
    training_map = {"0-1x": 1, "2-3x": 2, "4-5x": 4, "6x+": 6}
    sessions_per_week = training_map.get(baseline.training_frequency or "2-3x", 2)

    today = date.today()
    for i in range(1, 8):
        target_date = today - timedelta(days=i)
        existing = await db.execute(
            select(DailySummary).where(DailySummary.user_id == user.id, DailySummary.date == target_date)
        )
        if existing.scalar_one_or_none():
            continue
        trained = (i % max(1, 7 // sessions_per_week)) == 0
        summary = DailySummary(
            user_id=user.id,
            date=target_date,
            sleep_score=sleep_score,
            energy_avg=round(energy_score / 20, 1),
            trained=trained,
            water_ml=user.water_target_ml or 2000,
            protein_g=user.protein_target_g,
            data_source="baseline_estimate",
            is_estimated=True,
        )
        db.add(summary)