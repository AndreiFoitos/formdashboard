"""Background jobs that need to run on a fixed schedule.

- prewarm_digests (every 15 min): generate today's AI digest for users whose
  hash slot matches the current 15-min window of the day. Spreads load over
  96 slots/day so a 10k-user base sends ~104 Anthropic requests per slot
  instead of 10k at 05:00 UTC. Silently skips users that error out and
  no-ops entirely when the API key isn't set.

- dispatch_predictive_nudges (every 15 min): pushes log-reminder notifications
  to users at the slots where they typically log water / coffee.

Failures are isolated per-user so one bad user can't kill the run.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from core.database import AsyncSessionLocal
from core import redis as redis_mod
from models.user import User
from services.ai_client import AINotConfigured
from services.ai_features import generate_daily_digest
from services.notifier import dispatch_predictive_nudges
from services.saved_meals import detect_all_saved_meals
from services.split_detection import detect_all_user_splits

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None

# Run prewarm_digests every 15 min and bucket users into 96 slots/day.
DIGEST_SLOTS_PER_DAY = 96
# Concurrency cap for Anthropic calls within one slot. Sonnet 4.6 default tier
# allows ~50 req/min, so 5 concurrent at ~1s each = 300 req/min headroom × 4.
# Keeps us well under the per-key rate limit even when many users share a slot.
DIGEST_CONCURRENCY = 5


def _user_slot(user_id) -> int:
    """Deterministic 0..95 slot index for a user.

    Hash on the user_id bytes (UUIDs) or the str form (fallback). Same user
    always maps to the same slot so their digest fires once a day, not every
    15 minutes.
    """
    raw = user_id.bytes if hasattr(user_id, "bytes") else str(user_id).encode()
    return int(hashlib.md5(raw).hexdigest(), 16) % DIGEST_SLOTS_PER_DAY


def _current_slot() -> int:
    """Which of the 96 daily slots is happening right now."""
    now = datetime.now(timezone.utc)
    return (now.hour * 4 + now.minute // 15) % DIGEST_SLOTS_PER_DAY


async def _prewarm_one(user_id, sem: asyncio.Semaphore) -> tuple[bool, bool]:
    """Returns (success, ai_not_configured). One DB session per user so a slow
    Anthropic call doesn't hold a connection from the pool."""
    async with sem:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None:
                return False, False
            try:
                await generate_daily_digest(user, db, redis_mod.redis_client)
                await db.commit()
                return True, False
            except AINotConfigured:
                return False, True
            except Exception as e:  # noqa: BLE001 — log per-user and continue
                logger.warning("prewarm_digests: user=%s failed: %s", user_id, e)
                return False, False


async def prewarm_digests() -> None:
    """Generate today's digest for users whose hash slot matches now."""
    slot = _current_slot()
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id))
        all_user_ids = [row[0] for row in result.all()]

    user_ids = [uid for uid in all_user_ids if _user_slot(uid) == slot]
    if not user_ids:
        return

    sem = asyncio.Semaphore(DIGEST_CONCURRENCY)
    results = await asyncio.gather(
        *[_prewarm_one(uid, sem) for uid in user_ids],
        return_exceptions=False,
    )

    # If the very first user in the slot returns AINotConfigured we still
    # iterate the rest, but they'll all bail the same way — cheap, no Anthropic
    # call happens. Only log once.
    success = sum(1 for ok, _ in results if ok)
    not_configured = any(nc for _, nc in results)
    if not_configured and success == 0:
        logger.info("prewarm_digests: ANTHROPIC_API_KEY not set, slot=%d skipped", slot)
        return
    logger.info(
        "prewarm_digests slot=%d: success=%d total=%d (%d/%d total users)",
        slot, success, len(user_ids), len(user_ids), len(all_user_ids),
    )


def start_scheduler() -> AsyncIOScheduler:
    """Idempotent — calling twice returns the existing scheduler instead of crashing."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    sched = AsyncIOScheduler(timezone="UTC")
    # Every 15 min: process the slice of users whose hash maps to the current
    # 15-min slot. Avoids the "10k users hit Anthropic at 05:00 UTC" thundering
    # herd that breaks per-key rate limits.
    sched.add_job(
        prewarm_digests,
        trigger="cron",
        minute="*/15",
        id="prewarm_digests",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    # Predictive nudges run on a 15-min cadence so we can catch the start of
    # any 30-min pattern slot. coalesce=True means missed runs (worker restart)
    # collapse to a single backfill instead of bursting.
    sched.add_job(
        dispatch_predictive_nudges,
        trigger="cron",
        minute="*/15",
        id="dispatch_predictive_nudges",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    # Saved-meal detection runs nightly at 03:30 UTC — quiet time, after the
    # day's logs are done. Per-user failures are isolated inside the job.
    sched.add_job(
        detect_all_saved_meals,
        trigger="cron",
        hour=3,
        minute=30,
        id="detect_all_saved_meals",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    # Training-split detection runs slightly after saved meals — different
    # job, similar shape (per-user fan-out from a 28-day history window).
    sched.add_job(
        detect_all_user_splits,
        trigger="cron",
        hour=3,
        minute=45,
        id="detect_all_user_splits",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    sched.start()
    _scheduler = sched
    logger.info(
        "Scheduler started: prewarm_digests@*/15min (96-slot stagger), "
        "dispatch_predictive_nudges@*/15min, "
        "detect_all_saved_meals@03:30 UTC, "
        "detect_all_user_splits@03:45 UTC"
    )
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
