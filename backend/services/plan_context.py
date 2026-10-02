"""The data summary every Pit Crew model call starts from.

One compact text block (~1.5-3k tokens) used by Ask today and by plan
generation and the plan chat later (docs/ai-plans-design.md §5). Text, not
JSON: the model reads tables as well as JSON and it costs fewer tokens.

Rules carried over from the old Ask context:
- Rows seeded at onboarding (is_estimated) are skipped. They pin water and
  protein to the targets and would read as perfect adherence.
- Sleep / HRV are not included: no wearable feeds them any more, and nulls
  invite made-up numbers.
"""
from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import user_today
from models.body_metric import BodyMetric
from models.custom_exercise import CustomExercise
from models.daily_summary import DailySummary
from models.nutrition_log import NutritionLog
from models.onboarding import OnboardingBaseline
from models.saved_meal import SavedMeal
from models.training_log import TrainingLog
from models.user import User
from models.user_preference import UserPreference
from models.user_split import UserSplit
from services.exercise_taxonomy import groups_for_exercises
from services.one_rm import estimate as estimate_one_rm

DAILY_DAYS = 14  # newest days listed one per row; older ones as weekly averages
STRENGTH_WEEKS = 8  # 1RM window, compared with the 8 weeks before it
MAX_LIFTS = 12
MAX_FOODS = 15
MAX_SAVED_MEALS = 10
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MEAL_CLASSIFICATION = {"breakfast", "lunch", "dinner", "snack"}


def _num(v, digits: int = 0) -> str:
    if v is None:
        return "-"
    return f"{v:.{digits}f}" if digits else str(round(v))


def _avg(values) -> float | None:
    nums = [v for v in values if v is not None]
    return sum(nums) / len(nums) if nums else None


def _slope_per_week(points: list[tuple[date, float]]) -> float | None:
    """Least-squares kg/week. Needs 3+ weigh-ins over at least a week, or a
    single noisy weigh-in would read as a trend."""
    if len(points) < 3 or (points[-1][0] - points[0][0]).days < 7:
        return None
    xs = [(d - points[0][0]).days for d, _ in points]
    ys = [w for _, w in points]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    var = sum((x - mx) ** 2 for x in xs)
    if var == 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var * 7


async def _exercise_names(keys: set[str], db: AsyncSession) -> dict[str, str]:
    names = {k: k.replace("_", " ").title() for k in keys if not k.startswith("custom_")}
    ids = []
    for k in keys:
        if k.startswith("custom_"):
            try:
                ids.append(uuid.UUID(k.split("custom_", 1)[1]))
            except ValueError:
                pass
    if ids:
        rows = await db.execute(select(CustomExercise).where(CustomExercise.id.in_(ids)))
        for ex in rows.scalars():
            names[f"custom_{ex.id}"] = ex.name
    return names


def _profile(user: User, prefs: UserPreference | None, freq: str | None) -> list[str]:
    lines = [
        "## Profile",
        f"sex {user.sex or '-'}, age {user.age or '-'}, height {_num(user.height_cm)} cm",
        f"goal: {(prefs.goal if prefs else None) or 'not set'}",
        f"targets: {_num(user.calorie_target)} kcal, protein {_num(user.protein_target_g)} g, "
        f"water {_num(user.water_target_ml)} ml, bedtime {user.sleep_hour}:00",
        f"training frequency (self-reported at signup): {freq or '-'}",
    ]
    if prefs is None:
        return lines
    extras = [
        ("equipment", prefs.equipment),
        ("experience", prefs.experience),
        ("session length", f"{prefs.session_minutes} min" if prefs.session_minutes else None),
        ("training days/week", prefs.training_days),
        ("injuries", ", ".join(prefs.injuries) if prefs.injuries else None),
        ("diet", prefs.diet_style),
        ("allergies (never suggest)", ", ".join(prefs.allergies) if prefs.allergies else None),
        ("dislikes", ", ".join(prefs.dislikes) if prefs.dislikes else None),
        ("cooking", prefs.cooking),
        ("health conditions", ", ".join(prefs.health_flags) if prefs.health_flags else None),
        ("notes", "; ".join(prefs.notes) if prefs.notes else None),
    ]
    lines += [f"{k}: {v}" for k, v in extras if v]
    return lines


