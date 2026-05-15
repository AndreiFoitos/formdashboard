from __future__ import annotations
import uuid
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.nutrition_log import NutritionLog
from services.daily import increment_daily_field

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


class LogNutritionRequest(BaseModel):
    calories: int | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    meal_name: str | None = None


@router.post("/log", status_code=201)
async def log_nutrition(
    body: LogNutritionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = NutritionLog(
        user_id=current_user.id,
        date=date.today(),
        **body.model_dump(),
    )
    db.add(entry)

    # Incrementally update each macro field that was provided
    if body.calories is not None:
        await increment_daily_field(current_user.id, db, "calories_eaten", body.calories, mode="add")
    if body.protein_g is not None:
        await increment_daily_field(current_user.id, db, "protein_g", body.protein_g, mode="add")
    if body.carbs_g is not None:
        await increment_daily_field(current_user.id, db, "carbs_g", body.carbs_g, mode="add")
    if body.fat_g is not None:
        await increment_daily_field(current_user.id, db, "fat_g", body.fat_g, mode="add")

    await db.commit()
    await db.refresh(entry)
    return {"id": str(entry.id), "logged_at": entry.logged_at.isoformat()}


@router.get("/today")
async def get_today_nutrition(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()

    totals = await db.execute(
        select(
            sqlfunc.sum(NutritionLog.calories),
            sqlfunc.sum(NutritionLog.protein_g),
            sqlfunc.sum(NutritionLog.carbs_g),
            sqlfunc.sum(NutritionLog.fat_g),
        ).where(NutritionLog.user_id == current_user.id, NutritionLog.date == today)
    )
    cal, protein, carbs, fat = totals.one()

    entries_result = await db.execute(
        select(NutritionLog)
        .where(NutritionLog.user_id == current_user.id, NutritionLog.date == today)
        .order_by(NutritionLog.logged_at)
    )
    entries = entries_result.scalars().all()

    return {
        "totals": {
            "calories": cal or 0,
            "protein_g": protein or 0,
            "carbs_g": carbs or 0,
            "fat_g": fat or 0,
        },
        "targets": {
            "calories": current_user.calorie_target,
            "protein_g": current_user.protein_target_g,
        },
        "entries": [
            {
                "id": str(e.id),
                "meal_name": e.meal_name,
                "calories": e.calories,
                "protein_g": e.protein_g,
                "carbs_g": e.carbs_g,
                "fat_g": e.fat_g,
                "logged_at": e.logged_at.isoformat(),
            }
            for e in entries
        ],
    }


@router.delete("/{log_id}", status_code=204)
async def delete_nutrition(
    log_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NutritionLog).where(NutritionLog.id == log_id, NutritionLog.user_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Log entry not found")

    # Decrement summary fields before deleting
    if entry.calories is not None:
        await increment_daily_field(current_user.id, db, "calories_eaten", -entry.calories, mode="add")
    if entry.protein_g is not None:
        await increment_daily_field(current_user.id, db, "protein_g", -entry.protein_g, mode="add")
    if entry.carbs_g is not None:
        await increment_daily_field(current_user.id, db, "carbs_g", -entry.carbs_g, mode="add")
    if entry.fat_g is not None:
        await increment_daily_field(current_user.id, db, "fat_g", -entry.fat_g, mode="add")

    await db.delete(entry)
    await db.commit()