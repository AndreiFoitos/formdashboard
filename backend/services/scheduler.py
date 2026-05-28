"""Background jobs that need to run on a fixed schedule.

Two jobs are registered:

- prewarm_digests (05:00 UTC): generate today's AI digest for every user so
  the first dashboard fetch of the day hits the Redis cache instead of waiting
  on Anthropic. Silently skips users that error out, and the whole job no-ops
  when the API key isn't set.

- nightly_oura_sync (02:00 UTC): pulls the previous 2 days of Oura data for
  every user with an active connection. Without this, Oura only syncs on
  app-open / a manual button tap.

Both jobs isolate failures per-user so one bad user can't kill the run.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from core.database import AsyncSessionLocal
from core import redis as redis_mod
from models.user import User
from models.device_connection import DeviceConnection
from services.ai_client import AINotConfigured
from services.ai_features import generate_daily_digest
from services.oura import OuraNotConfigured, _sync as _oura_sync

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


async def nightly_oura_sync() -> None:
    """Pull the last 2 days of Oura data for every user with an active connection."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(DeviceConnection).where(
                DeviceConnection.provider == "oura",
                DeviceConnection.sync_enabled == True,  # noqa: E712
            )
        )
        connections = result.scalars().all()
        # Capture (user_id, conn_id) up front so each user gets a fresh session.
        targets = [(c.user_id, c.id) for c in connections]

    success = 0
    skipped = 0
    for user_id, _ in targets:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None:
                continue
            result = await db.execute(
                select(DeviceConnection).where(
                    DeviceConnection.user_id == user_id,
                    DeviceConnection.provider == "oura",
                )
            )
            conn = result.scalar_one_or_none()
            if conn is None or not conn.sync_enabled:
                continue
            try:
                await _oura_sync(conn, user, db, days_back=2)
                await db.commit()
                success += 1
            except OuraNotConfigured:
                logger.info("nightly_oura_sync: Oura OAuth not configured, skipping job")
                return
            except Exception as e:  # noqa: BLE001
                skipped += 1
                logger.warning("nightly_oura_sync: user=%s failed: %s", user_id, e)
    logger.info("nightly_oura_sync: success=%d skipped=%d total=%d", success, skipped, len(targets))


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
    sched.add_job(
        nightly_oura_sync,
        trigger="cron",
        hour=2,
        minute=0,
        id="nightly_oura_sync",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    sched.start()
    _scheduler = sched
    logger.info("Scheduler started: prewarm_digests@05:00 UTC, nightly_oura_sync@02:00 UTC")
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
