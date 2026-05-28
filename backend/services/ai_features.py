from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.daily_summary import DailySummary
from models.ai_insight import AIInsight
from services.ai_client import call_claude

# ── Prompts ─────────────────────────────────────────────────────────────────────

DIGEST_SYSTEM = (
    "You are a performance coach for someone who trains seriously and tracks their "
    "body like a system. Write a 3-sentence morning briefing.\n"
    "Rules:\n"
    "- Be direct and specific — use the actual numbers from the data.\n"
    "- Call out the single biggest win from yesterday and the single most important thing to fix today.\n"
    "- Tone: knowledgeable gym friend, not a therapist. No fluff, no 'great job!'.\n"
    "- Do not start with 'Yesterday' — vary your openers."
)

ASK_SYSTEM_PREFIX = (
    "You are a data analyst for a performance-tracking app. The user is asking about "
    "their own health and training data. Be specific, reference actual numbers, and be "
    "direct. If the data doesn't support an answer, say so plainly."
)

# ── Data helpers ────────────────────────────────────────────────────────────────

async def _get_summary(user_id, day: date, db: AsyncSession) -> DailySummary | None:
    result = await db.execute(
        select(DailySummary).where(DailySummary.user_id == user_id, DailySummary.date == day)
    )
    return result.scalar_one_or_none()


async def _last_n_days(user_id, n: int, db: AsyncSession) -> list[DailySummary]:
    cutoff = date.today() - timedelta(days=n)
    result = await db.execute(
        select(DailySummary)
        .where(DailySummary.user_id == user_id, DailySummary.date >= cutoff)
        .order_by(DailySummary.date)
    )
    return list(result.scalars().all())


def _avg(values: list) -> float | None:
    nums = [v for v in values if v is not None]
    return round(sum(nums) / len(nums), 1) if nums else None


def _week_averages(rows: list[DailySummary]) -> dict:
    return {
        "sleep_score": _avg([r.sleep_score for r in rows]),
        "hrv_score": _avg([r.hrv_score for r in rows]),
        "water_ml": _avg([r.water_ml for r in rows]),
        "protein_g": _avg([r.protein_g for r in rows]),
        "form_score": _avg([r.form_score for r in rows]),
    }


def _seconds_to_midnight() -> int:
    now = datetime.now(timezone.utc)
    midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(3600, int((midnight - now).total_seconds()))


async def save_insight(user_id, insight_type: str, content: str, db: AsyncSession, data_window_days: int = 7) -> None:
    db.add(AIInsight(
        user_id=user_id,
        insight_type=insight_type,
        content=content,
        data_window_days=data_window_days,
    ))
    await db.flush()


# ── Daily digest ──────────────────────────────────────────────────────────────

async def generate_daily_digest(user, db: AsyncSession, redis) -> str:
    cache_key = f"digest:{user.id}:{date.today().isoformat()}"
    cached = await redis.get(cache_key)
    if cached:
        return cached

    yesterday = date.today() - timedelta(days=1)
    summary = await _get_summary(user.id, yesterday, db)
    has_data = summary and any([
        summary.sleep_score, summary.hrv_score, summary.water_ml,
        summary.protein_g, summary.trained, summary.energy_avg,
    ])
    if not has_data:
        return "No data from yesterday yet — log a full day and your first briefing lands tomorrow morning."

    week = _week_averages(await _last_n_days(user.id, 7, db))
    msg = f"""Yesterday ({yesterday.isoformat()}):
- Form Score: {summary.form_score}
- Sleep score: {summary.sleep_score}, HRV: {summary.hrv_score} ms
- Water: {summary.water_ml}ml of {user.water_target_ml}ml target
- Protein: {summary.protein_g}g of {user.protein_target_g}g target
- Caffeine: {summary.caffeine_mg}mg
- Trained: {('Yes — ' + summary.training_type) if summary.trained else 'No'}
- Avg energy: {summary.energy_avg}/5
7-day averages: form {week['form_score']}, sleep {week['sleep_score']}, HRV {week['hrv_score']}, water {week['water_ml']}ml, protein {week['protein_g']}g
Goal: {user.goal}, bodyweight: {user.weight_kg}kg, bedtime hour: {user.sleep_hour}:00"""

    digest = await call_claude(DIGEST_SYSTEM, [{"role": "user", "content": msg}], max_tokens=250)

    await redis.setex(cache_key, _seconds_to_midnight(), digest)
    await save_insight(user.id, "daily_digest", digest, db, data_window_days=7)
    return digest


# ── Ask your data ─────────────────────────────────────────────────────────────

def _build_context(rows: list[DailySummary], user) -> str:
    lines = [
        f"User: goal={user.goal}, bodyweight={user.weight_kg}kg, "
        f"targets: protein={user.protein_target_g}g water={user.water_target_ml}ml, bedtime={user.sleep_hour}:00",
        "",
        "Last 30 days (date | form | sleep | hrv | water_ml | protein_g | caffeine_mg | trained | energy | estimated):",
    ]
    for r in rows:
        lines.append(
            f"{r.date} | {r.form_score} | {r.sleep_score} | {r.hrv_score} | {r.water_ml} | "
            f"{round(r.protein_g) if r.protein_g else None} | {r.caffeine_mg} | "
            f"{'Y' if r.trained else 'N'} | {r.energy_avg} | {'est' if r.is_estimated else ''}"
        )
    return "\n".join(lines)


async def answer_question(user, question: str, history: list[dict], db: AsyncSession) -> str:
    rows = await _last_n_days(user.id, 30, db)
    context = _build_context(rows, user)

    # The 30-day data block is large and stable across a conversation's turns —
    # cache it so follow-up questions only pay full price for the new question.
    system = [
        {"type": "text", "text": ASK_SYSTEM_PREFIX},
        {"type": "text", "text": context, "cache_control": {"type": "ephemeral"}},
    ]
    messages = (history or [])[-10:] + [{"role": "user", "content": question}]
    return await call_claude(system, messages, max_tokens=700)
