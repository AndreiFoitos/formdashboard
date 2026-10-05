"""Pit Crew weekly check-in.

Sunday evening (6 pm user-local, scheduler) or on first open of the Pit tab
from Sunday to Tuesday (if the server slept through Sunday), we review the
week of the current plan:

- code computes the numbers: planned sessions done, exercises skipped, lifts
  that went up, plan meals logged, average intake vs target, weight trend;
- Claude writes a 2-3 sentence review and up to two suggestions (new calorie
  target, swap an exercise, or build a fresh plan);
- applying a suggestion goes through the chat's tool code (services/
  plan_chat.Turn), so the same safety limits hold.

Free on every plan: one ~$0.01 call a week per user with a plan.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal
from core.timezone import resolve_tz, user_now, user_today
from models.ai_checkin import AiCheckin
from models.ai_plan import AiPlan
from models.body_metric import BodyMetric
from models.daily_summary import DailySummary
from models.training_log import TrainingLog
from models.user import User
from models.user_preference import UserPreference
from services.ai_client import AINotConfigured, call_claude_json
from services.plan_builder import allowed_exercises, meal_plan_allowed
from services.plan_chat import ToolError, Turn, _plan_summary
from services.plan_context import _slope_per_week
from services.push import send_to_user

log = logging.getLogger(__name__)

SEND_HOUR = 18  # local time on Sunday
MIN_PLAN_DAYS = 3  # a plan younger than this in the week isn't worth reviewing


def week_to_review(today: date) -> tuple[date, date] | None:
    """Sunday reviews the week ending today; Monday and Tuesday still offer
    the week just finished (late openers, or a server that slept)."""
    back = {6: 0, 0: 1, 1: 2}.get(today.weekday())
    if back is None:
        return None
    end = today - timedelta(days=back)
    return end - timedelta(days=6), end


async def _ready_plan(user_id: uuid.UUID, db: AsyncSession) -> AiPlan | None:
    return (await db.execute(
        select(AiPlan)
        .where(AiPlan.user_id == user_id, AiPlan.status == "ready")
        .order_by(AiPlan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()


async def compute_stats(user: User, row: AiPlan, start: date, end: date, db: AsyncSession) -> dict:
    tz = resolve_tz(user.timezone)
    plan = row.plan or {}
    first_day = max(start, row.created_at.astimezone(tz).date())
    dates = [first_day + timedelta(days=i) for i in range((end - first_day).days + 1)]
    tdays = {d["weekday"]: d for d in plan.get("training", {}).get("days", [])}
    planned = [d for d in dates if d.weekday() in tdays]

    logs = (await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == user.id,
            TrainingLog.date >= start - timedelta(weeks=4),
            TrainingLog.date <= end,
        )
    )).scalars().all()
    by_date: dict[date, set[str]] = defaultdict(set)
    top_now: dict[str, float] = {}
    top_before: dict[str, float] = {}
    for lg in logs:
        if lg.date >= first_day:
            by_date[lg.date].add(lg.type)
        if lg.weight_kg:
            bucket = top_now if lg.date >= start else top_before
            bucket[lg.type] = max(bucket.get(lg.type, 0), float(lg.weight_kg))

    done = [d for d in planned if by_date.get(d)]
    # Skipped = not logged in any session they did that included it (2+).
    skipped: dict[str, int] = defaultdict(int)
    included: dict[str, int] = defaultdict(int)
    for d in done:
        for ex in tdays[d.weekday()]["exercises"]:
            included[ex["key"]] += 1
            if ex["key"] not in by_date[d]:
                skipped[ex["key"]] += 1
    always_skipped = {k: v for k, v in skipped.items() if v == included[k] and v >= 2}
    names = {ex["key"]: ex["name"] for d in tdays.values() for ex in d["exercises"]}
    progressed = sorted(names[k] for k in names if k in top_now and k in top_before and top_now[k] > top_before[k])

    meals_planned = meals_logged = 0
    n = plan.get("nutrition")
    if n:
        ndays = {d["weekday"]: d for d in n["days"]}
        logged = plan.get("logged") or {}
        for d in dates:
            meals_planned += len((ndays.get(d.weekday()) or {}).get("meals", []))
            meals_logged += len(logged.get(d.isoformat()) or {})

    rows = (await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == user.id,
            DailySummary.date >= start,
            DailySummary.date <= end,
            DailySummary.is_estimated.is_(False),
        )
    )).scalars().all()
    eaten = [r for r in rows if r.calories_eaten and r.calories_eaten > 300]
    weights = [
        (r.date, r.weight_kg)
        for r in (await db.execute(
            select(BodyMetric)
            .where(BodyMetric.user_id == user.id, BodyMetric.date >= end - timedelta(days=21), BodyMetric.date <= end)
            .order_by(BodyMetric.date)
        )).scalars()
        if r.weight_kg
    ]
    slope = _slope_per_week(weights)
    prefs = await db.get(UserPreference, user.id)
    targets = (n or {}).get("targets") or {"kcal": user.calorie_target, "protein_g": user.protein_target_g}

    return {
        "week": [start.isoformat(), end.isoformat()],
        "plan_age_days": (end - row.created_at.astimezone(tz).date()).days + 1,
        "sessions_planned": len(planned),
        "sessions_done": len(done),
        "extra_sessions": len([d for d in by_date if d not in planned]),
        "skipped_exercises": {names[k]: v for k, v in always_skipped.items()},
        "lifts_up": progressed,
        "meals_planned": meals_planned,
        "meals_logged": meals_logged,
        "days_food_logged": len(eaten),
        "avg_kcal": round(sum(r.calories_eaten for r in eaten) / len(eaten)) if eaten else None,
        "avg_protein_g": round(sum(r.protein_g or 0 for r in eaten) / len(eaten)) if eaten else None,
        "target_kcal": targets.get("kcal"),
        "target_protein_g": targets.get("protein_g"),
        "weight_kg": weights[-1][1] if weights else None,
        "weight_trend_kg_per_week": round(slope, 2) if slope is not None else None,
        "weigh_ins_21d": len(weights),
        "goal": prefs.goal if prefs else None,
        "meal_plan": bool(n),
        "skipped_keys": always_skipped,
    }


CHECKIN_SYSTEM = """You are Pit Crew, the planner in the GainRace app. Write the user's weekly check-in from the numbers given.

