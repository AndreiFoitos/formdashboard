from datetime import date as Date
import uuid
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.goal import Goal

router = APIRouter(prefix="/goals", tags=["goals"])


class CreateGoalRequest(BaseModel):
    text: str
    date: Date | None = None


class UpdateGoalRequest(BaseModel):
    text: str | None = None
    done: bool | None = None


class ReorderItem(BaseModel):
    id: uuid.UUID
    position: int


def _goal_dict(g: Goal) -> dict:
    return {
        "id": str(g.id),
        "date": g.date.isoformat(),
        "text": g.text,
        "done": g.done,
        "position": g.position,
        "created_at": g.created_at.isoformat(),
    }


@router.get("/")
async def get_today_goals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Goal)
        .where(Goal.user_id == current_user.id, Goal.date == date.today())
        .order_by(Goal.position, Goal.created_at)
    )
    return [_goal_dict(g) for g in result.scalars().all()]


@router.get("/{target_date}")
async def get_goals_by_date(
    target_date: date,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Goal)
        .where(Goal.user_id == current_user.id, Goal.date == target_date)
        .order_by(Goal.position, Goal.created_at)
    )
    return [_goal_dict(g) for g in result.scalars().all()]


@router.post("/", status_code=201)
async def create_goal(
    body: CreateGoalRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target_date = body.date or date.today()

    # Position = max existing + 1
    result = await db.execute(
        select(Goal.position)
        .where(Goal.user_id == current_user.id, Goal.date == target_date)
        .order_by(Goal.position.desc())
        .limit(1)
    )
    max_pos = result.scalar() or -1

    goal = Goal(user_id=current_user.id, date=target_date, text=body.text, position=max_pos + 1)
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return _goal_dict(goal)


@router.put("/{goal_id}")
async def update_goal(
    goal_id: uuid.UUID,
    body: UpdateGoalRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == current_user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(404, "Goal not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)

    await db.commit()
    await db.refresh(goal)
    return _goal_dict(goal)


@router.delete("/{goal_id}", status_code=204)
async def delete_goal(
    goal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.user_id == current_user.id)
    )
    goal = result.scalar_one_or_none()
    if not goal:
        raise HTTPException(404, "Goal not found")
    await db.delete(goal)
    await db.commit()


@router.put("/reorder/bulk")
async def reorder_goals(
    items: list[ReorderItem],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for item in items:
        result = await db.execute(
            select(Goal).where(Goal.id == item.id, Goal.user_id == current_user.id)
        )
        goal = result.scalar_one_or_none()
        if goal:
            goal.position = item.position
    await db.commit()
    return {"updated": len(items)}


@router.post("/push-to-tomorrow")
async def push_to_tomorrow(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = date.today()
    tomorrow = today + timedelta(days=1)

    result = await db.execute(
        select(Goal).where(
            Goal.user_id == current_user.id,
            Goal.date == today,
            Goal.done == False,  # noqa
        )
    )
    undone = result.scalars().all()

    pushed = 0
    for goal in undone:
        goal.date = tomorrow
        pushed += 1

    await db.commit()
    return {"pushed": pushed}