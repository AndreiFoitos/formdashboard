"""Today's slice of a Pit Crew plan, with progression (docs/ai-plans-design.md §6).

Progression is plain code, no AI: double progression, shared with the
Training tab (services/progression.py). Lifts with no history use the plan's
starting weight.

When the chat rescales the rest of a day (adjust_today, after an off-plan
meal), the factors live in plan["today_scale"][date][meal_id] and every
reader goes through todays_meals(), so the card and the logged amounts match.

Meals logged from the plan are tracked on the plan row itself
(plan["logged"][date][meal_id] = nutrition log ids). A meal counts as logged
only while those entries still exist, so deleting them in the Nutrition tab
un-ticks it here.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import user_today
from models.ai_plan import AiPlan
from models.nutrition_log import NutritionLog
from models.training_log import TrainingLog
from models.user import User
from services.progression import next_target

LOOKBACK = timedelta(weeks=8)
KEEP_LOGGED_DAYS = 14


def suggest(ex: dict, sessions: list[list[TrainingLog]]) -> dict:
    """Weight and reps to aim for, and a short reason the app can show.
    Same double progression as the Training tab (services/progression.py),
    with the plan's rep range, set count and 1RM-based starting weight."""
    t = next_target(
        sessions,
        ex["group"],
        rep_range=(ex["reps_min"], ex["reps_max"]),
        planned_sets=ex["sets"],
        start_weight=ex.get("start_weight_kg"),
        bodyweight=ex.get("basis") == "bodyweight",
    )
    return {"weight_kg": t["weight_kg"], "reps": t["reps"], "reason": t["reason"], "kind": t["kind"]}


async def build_today(user: User, row: AiPlan, db: AsyncSession) -> dict:
    today = user_today(user.timezone)
    weekday = today.weekday()
    plan = row.plan or {}

    day = next((d for d in plan.get("training", {}).get("days", []) if d["weekday"] == weekday), None)
    workout = None
    if day:
        keys = [e["key"] for e in day["exercises"]]
        logs = (await db.execute(
            select(TrainingLog)
            .where(
                TrainingLog.user_id == user.id,
                TrainingLog.type.in_(keys),
                TrainingLog.date >= today - LOOKBACK,
            )
            .order_by(TrainingLog.date, TrainingLog.volume_sets)
        )).scalars().all()
        by_key: dict[str, dict[date, list[TrainingLog]]] = defaultdict(lambda: defaultdict(list))
        for log in logs:
            by_key[log.type][log.date].append(log)
        exercises = []
        for ex in day["exercises"]:
            sessions = by_key.get(ex["key"], {})
            done = sessions.get(today, [])
            past = sorted(d for d in sessions if d < today)
            last = sessions[past[-1]] if past else []
            exercises.append({
                **ex,
                "suggestion": suggest(ex, [sessions[d] for d in past]),
                "last": [{"weight_kg": s.weight_kg, "reps": s.reps} for s in last],
                "last_date": max(past).isoformat() if past else None,
                "logged_today": [{"weight_kg": s.weight_kg, "reps": s.reps} for s in done],
            })
        workout = {**day, "exercises": exercises}

    nutrition = plan.get("nutrition")
    meals, targets = [], None
    if nutrition:
        targets = nutrition["targets"]
        logged = await logged_meals(user, row, today, db)
        meals = [{**m, "logged": m["id"] in logged} for m in todays_meals(row, today)]

    next_day = None
    if not day:
        upcoming = sorted(
            plan.get("training", {}).get("days", []),
            key=lambda d: (d["weekday"] - weekday) % 7,
        )
        if upcoming:
            next_day = {"weekday": upcoming[0]["weekday"], "name": upcoming[0]["name"]}

    return {
        "date": today.isoformat(),
        "weekday": weekday,
        "workout": workout,
        "rest_day": day is None,
        "next_workout": next_day,
        "meals": meals,
        "targets": targets,
    }


def _scale_meal(meal: dict, factor: float) -> dict:
    items = []
    for i in meal["items"]:
        f = max(5, round(i["grams"] * factor / 5) * 5) / i["grams"] if i["grams"] else 1
        items.append({
            **i,
            "grams": round(i["grams"] * f),
            "calories": round(i["calories"] * f),
            "protein_g": round(i["protein_g"] * f, 1),
            "carbs_g": round(i["carbs_g"] * f, 1),
            "fat_g": round(i["fat_g"] * f, 1),
        })
    totals = {k: round(sum(i[k] for i in items), 1) for k in ("calories", "protein_g", "carbs_g", "fat_g")}
    totals["calories"] = round(totals["calories"])
    return {**meal, "items": items, "totals": totals, "scaled": factor}


def todays_meals(row: AiPlan, today: date) -> list[dict]:
    """Today's plan meals, with any chat rescale applied."""
    plan = row.plan or {}
    days = (plan.get("nutrition") or {}).get("days", [])
    day = next((d for d in days if d["weekday"] == today.weekday()), None)
    scale = (plan.get("today_scale") or {}).get(today.isoformat()) or {}
    return [
        _scale_meal(m, scale[m["id"]]) if m["id"] in scale else m
        for m in (day or {}).get("meals", [])
    ]


async def logged_meals(user: User, row: AiPlan, today: date, db: AsyncSession) -> set[str]:
    """Plan meal ids logged today whose nutrition entries still exist."""
    entries = ((row.plan or {}).get("logged") or {}).get(today.isoformat()) or {}
    ids = [uuid.UUID(i) for ids in entries.values() for i in ids]
    if not ids:
        return set()
    alive = {
        str(i) for i in (await db.execute(
            select(NutritionLog.id).where(NutritionLog.user_id == user.id, NutritionLog.id.in_(ids))
        )).scalars()
    }
    return {mid for mid, ids in entries.items() if any(i in alive for i in ids)}


def record_logged(row: AiPlan, today: date, meal_id: str, log_ids: list[str] | None) -> None:
    """Remember (or forget, with None) which entries a plan meal created.
    Reassigns row.plan so SQLAlchemy sees the JSONB change."""
    plan = dict(row.plan or {})
    logged = {
        d: v for d, v in (plan.get("logged") or {}).items()
        if date.fromisoformat(d) >= today - timedelta(days=KEEP_LOGGED_DAYS)
    }
    day = dict(logged.get(today.isoformat()) or {})
    if log_ids is None:
        day.pop(meal_id, None)
    else:
        day[meal_id] = log_ids
    logged[today.isoformat()] = day
    plan["logged"] = logged
    row.plan = plan
