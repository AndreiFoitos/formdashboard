"""Adaptive calories: the burn estimate behind the calorie target, and the
weekly suggestion the user accepts or dismisses. See services/energy.py and
services/adaptive_calories.py."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.timezone import user_today
from middleware.auth import get_current_user
from models.calorie_update import CalorieUpdate
from models.user import User
from models.user_preference import UserPreference
from services import adaptive_calories as ac
from services.energy import estimate_for
from services.plan_builder import meal_plan_allowed
from services.plan_chat import ToolError

router = APIRouter(prefix="/calories", tags=["calories"])


@router.get("/adaptive")
async def get_adaptive(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The live estimate (Settings and the goal/pace change prompts use its
    target_kcal) and this week's pending suggestion, created on first ask."""
    row = await ac.weekly(current_user, db)
    prefs = await db.get(UserPreference, current_user.id)
    est = await estimate_for(current_user, prefs, user_today(current_user.timezone), db)
    return {
        "enabled": prefs.adaptive_calories if prefs else True,
        "available": meal_plan_allowed(current_user, prefs),
        "target": current_user.calorie_target,
        "estimate": est.to_dict(),
        "suggestion": ac.out(row) if row is not None and row.status == "pending" else None,
    }


async def _row(sid: uuid.UUID, user: User, db: AsyncSession) -> CalorieUpdate:
    row = await db.get(CalorieUpdate, sid)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Suggestion not found")
    return row


def _result(user: User, row: CalorieUpdate) -> dict:
    return {
        "calorie_target": user.calorie_target,
        "protein_target_g": user.protein_target_g,
        "suggestion": ac.out(row),
    }


@router.post("/adaptive/{sid}/accept")
async def accept(sid: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _row(sid, current_user, db)
    try:
        await ac.accept(current_user, row, db)
    except ToolError as e:
        raise HTTPException(409, str(e))
    return _result(current_user, row)


@router.post("/adaptive/{sid}/dismiss")
async def dismiss(sid: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _row(sid, current_user, db)
    try:
        await ac.dismiss(row, db)
    except ToolError as e:
        raise HTTPException(409, str(e))
    return _result(current_user, row)


@router.post("/adaptive/{sid}/undo")
async def undo(sid: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await _row(sid, current_user, db)
    try:
        await ac.undo(current_user, row, db)
    except ToolError as e:
        raise HTTPException(409, str(e))
    return _result(current_user, row)
