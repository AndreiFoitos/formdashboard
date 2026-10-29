"""Hand edits to a Pit Crew plan, and skipping a workout.

Skipping moves today's session to tomorrow. Each later session slides one
day until a rest day absorbs the shift, so the rest of the week stays as
planned. With no rest day left, the last session drops off this week.

The plan's training days stay the template. A skip only changes one week,
stored as plan["shifts"][monday] = {"map", "skipped", "prev"}: "map" sends a
weekday to the template weekday it runs (None = no session), "prev" is the
week's state before the latest skip, for undo. Everything that asks "what
runs on this date" goes through day_for_date().
"""
from __future__ import annotations

import copy
from datetime import date, timedelta

from services.exercise_taxonomy import is_per_dumbbell
from services.plan_builder import BODYWEIGHT, _sum, start_weight

WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
KEEP_SHIFT_WEEKS = 3


class EditError(ValueError):
    pass


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _template(plan: dict) -> dict[int, dict]:
    return {d["weekday"]: d for d in (plan or {}).get("training", {}).get("days", [])}


def _shift(plan: dict, d: date) -> dict | None:
    return ((plan or {}).get("shifts") or {}).get(monday(d).isoformat())


def schedule(plan: dict, d: date) -> dict[int, int | None]:
    """{weekday: template weekday that runs that day, or None} for d's week."""
    tdays = _template(plan)
    out: dict[int, int | None] = {w: (w if w in tdays else None) for w in range(7)}
    entry = _shift(plan, d)
    for k, src in ((entry or {}).get("map") or {}).items():
        out[int(k)] = src if src in tdays else None
    return out


def day_for_date(plan: dict, d: date) -> dict | None:
    """The training day that runs on d, with weekday set to d's."""
    src = schedule(plan, d)[d.weekday()]
    if src is None:
        return None
    day = _template(plan)[src]
    return {**day, "weekday": d.weekday(), "moved_from": src if src != d.weekday() else None}


def this_week(plan: dict, today: date) -> dict:
    """For the app's week view: what runs each day this week, and which
    days were skipped."""
    sched = schedule(plan, today)
    skipped = set((_shift(plan, today) or {}).get("skipped") or [])
    return {
        "week_start": monday(today).isoformat(),
        "days": [{"weekday": w, "source": sched[w], "skipped": w in skipped} for w in range(7)],
        "shifted": _shift(plan, today) is not None,
    }


def _with_shift(plan: dict, today: date, entry: dict | None) -> dict:
    plan = dict(plan)
    keep_from = monday(today) - timedelta(weeks=KEEP_SHIFT_WEEKS)
    shifts = {k: v for k, v in (plan.get("shifts") or {}).items() if date.fromisoformat(k) >= keep_from}
    if entry is None:
        shifts.pop(monday(today).isoformat(), None)
    else:
        shifts[monday(today).isoformat()] = entry
    plan["shifts"] = shifts
    return plan


def skip_today(plan: dict, today: date) -> tuple[dict, str]:
    """Push today's session to tomorrow and slide the week up to the next
    rest day. Returns the new plan and a one-line summary."""
    sched = schedule(plan, today)
    w = today.weekday()
    if sched[w] is None:
        raise EditError("There's no session to skip today.")
    tdays = _template(plan)
    name = tdays[sched[w]]["name"]
    carry, sched[w] = sched[w], None
    absorbed = None
    for d in range(w + 1, 7):
        carry, sched[d] = sched[d], carry
        if carry is None:
            absorbed = d
            break
    if carry is not None:
        dropped = tdays[carry]["name"]
        summary = (
            f"{name} moves to {WEEKDAY_NAMES[w + 1]}. No rest day is left this week, so {dropped} drops off."
            if w < 6 else f"Skipped {name}. It's the last day of the week, so it drops off."
        )
    elif absorbed == w + 1:
        summary = f"{name} moves to {WEEKDAY_NAMES[w + 1]}, your rest day. The rest of the week stays the same."
    else:
        summary = f"{name} moves to {WEEKDAY_NAMES[w + 1]}. Sessions slide one day up to {WEEKDAY_NAMES[absorbed]}'s rest day."

    prev = _shift(plan, today)
    entry = {
        "map": {str(k): v for k, v in sched.items()},
        "skipped": sorted(set((prev or {}).get("skipped") or []) | {w}),
        "prev": copy.deepcopy(prev),
    }
    return _with_shift(plan, today, entry), summary


