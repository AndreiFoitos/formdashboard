"""Expo Push Notification Service wrapper.

Why Expo Push instead of FCM/APNs direct: it's free, requires no Apple/Google
service-account juggling, and matches what `expo-notifications` already does on
the client. We can swap to native APNs/FCM later if we hit Expo's rate limits.

`send_to_user` is the high-level entry point — it fans out across every active
push token for a user, marks DeviceNotRegistered tokens inactive, and is safe
to call from the scheduler.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Iterable

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.push_token import PushToken

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Expo accepts up to 100 messages per request — we send one message per token,
# so this is the chunk size.
BATCH_SIZE = 100


async def _send_batch(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Returns Expo's per-message ticket list. Raises on transport errors.

    HIGH-28: when EXPO_ACCESS_TOKEN is configured, send it as a Bearer header.
    Once "Enforce access token" is enabled in the Expo project dashboard,
    unauthenticated callers can't spoof pushes to your users — the project ID
    alone (visible in any IPA) is no longer enough to mint notifications.
    """
    if not messages:
        return []
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            EXPO_PUSH_URL,
            json=messages,
            headers=headers,
        )
        resp.raise_for_status()
        payload = resp.json()
    tickets = payload.get("data") or []
    if not isinstance(tickets, list):
        # Expo can wrap a single-message send in an object instead of a list.
        tickets = [tickets]
    return tickets


async def _deactivate_tokens(db: AsyncSession, tokens: Iterable[str]) -> None:
    tokens = list(tokens)
    if not tokens:
        return
    await db.execute(
        update(PushToken).where(PushToken.token.in_(tokens)).values(active=False)
    )
    await db.commit()


async def send_to_user(
    user_id: uuid.UUID,
    db: AsyncSession,
    *,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    category_id: str | None = None,
) -> int:
    """Send one push to every active device the user has. Returns delivery count."""
    result = await db.execute(
        select(PushToken).where(PushToken.user_id == user_id, PushToken.active == True)  # noqa: E712
    )
    tokens = result.scalars().all()
    if not tokens:
        return 0

    base: dict[str, Any] = {"title": title, "body": body, "sound": "default"}
    if data is not None:
        base["data"] = data
    if category_id is not None:
        # `categoryId` is what the Expo Push service expects; expo-notifications
        # on-device translates it into the iOS UNNotificationCategory or the
        # Android channel-registered actions.
        base["categoryId"] = category_id

    messages = [dict(base, to=t.token) for t in tokens]
    delivered = 0
    dead: list[str] = []

    for i in range(0, len(messages), BATCH_SIZE):
        batch = messages[i : i + BATCH_SIZE]
        try:
            tickets = await _send_batch(batch)
        except Exception as e:  # noqa: BLE001
            logger.warning("push.send_to_user user=%s batch failed: %s", user_id, e)
            continue
        for msg, ticket in zip(batch, tickets):
            if ticket.get("status") == "ok":
                delivered += 1
            else:
                err = (ticket.get("details") or {}).get("error")
                if err == "DeviceNotRegistered":
                    dead.append(msg["to"])
                else:
                    logger.info("push ticket error: %s details=%s", ticket.get("message"), ticket.get("details"))

    if dead:
        await _deactivate_tokens(db, dead)
    return delivered
