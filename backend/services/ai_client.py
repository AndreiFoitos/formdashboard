from datetime import date

import anthropic

from core.config import settings
from core import redis as redis_mod

# Single source of truth for the model. The roadmap chose Sonnet for the
# quality/cost balance on this high-volume per-user feature; bump to
# "claude-opus-4-7" here if you want higher quality and accept the cost.
CLAUDE_MODEL = "claude-sonnet-4-6"


class AINotConfigured(Exception):
    pass


_client: anthropic.AsyncAnthropic | None = None


def get_client() -> anthropic.AsyncAnthropic:
    if not settings.ANTHROPIC_API_KEY:
        raise AINotConfigured("ANTHROPIC_API_KEY is not set on the server")
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


async def _enforce_global_spend_cap() -> None:
    """HIGH-17: hard daily ceiling on Anthropic calls across the whole app.

    Per-user rate limits already cap each user; this catches the case where
    many users together (or a bug) drive total spend past what we can absorb.
    Redis is the source of truth so multiple replicas share the counter.

    If Redis is unavailable we fail OPEN — the call proceeds. That preserves
    availability at the cost of one missed cap-hit; the per-user limits are
    still active, so worst-case spend is bounded by user_count * per_user_cap.
    """
    client = redis_mod.redis_client
    if client is None:
        return
    key = f"anthropic_calls:{date.today().isoformat()}"
    try:
        n = await client.incr(key)
        await client.expire(key, 86400)
    except Exception:  # noqa: BLE001
        return
    if n > settings.ANTHROPIC_DAILY_CALL_LIMIT:
        raise AINotConfigured(
            f"Global daily AI quota exhausted ({settings.ANTHROPIC_DAILY_CALL_LIMIT}). "
            "Retry after midnight UTC."
        )


async def call_claude(
    system,  # str, or a list of system blocks (use a cache_control block for large reusable prefixes)
    messages: list[dict],
    max_tokens: int = 600,
) -> str:
    """Single Messages API call, returns the concatenated text. No thinking — these
    are short, structured generations where latency/cost matter more than reasoning depth."""
    client = get_client()
    await _enforce_global_spend_cap()
    resp = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()