async def _body(user: User, today: date, db: AsyncSession) -> list[str]:
    rows = (await db.execute(
        select(BodyMetric)
        .where(BodyMetric.user_id == user.id, BodyMetric.date >= today - timedelta(days=90))
        .order_by(BodyMetric.date)
    )).scalars().all()
    weights = [(r.date, r.weight_kg) for r in rows if r.weight_kg]
    lines = ["## Body"]
    if weights:
        lines.append(f"latest weight {weights[-1][1]:.1f} kg on {weights[-1][0]}")
        recent = [p for p in weights if p[0] >= today - timedelta(days=28)]
        slope = _slope_per_week(recent)
        if slope is not None:
            lines.append(f"weight trend, last 28 days: {slope:+.2f} kg/week ({len(recent)} weigh-ins)")
        else:
            lines.append("weight trend: not enough weigh-ins in the last 28 days")
    else:
        lines.append(f"weight {_num(user.weight_kg, 1)} kg (signup value, no weigh-ins logged)")
    bf = [r for r in rows if r.body_fat_pct]
    if bf:
        first, last = bf[0], bf[-1]
        line = f"body fat {last.body_fat_pct:.1f}% on {last.date} ({last.source or 'logged'})"
        if first is not last:
            line += f", was {first.body_fat_pct:.1f}% on {first.date}"
        lines.append(line)
    return lines


def _days(rows: list[DailySummary], today: date, days: int, names: dict[str, str]) -> list[str]:
    real = {r.date: r for r in rows if not r.is_estimated}
    lines = [
        f"## Daily log, last {DAILY_DAYS} days",
        "date | kcal | protein g | carbs g | fat g | water ml | caffeine mg | trained | form score",
    ]
    for i in range(DAILY_DAYS - 1, -1, -1):
        d = today - timedelta(days=i)
        r = real.get(d)
        label = f"{d} {WEEKDAYS[d.weekday()]}" + (" (today, so far)" if d == today else "")
        if r is None:
            lines.append(f"{label} | nothing logged")
            continue
        # training_type is the day's first exercise key ("bench_press").
        trained = names.get(r.training_type, r.training_type or "yes") if r.trained else "no"
        lines.append(
            f"{label} | {_num(r.calories_eaten)} | {_num(r.protein_g)} | {_num(r.carbs_g)} | "
            f"{_num(r.fat_g)} | {_num(r.water_ml)} | {_num(r.caffeine_mg)} | {trained} | {_num(r.form_score)}"
        )

    older = [r for d, r in real.items() if d < today - timedelta(days=DAILY_DAYS - 1)]
    if days > DAILY_DAYS and older:
        weeks: dict[date, list[DailySummary]] = defaultdict(list)
        for r in older:
            weeks[r.date - timedelta(days=r.date.weekday())].append(r)
        lines += [
            "",
            f"## Weekly averages before that (back to {days} days ago, logged days only)",
            "week of | days logged | kcal | protein g | training days | form score",
        ]
        for wk in sorted(weeks):
            ws = weeks[wk]
            lines.append(
                f"{wk} | {len(ws)} | {_num(_avg(r.calories_eaten for r in ws))} | "
                f"{_num(_avg(r.protein_g for r in ws))} | {sum(1 for r in ws if r.trained)} | "
                f"{_num(_avg(r.form_score for r in ws))}"
            )
    return lines


