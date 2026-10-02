"""Pit Crew: AI training + meal plans. See docs/ai-plans-design.md.

Preferences (what plans are built from) and plan builds. The chat that
edits a plan lands here in a later step.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from middleware.auth import get_current_user
from core.timezone import user_today
from models.ai_plan import AiPlan
from models.user import User
from models.user_preference import UserPreference
from services.plan_builder import expire_stale, run_build
from services.plans import PLAN, consume_scan

router = APIRouter(prefix="/plan-ai", tags=["plan-ai"])

Goal = Literal["cut", "maintain", "bulk"]
Equipment = Literal["gym", "home_weights", "bodyweight"]
Experience = Literal["new", "some", "experienced"]
DietStyle = Literal["anything", "vegetarian", "vegan", "pescatarian", "halal", "kosher"]
Cooking = Literal["minimal", "some", "loves"]
HealthFlag = Literal["pregnant", "eating_disorder", "diabetes", "kidney"]

MAX_ITEMS = 30
MAX_ITEM_LEN = 40

FREE_TEXT_LISTS = ("injuries", "allergies", "dislikes", "notes")
FIELDS = (
    "goal", "equipment", "experience", "session_minutes", "training_days",
    "injuries", "diet_style", "allergies", "dislikes", "cooking", "health_flags", "notes",
)


def _clean_list(values: list[str]) -> list[str]:
    """Trim, lowercase and dedupe free-text chips, keeping the user's order.
    These go into prompts, so they're short and bounded."""
    out: list[str] = []
    for v in values:
        v = " ".join(v.split()).lower()[:MAX_ITEM_LEN]
        if v and v not in out:
            out.append(v)
    return out[:MAX_ITEMS]


class PreferencesIn(BaseModel):
    """Partial update: only the fields sent are changed. Lists replace the
    stored list rather than appending, so the client sends the full set."""

    goal: Goal | None = None
    equipment: Equipment | None = None
    experience: Experience | None = None
    session_minutes: int | None = Field(default=None, ge=15, le=180)
    training_days: int | None = Field(default=None, ge=1, le=7)
    injuries: list[str] | None = None
    diet_style: DietStyle | None = None
    allergies: list[str] | None = None
    dislikes: list[str] | None = None
    cooking: Cooking | None = None
    health_flags: list[HealthFlag] | None = None
    notes: list[str] | None = None

    @field_validator(*FREE_TEXT_LISTS)
    @classmethod
    def _lists(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _clean_list(v)

    @field_validator("health_flags")
    @classmethod
    def _flags(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else sorted(set(v))


def _out(p: UserPreference | None) -> dict:
    if p is None:
        return {f: ([] if f in FREE_TEXT_LISTS else None) for f in FIELDS}
    return {f: getattr(p, f) for f in FIELDS}


@router.get("/preferences")
async def get_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return _out(await db.get(UserPreference, current_user.id))


@router.put("/preferences")
async def update_preferences(
    body: PreferencesIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    prefs = await db.get(UserPreference, current_user.id)
    if prefs is None:
        prefs = UserPreference(user_id=current_user.id)
        db.add(prefs)
    for field, value in body.model_dump(exclude_unset=True).items():
        # An explicit null clears a single-choice answer. A list field sent
        # as null is ignored; send [] to empty it.
        if value is None and field in FREE_TEXT_LISTS:
            continue
        setattr(prefs, field, value)
    await db.commit()
    await db.refresh(prefs)
    return _out(prefs)


# ─── Plans ────────────────────────────────────────────────────────────────────


def _plan_out(row: AiPlan) -> dict:
    return {
        "id": str(row.id),
        "status": row.status,
        "week_start": row.week_start.isoformat(),
        "created_at": row.created_at.isoformat(),
        "plan": row.plan,
        "targets": row.targets,
        "rationale": row.rationale,
        "meal_plan_enabled": row.meal_plan_enabled,
    }


@router.get("/plan")
async def get_plan(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The plan in force, plus the state of the latest build so the app can
    show "building..." or the reason a build failed."""
    await expire_stale(current_user.id, db)
    ready = (await db.execute(
        select(AiPlan)
        .where(AiPlan.user_id == current_user.id, AiPlan.status == "ready")
        .order_by(AiPlan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    latest = (await db.execute(
        select(AiPlan)
        .where(AiPlan.user_id == current_user.id, AiPlan.status.in_(("generating", "failed")))
        .order_by(AiPlan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if latest and ready and latest.created_at < ready.created_at:
        latest = None  # an older failure, already superseded
    return {
        "plan": _plan_out(ready) if ready else None,
        "building": bool(latest and latest.status == "generating"),
        "last_error": latest.error if latest and latest.status == "failed" else None,
    }


@router.post("/plan", status_code=202)
async def build_plan(
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a build. Returns at once; the plan arrives via GET /plan and a
    push notification, usually within a couple of minutes."""
    await expire_stale(current_user.id, db)
    running = (await db.execute(
        select(AiPlan.id).where(AiPlan.user_id == current_user.id, AiPlan.status == "generating")
    )).first()
    if running:
        raise HTTPException(409, "A plan is already being built")
    scan_id = await consume_scan(current_user, PLAN, db)
    row = AiPlan(
        user_id=current_user.id,
        status="generating",
        week_start=user_today(current_user.timezone),
        meal_plan_enabled=True,
        scan_id=scan_id,
    )
    db.add(row)
    await db.commit()
    background.add_task(run_build, row.id)
    return {"id": str(row.id), "building": True}
