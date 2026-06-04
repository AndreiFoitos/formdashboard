"""Body-composition estimate from a single photo.

Uses Claude vision with a strict JSON-output prompt. The model is asked to
return a body-fat percentage range plus a textual breakdown of the visual cues
that informed the call. The range matters: a single number implies confidence
the model can't reliably express on a photo, and a 4-percentage-point spread
is more honest than a false-precision integer.

This is a screening tool. Real BF% requires DEXA / BodPod / hydrostatic;
photo-based estimates from any source are ±3–5% under best conditions and
worse under poor lighting or unusual posture.
"""
from __future__ import annotations

import json
import re

from services.ai_client import call_claude  # noqa: F401  — re-exported via module
from services.ai_vision import call_claude_vision


BF_SYSTEM = (
    "You estimate adult body-fat percentage from a single full-body photo. "
    "Respond ONLY with a JSON object, no markdown fences, no prose outside JSON.\n"
    "Format:\n"
    "{\n"
    '  "bf_percent_low": number,    // lower bound of estimated BF%\n'
    '  "bf_percent_high": number,   // upper bound of estimated BF%\n'
    '  "sex_assumed": "male" | "female" | "unknown",\n'
    '  "visible_cues": [string, ...], // 2-4 short observations (e.g. "vascularity visible at the forearms", "lower-ab definition", "soft midsection")\n'
    '  "limitations": [string, ...], // 1-3 things reducing confidence (lighting, pose, clothing, single angle)\n'
    '  "confidence": "low" | "medium" | "high"\n'
    "}\n"
    "Rules:\n"
    "- Express the estimate as a 3–4 percentage-point band. NEVER return a single number.\n"
    "- For males: typical bands are 5–8 (elite competitive), 8–12 (very lean), 12–17 (lean), 17–22 (average), 22–28 (overweight), 28+ (obese).\n"
    "- For females: typical bands are 10–14 (elite), 14–18 (very lean), 18–23 (lean), 23–28 (average), 28–33 (overweight), 33+ (obese).\n"
    "- If sex can't be visually determined, use 'unknown' and pick a generic band.\n"
    "- If the photo is unusable (clothing covers too much, dark lighting, partial frame), return bf_percent_low=null, bf_percent_high=null, confidence='low', and explain in limitations.\n"
    "- Never identify a specific person. Never comment on appearance beyond body-composition cues."
)

BF_PROMPT = (
    "Estimate body-fat percentage from this photo. Follow the JSON spec exactly."
)


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


async def estimate_bf_from_photo(image_bytes: bytes) -> dict:
    """Returns the parsed JSON estimate. Raises ValueError on malformed model
    output so the caller can surface a 502 rather than a 200 with garbage."""
    raw = await call_claude_vision(BF_SYSTEM, image_bytes, BF_PROMPT)
    try:
        parsed = _extract_json(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"BF model returned malformed JSON: {raw[:200]}") from e

    low = parsed.get("bf_percent_low")
    high = parsed.get("bf_percent_high")
    midpoint = None
    if low is not None and high is not None:
        try:
            midpoint = round((float(low) + float(high)) / 2.0, 1)
        except (TypeError, ValueError):
            midpoint = None

    return {
        "bf_percent_low": low,
        "bf_percent_high": high,
        "bf_percent_midpoint": midpoint,
        "sex_assumed": parsed.get("sex_assumed") or "unknown",
        "visible_cues": parsed.get("visible_cues") or [],
        "limitations": parsed.get("limitations") or [],
        "confidence": parsed.get("confidence") or "low",
        "disclaimer": (
            "Photo-based BF% estimates carry ±3–5% error under best conditions. "
            "Treat this as a screening signal, not a measurement."
        ),
    }
