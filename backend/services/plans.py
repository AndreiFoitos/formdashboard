"""Subscription plans and their limits.

Single source of truth for what each plan allows. The plan itself is synced
from RevenueCat onto users.plan (services/billing.py); this module only reads
it. Scan quotas are counted from the ai_scans ledger in Postgres so they
survive server restarts (the in-process counter in core/redis.py does not).

Windows:
- "day" is the user's local calendar day (users.timezone), so a free user's
  scan comes back at their midnight, not at midnight UTC.
- "week" is a rolling 7 days, so there is no Monday rush and no way to scan
  on Sunday and again on Monday.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import resolve_tz, user_now
from models.billing import AiScan
from models.friendship import Friendship
from models.user import User

FOOD = "food"
BF = "bf"
ASK = "ask"
KINDS = (FOOD, BF, ASK)


@dataclass(frozen=True)
class Limit:
    count: int
    window: str  # "day" | "week"


@dataclass(frozen=True)
class Plan:
    id: str
    food: Limit
    bf: Limit
    # "Ask your data" questions. The daily digest is free on every plan: it is
    # cached per user per day (~$0.002) and it is what brings people back.
    ask: Limit
    friends: int
    # How far back trends/charts and the Ask context may reach. Raw logs and
    # existing history screens are NOT limited by this: a user can always see
    # and export everything they logged; only the long-range views are a
    # paid perk (and a longer Ask window genuinely costs more tokens).
    history_days: int
    # CSV export of everything, Pro only.
    export: bool


PLANS: dict[str, Plan] = {
    "free": Plan(
        "free", food=Limit(1, "day"), bf=Limit(1, "week"), ask=Limit(3, "day"),
        friends=15, history_days=30, export=False,
    ),
    "plus": Plan(
        "plus", food=Limit(4, "day"), bf=Limit(3, "week"), ask=Limit(15, "day"),
        friends=50, history_days=90, export=False,
    ),
    # "Unlimited" in the app; these are fair-use caps against abuse.
    "pro": Plan(
        "pro", food=Limit(12, "day"), bf=Limit(1, "day"), ask=Limit(50, "day"),
        friends=150, history_days=365, export=True,
    ),
}


def plan_for(user: User) -> Plan:
    """The plan in force right now. A lapsed paid plan counts as free even
    before the RevenueCat EXPIRATION webhook lands."""
    plan = PLANS.get(user.plan or "free", PLANS["free"])
    if plan.id != "free" and user.plan_expires_at and user.plan_expires_at <= datetime.now(timezone.utc):
        return PLANS["free"]
    return plan


def _window_start(user: User, window: str) -> datetime:
    if window == "day":
        tz = resolve_tz(user.timezone)
        local_midnight = datetime.combine(user_now(user.timezone).date(), time.min, tzinfo=tz)
        return local_midnight.astimezone(timezone.utc)
    return datetime.now(timezone.utc) - timedelta(days=7)


def _limit(plan: Plan, kind: str) -> Limit:
    return {FOOD: plan.food, BF: plan.bf, ASK: plan.ask}[kind]


async def _used(user: User, kind: str, window: str, db: AsyncSession) -> tuple[int, datetime | None]:
    """Scans in the window, and the oldest one's time (for the reset hint)."""
    since = _window_start(user, window)
    n, oldest = (await db.execute(
        select(func.count(), func.min(AiScan.created_at)).where(
            AiScan.user_id == user.id, AiScan.kind == kind, AiScan.created_at >= since,
        )
    )).one()
    return n, oldest


def _resets_at(user: User, window: str, oldest: datetime | None) -> datetime:
    if window == "day":
        return _window_start(user, "day") + timedelta(days=1)
    return (oldest or datetime.now(timezone.utc)) + timedelta(days=7)


async def usage(user: User, db: AsyncSession) -> dict:
    """Remaining scans per kind, for the app's counters and paywall."""
    plan = plan_for(user)
    out = {}
    for kind in KINDS:
        lim = _limit(plan, kind)
        used, oldest = await _used(user, kind, lim.window, db)
        out[kind] = {
            "limit": lim.count,
            "window": lim.window,
            "used": min(used, lim.count),
            "remaining": max(lim.count - used, 0),
            "resets_at": _resets_at(user, lim.window, oldest).isoformat() if used else None,
        }
    return out


async def consume_scan(user: User, kind: str, db: AsyncSession) -> uuid.UUID:
    """Reserve one scan or raise 402 with what the app needs for the paywall.

    Inserts first and counts after, so two scans fired at once can't both
    squeeze through on the last slot. Returns the row id; pass it to
    refund_scan if the AI call then fails, so a failed scan doesn't count."""
    plan = plan_for(user)
    lim = _limit(plan, kind)
    scan = AiScan(user_id=user.id, kind=kind)
    db.add(scan)
    await db.commit()

    used, oldest = await _used(user, kind, lim.window, db)
    if used > lim.count:
        await refund_scan(scan.id, db)
        noun = {FOOD: "food scan", BF: "body-fat scan", ASK: "question"}[kind]
        period = "today" if lim.window == "day" else "this week"
        raise HTTPException(402, {
            "code": "scan_limit",
            "kind": kind,
            "plan": plan.id,
            "limit": lim.count,
            "window": lim.window,
            "resets_at": _resets_at(user, lim.window, oldest).isoformat(),
            "message": f"You've used your {lim.count} {noun}{'s' if lim.count != 1 else ''} {period}.",
        })
    return scan.id


async def refund_scan(scan_id: uuid.UUID, db: AsyncSession) -> None:
    await db.execute(delete(AiScan).where(AiScan.id == scan_id))
    await db.commit()


def history_window(user: User, requested: int | None) -> tuple[int, bool]:
    """(days to actually use, whether the plan cut the request short)."""
    allowed = plan_for(user).history_days
    if requested is None:
        return allowed, False
    days = max(1, requested)
    return min(days, allowed), days > allowed


def ensure_export(user: User) -> None:
    if not plan_for(user).export:
        raise HTTPException(402, {
            "code": "export_locked",
            "plan": plan_for(user).id,
            "message": "Exporting your data is a Pro feature.",
        })


# ─── Friends ─────────────────────────────────────────────────────────────────

async def friend_count(user_id: uuid.UUID, db: AsyncSession) -> int:
    return (await db.execute(
        select(func.count()).select_from(Friendship).where(
            Friendship.status == "accepted",
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
        )
    )).scalar_one()


async def ensure_friend_room(me: User, other: User, db: AsyncSession) -> None:
    """Raise 402 if adding one more friend would put either user over their
    plan's cap. Downgrading never removes friends; it only blocks new ones."""
    mine = plan_for(me)
    if await friend_count(me.id, db) >= mine.friends:
        raise HTTPException(402, {
            "code": "friend_limit",
            "plan": mine.id,
            "limit": mine.friends,
            "message": f"Your friends list is full ({mine.friends}).",
        })
    theirs = plan_for(other)
    if await friend_count(other.id, db) >= theirs.friends:
        # Don't reveal their plan; just say they're full.
        raise HTTPException(409, {
            "code": "friend_limit_other",
            "message": "Their friends list is full.",
        })
