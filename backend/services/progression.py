"""Progressive overload: what to aim for next session. Plain code, no AI.

Double progression. Each exercise works in a rep range; keep the weight and
add reps until every set reaches the top of the range, then add weight and
drop back to the bottom. Shared by the Training tab (rep range read off the
last session) and Pit Crew plans (rep range from the plan), so both always
give the same advice.

- Warm-up sets (under 60% of the session's top weight) are ignored.
- Weight steps: 5 kg on leg lifts, 1 kg under 20 kg (dumbbells, cables),
  2.5 kg otherwise.
- Bodyweight work: +reps; at the top of the range, add weight or a harder
  variation.
- Stalled (same top weight, no extra reps over 3 sessions): one extra set,
  or a lighter week at -10% to build back up.
"""
from __future__ import annotations

from typing import Any, Iterable, Protocol

WARMUP_SHARE = 0.6
STALL_SESSIONS = 3
# A session's best reps -> the range it was working in.
RANGES = [(5, (3, 5)), (8, (6, 8)), (12, (8, 12)), (15, (12, 15)), (10_000, (15, 20))]


class SetLike(Protocol):
    weight_kg: float | None
    reps: int | None


def range_for(reps: int) -> tuple[int, int]:
    return next(r for top, r in RANGES if reps <= top)


def step(group: str | None, weight: float) -> float:
    if weight < 20:
        return 1.0
    return 5.0 if group == "Legs" else 2.5


def round_to(weight: float, inc: float) -> float:
    return round(round(weight / inc) * inc, 1)


def _sets(raw: Iterable[Any]) -> list[tuple[float, int]]:
    """(weight, reps) for sets that have reps; weight 0 for bodyweight."""
    out = []
    for s in raw:
        reps = s["reps"] if isinstance(s, dict) else s.reps
        w = s["weight_kg"] if isinstance(s, dict) else s.weight_kg
        if reps:
            out.append((float(w or 0), int(reps)))
    return out


def working(raw: Iterable[Any]) -> list[tuple[float, int]]:
    sets = _sets(raw)
    top = max((w for w, _ in sets), default=0)
    if top <= 0:
        return sets
    return [(w, r) for w, r in sets if w >= WARMUP_SHARE * top]


def _top_summary(sets: list[tuple[float, int]]) -> tuple[float, int]:
    """(top weight, total reps at that weight)."""
    top = max(w for w, _ in sets)
    return top, sum(r for w, r in sets if w == top)


def next_target(
    sessions: list[list[Any]],
    group: str | None,
    rep_range: tuple[int, int] | None = None,
    planned_sets: int | None = None,
    start_weight: float | None = None,
    bodyweight: bool | None = None,
) -> dict:
    """`sessions`: past sessions of one exercise, oldest first, each a list of
    sets (dicts or rows with weight_kg / reps). Returns the next target:

        kind: first | start | reps | weight | stall | bodyweight_reps | bodyweight_harder
        weight_kg, reps: the headline ("82.5 kg x 8")
        sets: [{weight_kg, reps}] to pre-fill the log sheet
        range: [lo, hi]; reason: one sentence; ready_for_weight; stalled
    """
    history = [w for w in (working(s) for s in sessions) if w]
    if not history:
        lo, hi = rep_range or (8, 12)
        n = planned_sets or 3
        if start_weight:
            return _out("start", start_weight, hi, [(start_weight, hi)] * n, (lo, hi),
                        "Starting weight from your estimated 1RM.")
        return _out("first", None, hi, [], (lo, hi),
                    f"First time: pick a weight you can lift for {hi} reps with 2 to spare.")

    last = history[-1]
    is_bw = bodyweight if bodyweight is not None else all(w <= 0 for w, _ in last)

    if is_bw and all(w <= 0 for w, _ in last):
        lo, hi = rep_range or range_for(max(r for _, r in last))
        n = planned_sets or len(last)
        if len(last) >= n and all(r >= hi for _, r in last):
            return _out("bodyweight_harder", None, hi, [(0, hi)] * n, (lo, hi),
                        f"{hi} reps on every set. Add weight (vest or belt) or move to a harder variation.",
                        ready=True)
        targets = [(0, min(hi, r + 1)) for _, r in last][:n] + [(0, lo)] * max(0, n - len(last))
        return _out("bodyweight_reps", None, min(r for _, r in targets), targets, (lo, hi),
                    f"Add a rep to each set, up to {hi}. At {hi} on every set, make it harder.")

    # Ramp-up and back-off sets don't count: the range and set count come
    # from the sets at the top weight.
    top, _ = _top_summary(last)
    at_top = [r for w, r in last if w == top]
    fewest = min(at_top)
    lo, hi = rep_range or range_for(max(at_top))
    n = planned_sets or len(at_top)
    inc = step(group, top)
    # Lighter working sets after the top ones (back-offs) stay as they were
    # in the pre-fill; the target is about the top sets.
    backoff = [(w, r) for w, r in last if w < top]

    # Earned: every set at the top weight reached the top of the range, or
    # fewer sets but clearly beyond it (e.g. last plan's 12s vs this one's 6).
    if fewest >= hi and (len(at_top) >= n or fewest >= hi + 2):
        new = round_to(top + inc, inc)
        if start_weight and start_weight > new:
            return _out("start", start_weight, hi, [(start_weight, hi)] * n, (lo, hi),
                        f"A heavier rep range than your last {top:g} kg x {fewest}. "
                        f"Start at {start_weight:g} kg (from your est. 1RM).", ready=True)
        return _out("weight", new, lo, [(new, lo)] * n + backoff, (lo, hi),
                    f"You hit {hi}+ reps on every set at {top:g} kg. Go up to {new:g} kg for {lo}+ reps.",
                    ready=True)

    # Stalled: same top weight across the last 3 sessions and no more reps.
    recent = [_top_summary(s) for s in history[-STALL_SESSIONS:]]
    if (len(recent) == STALL_SESSIONS and len({w for w, _ in recent}) == 1
            and recent[-1][1] <= recent[0][1]):
        lighter = round_to(top * 0.9, inc)
        rows = [(top, r) for r in at_top] + [(top, fewest)] + backoff
        return _out("stall", top, fewest, rows, (lo, hi),
                    f"Stuck at {top:g} kg for {STALL_SESSIONS} sessions. Add one extra set today, or take a "
                    f"lighter week at {lighter:g} kg and build back up.", stalled=True)

    rows = [(top, min(hi, r + 1)) for r in at_top][:n] + [(top, lo)] * max(0, n - len(at_top))
    aims = ", ".join(str(r) for _, r in rows)
    return _out("reps", top, min(r for _, r in rows), rows + backoff, (lo, hi),
                f"Same {top:g} kg, one more rep a set: aim for {aims}. At {hi} on every set, add weight.")


def _out(kind: str, weight: float | None, reps: int, rows: list[tuple[float, int]],
         rng: tuple[int, int], reason: str, ready: bool = False, stalled: bool = False) -> dict:
    return {
        "kind": kind,
        "weight_kg": weight,
        "reps": reps,
        "sets": [{"weight_kg": (w or None), "reps": r} for w, r in rows],
        "range": list(rng),
        "reason": reason,
        "ready_for_weight": ready,
        "stalled": stalled,
    }