review: 2-3 plain sentences to the user. Start with what went well, then the one thing that matters most for next week. Cite their numbers. If almost nothing was logged, say so kindly and ask them to log next week. No markdown, no cheerleading, no medical claims.

suggestions: 0-2 concrete changes, only when the numbers clearly support one. Otherwise return none.
- calories: a new daily calorie target, only when the weight trend (3+ weigh-ins) disagrees with the goal: cutting but not losing, bulking but not gaining, or losing faster than about 1% of bodyweight a week. Move 100-250 kcal. Only when meal_plan is true.
- swap_exercise: an exercise they skipped in every session they did (skipped_keys). Pick a replacement for the same muscle from the allowed list.
- rebuild: they did under half the planned sessions, or the plan is 28+ days old.
title: 6 words or fewer. detail: one sentence saying why. Unused fields are null."""


def _schema(exercise_keys: list[str]) -> dict:
    def nullable(schema: dict) -> dict:
        return {"anyOf": [schema, {"type": "null"}]}
    suggestion = {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["calories", "swap_exercise", "rebuild"]},
            "title": {"type": "string"},
            "detail": {"type": "string"},
            "calories": nullable({"type": "integer"}),
            "current_key": nullable({"type": "string"}),
            "new_key": nullable({"type": "string", "enum": exercise_keys}),
        },
        "required": ["kind", "title", "detail", "calories", "current_key", "new_key"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {"review": {"type": "string"}, "suggestions": {"type": "array", "items": suggestion}},
        "required": ["review", "suggestions"],
        "additionalProperties": False,
    }


def _clean(raw: list[dict], stats: dict, row: AiPlan, allowed: set[str], calories_ok: bool) -> list[dict]:
    plan_keys = {e["key"] for d in (row.plan or {}).get("training", {}).get("days", []) for e in d["exercises"]}
    out = []
    for s in raw:
        args: dict = {}
        if s["kind"] == "calories":
            if not calories_ok or not s.get("calories"):
                continue
            args["calories"] = int(s["calories"])
        elif s["kind"] == "swap_exercise":
            if s.get("current_key") not in plan_keys or s.get("new_key") not in allowed:
                continue
            args = {"current_key": s["current_key"], "new_key": s["new_key"]}
        out.append({
            "id": f"s{len(out) + 1}", "kind": s["kind"], "title": s["title"].strip(),
            "detail": s["detail"].strip(), "args": args, "status": "pending", "result": None,
        })
        if len(out) == 2:
            break
    return out


async def generate(user: User, db: AsyncSession, today: date | None = None) -> AiCheckin | None:
    """Create this week's check-in if it's due and missing. Returns it (new
    or existing) or None when there's nothing to review."""
    today = today or user_today(user.timezone)
    window = week_to_review(today)
    if window is None:
        return None
    start, end = window
    existing = (await db.execute(
        select(AiCheckin).where(AiCheckin.user_id == user.id, AiCheckin.week_start == start)
    )).scalar_one_or_none()
    if existing:
        return existing
    row = await _ready_plan(user.id, db)
    if row is None:
        return None
    stats = await compute_stats(user, row, start, end, db)
    if stats["plan_age_days"] < MIN_PLAN_DAYS:
        return None

    prefs = await db.get(UserPreference, user.id)
    allowed = await allowed_exercises(user, prefs, db)
    lines = [f"- {k}: {v}" for k, v in stats.items()]
    content = (
        f"Week {start} to {end}, user-local. Numbers:\n" + "\n".join(lines)
        + "\n\n" + _plan_summary(row, today)
    )
    data, _ = await call_claude_json(
        CHECKIN_SYSTEM, [{"role": "user", "content": content}], _schema(sorted(allowed)),
        max_tokens=4000, effort="medium",
    )
    checkin = AiCheckin(
        user_id=user.id, plan_id=row.id, week_start=start, stats=stats,
        review=data["review"].strip(),
        suggestions=_clean(data["suggestions"], stats, row, set(allowed), meal_plan_allowed(user, prefs)),
        status="new",
    )
    db.add(checkin)
    try:
        await db.commit()
    except IntegrityError:  # generated concurrently (scheduler + app open)
        await db.rollback()
        return (await db.execute(
            select(AiCheckin).where(AiCheckin.user_id == user.id, AiCheckin.week_start == start)
        )).scalar_one_or_none()
    return checkin


