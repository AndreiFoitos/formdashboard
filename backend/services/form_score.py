"""
Form Score = a daily "Habits Score" derived entirely from data the user logs
in Protocol. We dropped sleep_score and hrv_score from the previous formula
because the app no longer integrates with wearables — leaving them in would
have collapsed 45% of the weighting to a flat 50% constant.

This formula is intentionally open / citable:

    Hydration   25%   water_ml ÷ target_ml
    Nutrition   30%   protein 60%  +  calorie window 40%
    Training    25%   trained × (volume ÷ personal 14-day avg)
    Caffeine    10%   residual mg at user's bedtime
    Streak      10%   consecutive log-days, capped at 14

Targets / decay constants are grounded in published guidance:
- Protein  1.6-2.2 g/kg/day   — Morton et al. 2018, BJSM meta-analysis
- Hydration  ~35 ml/kg/day    — EFSA / ACSM joint guidance
- Caffeine half-life ~5h      — Cornelis et al.; ISSN caffeine position stand
- Calorie ±10% perfect band   — small enough to be meaningful, wide enough that
                                one big meal doesn't tank the score
- Volume-vs-personal-baseline — applies the Plews/Buchheit "rolling baseline"
                                framing from HRV research to training volume
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

from models.daily_summary import DailySummary
from models.streak import Streak
from models.stimulant_log import StimulantLog
from models.training_log import TrainingLog
from services.stimulants import caffeine_at_time


WEIGHTS = {
    "hydration": 0.25,
    "nutrition": 0.30,
    "training":  0.25,
    "caffeine":  0.10,
    "streak":    0.10,
}

# Calorie deviation tolerance — ±10% = full credit, linear decay to 0 at ±30%.
CALORIE_PERFECT_BAND = 0.10
CALORIE_ZERO_BAND   = 0.30

# Bodyweight exercises where the load IS the lifter — falls back to the user's
# weight_kg when no added load is logged. Mirrors routers/friends.py.
BODYWEIGHT_EXERCISES = {"pull_up", "push_up", "tricep_dip", "hanging_leg_raise"}

# Streak ceiling — 14 consecutive logged days = full credit.
STREAK_FULL_DAYS = 14


# ─── Component scorers ──────────────────────────────────────────────────────


def _score_hydration(water_ml: int | None, target_ml: int) -> int:
    if not water_ml or target_ml <= 0:
        return 0
    return min(100, round(water_ml / target_ml * 100))


def _score_protein(protein_g: float | None, target_g: float | None) -> int:
    if not target_g or target_g <= 0:
        return 50  # no target set yet — neutral, doesn't punish new accounts
    if not protein_g:
        return 0
    return min(100, round(protein_g / target_g * 100))


def _score_calories(actual: int | None, target: int | None) -> int:
    if not target or target <= 0:
        return 50
    if not actual:
        return 0
    pct_off = abs(actual - target) / target
    if pct_off <= CALORIE_PERFECT_BAND:
        return 100
    if pct_off >= CALORIE_ZERO_BAND:
        return 0
    span = CALORIE_ZERO_BAND - CALORIE_PERFECT_BAND
    return round((1 - (pct_off - CALORIE_PERFECT_BAND) / span) * 100)


def _score_training(
    trained_today: bool,
    today_volume_kg: float,
    baseline_volume_kg: float,
    days_since_last: int | None,
) -> int:
    """
    Trained today → 60 base + up to 40 from volume vs the user's 14-day avg.
    Cap the ratio at 1.5× so one monster session doesn't dominate.

    Rest day → tapered score by days since last session. 1-2 days off is
    *normal* recovery (ACSM); the curve only gets steep after day 3.
    """
    if trained_today:
        if baseline_volume_kg <= 0:
            return 80  # first session ever — credit for showing up
        ratio = min(today_volume_kg / baseline_volume_kg, 1.5)
        return min(100, 60 + round(ratio / 1.5 * 40))
    rest_decay = {1: 75, 2: 60, 3: 40, 4: 25, 5: 15, 6: 5}
    if days_since_last is None or days_since_last >= 7:
        return 0
    return rest_decay.get(days_since_last, 0)


def _score_caffeine(caffeine_at_bed_mg: float) -> int:
    """Linear penalty for residual caffeine at bedtime. Hits 0 at ~250 mg."""
    return max(0, 100 - round(caffeine_at_bed_mg / 2.5))


def _score_streak(current_streak: int) -> int:
    return min(100, round(current_streak * 100 / STREAK_FULL_DAYS))


# ─── Data helpers ───────────────────────────────────────────────────────────


async def _volume_today_and_baseline_kg(
    user_id, target_date: date, user_weight_kg: float | None, db: AsyncSession,
) -> tuple[float, float]:
    """
    Returns (today_volume_kg, personal_14-day_avg_volume_kg).

    Volume = Σ weight × reps across the day. Bodyweight exercises substitute
    user.weight_kg for the load. Baseline excludes target_date so today's
    volume gets compared against your prior 2-week pattern.
    """
    cutoff = target_date - timedelta(days=14)
    result = await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == user_id,
            TrainingLog.date >= cutoff,
            TrainingLog.date <= target_date,
        )
    )
    logs = result.scalars().all()

    today_volume = 0.0
    by_date: dict[date, float] = {}
    for log in logs:
        w = float(log.weight_kg) if log.weight_kg is not None else 0.0
        if w == 0 and log.type in BODYWEIGHT_EXERCISES and user_weight_kg:
            w = float(user_weight_kg)
        vol = w * (log.reps or 0)
        by_date[log.date] = by_date.get(log.date, 0.0) + vol
        if log.date == target_date:
            today_volume += vol

    prior_dates = [d for d in by_date if d != target_date]
    if not prior_dates:
        return today_volume, 0.0
    prior_avg = sum(by_date[d] for d in prior_dates) / len(prior_dates)
    return today_volume, prior_avg


async def days_since_last_training(user_id, current_date: date, db: AsyncSession) -> int | None:
    cutoff = current_date - timedelta(days=7)
    result = await db.execute(
        select(DailySummary.date)
        .where(
            DailySummary.user_id == user_id,
            DailySummary.trained == True,  # noqa: E712
            DailySummary.date < current_date,
            DailySummary.date >= cutoff,
        )
        .order_by(DailySummary.date.desc())
        .limit(1)
    )
    last = result.scalar()
    if not last:
        return None
    return (current_date - last).days


async def estimate_caffeine_at_sleep(user_id, target_date: date, sleep_hour: int, db: AsyncSession) -> float:
    day_start = datetime.combine(target_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    result = await db.execute(
        select(StimulantLog).where(
            StimulantLog.user_id == user_id,
            StimulantLog.logged_at >= day_start,
            StimulantLog.logged_at < day_end,
        )
    )
    logs = result.scalars().all()
    bedtime = day_start.replace(hour=sleep_hour)
    return sum(
        caffeine_at_time(log.caffeine_mg, log.logged_at, log.half_life_hours, bedtime)
        for log in logs
    )


# ─── Main entry point ──────────────────────────────────────────────────────


async def compute_form_score(day: DailySummary, user, db: AsyncSession) -> tuple[int, dict]:
    """Returns (rounded_total, breakdown).

    breakdown keys:
        hydration / nutrition / training / caffeine / streak — 0-100
        nutrition_protein / nutrition_calories                — 0-100 (sub-scores)
        weights                                               — the weight dict
        context                                               — display strings for UI
    """
    # AsyncSession isn't safe for concurrent use — keep these sequential.
    days_since = await days_since_last_training(user.id, day.date, db)
    caffeine_at_bed = await estimate_caffeine_at_sleep(user.id, day.date, user.sleep_hour, db)
    today_volume, baseline_volume = await _volume_today_and_baseline_kg(
        user.id, day.date, user.weight_kg, db,
    )
    streak_row = await db.get(Streak, user.id)
    current_streak = streak_row.current_streak if streak_row else 0

    # Targets — fall back to weight-based defaults if the user hasn't customised.
    target_water_ml = user.water_target_ml or (
        int(user.weight_kg * 35) if user.weight_kg else 2500
    )
    target_protein_g = user.protein_target_g or (
        user.weight_kg * 2 if user.weight_kg else None
    )
    target_calories = user.calorie_target  # None until the user picks a goal

    # Components
    hydration = _score_hydration(day.water_ml, target_water_ml)
    protein = _score_protein(day.protein_g, target_protein_g)
    calories = _score_calories(day.calories_eaten, target_calories)
    nutrition = round(protein * 0.6 + calories * 0.4)
    training = _score_training(
        bool(day.trained), today_volume, baseline_volume, days_since,
    )
    caffeine = _score_caffeine(caffeine_at_bed)
    streak = _score_streak(current_streak)

    breakdown = {
        "hydration": hydration,
        "nutrition": nutrition,
        "nutrition_protein": protein,
        "nutrition_calories": calories,
        "training": training,
        "caffeine": caffeine,
        "streak": streak,
        "weights": WEIGHTS,
        # Context strings for the UI — short, no jargon. The card can render
        # these as-is so the formula stays a backend concern.
        "context": {
            "hydration": f"{day.water_ml or 0}/{target_water_ml} ml",
            "nutrition": (
                f"Protein {protein} · Calories {calories}"
                if (target_protein_g or target_calories) else "Set your targets in settings"
            ),
            "training": (
                f"Today {round(today_volume):,} kg · avg {round(baseline_volume):,} kg"
                if baseline_volume > 0 and day.trained
                else ("Trained today" if day.trained
                      else (f"{days_since}d since last session" if days_since else "No recent sessions"))
            ),
            "caffeine": f"{round(caffeine_at_bed)} mg at bedtime",
            "streak": f"{current_streak}-day streak",
        },
    }

    total = (
        hydration * WEIGHTS["hydration"]
        + nutrition * WEIGHTS["nutrition"]
        + training * WEIGHTS["training"]
        + caffeine * WEIGHTS["caffeine"]
        + streak * WEIGHTS["streak"]
    )
    return round(total), breakdown


# ─── Unlock gate (unchanged) ────────────────────────────────────────────────


async def count_recent_logged_days(user_id, days: int, db: AsyncSession) -> int:
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(sqlfunc.count()).select_from(DailySummary).where(
            DailySummary.user_id == user_id,
            DailySummary.date >= cutoff,
        )
    )
    return result.scalar() or 0


async def check_and_unlock_form_score(user, db: AsyncSession) -> bool:
    """Returns True if form score was just unlocked."""
    if user.form_score_unlocked:
        return False
    days_logged = await count_recent_logged_days(user.id, 7, db)
    if days_logged >= 5:
        user.form_score_unlocked = True
        await db.commit()
        return True
    return False