async def _strength(user: User, today: date, db: AsyncSession) -> list[str]:
    span = timedelta(weeks=STRENGTH_WEEKS)
    logs = (await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == user.id,
            TrainingLog.date >= today - 2 * span,
            TrainingLog.weight_kg.is_not(None),
            TrainingLog.reps.is_not(None),
        )
    )).scalars().all()
    if not logs:
        return ["## Strength", "no weighted sets logged in the last 16 weeks"]

    best_now: dict[str, tuple[float, TrainingLog]] = {}
    best_before: dict[str, float] = {}
    sets_now: Counter[str] = Counter()
    week_sets: Counter[str] = Counter()
    for log in logs:
        if log.weight_kg <= 0 or log.reps <= 0:
            continue
        est = estimate_one_rm(float(log.weight_kg), int(log.reps))["mean"]
        if est is None:
            continue
        if log.date >= today - span:
            sets_now[log.type] += 1
            if log.date > today - timedelta(days=7):
                week_sets[log.type] += 1
            if log.type not in best_now or est > best_now[log.type][0]:
                best_now[log.type] = (est, log)
        elif est > best_before.get(log.type, 0):
            best_before[log.type] = est

    top = [k for k, _ in sets_now.most_common(MAX_LIFTS)]
    names = await _exercise_names(set(top) | set(week_sets), db)
    lines = [
        f"## Strength: best estimated 1RM, last {STRENGTH_WEEKS} weeks vs the {STRENGTH_WEEKS} before",
        "exercise | est 1RM kg | from set | previous est 1RM kg | sets logged",
    ]
    for k in top:
        est, log = best_now[k]
        prev = best_before.get(k)
        lines.append(
            f"{names.get(k, k)} | {est:.1f} | {float(log.weight_kg):g} kg x {log.reps} on {log.date} | "
            f"{f'{prev:.1f}' if prev else '-'} | {sets_now[k]}"
        )

    if week_sets:
        groups = await groups_for_exercises(list(week_sets), db)
        by_group: Counter[str] = Counter()
        for k, n in week_sets.items():
            by_group[groups.get(k, "Other")] += n
        lines += ["", "working sets in the last 7 days by muscle group: " + ", ".join(
            f"{g} {n}" for g, n in by_group.most_common()
        )]
    return lines


async def _split(user: User, db: AsyncSession) -> list[str]:
    rows = (await db.execute(
        select(UserSplit).where(UserSplit.user_id == user.id).order_by(UserSplit.weekday)
    )).scalars().all()
    rows = [r for r in rows if r.confidence >= 0.5]
    if not rows:
        return []
    return ["## Usual weekly split (detected from the last 28 days)", ", ".join(
        f"{WEEKDAYS[r.weekday]} {r.group_name}" for r in rows
    )]


async def _foods(user: User, today: date, db: AsyncSession) -> list[str]:
    rows = (await db.execute(
        select(NutritionLog.meal_name, func.count(NutritionLog.id))
        .where(
            NutritionLog.user_id == user.id,
            NutritionLog.date >= today - timedelta(days=30),
            NutritionLog.meal_name.is_not(None),
            NutritionLog.meal_name != "",
        )
        .group_by(NutritionLog.meal_name)
        .order_by(func.count(NutritionLog.id).desc())
        .limit(MAX_FOODS * 2)
    )).all()
    foods = [f"{name} ({n}x)" for name, n in rows if name.strip().lower() not in MEAL_CLASSIFICATION]
    meal_names = (await db.execute(
        select(SavedMeal.name)
        .where(SavedMeal.user_id == user.id)
        .order_by(SavedMeal.updated_at.desc())
        .limit(MAX_SAVED_MEALS * 2)
    )).scalars().all()
    meals = list(dict.fromkeys(meal_names))[:MAX_SAVED_MEALS]
    lines = []
    if foods:
        lines += ["## Most logged foods, last 30 days", ", ".join(foods[:MAX_FOODS])]
    if meals:
        lines += ["", "## Saved meals", ", ".join(meals)] if lines else ["## Saved meals", ", ".join(meals)]
    return lines


async def build_context(user: User, db: AsyncSession, days: int = 30) -> str:
    """`days` is the plan's look-back (30 / 90 / 365, services/plans.py).
    The newest 14 days are always listed in full; the rest of the window is
    weekly averages, so a year of history stays a few hundred tokens."""
    today = user_today(user.timezone)
    prefs = await db.get(UserPreference, user.id)
    freq = (await db.execute(
        select(OnboardingBaseline.training_frequency).where(OnboardingBaseline.user_id == user.id)
    )).scalar_one_or_none()
    summaries = (await db.execute(
        select(DailySummary)
        .where(DailySummary.user_id == user.id, DailySummary.date >= today - timedelta(days=days))
        .order_by(DailySummary.date)
    )).scalars().all()

    names = await _exercise_names({r.training_type for r in summaries if r.training_type}, db)
    sections = [
        [f"Today is {today} ({WEEKDAYS[today.weekday()]}) in the user's timezone."],
        _profile(user, prefs, freq),
        await _body(user, today, db),
        _days(list(summaries), today, days, names),
        await _strength(user, today, db),
        await _split(user, db),
        await _foods(user, today, db),
    ]
    return "\n\n".join("\n".join(s) for s in sections if s)
