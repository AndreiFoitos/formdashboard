from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.energy_log import EnergyLog

router = APIRouter(prefix="/energy", tags=["energy"])


class LogEnergyRequest(BaseModel):
    level: int = Field(..., ge=1, le=5)
    note: str | None = None


@router.post("/log", status_code=201)
async def log_energy(
    body: LogEnergyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = EnergyLog(user_id=current_user.id, level=body.level, note=body.note)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return {"id": str(entry.id), "level": entry.level, "logged_at": entry.logged_at.isoformat()}


@router.get("/today")
async def get_today_energy(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(EnergyLog)
        .where(EnergyLog.user_id == current_user.id, EnergyLog.logged_at >= day_start)
        .order_by(EnergyLog.logged_at)
    )
    logs = result.scalars().all()
    return [
        {"id": str(l.id), "level": l.level, "note": l.note, "logged_at": l.logged_at.isoformat()}
        for l in logs
    ]