from datetime import date

import anthropic

from core.config import settings
from core import redis as redis_mod

# Single source of truth for the model. The roadmap chose Sonnet for the
# quality/cost balance on this high-volume per-user feature; bump to
# "claude-opus-5" here if you want higher quality and accept the cost.
#
# Sonnet 5.5 supersedes Sonnet 5 at the same price ($2/$10 per MTok).
# It rejects `thinking: disabled`; see call_claude for the replacement.
CLAUDE_MODEL = "claude-sonnet-5-5"


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

    Without Redis the counter lives in process memory (core/redis.py), so the
    cap still holds on a single instance but resets when the server restarts.
    """
    key = f"anthropic_calls:{date.today().isoformat()}"
    n = await redis_mod.incr_with_ttl(key, 86400)
    if n > settings.ANTHROPIC_DAILY_CALL_LIMIT:
        raise AINotConfigured(
            f"Global daily AI quota exhausted ({settings.ANTHROPIC_DAILY_CALL_LIMIT}). "
            "Retry after midnight UTC."
        )


async def call_claude(
    system,  # str, or a list of system blocks (use a cache_control block for large reusable prefixes)
    messages: list[dict],
    max_tokens: int = 600,
    thinking: bool = True,
    effort: str | None = None,
) -> str:
    """Single Messages API call, returns the concatenated text.

    Sonnet 5.5 thinks adaptively unless told not to, and thinking tokens count
    against max_tokens. Pass thinking=False for tiny structured replies: with
    a ~120-token cap the model can spend it all thinking and return no text.
    Sonnet 5.5 400s on {"type": "disabled"}; "between_tools" is its
    no-thinking setting (allowed at the default "high" effort or below)."""
    client = get_client()
    await _enforce_global_spend_cap()
    extra = {} if thinking else {"thinking": {"type": "between_tools"}}
    if effort:
        extra["output_config"] = {"effort": effort}
    resp = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
        **extra,
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


class AIRefused(Exception):
    """The model declined (stop_reason "refusal")."""


async def call_claude_json(
    system,
    messages: list[dict],
    schema: dict,
    max_tokens: int = 32000,
    effort: str | None = None,
):
    """One structured-output call: the reply is JSON matching `schema`.

    Streams, so a long plan can't hit an HTTP timeout. Returns (data, message)
    so callers can read usage and replay `message.content` (thinking blocks
    included) in a follow-up turn. Raises AIRefused on a refusal and
    ValueError when the reply is cut off by max_tokens."""
    import json

    client = get_client()
    await _enforce_global_spend_cap()
    output_config: dict = {"format": {"type": "json_schema", "schema": schema}}
    if effort:
        output_config["effort"] = effort
    async with client.messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
        output_config=output_config,
    ) as stream:
        message = await stream.get_final_message()
    if message.stop_reason == "refusal":
        raise AIRefused(getattr(message, "stop_details", None))
    if message.stop_reason == "max_tokens":
        raise ValueError("Model output was cut off (max_tokens)")
    text = next(b.text for b in message.content if b.type == "text")
    return json.loads(text), message
