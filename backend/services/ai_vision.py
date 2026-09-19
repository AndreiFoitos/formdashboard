import base64

from services.ai_client import CLAUDE_MODEL, _enforce_global_spend_cap, get_client


async def call_claude_vision(
    system: str,
    images: bytes | list[tuple[str | None, bytes]],
    prompt: str,
    media_type: str = "image/jpeg",
    max_tokens: int = 1000,
    model: str = CLAUDE_MODEL,
    effort: str | None = None,
) -> str:
    """Single Messages API vision call. Returns the concatenated text content.

    `images` is either raw bytes (one photo) or a list of (label, bytes) pairs.
    Several images still go out as ONE request, so a multi-angle scan counts
    once against the daily call cap; only the input tokens grow (~1.6k/image
    at the API's default downscale). A label, when given, is placed as a text
    block right before its image so the model knows which view it's looking at.

    `effort` ("low" / "medium" / ...) caps how much Sonnet 5 thinks. Leave it
    None for Haiku 4.5, which rejects the parameter.
    """
    if isinstance(images, bytes):
        images = [(None, images)]

    client = get_client()
    await _enforce_global_spend_cap()

    content: list[dict] = []
    for label, image_bytes in images:
        if label:
            content.append({"type": "text", "text": label})
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(image_bytes).decode("utf-8"),
                },
            }
        )
    content.append({"type": "text", "text": prompt})

    extra = {"output_config": {"effort": effort}} if effort else {}
    resp = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": content}],
        **extra,
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()
