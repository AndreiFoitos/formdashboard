"""1RM estimation from rep work — three published formulas + their mean.

Three formulas; we return the mean of the three because no single one
dominates across rep ranges. Brzycki is only defined for reps ≤ 10 (the
denominator goes nonsensical past 10), so we skip it for high-rep sets.

- Epley:    weight × (1 + reps/30)            — valid 1–10 reps, OK to ~15
- Brzycki:  weight × 36 / (37 - reps)         — valid 1–10 reps only
- Lombardi: weight × reps^0.10                — broader rep range
"""
from __future__ import annotations


def epley(weight_kg: float, reps: int) -> float:
    return weight_kg * (1 + reps / 30.0)


def brzycki(weight_kg: float, reps: int) -> float | None:
    if reps >= 37:
        return None
    return weight_kg * 36.0 / (37.0 - reps)


def lombardi(weight_kg: float, reps: int) -> float:
    return weight_kg * (reps ** 0.10)


def estimate(weight_kg: float, reps: int) -> dict:
    """Return per-formula + mean 1RM. 1-rep input → all three equal weight_kg."""
    if reps <= 0 or weight_kg <= 0:
        return {"epley": None, "brzycki": None, "lombardi": None, "mean": None}
    if reps == 1:
        return {
            "epley": weight_kg,
            "brzycki": weight_kg,
            "lombardi": weight_kg,
            "mean": weight_kg,
        }
    e = epley(weight_kg, reps)
    # Brzycki only valid for reps ≤ 10; above that the formula over-estimates
    # heavily, so we drop it from the mean rather than clamp.
    b = brzycki(weight_kg, reps) if reps <= 10 else None
    l = lombardi(weight_kg, reps)
    pieces = [x for x in (e, b, l) if x is not None]
    mean = sum(pieces) / len(pieces) if pieces else None
    return {
        "epley": round(e, 1) if e is not None else None,
        "brzycki": round(b, 1) if b is not None else None,
        "lombardi": round(l, 1) if l is not None else None,
        "mean": round(mean, 1) if mean is not None else None,
    }
