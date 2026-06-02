"""Predictive notification dispatcher.

Runs every 15 minutes (services/scheduler.py::dispatch_predictive_nudges).
For each user with active push tokens, asks log_patterns for high-confidence
slots, finds the ones that fall inside the upcoming 15-min window in the
user's local timezone, dedupes against today's logs and a daily push cap,
and ships a push via services/push.send_to_user.

The push payload carries `data.action = "quick_log"` plus the suggested
type / amount / substance so the mobile notification-response handler can
POST /logs/quick without opening the app.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import redis as redis_mod
from core.database import AsyncSessionLocal
from models.hydration_log import HydrationLog
from models.push_token import PushToken
from models.stimulant_log import StimulantLog
from models.user import User
from services import push
from services.log_patterns import (
    PatternSlot,
    get_patterns_for_user,
)
from services.stimulants import SUBSTANCES

logger = logging.getLogger(__name__)

# Don't pester anyone more than this per day, regardless of how many patterns match.
DAILY_PUSH_CAP = 4
# If they logged the same type within this window of the predicted slot today,
# they already self-logged — skip the push.
RECENT_LOG_DEDUPE_MINUTES = 30
# How wide the "fire now" window around each slot is.
SLOT_FIRE_WINDOW_MINUTES = 15

# iOS UNNotificationCategory identifiers — the mobile app registers matching
# categories with the visible action buttons (e.g. "Log it").
CATEGORY_HYDRATION = "quick_log_hydration"
CATEGORY_STIMULANT = "quick_log_stimulant"


def _local_now(tz_name: str | None) -> datetime:
    try:
        return datetime.now(ZoneInfo(tz_name)) if tz_name else datetime.now(ZoneInfo("UTC"))
    except ZoneInfoNotFoundError:
        return datetime.now(ZoneInfo("UTC"))


def _today_cap_key(user_id: uuid.UUID, local_date_str: str) -> str:
    return f"notif:cap:{user_id}:{local_date_str}"


def _slot_sent_key(user_id: uuid.UUID, local_date_str: str, slot: PatternSlot) -> str:
    return f"notif:sent:{user_id}:{local_date_str}:{slot.log_type}:{slot.slot_minute}"


async def _already_logged_near_slot(
    db: AsyncSession,
    user_id: uuid.UUID,
    slot: PatternSlot,
    local_now: datetime,
    tz: ZoneInfo,
) -> bool:
    """Returns True if user has a log of this type today within the slot window."""
    day_start_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start_utc = day_start_local.astimezone(timezone.utc)

    if slot.log_type == "hydration":
        result = await db.execute(
            select(HydrationLog.logged_at)
            .where(
                HydrationLog.user_id == user_id,
                HydrationLog.logged_at >= day_start_utc,
            )
        )
    else:
        result = await db.execute(
            select(StimulantLog.logged_at)
            .where(
                StimulantLog.user_id == user_id,
                StimulantLog.logged_at >= day_start_utc,
            )
        )

    for (logged_at,) in result.all():
        local = logged_at.astimezone(tz)
        log_minute = local.hour * 60 + local.minute
        delta = abs(log_minute - slot.slot_minute)
        delta = min(delta, 1440 - delta)
        if delta <= RECENT_LOG_DEDUPE_MINUTES:
            return True
    return False


def _format_message(slot: PatternSlot) -> tuple[str, str, dict[str, Any], str]:
    """Build (title, body, data, category_id) for a slot."""
    if slot.log_type == "hydration":
        amount = slot.suggested_amount_ml or 250
        return (
            "Hydration check",
            f"Tap to log {amount} ml — you usually drink around now.",
            {
                "action": "quick_log",
                "type": "hydration",
                "amount_ml": amount,
            },
            CATEGORY_HYDRATION,
        )
    # stimulant
    substance = slot.suggested_substance or "coffee"
    caffeine = slot.suggested_caffeine_mg or SUBSTANCES.get(substance, {}).get("caffeine_mg", 95)
    label = SUBSTANCES.get(substance, {}).get("label", substance.title())
    return (
        "Coffee o'clock",
        f"Tap to log a {label} — you usually have one around now.",
        {
            "action": "quick_log",
            "type": "stimulant",
            "substance": substance,
            "caffeine_mg": caffeine,
        },
        CATEGORY_STIMULANT,
    )


async def _user_has_active_tokens(db: AsyncSession, user_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(PushToken.id).where(PushToken.user_id == user_id, PushToken.active == True)  # noqa: E712
        .limit(1)
    )
    return result.first() is not None


async def _process_user(user: User, db: AsyncSession, redis) -> int:
    """Returns how many pushes were sent for this user."""
    if not await _user_has_active_tokens(db, user.id):
        return 0

    tz_name = user.timezone or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")
    local_now = datetime.now(tz)
    today_str = local_now.date().isoformat()
    now_min = local_now.hour * 60 + local_now.minute
    now_weekday = local_now.weekday()

    # Daily cap check up front — cheap.
    cap_key = _today_cap_key(user.id, today_str)
    sent_so_far = 0
    if redis is not None:
        try:
            sent_raw = await redis.get(cap_key)
            sent_so_far = int(sent_raw) if sent_raw else 0
        except Exception:  # noqa: BLE001
            sent_so_far = 0
    if sent_so_far >= DAILY_PUSH_CAP:
        return 0

    patterns = await get_patterns_for_user(user.id, db, tz_name)
    if not patterns:
        return 0

    delivered_total = 0
    for slot in patterns:
        if sent_so_far + delivered_total >= DAILY_PUSH_CAP:
            break
        if not slot.matches_now(now_min, now_weekday, SLOT_FIRE_WINDOW_MINUTES):
            continue

        # Per-slot dedupe — only one push per slot per day, even if the scheduler
        # picks the user up again 15 min later inside the same window.
        sent_key = _slot_sent_key(user.id, today_str, slot)
        if redis is not None:
            try:
                if await redis.get(sent_key):
                    continue
            except Exception:  # noqa: BLE001
                pass

        if await _already_logged_near_slot(db, user.id, slot, local_now, tz):
            continue

        title, body, data, category_id = _format_message(slot)
        data["slot_minute"] = slot.slot_minute
        delivered = await push.send_to_user(
            user.id, db, title=title, body=body, data=data, category_id=category_id
        )
        if delivered > 0:
            delivered_total += 1
            if redis is not None:
                try:
                    # 36h TTL — outlasts the cap-counter day across DST shifts.
                    await redis.set(sent_key, "1", ex=60 * 60 * 36)
                except Exception:  # noqa: BLE001
                    pass

    if delivered_total and redis is not None:
        try:
            new_total = sent_so_far + delivered_total
            await redis.set(cap_key, new_total, ex=60 * 60 * 36)
        except Exception:  # noqa: BLE001
            pass
    return delivered_total


async def dispatch_predictive_nudges() -> None:
    """Scheduler entry point — fan out across all users with push tokens."""
    redis = redis_mod.redis_client
    async with AsyncSessionLocal() as db:
        # Pull users that have at least one active push token. Avoids loading the
        # whole user table when 80% of accounts won't have notifications enabled.
        result = await db.execute(
            select(User.id).join(PushToken, PushToken.user_id == User.id)
            .where(PushToken.active == True)  # noqa: E712
            .distinct()
        )
        user_ids = [row[0] for row in result.all()]

    sent_total = 0
    failed = 0
    for user_id in user_ids:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None:
                continue
            try:
                sent = await _process_user(user, db, redis)
                sent_total += sent
            except Exception as e:  # noqa: BLE001
                failed += 1
                logger.warning("dispatch_predictive_nudges: user=%s failed: %s", user_id, e)
    logger.info(
        "dispatch_predictive_nudges: users=%d sent=%d failed=%d",
        len(user_ids),
        sent_total,
        failed,
    )
