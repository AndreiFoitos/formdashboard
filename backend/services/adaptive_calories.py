"""Weekly calorie suggestions.

Once a week (from the user-local Monday, worked out the first time the app
asks), the burn estimate in services/energy.py is compared with the user's
calorie target. When the target for their goal and pace is 75+ kcal away,
the app offers the new number with a plain reason; nothing changes until
the user accepts. Typing their own target (Settings or the Pit Crew chat)
turns the suggestions off; a switch in Settings turns them back on.

Moves are capped at 300 kcal a week so noisy weeks can't swing the target,
except when the current target is outside the safety limits: then the
suggestion goes straight back inside them. A dismissed number isn't offered
again until the data moves it by MIN_CHANGE.

Accepting goes through the chat's change_targets tool code, so the meal plan
rescales and the same §8 limits hold.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import resolve_tz, user_today
from models.ai_plan import AiPlan
from models.calorie_update import CalorieUpdate
from models.user import User
from models.user_preference import UserPreference
from services.energy import Estimate, estimate_for
from services.plan_builder import meal_plan_allowed
from services.plan_chat import ToolError, Turn

MIN_CHANGE = 75
MAX_STEP = 300
MIN_ACCOUNT_DAYS = 7  # the onboarding target gets a week before it's second-guessed

LB_PER_KG = 2.20462


def week_start(today: date) -> date:
    return today - timedelta(days=today.weekday())


def is_on(user: User, prefs: UserPreference | None) -> bool:
    return bool(prefs and prefs.goal and prefs.adaptive_calories and meal_plan_allowed(user, prefs))


def _kg(v: float, units: str) -> str:
    if units == "imperial":
        return f"{abs(v) * LB_PER_KG:.1f} lb"
    return f"{abs(v):.1f} kg"


def _n(v: float) -> str:
    """To the nearest 10: these are estimates, not measurements."""
    return f"{round(v / 10) * 10:,}"


def explain(est: Estimate, new_kcal: int, full_kcal: int, units: str) -> str:
    """One or two plain sentences: what the burn is based on, then what the
    goal and pace need. Shown on the suggestion card."""
    parts = []
    if est.measured_tdee is not None and est.confidence >= 0.5:
        trend = est.weight_trend_kg_week or 0
        moved = (
            "held steady" if abs(trend) < 0.1
            else f"went {'down' if trend < 0 else 'up'} {_kg(trend, units)} a week"
        )
        parts.append(
            f"You've eaten about {_n(est.avg_intake)} kcal a day on {est.logged_days} logged days and your "
            f"weight {moved}, so you burn about {_n(est.tdee)} kcal a day."
        )
    else:
        bits = [f"{_kg(est.weight_kg, units)}" if est.weight_kg else None,
                f"{est.body_fat_pct:.0f}% body fat" if est.body_fat_pct is not None else None,
                f"{est.training_days} training days a week"]
        parts.append(f"At {', '.join(b for b in bits if b)}, you burn about {_n(est.tdee)} kcal a day.")
    if est.goal == "maintain" or not est.rate_kg_week:
        parts.append(f"To hold your weight, eat about {_n(full_kcal)}.")
    else:
        verb = "lose" if est.rate_kg_week < 0 else "gain"
        parts.append(f"To {verb} about {_kg(est.rate_kg_week, units)} a week, eat about {_n(full_kcal)}.")
    if new_kcal != full_kcal:
        parts.append(f"It moves at most {MAX_STEP} kcal a week, so this is a step towards it.")
    if est.measured_tdee is None or est.confidence < 0.5:
        parts.append("Log your food and weigh in a few times a week and this gets more accurate.")
    return " ".join(parts)


def propose(current: int | None, est: Estimate) -> tuple[int | None, int | None]:
    """(suggested, full target) or (None, full) when no change is worth it."""
    full = est.target_kcal
    if full is None:
        return None, None
    if current is None:
        return full, full
    diff = full - current
    if abs(diff) < MIN_CHANGE:
        return None, full
    outside = (est.floor and current < est.floor) or (est.ceiling and current > est.ceiling)
    if not outside:
        diff = max(-MAX_STEP, min(MAX_STEP, diff))
    return int(round((current + diff) / 10) * 10), full


async def _said_no(user: User, full: int | None, db: AsyncSession) -> bool:
    """A dismissed number isn't offered again until the data moves it: the
    last dismissal on this same target aimed within MIN_CHANGE of `full`."""
    last = (await db.execute(
        select(CalorieUpdate)
        .where(CalorieUpdate.user_id == user.id, CalorieUpdate.status == "dismissed")
        .order_by(CalorieUpdate.week_start.desc())
        .limit(1)
    )).scalar_one_or_none()
    if last is None or full is None or last.old_kcal != user.calorie_target:
        return False
    aimed = (last.details or {}).get("target_kcal")
    return aimed is not None and abs(full - aimed) < MIN_CHANGE


async def weekly(user: User, db: AsyncSession, today: date | None = None) -> CalorieUpdate | None:
    """This week's check, run and saved the first time it's asked for.
    Returns None while suggestions are off or the account is too new."""
    prefs = await db.get(UserPreference, user.id)
    if not is_on(user, prefs):
        return None
    today = today or user_today(user.timezone)
    start = week_start(today)
    existing = (await db.execute(
        select(CalorieUpdate).where(CalorieUpdate.user_id == user.id, CalorieUpdate.week_start == start)
    )).scalar_one_or_none()
    if existing:
        return existing
    if user.created_at and (today - user.created_at.astimezone(resolve_tz(user.timezone)).date()).days < MIN_ACCOUNT_DAYS:
        return None

    est = await estimate_for(user, prefs, today, db)
    new, full = propose(user.calorie_target, est)
    if new is not None and await _said_no(user, full, db):
        new = None
    row = CalorieUpdate(
        user_id=user.id, week_start=start, old_kcal=user.calorie_target, details=est.to_dict(),
        new_kcal=new, status="pending" if new is not None else "none",
        reason=explain(est, new, full, user.units) if new is not None else "",
    )
    # Last week's unanswered suggestion is out of date now.
    await db.execute(
        update(CalorieUpdate)
        .where(CalorieUpdate.user_id == user.id, CalorieUpdate.status == "pending", CalorieUpdate.week_start < start)
        .values(status="expired")
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:  # two requests raced to create it
        await db.rollback()
        await db.refresh(user)  # the rollback expired it; callers read it next
        return (await db.execute(
            select(CalorieUpdate).where(CalorieUpdate.user_id == user.id, CalorieUpdate.week_start == start)
        )).scalar_one_or_none()
    return row


async def _set_target(user: User, kcal: int, db: AsyncSession) -> None:
    row = (await db.execute(
        select(AiPlan)
        .where(AiPlan.user_id == user.id, AiPlan.status == "ready")
        .order_by(AiPlan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    prefs = await db.get(UserPreference, user.id)
    await Turn(user, db, row, prefs).change_targets(kcal, None, manual=False)


async def accept(user: User, row: CalorieUpdate, db: AsyncSession) -> None:
    if row.status != "pending" or row.new_kcal is None:
        raise ToolError("This suggestion was already handled.")
    await _set_target(user, row.new_kcal, db)
    row.status, row.decided_at = "accepted", datetime.now(timezone.utc)
    await db.commit()


async def dismiss(row: CalorieUpdate, db: AsyncSession) -> None:
    if row.status != "pending":
        raise ToolError("This suggestion was already handled.")
    row.status, row.decided_at = "dismissed", datetime.now(timezone.utc)
    await db.commit()


async def undo(user: User, row: CalorieUpdate, db: AsyncSession) -> None:
    """Put the old target back and offer the suggestion again."""
    if row.status != "accepted" or row.old_kcal is None:
        raise ToolError("Nothing to undo.")
    if user.calorie_target != row.new_kcal:
        raise ToolError("Your target has changed since, so this can't be undone.")
    await _set_target(user, row.old_kcal, db)
    row.status, row.decided_at = "pending", None
    await db.commit()


def out(row: CalorieUpdate) -> dict:
    return {
        "id": str(row.id),
        "week_start": row.week_start.isoformat(),
        "old_kcal": row.old_kcal,
        "new_kcal": row.new_kcal,
        "status": row.status,
        "reason": row.reason,
    }
