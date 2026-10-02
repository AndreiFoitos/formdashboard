"""Packaged-food lookup by barcode via Open Food Facts.

OFF is free and needs no key, but asks every client to send a User-Agent
naming the app and a contact. Coverage of European (incl. Romanian) products is
good; US coverage is thinner. Values are per 100 g, or per 100 ml for drinks.
"""
import re

import httpx

OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{code}"
OFF_FIELDS = ",".join([
    "product_name",
    "product_name_en",
    "brands",
    "nutriments",
    "serving_quantity",
    "serving_quantity_unit",
    "product_quantity",
    "product_quantity_unit",
    "quantity",
    "image_front_small_url",
])
USER_AGENT = "GainRace/1.0 (andreifoitos4@gmail.com)"
KJ_PER_KCAL = 4.184


class InvalidBarcode(ValueError):
    pass


def normalize_barcode(raw: str) -> str:
    """Digits only, length and GTIN check digit validated.

    The check digit catches nearly every typo in a hand-typed code, so the
    user hears "check the number" instead of "product not found"."""
    code = "".join(ch for ch in raw if ch not in " -")
    if not code.isdigit() or len(code) not in (8, 12, 13, 14):
        raise InvalidBarcode("A barcode is 8, 12, 13 or 14 digits.")
    body, check = code[:-1], int(code[-1])
    # GTIN: weights 3,1,3,1… from the rightmost body digit.
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    if (10 - total % 10) % 10 != check:
        raise InvalidBarcode("That barcode number doesn't check out. Double-check the digits.")
    return code


def lookup_variants(code: str) -> list[str]:
    """Spellings of the same GTIN that OFF may have filed the product under.

    iOS reports UPC-A as a 13-digit EAN with a leading 0, Android as 12
    digits; OFF holds whichever one a contributor scanned."""
    variants = [code]
    if len(code) == 12:
        variants.append("0" + code)
    elif len(code) == 13 and code.startswith("0"):
        variants.append(code[1:])
    return variants


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 else None


def _unit(u) -> str:
    return "ml" if str(u or "").strip().lower() in ("ml", "cl", "l") else "g"


_QUANTITY_RE = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(g|gr|kg|ml|cl|l)\b", re.I)
_TO_BASE = {"g": 1, "gr": 1, "kg": 1000, "ml": 1, "cl": 10, "l": 1000}


def _parse_quantity(text) -> tuple[float, str] | None:
    """"330 ml" -> (330, "ml"), "1 kg" -> (1000, "g"). Multipacks like
    "4 x 125 g" don't match on purpose: the pack total isn't one portion."""
    m = _QUANTITY_RE.match(str(text or ""))
    if not m:
        return None
    unit = m.group(2).lower()
    return float(m.group(1).replace(",", ".")) * _TO_BASE[unit], _unit(unit)


def parse_product(code: str, product: dict) -> dict:
    """OFF product -> our payload. per_100g is None when OFF has no calories,
    which happens for contributor-added products nobody filled in yet."""
    n = product.get("nutriments") or {}
    kcal = _num(n.get("energy-kcal_100g"))
    if kcal is None:
        kj = _num(n.get("energy-kj_100g")) or _num(n.get("energy_100g"))
        kcal = kj / KJ_PER_KCAL if kj is not None else None

    per_100g = None
    if kcal is not None:
        per_100g = {
            "calories": round(kcal),
            "protein_g": round(_num(n.get("proteins_100g")) or 0, 1),
            "carbs_g": round(_num(n.get("carbohydrates_100g")) or 0, 1),
            "fat_g": round(_num(n.get("fat_100g")) or 0, 1),
        }

    name = (product.get("product_name") or product.get("product_name_en") or "").strip()
    brand = (product.get("brands") or "").split(",")[0].strip() or None
    serving = _num(product.get("serving_quantity"))
    package = _num(product.get("product_quantity"))
    unit = _unit(product.get("product_quantity_unit") or product.get("serving_quantity_unit"))
    # OFF omits product_quantity from some responses; the free-text quantity
    # is nearly always there.
    if package is None and (parsed := _parse_quantity(product.get("quantity"))):
        package, q_unit = parsed
        if not (product.get("product_quantity_unit") or product.get("serving_quantity_unit")):
            unit = q_unit
    return {
        "barcode": code,
        "name": name or "Unnamed product",
        "brand": brand,
        "per_100g": per_100g,
        # The unit _100g values and the amounts below are in.
        "unit": unit,
        "serving_qty": round(serving, 1) if serving else None,
        "package_qty": round(package, 1) if package else None,
        "image_url": product.get("image_front_small_url"),
    }


async def fetch_product(code: str, client: httpx.AsyncClient) -> dict | None:
    """Look the code up on OFF. None = OFF doesn't know it. Raises
    httpx.HTTPError when OFF can't be reached or errors."""
    for variant in lookup_variants(code):
        r = await client.get(
            OFF_PRODUCT_URL.format(code=variant),
            params={"fields": OFF_FIELDS},
            headers={"User-Agent": USER_AGENT},
            timeout=8.0,
        )
        if r.status_code == 404:
            continue
        r.raise_for_status()
        data = r.json()
        if data.get("status") == 1 and data.get("product"):
            return parse_product(code, data["product"])
    return None
