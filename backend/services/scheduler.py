"""Background jobs that need to run on a fixed schedule.

- prewarm_digests (05:00 UTC): generate today's AI digest for every user so
  the first dashboard fetch of the day hits the Redis cache instead of waiting
  on Anthropic. Silently skips users that error out, and the whole job no-ops
  when the API key isn't set.

- dispatch_predictive_nudges (every 15 min): pushes log-reminder notifications
  to users at the slots where they typically log water / coffee.

Failures are isolated per-user so one bad user can't kill the run.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from core.database import AsyncSessionLocal
from core import redis as redis_mod
from models.user import User
from services.ai_client import AINotConfigured
from services.ai_features import generate_daily_digest
from services.notifier import dispatch_predictive_nudges

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def prewarm_digests() -> None:
    """Generate today's digest for every user so the morning load is cached."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id))
        user_ids = [row[0] for row in result.all()]

    success = 0
    skipped = 0
    for user_id in user_ids:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None:
                continue
            try:
                await generate_daily_digest(user, db, redis_mod.redis_client)
                await db.commit()
                success += 1
            except AINotConfigured:
                # No API key — whole job is a no-op. Bail early so we don't
                # spam the loop with the same exception per user.
                logger.info("prewarm_digests: ANTHROPIC_API_KEY not set, skipping job")
                return
            except Exception as e:  # noqa: BLE001 — log per-user and continue
                skipped += 1
                logger.warning("prewarm_digests: user=%s failed: %s", user_id, e)
    logger.info("prewarm_digests: success=%d skipped=%d total=%d", success, skipped, len(user_ids))


def start_scheduler() -> AsyncIOScheduler:
    """Idempotent — calling twice returns the existing scheduler instead of crashing."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(
        prewarm_digests,
        trigger="cron",
        hour=5,
        minute=0,
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
    sched.start()
    _scheduler = sched
    logger.info(
        "Scheduler started: prewarm_digests@05:00 UTC, dispatch_predictive_nudges@*/15min"
    )
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
