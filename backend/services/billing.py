"""Store purchases, via RevenueCat.

The app buys through Apple (RevenueCat's SDK) and logs in to RevenueCat with
our user id, so RevenueCat's app_user_id == users.id. The server never trusts
the app about what was bought: after a purchase the app calls POST
/billing/sync, and RevenueCat's webhook fires on every renewal, expiry and
refund; both just re-read the customer from RevenueCat's REST API
(RevenueCat's own recommendation) and copy it onto our tables.

Products (create these in App Store Connect, then attach them in RevenueCat):
- Subscriptions, one group, entitlement "plus" or "pro":
  com.gainrace.plus.monthly / .yearly, com.gainrace.pro.monthly / .yearly.
  The 7-day free trial is an Apple introductory offer on the Pro products.
- Avatar packs, non-consumable: com.gainrace.pack.<pack id>, plus a cheaper
  com.gainrace.pack.<pack id>.pro that the app only offers to Pro users.
  Either one unlocks the pack (services/avatar_packs.py).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.billing import Purchase
from models.user import User


API = "https://api.revenuecat.com/v1"
# Highest first: an upgrade mid-period can leave both active for a moment.
ENTITLEMENT_PLANS = ("pro", "plus")
PACK_PREFIX = "com.gainrace.pack."


class BillingNotConfigured(Exception):
    pass


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


async def fetch_customer(app_user_id: str) -> dict:
    if not settings.REVENUECAT_SECRET_API_KEY:
        raise BillingNotConfigured("REVENUECAT_SECRET_API_KEY is not set on the server")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            f"{API}/subscribers/{app_user_id}",
            headers={"Authorization": f"Bearer {settings.REVENUECAT_SECRET_API_KEY}"},
        )
        r.raise_for_status()
        return r.json()["subscriber"]


def _active_plan(subscriber: dict) -> tuple[str, datetime | None]:
    now = datetime.now(timezone.utc)
    ents = subscriber.get("entitlements") or {}
    for plan in ENTITLEMENT_PLANS:
        e = ents.get(plan)
        if not e:
            continue
        ends = [d for d in (_parse(e.get("expires_date")), _parse(e.get("grace_period_expires_date"))) if d]
        if e.get("expires_date") is None:
            return plan, None  # lifetime / promotional without end
        if ends and max(ends) > now:
            return plan, max(ends)
    return "free", None


async def sync_user(user: User, db: AsyncSession) -> None:
    """Copy the user's plan and pack purchases from RevenueCat. Idempotent."""
    sub = await fetch_customer(str(user.id))

    user.plan, user.plan_expires_at = _active_plan(sub)

    # RevenueCat's answer is the whole truth: a pack that was refunded or
    # moved to another account (TRANSFER) is gone from its list, so drop it.
    live = {
        str(tx["id"])
        for product_id, txs in (sub.get("non_subscriptions") or {}).items()
        if product_id.startswith(PACK_PREFIX)
        for tx in txs
    }
    await db.execute(
        delete(Purchase).where(Purchase.user_id == user.id, Purchase.transaction_id.not_in(live))
        if live else delete(Purchase).where(Purchase.user_id == user.id)
    )

    for product_id, txs in (sub.get("non_subscriptions") or {}).items():
        if not product_id.startswith(PACK_PREFIX):
            continue
        for tx in txs:
            stmt = insert(Purchase).values(
                id=uuid.uuid4(),
                user_id=user.id,
                product_id=product_id,
                transaction_id=str(tx["id"]),
                purchased_at=_parse(tx.get("purchase_date")) or datetime.now(timezone.utc),
            )
            # Same transaction already stored: it may sit on the account it
            # was transferred away from, so move it to its current owner.
            await db.execute(stmt.on_conflict_do_update(
                index_elements=["transaction_id"], set_={"user_id": stmt.excluded.user_id},
            ))
    await db.commit()


async def users_for_event(event: dict, db: AsyncSession) -> list[User]:
    """Our users the webhook event touches. Purchases made before the app
    logged in to RevenueCat carry an anonymous id first, so the aliases are
    checked too; a TRANSFER (restore on another account) touches both sides.
    Ids that aren't our user UUIDs (anonymous ones) are skipped."""
    raw_ids = [
        event.get("app_user_id"), event.get("original_app_user_id"),
        *(event.get("aliases") or []),
        *(event.get("transferred_from") or []), *(event.get("transferred_to") or []),
    ]
    uids = set()
    for raw in raw_ids:
        try:
            uids.add(uuid.UUID(str(raw)))
        except (TypeError, ValueError):
            continue
    if not uids:
        return []
    return list((await db.execute(select(User).where(User.id.in_(uids)))).scalars().all())


async def owned_pack_products(user_id: uuid.UUID, db: AsyncSession) -> set[str]:
    rows = await db.execute(select(Purchase.product_id).where(Purchase.user_id == user_id))
    return set(rows.scalars().all())
