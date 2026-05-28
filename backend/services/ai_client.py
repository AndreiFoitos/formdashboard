import anthropic

from core.config import settings

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


async def call_claude(
    system,  # str, or a list of system blocks (use a cache_control block for large reusable prefixes)
    messages: list[dict],
    max_tokens: int = 600,
) -> str:
    """Single Messages API call, returns the concatenated text. No thinking — these
    are short, structured generations where latency/cost matter more than reasoning depth."""
    client = get_client()
    resp = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()
