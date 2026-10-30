"""Today's slice of a Pit Crew plan, with progression (docs/ai-plans-design.md §6).

Progression is plain code, no AI: double progression, shared with the
Training tab (services/progression.py). Lifts with no history use the plan's
starting weight. Once an exercise is logged today, "next" is the call for
next time (more weight or one more rep, from what was just lifted), and
"up_next" previews the next training day the same way.

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
from services.exercise_taxonomy import is_per_dumbbell
from services.plan_edit import day_for_date
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
        dumbbell=is_per_dumbbell(ex["key"]),
    )
    return {"weight_kg": t["weight_kg"], "reps": t["reps"], "reason": t["reason"], "kind": t["kind"]}


async def _sessions_by_key(
    user: User, keys: set[str], today: date, db: AsyncSession
) -> dict[str, dict[date, list[TrainingLog]]]:
    """{exercise key: {date: sets}} over the lookback, today included."""
    by_key: dict[str, dict[date, list[TrainingLog]]] = defaultdict(lambda: defaultdict(list))
    if not keys:
        return by_key
    logs = (await db.execute(
        select(TrainingLog)
        .where(
            TrainingLog.user_id == user.id,
            TrainingLog.type.in_(keys),
            TrainingLog.date >= today - LOOKBACK,
        )
        .order_by(TrainingLog.date, TrainingLog.volume_sets)
    )).scalars().all()
    for log in logs:
        by_key[log.type][log.date].append(log)
    return by_key


def _upcoming(plan: dict, today: date) -> tuple[dict, int] | None:
    """The next training day after today, and how many days away."""
    for ahead in range(1, 8):
        day = day_for_date(plan, today + timedelta(days=ahead))
        if day:
            return day, ahead
    return None


def _history(sessions: dict[date, list[TrainingLog]], until: date, include: bool) -> list[list[TrainingLog]]:
    return [sessions[d] for d in sorted(sessions) if d < until or (include and d == until)]


async def todays_targets(user: User, row: AiPlan, today: date, db: AsyncSession) -> tuple[dict, list[dict]] | None:
    """Today's plan day and its exercises with suggestions, for the
    training-day notification (services/smart_notifications.py)."""
    day = day_for_date(row.plan or {}, today)
    if not day:
        return None
    by_key = await _sessions_by_key(user, {e["key"] for e in day["exercises"]}, today, db)
    return day, [
        {**ex, "suggestion": suggest(ex, _history(by_key.get(ex["key"], {}), today, include=False))}
        for ex in day["exercises"]
    ]


async def build_today(user: User, row: AiPlan, db: AsyncSession) -> dict:
    today = user_today(user.timezone)
    weekday = today.weekday()
    plan = row.plan or {}

    day = day_for_date(plan, today)  # after any skip this week
    upcoming = _upcoming(plan, today)
    keys = {e["key"] for d in (day, upcoming[0] if upcoming else None) if d for e in d["exercises"]}
    by_key = await _sessions_by_key(user, keys, today, db)

    workout = None
    if day:
        exercises = []
        for ex in day["exercises"]:
            sessions = by_key.get(ex["key"], {})
            done = sessions.get(today, [])
            past = sorted(d for d in sessions if d < today)
            last = sessions[past[-1]] if past else []
            exercises.append({
                **ex,
                "suggestion": suggest(ex, _history(sessions, today, include=False)),
                # From what was just lifted: more weight or one more rep next time.
                "next": suggest(ex, _history(sessions, today, include=True)) if done else None,
                "last": [{"weight_kg": s.weight_kg, "reps": s.reps} for s in last],
                "last_date": max(past).isoformat() if past else None,
                "logged_today": [{"weight_kg": s.weight_kg, "reps": s.reps} for s in done],
            })
        workout = {**day, "exercises": exercises}

    up_next = None
    if upcoming:
        nday, ahead = upcoming
        up_next = {
            "date": (today + timedelta(days=ahead)).isoformat(),
            "weekday": nday["weekday"],
            "name": nday["name"],
            "in_days": ahead,
            "exercises": [
                {
                    "key": ex["key"],
                    "name": ex["name"],
                    "sets": ex["sets"],
                    "reps_min": ex["reps_min"],
                    "reps_max": ex["reps_max"],
                    "basis": ex.get("basis"),
                    "suggestion": suggest(ex, _history(by_key.get(ex["key"], {}), today, include=True)),
                }
                for ex in nday["exercises"]
            ],
        }

    nutrition = plan.get("nutrition")
    meals, targets = [], None
    if nutrition:
        targets = nutrition["targets"]
        logged = await logged_meals(user, row, today, db)
        meals = [{**m, "logged": m["id"] in logged} for m in todays_meals(row, today)]

    next_day = None
    if not day and upcoming:
        next_day = {"weekday": upcoming[0]["weekday"], "name": upcoming[0]["name"]}

    return {
        "date": today.isoformat(),
        "weekday": weekday,
        "workout": workout,
        "rest_day": day is None,
        "next_workout": next_day,
        "up_next": up_next,
        "meals": meals,
        "targets": targets,
    }


LB_PER_KG = 2.20462


def _lift(kg: float, units: str) -> str:
    return f"{kg * LB_PER_KG:.0f} lb" if units == "imperial" else f"{kg:g} kg"


# Order the training-day notification lists lifts in: news first.
_LINE_ORDER = {"weight": 0, "start": 1, "reps": 2, "bodyweight_harder": 3, "bodyweight_reps": 4, "stall": 5}


def target_lines(exercises: list[dict], units: str, limit: int = 3) -> list[str]:
    """"Bench press ↑ 82.5 kg", "Rows +1 rep at 60 kg": the progression
    call per lift, for a notification. First-time lifts are left out."""
    lines = []
    for ex in sorted(exercises, key=lambda e: _LINE_ORDER.get(e["suggestion"]["kind"], 9)):
        s, name = ex["suggestion"], ex["name"]
        w = s["weight_kg"]
        line = {
            "weight": f"{name} ↑ {_lift(w, units)}" if w else None,
            "start": f"{name} start at {_lift(w, units)}" if w else None,
            "reps": f"{name} +1 rep at {_lift(w, units)}" if w else f"{name} +1 rep",
            "bodyweight_reps": f"{name} +1 rep",
            "bodyweight_harder": f"{name}: make it harder",
            "stall": f"{name}: add a set",
        }.get(s["kind"])
        if line:
            lines.append(line)
    return lines[:limit]


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