async def apply_suggestion(user: User, checkin: AiCheckin, sid: str, db: AsyncSession) -> dict:
    suggestions = [dict(s) for s in checkin.suggestions]
    s = next((x for x in suggestions if x["id"] == sid), None)
    if s is None:
        raise ToolError("Unknown suggestion.")
    if s["status"] != "pending":
        raise ToolError("Already handled.")
    if s["kind"] == "rebuild":
        result = "rebuild"  # the app starts the build through the normal quota-checked button
    else:
        row = await _ready_plan(user.id, db)
        prefs = await db.get(UserPreference, user.id)
        turn = Turn(user, db, row, prefs)
        if s["kind"] == "calories":
            await turn.change_targets(s["args"]["calories"], None)
        else:
            await turn.swap_exercise(s["args"]["current_key"], s["args"]["new_key"], "all")
        result = turn.actions[-1]["summary"]
    s["status"], s["result"] = "applied", result
    checkin.suggestions = suggestions
    await db.commit()
    return s


# ─── Scheduler ────────────────────────────────────────────────────────────────

async def _one(user_id: uuid.UUID, sem: asyncio.Semaphore) -> None:
    async with sem:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None:
                return
            now = user_now(user.timezone)
            if now.weekday() != 6 or now.hour < SEND_HOUR:
                return
            try:
                before = (await db.execute(
                    select(AiCheckin.id).where(
                        AiCheckin.user_id == user.id, AiCheckin.week_start == now.date() - timedelta(days=6)
                    )
                )).first()
                if before:
                    return
                checkin = await generate(user, db)
            except AINotConfigured:
                return
            except Exception as e:  # noqa: BLE001
                log.warning("weekly check-in failed for %s: %s", user_id, e)
                return
            if checkin is not None:
                try:
                    await send_to_user(
                        user.id, db,
                        title="Your weekly check-in",
                        body="How your week went, and what to change for the next one.",
                        data={"type": "checkin_ready", "checkin_id": str(checkin.id)},
                    )
                except Exception:  # noqa: BLE001
                    log.warning("check-in push failed for %s", user_id)


async def dispatch_weekly_checkins() -> None:
    """Hourly. Users whose local time just passed Sunday 6 pm get their
    check-in and a push. Re-runs are no-ops thanks to the unique week row."""
    async with AsyncSessionLocal() as db:
        user_ids = (await db.execute(
            select(AiPlan.user_id).where(AiPlan.status == "ready").distinct()
        )).scalars().all()
    sem = asyncio.Semaphore(3)
    await asyncio.gather(*(_one(uid, sem) for uid in user_ids))
