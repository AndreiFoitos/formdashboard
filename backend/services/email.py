"""
Send transactional email through Resend's HTTP API (https://resend.com).

Only used for account links (set/change password, confirm email), so volume
is tiny and the free tier covers it. No SDK: one POST with httpx.
"""
from __future__ import annotations

import logging
import os

import httpx
from fastapi import HTTPException

from core.config import settings

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


async def send_email(*, to: str, subject: str, text: str, html: str) -> None:
    if not settings.RESEND_API_KEY:
        if os.environ.get("ENV", "dev") == "production":
            raise HTTPException(503, "Email isn't set up yet. Try again later.")
        # Dev: no provider configured, so print the message to use the link.
        log.warning("RESEND_API_KEY unset; email to %s not sent:\n%s", to, text)
        return

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "text": text, "html": html},
            )
        resp.raise_for_status()
    except httpx.HTTPError as e:
        body = getattr(getattr(e, "response", None), "text", "")
        log.error("Resend send to %s failed: %s %s", to, e, body)
        raise HTTPException(502, "Couldn't send the email. Try again in a minute.")
