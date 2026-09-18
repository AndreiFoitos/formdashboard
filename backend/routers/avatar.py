from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from services.avatar_rewards import mark_seen, sync_and_describe

router = APIRouter(prefix="/avatar", tags=["avatar"])


@router.get("/rewards")
async def get_rewards(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Today's active combos, owned items, unseen unlocks and the Combo Dex.

    Also records newly earned combos/milestones (idempotent: one row per
    reward per day), so the app just calls this after data changes."""
    return await sync_and_describe(current_user, db)


@router.post("/rewards/seen", status_code=204)
async def rewards_seen(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await mark_seen(current_user.id, db)
