"""Pit Crew: AI training + meal plans. See docs/ai-plans-design.md.

Preferences (what plans are built from), plan builds, today's slice of the
plan, and the chat that can change it.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.timezone import user_today
from middleware.auth import get_current_user
from models.ai_message import AiMessage
from models.ai_plan import AiPlan
from models.user import User
from models.user_preference import UserPreference
from routers.nutrition import BatchLogRequest, LogNutritionRequest, delete_nutrition, log_nutrition_batch
from services.ai_client import AINotConfigured
from services.ai_features import chat_history
from services.plan_builder import expire_stale, run_build
from services.plan_chat import ToolError, chat_turn, undo_actions
from services.plan_shopping import build_list
from services.plan_today import build_today, logged_meals, record_logged, todays_meals
from services.plans import ASK, PLAN, consume_scan, plan_for, refund_scan

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


# ─── Today ────────────────────────────────────────────────────────────────────


async def _ready_plan(user: User, db: AsyncSession) -> AiPlan | None:
    return (await db.execute(
        select(AiPlan)
        .where(AiPlan.user_id == user.id, AiPlan.status == "ready")
        .order_by(AiPlan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()


@router.get("/today")
async def get_today(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Today's workout with weight suggestions, and today's meals."""
    row = await _ready_plan(current_user, db)
    if row is None:
        return {"today": None}
    return {"today": await build_today(current_user, row, db)}


@router.get("/shopping")
async def get_shopping_list(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What to buy for the next 7 days of meals, grouped by aisle."""
    row = await _ready_plan(current_user, db)
    if row is None:
        raise HTTPException(404, "No plan yet")
    return await build_list(current_user, row, user_today(current_user.timezone), db)


def _todays_meal(user: User, row: AiPlan, meal_id: str) -> dict:
    meals = todays_meals(row, user_today(user.timezone))
    meal = next((m for m in meals if m["id"] == meal_id), None)
    if meal is None:
        raise HTTPException(404, "That meal isn't in today's plan")
    return meal


@router.post("/today/meals/{meal_id}", status_code=201)
async def log_plan_meal(
    meal_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Log one of today's plan meals: one nutrition entry per ingredient,
    through the same path as any other batch log."""
    row = await _ready_plan(current_user, db)
    if row is None:
        raise HTTPException(404, "No plan yet")
    meal = _todays_meal(current_user, row, meal_id)
    today = user_today(current_user.timezone)
    if meal_id in await logged_meals(current_user, row, today, db):
        raise HTTPException(409, "Already logged")
    created = await log_nutrition_batch(
        BatchLogRequest(entries=[
            LogNutritionRequest(
                calories=i["calories"], protein_g=i["protein_g"], carbs_g=i["carbs_g"],
                fat_g=i["fat_g"], meal_name=i["food"], source="plan",
            )
            for i in meal["items"]
        ]),
        current_user=current_user,
        db=db,
    )
    await db.refresh(row)
    record_logged(row, today, meal_id, [c["id"] for c in created])
    await db.commit()
    return {"logged": True, "entries": created}


@router.delete("/today/meals/{meal_id}", status_code=204)
async def unlog_plan_meal(
    meal_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Undo: delete the entries this meal created today."""
    row = await _ready_plan(current_user, db)
    if row is None:
        raise HTTPException(404, "No plan yet")
    today = user_today(current_user.timezone)
    ids = (((row.plan or {}).get("logged") or {}).get(today.isoformat()) or {}).get(meal_id, [])
    for log_id in ids:
        try:
            await delete_nutrition(uuid.UUID(log_id), current_user=current_user, db=db)
        except HTTPException:
            pass  # already deleted elsewhere
    await db.refresh(row)
    record_logged(row, today, meal_id, None)
    await db.commit()


# ─── Chat ─────────────────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


def _public_actions(actions: list[dict]) -> list[dict]:
    return [{"type": a["type"], "summary": a["summary"], "undone": bool(a.get("undone"))} for a in actions]


@router.post("/chat")
async def chat(
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """One chat turn. Like /ai/ask (same quota and saved history) but Claude
    can change the plan; `actions` lists what changed, for the Undo chip."""
    text = body.message.strip()
    if not text:
        raise HTTPException(400, "Message is empty")
    asked_at = datetime.now(timezone.utc)
    scan_id = await consume_scan(current_user, ASK, db)
    try:
        try:
            reply, actions = await chat_turn(current_user, text, db, plan_for(current_user).history_days)
        except AINotConfigured:
            raise HTTPException(503, "AI is not configured on the server")
        if not reply:
            raise HTTPException(502, "The model returned an empty answer")
    except Exception:
        await db.rollback()
        await refund_scan(scan_id, db)
        raise
    answered_at = max(datetime.now(timezone.utc), asked_at + timedelta(microseconds=1))
    db.add(AiMessage(user_id=current_user.id, role="user", content=text, created_at=asked_at))
    msg = AiMessage(
        user_id=current_user.id, role="assistant", content=reply,
        actions=actions or None, created_at=answered_at,
    )
    db.add(msg)
    await db.commit()
    return {
        "id": str(msg.id),
        "answer": reply,
        "actions": _public_actions(actions),
        "undoable": bool(actions),
    }


@router.post("/chat/{message_id}/undo")
async def undo_chat(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await db.get(AiMessage, message_id)
    if msg is None or msg.user_id != current_user.id or not msg.actions:
        raise HTTPException(404, "Nothing to undo")
    if any(a.get("undone") for a in msg.actions):
        raise HTTPException(409, "Already undone")
    latest = next((m for m in reversed(await chat_history(current_user.id, db, limit=50)) if m.actions), None)
    if latest is None or latest.id != msg.id:
        raise HTTPException(409, "Only the latest change can be undone")
    try:
        await undo_actions(current_user, msg, db)
    except ToolError as e:
        raise HTTPException(409, str(e))
    return {"undone": True, "actions": _public_actions(msg.actions)}