def undo_skip(plan: dict, today: date) -> dict:
    entry = _shift(plan, today)
    if entry is None:
        raise EditError("Nothing to undo this week.")
    return _with_shift(plan, today, entry.get("prev"))


# ─── Training edits ───────────────────────────────────────────────────────────

def apply_training(
    plan: dict,
    days: list[dict],
    catalog: dict[str, tuple[str, str]],
    one_rms: dict[str, float],
    today: date,
) -> dict:
    """Replace the training template with the user's edit. days are
    {weekday, name, focus, exercises: [{key, sets, reps_min, reps_max,
    rest_seconds, note}]}, already range-checked by the request model."""
    weekdays = [d["weekday"] for d in days]
    if len(set(weekdays)) != len(weekdays):
        raise EditError("Two sessions can't share a day.")
    out = []
    for d in sorted(days, key=lambda d: d["weekday"]):
        exs = []
        for e in d["exercises"]:
            if e["key"] not in catalog:
                raise EditError(f"Unknown exercise: {e['key']}")
            name, group = catalog[e["key"]]
            lo, hi = sorted((e["reps_min"], e["reps_max"]))
            body = e["key"] in BODYWEIGHT
            exs.append({
                "key": e["key"],
                "name": name,
                "group": group,
                "sets": e["sets"],
                "reps_min": lo,
                "reps_max": hi,
                "rest_seconds": e["rest_seconds"],
                "note": (e.get("note") or "").strip(),
                "start_weight_kg": None if body else start_weight(one_rms.get(e["key"]), hi, is_per_dumbbell(e["key"])),
                "basis": "bodyweight" if body else ("e1rm" if one_rms.get(e["key"]) else "none"),
            })
        if not exs:
            raise EditError(f"{WEEKDAY_NAMES[d['weekday']]} needs at least one exercise, or make it a rest day.")
        out.append({
            "weekday": d["weekday"],
            "name": " ".join(d["name"].split()),
            "focus": (d.get("focus") or "").strip(),
            "exercises": exs,
        })

    moved = sorted(_template(plan)) != sorted(weekdays)
    plan = copy.deepcopy(plan)
    plan["training"] = {**plan.get("training", {}), "days": out}
    plan["days_per_week"] = len(out)
    # A skip this week points at template weekdays; once days move those
    # no longer mean the same session, so this week goes back to the plan.
    return _with_shift(plan, today, None) if moved else plan


# ─── Meal edits ───────────────────────────────────────────────────────────────

def _meal_day(plan: dict, weekday: int, meal_id: str) -> tuple[dict, int]:
    n = plan.get("nutrition")
    if not n:
        raise EditError("This plan has no meals.")
    day = next((d for d in n["days"] if d["weekday"] == weekday), None)
    k = next((i for i, m in enumerate((day or {}).get("meals", [])) if m["id"] == meal_id), None)
    if day is None or k is None:
        raise EditError("That meal isn't on that day.")
    return day, k


def edit_meal(plan: dict, weekday: int, meal_id: str, grams: list[int]) -> dict:
    """New grams per item (same order as the meal's items). 0 removes an
    item. Macros scale with the grams."""
    plan = copy.deepcopy(plan)
    day, k = _meal_day(plan, weekday, meal_id)
    meal = day["meals"][k]
    if len(grams) != len(meal["items"]):
        raise EditError("The meal changed. Reload and try again.")
    items = []
    for item, g in zip(meal["items"], grams):
        if g <= 0:
            continue
        f = g / item["grams"] if item["grams"] else 1
        items.append({
            **item,
            "grams": g,
            "calories": round(item["calories"] * f),
            "protein_g": round(item["protein_g"] * f, 1),
            "carbs_g": round(item["carbs_g"] * f, 1),
            "fat_g": round(item["fat_g"] * f, 1),
        })
    if not items:
        raise EditError("Keep at least one item, or remove the meal.")
    day["meals"][k] = {**meal, "items": items, "totals": _sum(items)}
    day["totals"] = _sum([m["totals"] for m in day["meals"]])
    return plan


def remove_meal(plan: dict, weekday: int, meal_id: str) -> dict:
    plan = copy.deepcopy(plan)
    day, k = _meal_day(plan, weekday, meal_id)
    del day["meals"][k]
    day["totals"] = _sum([m["totals"] for m in day["meals"]]) if day["meals"] else {
        "calories": 0, "protein_g": 0.0, "carbs_g": 0.0, "fat_g": 0.0,
    }
    return plan
