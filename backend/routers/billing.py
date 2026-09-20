"""Plans, usage and store purchases. See services/plans.py (limits) and
services/billing.py (RevenueCat sync)."""
from __future__ import annotations

import hmac
import logging

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from services import avatar_packs
from services.billing import BillingNotConfigured, owned_pack_products, sync_user, users_for_event
from services.plans import friend_count, plan_for, usage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


async def _describe(user: User, db: AsyncSession) -> dict:
    plan = plan_for(user)
    owned = await owned_pack_products(user.id, db)
    return {
        "plan": plan.id,
        # Null for free, and for a paid plan RevenueCat reports without an end.
        "plan_expires_at": user.plan_expires_at.isoformat() if plan.id != "free" and user.plan_expires_at else None,
        "scans": await usage(user, db),
        "friends": {"count": await friend_count(user.id, db), "limit": plan.friends},
        # Trends/Ask look-back window and CSV export, both plan perks.
        "history_days": plan.history_days,
        "export": plan.export,
        "packs": [
            {
                "id": p.id,
                "name": p.name,
                # Pro subscribers are offered the discounted product.
                "product_id": avatar_packs.product_ids(p.id)[1 if plan.id == "pro" else 0],
                "owned": any(pid in owned for pid in avatar_packs.product_ids(p.id)),
                "items": {slot: sorted(items) for slot, items in p.items.items()},
            }
            for p in avatar_packs.PACKS.values()
        ],
    }


@router.get("/me")
async def my_plan(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Current plan, scans left, friend slots and packs, for the app's
    counters, paywall and avatar shop."""
    return await _describe(current_user, db)


@router.post("/sync")
async def sync_my_purchases(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-read this user's purchases from RevenueCat. The app calls it right
    after a purchase or 'Restore purchases' so the plan applies at once
    instead of waiting for the webhook."""
    try:
        await sync_user(current_user, db)
    except BillingNotConfigured as e:
        raise HTTPException(503, str(e))
    except httpx.HTTPError as e:
        log.warning("RevenueCat sync failed for %s: %s", current_user.id, e)
        raise HTTPException(502, "Couldn't reach the store. Try again in a moment.")
    return await _describe(current_user, db)


@router.post("/revenuecat", include_in_schema=False)
async def revenuecat_webhook(
    request: Request,
    authorization: str = Header(""),
    db: AsyncSession = Depends(get_db),
):
    """RevenueCat webhook. Every event (purchase, renewal, cancellation,
    expiry, refund, transfer) is handled the same way: re-sync the users it
    touches. A non-200 makes RevenueCat retry (5 times, up to 80 min apart)."""
    expected = settings.REVENUECAT_WEBHOOK_AUTH
    if not expected:
        raise HTTPException(503, "Webhook not configured")
    if not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(401, "Bad authorization")

    event = (await request.json()).get("event") or {}
    users = await users_for_event(event, db)
    if not users:
        # Anonymous customer (bought before logging in) or a deleted account.
        log.info("RevenueCat %s for unknown user %s", event.get("type"), event.get("app_user_id"))
        return {"ok": True, "synced": 0}
    try:
        for u in users:
            await sync_user(u, db)
    except (BillingNotConfigured, httpx.HTTPError) as e:
        log.warning("RevenueCat webhook sync failed: %s", e)
        raise HTTPException(502, "Sync failed, retry")
    return {"ok": True, "synced": len(users)}
