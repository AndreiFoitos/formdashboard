"""Pit Crew: AI training + meal plans. See docs/ai-plans-design.md.

Step 1 only has the preferences the plans are built from. Plan generation
and the chat land here in later steps.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.user_preference import UserPreference

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
