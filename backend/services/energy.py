"""Daily energy burn and the calorie target that follows from it.

One estimate for every place a calorie number is worked out: the weekly
calorie suggestions (services/adaptive_calories.py), plan builds
(plan_builder.compute_targets), the Pit Crew context and Settings.

Daily burn (TDEE) comes from two places:
- a formula: BMR times an activity factor for training days a week. BMR is
  Katch-McArdle from lean mass when there's a body-fat reading from the last
  90 days, otherwise Mifflin-St Jeor;
- the logs: average intake minus what the weight trend says was stored or
  burned (7,700 kcal per kg), over the last 28 days.
They're blended by how much data backs the measured number: it counts fully
after 21 logged days across a 21-day weigh-in span, and not at all below 10
logged days, 4 weigh-ins or a 14-day span. The target is that burn plus the
goal's pace (a share of bodyweight a week), inside the §8 safety limits.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.body_metric import BodyMetric
from models.daily_summary import DailySummary
from models.onboarding import OnboardingBaseline
from models.training_log import TrainingLog
from models.user import User
from models.user_preference import UserPreference

KCAL_PER_KG = 7700
WINDOW_DAYS = 28
BF_MAX_AGE_DAYS = 90
MIN_LOGGED_DAYS = 10
MIN_WEIGH_INS = 4
MIN_SPAN_DAYS = 14
FULL_TRUST_DAYS = 21
MIN_DAY_KCAL = 800  # a day under this is taken as not fully logged

ACTIVITY = [(1, 1.2), (3, 1.375), (5, 1.55), (7, 1.725)]  # max days/week -> factor
FREQ_DAYS = {"0-1x": 2, "2-3x": 3, "4-5x": 4, "6x+": 5}

PACES = ("slow", "steady", "fast")
# Share of bodyweight to lose (cut) or gain (bulk) a week. Mirrored in the
# app's lib/targets.ts for onboarding, before there's any data.
PACE_RATES = {
    "cut": {"slow": 0.0025, "steady": 0.005, "fast": 0.0075},
    "bulk": {"slow": 0.001, "steady": 0.0025, "fast": 0.004},
}
# Below this body fat a fast cut is held to steady pace, to protect muscle.
LEAN_BF = {"male": 12.0, "female": 20.0}


def training_days(prefs: UserPreference | None, freq: str | None) -> int:
    if prefs and prefs.training_days:
        return prefs.training_days
    return FREQ_DAYS.get(freq or "", 3)


def activity_factor(days: int) -> float:
    return next(f for d, f in ACTIVITY if days <= d)


def slope_per_week(points: list[tuple[date, float]]) -> float | None:
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


def safety_limits(sex: str | None, bmr: float | None, tdee: float | None) -> tuple[float, float | None]:
    """§8: never below a sex-based minimum, BMR or a 25% deficit; never more
    than 500 kcal over maintenance."""
    floor = 1500.0 if sex == "male" else 1200.0
    if bmr:
        floor = max(floor, bmr)
    if tdee:
        floor = max(floor, 0.75 * tdee)
    return floor, (tdee + 500 if tdee else None)


@dataclass
class EnergyInputs:
    sex: str | None
    age: int | None
    height_cm: float | None
    weight_kg: float | None  # latest weigh-in, else the profile value
    weights: list[tuple[date, float]]  # weigh-ins in the window, oldest first
    body_fat: tuple[date, float] | None  # latest reading
    intake: list[tuple[date, int]]  # logged calories per day, today excluded
    training_days: int
    goal: str | None
    pace: str | None
    today: date


@dataclass
class Estimate:
    weight_kg: float | None
    bmr: int | None
    bmr_method: str | None  # "katch" (lean mass) / "mifflin"
    body_fat_pct: float | None
    training_days: int
    formula_tdee: int | None
    measured_tdee: int | None
    # 0-1: how much the measured burn counts in tdee.
    confidence: float
    tdee: int | None
    avg_intake: int | None
    logged_days: int
    weigh_ins: int
    weight_trend_kg_week: float | None
    goal: str | None
    pace: str
    rate_kg_week: float  # negative for a cut
    target_kcal: int | None
    floor: int | None
    ceiling: int | None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _round10(v: float) -> int:
    return int(round(v / 10) * 10)


def estimate(i: EnergyInputs) -> Estimate:
    notes: list[str] = []
    weight = i.weight_kg

    bf = None
    if i.body_fat and (i.today - i.body_fat[0]).days <= BF_MAX_AGE_DAYS:
        bf = i.body_fat[1]
    bmr = method = None
    if weight and bf is not None:
        bmr, method = 370 + 21.6 * weight * (1 - bf / 100), "katch"
    elif weight and i.height_cm and i.age and i.sex in ("male", "female"):
        bmr = 10 * weight + 6.25 * i.height_cm - 5 * i.age + (5 if i.sex == "male" else -161)
        method = "mifflin"
    formula = bmr * activity_factor(i.training_days) if bmr else None

    # Intake only counts inside the weigh-in span: that's the eating the
    # weight change reflects.
    measured = None
    confidence = 0.0
    slope = slope_per_week(i.weights)
    days_in_span: list[int] = []
    if i.weights:
        first, last = i.weights[0][0], i.weights[-1][0]
        days_in_span = [k for d, k in i.intake if first <= d <= last and k >= MIN_DAY_KCAL]
    avg_intake = sum(days_in_span) / len(days_in_span) if days_in_span else None
    span = (i.weights[-1][0] - i.weights[0][0]).days if i.weights else 0
    if (
        slope is not None and avg_intake is not None
        and len(days_in_span) >= MIN_LOGGED_DAYS
        and len(i.weights) >= MIN_WEIGH_INS
        and span >= MIN_SPAN_DAYS
    ):
        measured = avg_intake - slope * KCAL_PER_KG / 7
        if formula:
            lo, hi = 0.7 * formula, 1.3 * formula
            if not lo <= measured <= hi:
                clamped = min(max(measured, lo), hi)
                notes.append(
                    f"Your logs point to a burn of {round(measured)} kcal, far from the "
                    f"formula's {round(formula)}, so {round(clamped)} is used. Missed food "
                    "logs are the usual cause."
                )
                measured = clamped
        confidence = min(1.0, len(days_in_span) / FULL_TRUST_DAYS) * min(1.0, span / FULL_TRUST_DAYS)
        if not formula:
            confidence = 1.0

    if measured is not None and formula:
        tdee = confidence * measured + (1 - confidence) * formula
    else:
        tdee = measured or formula

    pace = i.pace if i.pace in PACES else "steady"
    rate = 0.0
    if i.goal in PACE_RATES and weight:
        share = PACE_RATES[i.goal][pace]
        lean = LEAN_BF.get(i.sex or "")
        if i.goal == "cut" and bf is not None and lean is not None and bf < lean and share > PACE_RATES["cut"]["steady"]:
            share = PACE_RATES["cut"]["steady"]
            notes.append(f"At {bf:.0f}% body fat a fast cut is held to steady pace, to protect muscle.")
        rate = share * weight * (-1 if i.goal == "cut" else 1)

    target = floor = ceiling = None
    if tdee:
        floor, ceiling = safety_limits(i.sex, bmr, tdee)
        raw = tdee + rate * KCAL_PER_KG / 7
        target = min(max(raw, floor), ceiling)
        if target > raw + 5:
            notes.append(f"Raised to the safe minimum of {round(floor)} kcal, so the loss will be slower than the pace.")
        elif target < raw - 5:
            notes.append(f"Held to {round(ceiling)} kcal, 500 above your burn.")

    return Estimate(
        weight_kg=round(weight, 1) if weight else None,
        bmr=round(bmr) if bmr else None,
        bmr_method=method,
        body_fat_pct=round(bf, 1) if bf is not None else None,
        training_days=i.training_days,
        formula_tdee=round(formula) if formula else None,
        measured_tdee=round(measured) if measured is not None else None,
        confidence=round(confidence, 2),
        tdee=round(tdee) if tdee else None,
        avg_intake=round(avg_intake) if avg_intake is not None else None,
        logged_days=len(days_in_span),
        weigh_ins=len(i.weights),
        weight_trend_kg_week=round(slope, 2) if slope is not None else None,
        goal=i.goal,
        pace=pace,
        rate_kg_week=round(rate, 2),
        target_kcal=_round10(target) if target else None,
        floor=round(floor) if floor else None,
        ceiling=round(ceiling) if ceiling else None,
        notes=notes,
    )


async def gather(
    user: User, prefs: UserPreference | None, today: date, db: AsyncSession, days: int | None = None
) -> EnergyInputs:
    """Read what estimate() needs. `days` overrides training days a week."""
    metrics = (await db.execute(
        select(BodyMetric)
        .where(BodyMetric.user_id == user.id, BodyMetric.date >= today - timedelta(days=BF_MAX_AGE_DAYS))
        .order_by(BodyMetric.date, BodyMetric.logged_at)
    )).scalars().all()
    weights = [(r.date, r.weight_kg) for r in metrics if r.weight_kg and r.date >= today - timedelta(days=WINDOW_DAYS)]
    all_weights = [r.weight_kg for r in metrics if r.weight_kg]
    bfs = [(r.date, r.body_fat_pct) for r in metrics if r.body_fat_pct]

    intake = [
        (r.date, r.calories_eaten)
        for r in (await db.execute(
            select(DailySummary).where(
                DailySummary.user_id == user.id,
                DailySummary.date >= today - timedelta(days=WINDOW_DAYS),
                DailySummary.date < today,
                DailySummary.is_estimated.is_(False),
            )
        )).scalars()
        if r.calories_eaten
    ]

    if days is None:
        freq = (await db.execute(
            select(OnboardingBaseline.training_frequency).where(OnboardingBaseline.user_id == user.id)
        )).scalar_one_or_none()
        days = training_days(prefs, freq)
        # If they log more sessions than they said they'd do, believe the logs.
        # Fewer is left to the measured burn: not every session gets logged.
        age = (today - user.created_at.date()).days if user.created_at else 0
        if age >= 14:
            logged = (await db.execute(
                select(func.count(func.distinct(TrainingLog.date))).where(
                    TrainingLog.user_id == user.id,
                    TrainingLog.date >= today - timedelta(days=WINDOW_DAYS),
                    TrainingLog.date < today,
                )
            )).scalar_one()
            days = min(7, max(days, round(logged * 7 / min(WINDOW_DAYS, age))))

    return EnergyInputs(
        sex=user.sex,
        age=user.age,
        height_cm=user.height_cm,
        weight_kg=all_weights[-1] if all_weights else user.weight_kg,
        weights=weights,
        body_fat=bfs[-1] if bfs else None,
        intake=intake,
        training_days=days,
        goal=prefs.goal if prefs else None,
        pace=prefs.pace if prefs else None,
        today=today,
    )


async def estimate_for(
    user: User, prefs: UserPreference | None, today: date, db: AsyncSession, days: int | None = None
) -> Estimate:
    return estimate(await gather(user, prefs, today, db, days))
