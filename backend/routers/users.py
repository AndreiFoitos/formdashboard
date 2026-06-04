from __future__ import annotations
import re
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc, delete as sa_delete

from core.database import get_db
from core.rate_limit import limiter
from middleware.auth import get_current_user
from models.user import User
from models.daily_summary import DailySummary
from models.onboarding import OnboardingBaseline
from models.body_metric import BodyMetric
from schemas.user import UserOut, UserUpdate, USERNAME_PATTERN, RESERVED_USERNAMES

router = APIRouter(prefix="/users", tags=["users"])

_USERNAME_RE = re.compile(USERNAME_PATTERN)


class OnboardingStepRequest(BaseModel):
    step: str
    data: dict


class BaselineRequest(BaseModel):
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    avg_sleep_hours: float | None = None
    training_frequency: str | None = None
    caffeine_habit: str | None = None


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserOut)
async def update_me(
    body: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    updates = body.model_dump(exclude_unset=True)

    # Username uniqueness — Pydantic enforces shape; DB unique handles races,
    # but we pre-check so the user sees a clean 409 instead of a 500.
    new_username = updates.get("username")
    if new_username and new_username != current_user.username:
        if new_username.lower() in RESERVED_USERNAMES:
            raise HTTPException(409, "That username is reserved — pick another")
        existing = await db.execute(
            select(User.id).where(sqlfunc.lower(User.username) == new_username.lower())
        )
        if existing.scalar_one_or_none():
            raise HTTPException(409, "Username already taken")

    for field, value in updates.items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    return current_user


class DeleteAccountRequest(BaseModel):
    """Server-side defense in depth: the UI also gates this on a typed email
    confirmation, but we re-check here so the endpoint can't be called from
    a hostile script bearing a stolen access token. Apple Guideline 5.1.1(v)
    requires in-app deletion to be at least as easy to find as sign-up — but
    nothing says it can't double-check intent."""
    email_confirmation: str


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    body: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete the authenticated user and all their data.

    Apple App Store Review Guideline 5.1.1(v) (in force since June 30, 2022)
    requires any app with account creation to offer in-app account deletion —
    not deactivation, not 'email us'.

    Cascade chain (all enforced at the database level via FK ondelete=CASCADE):

      - daily_summaries, streak, onboarding_baseline
      - hydration_logs, nutrition_logs, stimulant_logs, training_logs
      - body_metrics, ai_insights, push_tokens
      - friendships (as requester OR addressee)
      - sus_votes (as voter OR target)
      - vouches (as voter OR target)
      - custom_exercises, user_splits
      - saved_meals (and saved_meal_items via saved_meal cascade)
      - dismissed_meal_patterns, friend_invites (as inviter)

    Existing access tokens stop working immediately: middleware/auth.py loads
    the user via `db.get(User, user_id)` and returns 401 when it's missing.
    Existing refresh tokens stop working at the next /auth/refresh call,
    where we now also verify the user row still exists (see auth.py).
    """
    if body.email_confirmation.strip().lower() != (current_user.email or "").lower():
        raise HTTPException(
            status_code=400,
            detail="Email confirmation does not match your account email.",
        )

    user_id = current_user.id

    # Single-row DELETE; Postgres handles the rest via FK cascade.
    await db.execute(sa_delete(User).where(User.id == user_id))
    await db.commit()
    return  # 204


@router.get("/username-available")
@limiter.limit("10/minute")
async def username_available(
    request: Request,
    username: str = Query(..., min_length=3, max_length=24),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Tiny endpoint so the UI can debounce-check before submit."""
    if not _USERNAME_RE.match(username):
        return {"available": False, "reason": "format"}
    # Lowercase the comparison since usernames are stored lowercased everywhere.
    handle = username.lower()
    if handle in RESERVED_USERNAMES:
        return {"available": False, "reason": "reserved"}
    if handle == (current_user.username or "").lower():
        return {"available": True}
    result = await db.execute(
        select(User.id).where(sqlfunc.lower(User.username) == handle)
    )
    return {"available": result.scalar_one_or_none() is None}


@router.put("/me/onboarding")
async def save_onboarding_step(
    body: OnboardingStepRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = body.data
    if body.step == "stats":
        current_user.age = data.get("age")
        current_user.height_cm = data.get("height_cm")
        current_user.weight_kg = data.get("weight_kg")
        sex = data.get("sex")
        if sex in ("male", "female"):
            current_user.sex = sex
        if current_user.weight_kg:
            current_user.protein_target_g = round(current_user.weight_kg * 2)
            current_user.water_target_ml = int(current_user.weight_kg * 35)
    elif body.step == "targets":
        current_user.protein_target_g = data.get("protein_target_g", current_user.protein_target_g)
        current_user.water_target_ml = data.get("water_target_ml", current_user.water_target_ml)
        current_user.calorie_target = data.get("calorie_target", current_user.calorie_target)
        sleep_hour = data.get("sleep_hour")
        if sleep_hour is not None:
            current_user.sleep_hour = sleep_hour
    elif body.step == "username":
        new_username = data.get("username")
        if new_username:
            handle = new_username.lower()
            if handle in RESERVED_USERNAMES:
                raise HTTPException(409, "That username is reserved — pick another")
            # Pre-check so the user gets a clean 409 instead of a unique-violation 500.
            existing = await db.execute(
                select(User.id).where(
                    sqlfunc.lower(User.username) == handle,
                    User.id != current_user.id,
                )
            )
            if existing.scalar_one_or_none():
                raise HTTPException(409, "Username already taken")
            current_user.username = new_username
    await db.commit()
    return {"ok": True}


@router.post("/me/baseline")
async def submit_baseline(
    body: BaselineRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field in ("age", "height_cm", "weight_kg"):
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
    db.add(baseline)

    await _seed_estimated_summaries(current_user, body, db)
    await _seed_first_body_metric(current_user, db)

    current_user.onboarding_complete = True
    await db.commit()
    return {"ok": True}


async def _seed_first_body_metric(user: User, db: AsyncSession):
    """Seed the body page with today's weight so it isn't empty for new users."""
    if user.weight_kg is None:
        return
    today = date.today()
    existing = await db.execute(
        select(BodyMetric).where(
            BodyMetric.user_id == user.id,
            BodyMetric.date == today,
            BodyMetric.source == "manual",
        )
    )
    if existing.scalar_one_or_none():
        return
    db.add(
        BodyMetric(
            user_id=user.id,
            date=today,
            weight_kg=user.weight_kg,
            source="manual",
        )
    )


async def _seed_estimated_summaries(user: User, baseline: BaselineRequest, db: AsyncSession):
    """Backfills 7 days of DailySummary rows so the Form Score 14-day baseline
    has data to compare against from day 1.

    HIGH-16 Path A: we no longer seed `sleep_score` because the underlying
    wearable integrations are gone and a baseline guess would mislead the AI
    digest. The rows still seed water/protein/training so the rolling water
    consistency check has a starting point.
    """
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
            trained=trained,
            water_ml=user.water_target_ml or 2000,
            protein_g=user.protein_target_g,
            data_source="baseline_estimate",
            is_estimated=True,
        )
        db.add(summary)