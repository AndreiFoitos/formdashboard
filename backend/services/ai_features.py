from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.daily_summary import DailySummary
from models.ai_insight import AIInsight
from models.ai_message import AiMessage
from core.redis import cache_get, cache_setex
from services.ai_client import call_claude
from services.plan_context import build_context

# ── Prompts ─────────────────────────────────────────────────────────────────────

DIGEST_SYSTEM = (
    "Write a morning briefing from yesterday's training and recovery numbers.\n"
    "Hard rules:\n"
    "- Maximum 3 sentences. ~50 words total. Stop at 3.\n"
    "- Plain text only. No markdown, no bullets, no headers, no asterisks, no bold.\n"
    "- Lead with the most important signal from the numbers; end with one thing to do today.\n"
    "- Reference specific numbers, not generalities.\n"
    "- No assistant voice: never say 'I', 'your data shows', 'looking at', 'based on', 'it seems', 'let me know', 'feel free'. Do not greet, do not sign off, do not address the reader by role.\n"
    "- No coach-speak: no 'great job', 'keep it up', 'crushed it', 'amazing', 'awesome'.\n"
    "- Tone: terse text from a friend who reads your stats — like an observation, not advice."
)

ASK_SYSTEM_PREFIX = (
    "Answer questions about the user's training, sleep, nutrition, and recovery data.\n"
    "Hard rules:\n"
    "- Plain text only. No markdown, no bullets, no headers, no asterisks, no bold, no numbered lists.\n"
    "- Keep it short. 1-3 sentences in most cases. Only go longer when the question genuinely needs more numbers.\n"
    "- Cite specific numbers from the data, never generalities.\n"
    "- If the data doesn't support a clean answer, say so in one sentence and stop.\n"
    "- No assistant voice: never say 'I', 'based on your data', 'looking at', 'it appears', 'it seems', 'let me know', 'feel free', 'happy to', 'I'd recommend', 'I notice'. Do not greet, do not sign off, do not offer follow-ups.\n"
    "- No coach-speak or pep: just the read on the numbers.\n"
    "- Tone: a friend who pulled up your stats and is telling you what's in them.\n"
    "About the data:\n"
    "- The data block has the user's profile and preferences, body trend, a daily log, weekly averages, "
    "strength (1RM values are estimates from rep sets), their usual split and the foods they log most.\n"
    "- 'nothing logged' means no entries that day, not zero intake. Say so rather than calling it a bad day.\n"
    "- Never suggest a food listed under allergies, and avoid listed dislikes.\n"
    "- If health conditions are listed (pregnant, eating_disorder, diabetes, kidney), do not give calorie-cutting "
    "or restrictive diet advice; say food changes should go through their doctor or a dietitian. Training questions are fine.\n"
    "- If the user describes eating very little, purging, or punishing exercise, answer with care, skip the numbers, "
    "and suggest talking to a doctor or an eating-disorder helpline.\n"
    "- Training and meal plans are not available yet. If asked for one, say Pit Crew plans are coming and answer "
    "what the data already shows."
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
    # HIGH-16: sleep_score / hrv_score columns removed from the prompt (wearables
    # gone, columns return null).
    # HIGH-30 / MEDIUM-33: exclude is_estimated baseline rows. Those rows have
    # water and protein pinned EXACTLY to the user's targets, which would make
    # the rolling average look like perfect adherence for any week containing
    # any seed days. Past form_score is also unbackfilled (only today's is
    # computed on read), so excluding estimated rows naturally also skips the
    # rows whose form_score is null-by-design.
    real = [r for r in rows if not r.is_estimated]
    return {
        "water_ml": _avg([r.water_ml for r in real]),
        "protein_g": _avg([r.protein_g for r in real]),
        "form_score": _avg([r.form_score for r in real]),
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

async def generate_daily_digest(user, db: AsyncSession) -> str:
    cache_key = f"digest:{user.id}:{date.today().isoformat()}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    yesterday = date.today() - timedelta(days=1)
    summary = await _get_summary(user.id, yesterday, db)
    has_data = summary and any([
        summary.water_ml, summary.protein_g, summary.trained, summary.caffeine_mg,
    ])
    if not has_data:
        return "No data from yesterday yet — log a full day and your first briefing lands tomorrow morning."

    week = _week_averages(await _last_n_days(user.id, 7, db))
    # Sleep / HRV intentionally omitted (Path A in PRE_SUBMISSION_TODO HIGH-16):
    # the wearable integrations were removed, so feeding nulls into the prompt
    # produces hallucinated values. Re-introduce only if Form Score gets a
    # manual-sleep tile back (Path B).
    msg = f"""Yesterday ({yesterday.isoformat()}):
- Form Score: {summary.form_score}
- Water: {summary.water_ml}ml of {user.water_target_ml}ml target
- Protein: {summary.protein_g}g of {user.protein_target_g}g target
- Caffeine: {summary.caffeine_mg}mg
- Trained: {('Yes — ' + summary.training_type) if summary.trained else 'No'}
7-day averages: form {week['form_score']}, water {week['water_ml']}ml, protein {week['protein_g']}g
Bodyweight: {user.weight_kg}kg, bedtime hour: {user.sleep_hour}:00"""

    digest = await call_claude(DIGEST_SYSTEM, [{"role": "user", "content": msg}], max_tokens=120, thinking=False)

    await cache_setex(cache_key, max(_seconds_to_midnight(), 1), digest)
    await save_insight(user.id, "daily_digest", digest, db, data_window_days=7)
    return digest


# ── Ask your data ─────────────────────────────────────────────────────────────

HISTORY_TURNS = 20  # messages of saved chat the model sees


async def chat_history(user_id, db: AsyncSession, limit: int = HISTORY_TURNS) -> list[AiMessage]:
    """Newest `limit` saved messages, oldest first."""
    rows = (await db.execute(
        select(AiMessage)
        .where(AiMessage.user_id == user_id)
        .order_by(AiMessage.created_at.desc())
        .limit(limit)
    )).scalars().all()
    return list(reversed(rows))


async def answer_question(user, question: str, db: AsyncSession, days: int = 30) -> str:
    """`days` is how far back the model may look — a plan perk (30 / 90 / 365,
    services/plans.py). The newest 14 days go in full, the rest as weekly
    averages (services/plan_context.py).

    History comes from ai_messages, not the client, so a chat survives
    leaving the tab and older app builds that still send `history` get the
    same answers. Saving the new turn is the caller's job, after it has an
    answer to save."""
    context = await build_context(user, db, days)
    # Cached: the system prompt + data block are the same across a
    # conversation's turns, so follow-ups pay full price only for the new turn.
    system = [
        {"type": "text", "text": ASK_SYSTEM_PREFIX},
        {"type": "text", "text": context, "cache_control": {"type": "ephemeral"}},
    ]
    history = [{"role": m.role, "content": m.content} for m in await chat_history(user.id, db)]
    # The API needs user/assistant alternation starting with a user turn. A
    # failed turn never saves, but drop any leading assistant message anyway.
    while history and history[0]["role"] != "user":
        history.pop(0)
    messages = history + [{"role": "user", "content": question}]
    # Medium effort so questions like "why am I not losing weight" get some
    # reasoning over the numbers. A starting point, not tuned against an eval.
    # max_tokens covers the thinking as well as the short answer.
    return await call_claude(system, messages, max_tokens=4000, effort="medium")
