import base64

from services.ai_client import CLAUDE_MODEL, get_client


async def call_claude_vision(
    system: str,
    image_bytes: bytes,
    prompt: str,
    media_type: str = "image/jpeg",
    max_tokens: int = 1000,
) -> str:
    """Single Messages API vision call. Returns the concatenated text content."""
    client = get_client()
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    resp = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()
