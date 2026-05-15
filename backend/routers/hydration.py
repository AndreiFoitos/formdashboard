from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.hydration_log import HydrationLog
from services.daily import increment_daily_field

router = APIRouter(prefix="/hydration", tags=["hydration"])


class LogHydrationRequest(BaseModel):
    amount_ml: int = Field(..., gt=0)
    source: str = "water"


@router.post("/log", status_code=201)
async def log_hydration(
    body: LogHydrationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = HydrationLog(user_id=current_user.id, amount_ml=body.amount_ml, source=body.source)
    db.add(entry)

    # Incrementally update today's summary — no full recompute needed
    await increment_daily_field(current_user.id, db, "water_ml", body.amount_ml, mode="add")

    await db.commit()
    await db.refresh(entry)
    return {"id": str(entry.id), "amount_ml": entry.amount_ml, "logged_at": entry.logged_at.isoformat()}


@router.get("/today")
async def get_today_hydration(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total_result = await db.execute(
        select(sqlfunc.sum(HydrationLog.amount_ml)).where(
            HydrationLog.user_id == current_user.id, HydrationLog.logged_at >= day_start
        )
    )
    total = total_result.scalar() or 0

    logs_result = await db.execute(
        select(HydrationLog)
        .where(HydrationLog.user_id == current_user.id, HydrationLog.logged_at >= day_start)
        .order_by(HydrationLog.logged_at)
    )
    logs = logs_result.scalars().all()

    target = current_user.water_target_ml or (int(current_user.weight_kg * 35) if current_user.weight_kg else 2500)

    return {
        "total_ml": total,
        "target_ml": target,
        "pct": min(100, round((total / target) * 100)) if target else 0,
        "entries": [
            {"id": str(l.id), "amount_ml": l.amount_ml, "source": l.source, "logged_at": l.logged_at.isoformat()}
            for l in logs
        ],
    }


@router.delete("/{log_id}", status_code=204)
async def delete_hydration(
    log_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(HydrationLog).where(HydrationLog.id == log_id, HydrationLog.user_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Log entry not found")

    # Decrement summary before deleting the log
    await increment_daily_field(current_user.id, db, "water_ml", -entry.amount_ml, mode="add")

    await db.delete(entry)
    await db.commit()