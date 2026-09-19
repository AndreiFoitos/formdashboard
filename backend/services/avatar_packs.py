"""Paid avatar packs: one-off App Store purchases that unlock cosmetics.

Earned items (services/avatar_rewards.py) stay free for everyone; packs are
extra items on top. Each pack is sold as two App Store products with the same
content, com.gainrace.pack.<id> and a cheaper com.gainrace.pack.<id>.pro that
the app offers only to Pro subscribers (Apple has no per-customer pricing).
Owning either one unlocks the pack, forever, even after Pro lapses.

To add a pack: add it here, create both products in App Store Connect
(non-consumable) and attach them in RevenueCat. Items are ids the app knows
how to render (emote clips in assets/avatar/emotes_*.glb, aura/eyes effects
in the app's rewards visuals).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from services.billing import PACK_PREFIX


@dataclass(frozen=True)
class Pack:
    id: str
    name: str
    # slot -> item ids, same slots as avatar_rewards.EQUIP_SLOTS
    items: dict[str, frozenset[str]] = field(default_factory=dict)


PACKS: dict[str, Pack] = {}


def product_ids(pack_id: str) -> tuple[str, str]:
    """(regular product, Pro-discount product)."""
    base = f"{PACK_PREFIX}{pack_id}"
    return base, f"{base}.pro"


def pack_for_product(product_id: str) -> Pack | None:
    if not product_id.startswith(PACK_PREFIX):
        return None
    pack_id = product_id[len(PACK_PREFIX):].removesuffix(".pro")
    return PACKS.get(pack_id)


def slot_items() -> dict[str, set[str]]:
    """Every pack item by slot, so the equip validator accepts them."""
    out: dict[str, set[str]] = {}
    for p in PACKS.values():
        for slot, items in p.items.items():
            out.setdefault(slot, set()).update(items)
    return out


def items_from_products(product_ids_owned: set[str]) -> set[str]:
    owned: set[str] = set()
    for pid in product_ids_owned:
        pack = pack_for_product(pid)
        if pack:
            for items in pack.items.values():
                owned |= items
    return owned
