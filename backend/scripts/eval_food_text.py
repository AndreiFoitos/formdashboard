"""Offline eval for "Describe a meal": how close are estimates from a typed
description, and how often does the range the app shows contain the truth?

Ground truth is the same Nutrition5k sample as scripts/eval_food_views.py
(Google, CC BY 4.0: every ingredient weighed), read from its manifest.json,
so text and photo results compare on the same plates.

Descriptions: Claude writes, once per dish, how a person might describe the
plate at three levels of detail. They are cached in text_descriptions.json so
every condition reads the same words.

    exact  every food with its weight
    rough  main foods with rounded or ranged amounts, small things loosely
    vague  household words only, no numbers

exact and rough are written from the true weights, so they measure the
parsing and nutrition lookup, not how well people judge weight. vague
measures the model's portion guesses too.

Your own weighed meals (decision D8-C) go in <data>/my_meals.json as
[{"id": "...", "text": "what you'd type", "calories": 640}, ...]. They run as
level "own".

Conditions (engine x model):

    grounded        parse -> USDA -> pick (services.nutrition_text), Sonnet 5.5
    direct          one call, Claude's own numbers (D1-A baseline), Sonnet 5.5
    grounded_haiku  / direct_haiku   the same on Haiku 5.5. grounded_haiku is
                    what the app runs since 2026-11-17 (TEXT_MODEL).
    grounded_opus   / direct_opus    the same on Opus 5.5

    # 1) write the descriptions (spends API credits; asks first)
    python -m scripts.eval_food_text describe --data scripts/.n5k_data

    # 2) run and score (spends API credits; prints an estimate and asks first)
    python -m scripts.eval_food_text run --data scripts/.n5k_data --conditions grounded,direct

    # 3) re-print the tables from a results file
    python -m scripts.eval_food_text report --data scripts/.n5k_data --conditions grounded,direct
"""
from __future__ import annotations

import argparse
import asyncio
import contextvars
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_DATA = Path(__file__).resolve().parent / ".n5k_data"
LEVELS = ("exact", "rough", "vague")

# List prices, $/token (input, output).
PRICES = {
    "claude-sonnet-5-5": (2.00 / 1_000_000, 10.00 / 1_000_000),
    "claude-haiku-5-5": (0.10 / 1_000_000, 0.50 / 1_000_000),
    "claude-opus-5-5": (4.00 / 1_000_000, 20.00 / 1_000_000),
}

# condition -> (engine, model for every call, the fallback included)
CONDITIONS = {
    "grounded": ("grounded", "claude-sonnet-5-5"),
    "direct": ("direct", "claude-sonnet-5-5"),
    "grounded_haiku": ("grounded", "claude-haiku-5-5"),
    "direct_haiku": ("direct", "claude-haiku-5-5"),
    "grounded_opus": ("grounded", "claude-opus-5-5"),
    "direct_opus": ("direct", "claude-opus-5-5"),
}

# $ per describe, only for the estimate printed before a run. Measured in the
# 2026-11-17 run for Sonnet and grounded Haiku; the rest scaled.
EST_COST = {
    ("grounded", "claude-sonnet-5-5"): 0.017, ("direct", "claude-sonnet-5-5"): 0.010,
    ("grounded", "claude-haiku-5-5"): 0.0012, ("direct", "claude-haiku-5-5"): 0.0007,
    ("grounded", "claude-opus-5-5"): 0.034, ("direct", "claude-opus-5-5"): 0.020,
}
EST_DESCRIBE_COST = 0.005


def _confirm(what: str, dollars: float, yes: bool) -> None:
    print(f"{what}: estimated ${dollars:.2f} in API credits.")
    if yes:
        return
    if input("Go ahead? [y/N] ").strip().lower() != "y":
        sys.exit("Cancelled.")


class UsageMeter:
    """Wraps the shared Anthropic client: records every call's real token
    usage under the active tag, and applies the condition's model override to
    every call (the Claude fallback included)."""

    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.tag = contextvars.ContextVar("tag", default=None)
        self.model = contextvars.ContextVar("model", default=None)

    def install(self) -> None:
        import services.ai_client as ai_client

        client = ai_client.get_client()
        original = client.messages.create
        meter = self

        async def create(*args, **kwargs):
            if override := meter.model.get():
                kwargs["model"] = override
                # Thinking off is "between_tools" on Sonnet 5.5 and "disabled"
                # on Haiku 5.5; Opus 5.5 can't turn it off, so it gets low
                # effort instead.
                off = kwargs.get("thinking", {}).get("type") in ("between_tools", "disabled")
                if off and override == "claude-opus-5-5":
                    kwargs.pop("thinking")
                    kwargs["output_config"] = {**kwargs.get("output_config", {}), "effort": "low"}
                elif off:
                    kwargs["thinking"] = (
                        {"type": "between_tools"} if override == "claude-sonnet-5-5" else {"type": "disabled"}
                    )
            resp = await original(*args, **kwargs)
            u = resp.usage
            p_in, p_out = PRICES[kwargs["model"]]
            meter.rows.append({
                "tag": meter.tag.get(),
                "cost": u.input_tokens * p_in + u.output_tokens * p_out,
                "in": u.input_tokens,
                "out": u.output_tokens,
                "stop": resp.stop_reason,
            })
            return resp

        client.messages.create = create


# ─── describe ─────────────────────────────────────────────────────────────────

DESCRIBE_SYSTEM = (
    "You write how a person would tell a calorie-tracking app what they just ate, given "
    "the weighed ingredients of their plate. Write three versions, each in first person, "
    "past tense, one or two casual sentences:\n"
    "- \"exact\": every food with its weight in grams, rounded to the nearest 5 g.\n"
    "- \"rough\": like someone who eyeballed it: the main foods with rounded or ranged "
    "amounts (\"about 150 g\", \"150-200 g\"), small things described loosely (\"a drizzle "
    "of oil\", \"a bit of cheese\"). Casual wording and the odd typo are fine.\n"
    "- \"vague\": household words only, no numbers or units (\"a bowl of\", \"some\", \"a "
    "couple of pieces of\").\n"
    "Use everyday food names, not database names, and group ingredients the way a person "
    "would name the dish (\"a chicken salad with ...\"). Leave out salt, pepper, spices and "
    "herbs under 3 g, as people do. Never mention calories or macros."
)

DESCRIBE_SCHEMA = {
    "type": "object",
    "properties": {k: {"type": "string"} for k in LEVELS},
    "required": list(LEVELS),
    "additionalProperties": False,
}


async def describe(data: Path, limit: int | None, yes: bool) -> None:
    from services.ai_client import call_claude_structured

    manifest = json.loads((data / "manifest.json").read_text())[: limit or None]
    path = data / "text_descriptions.json"
    out: dict[str, dict] = json.loads(path.read_text()) if path.exists() else {}
    todo = [m for m in manifest if m["dish"] not in out]
    if not todo:
        print(f"All {len(manifest)} dishes already described in {path}")
        return
    _confirm(f"Describe {len(todo)} dishes", len(todo) * EST_DESCRIBE_COST, yes)

    meter = UsageMeter()
    meter.install()
    sem = asyncio.Semaphore(4)

    async def one(m: dict) -> None:
        ingredients = "\n".join(f"- {i['name']}: {i['grams']:g} g" for i in m["ingredients"])
        async with sem:
            out[m["dish"]] = await call_claude_structured(
                DESCRIBE_SYSTEM,
                [{"role": "user", "content": f"Ingredients:\n{ingredients}"}],
                DESCRIBE_SCHEMA,
                max_tokens=4000,
            )
        path.write_text(json.dumps(out, indent=1))
        print(f"[{len(out)}] {m['dish']}: {out[m['dish']]['rough']}")

    await asyncio.gather(*(one(m) for m in todo))
    print(f"spent ${sum(r['cost'] for r in meter.rows):.2f}")


# ─── run ──────────────────────────────────────────────────────────────────────

def _cases(data: Path, levels: list[str], limit: int | None) -> list[dict]:
    """One case per (dish, level), plus the user's own meals as level "own"."""
    cases = []
    manifest = json.loads((data / "manifest.json").read_text())[: limit or None]
    texts = json.loads((data / "text_descriptions.json").read_text())
    for m in manifest:
        for level in levels:
            if level in LEVELS and m["dish"] in texts:
                cases.append({"id": m["dish"], "level": level, "text": texts[m["dish"]][level],
                              "gt_kcal": m["calories"]})
    own = data / "my_meals.json"
    if "own" in levels and own.exists():
        for m in json.loads(own.read_text()):
            cases.append({"id": m["id"], "level": "own", "text": m["text"],
                          "gt_kcal": float(m["calories"])})
    return cases


async def run(data: Path, conditions: list[str], levels: list[str], limit: int | None,
              concurrency: int, usda: bool, yes: bool) -> None:
    from scripts.eval_food_views import _memoize_usda
    from services.nutrition_text import estimate_from_text, estimate_from_text_direct

    out = data / "text_results.jsonl"
    results = [json.loads(l) for l in out.read_text().splitlines()] if out.exists() else []
    # A failed API call (credit, rate limit, network) is retried on the next
    # run; a reply with no foods in it is a result and is kept.
    done = {(r["id"], r["level"], r["cond"]) for r in results
            if r.get("ok") or r.get("error") == "no items"}
    cases = _cases(data, levels, limit)
    todo = [(c, cond) for c in cases for cond in conditions if (c["id"], c["level"], cond) not in done]
    if not todo:
        report(results, conditions, levels)
        return
    _confirm(f"{len(todo)} estimates", sum(EST_COST[CONDITIONS[cond]] for _, cond in todo), yes)

    meter = UsageMeter()
    meter.install()
    _memoize_usda(usda)
    sem = asyncio.Semaphore(concurrency)
    lock = asyncio.Lock()

    async def one(case: dict, cond: str) -> None:
        engine, model = CONDITIONS[cond]
        fn = estimate_from_text if engine == "grounded" else estimate_from_text_direct
        async with sem:
            tag = f"{case['id']}:{case['level']}:{cond}"
            meter.tag.set(tag)
            meter.model.set(model)
            t0 = time.monotonic()
            row = {"id": case["id"], "level": case["level"], "cond": cond,
                   "text": case["text"], "gt_kcal": case["gt_kcal"]}
            try:
                est = await fn(case["text"], model=model)
                row.update(
                    ok=bool(est["items"]),
                    kcal=est["totals"]["calories"],
                    low=est["calories_low"],
                    high=est["calories_high"],
                    items=[{k: i.get(k) for k in ("name", "grams", "calories", "calories_low",
                                                  "calories_high", "source", "usda_name",
                                                  "portion", "assumption")}
                           for i in est["items"]],
                )
                if not est["items"]:
                    row["error"] = "no items"
            except Exception as e:
                row.update(ok=False, error=f"{type(e).__name__}: {e}"[:300])
            row["secs"] = round(time.monotonic() - t0, 1)
            calls = [u for u in meter.rows if u["tag"] == tag]
            row["cost"] = sum(u["cost"] for u in calls)
            row["calls"] = len(calls)
            async with lock:
                results.append(row)
                with out.open("a") as f:
                    f.write(json.dumps(row) + "\n")
                print(f"{len(results):4d} {tag:34s} "
                      + (f"kcal {row['kcal']:5.0f} ({row['low']}-{row['high']}) vs {case['gt_kcal']:5.0f}"
                         if row.get("ok") else row["error"][:60]))

    await asyncio.gather(*(one(c, cond) for c, cond in todo))
    report(results, conditions, levels)


# ─── report ───────────────────────────────────────────────────────────────────

def report(results: list[dict], conditions: list[str], levels: list[str]) -> None:
    from scripts.eval_food_views import _bootstrap_ci

    print()
    hdr = (f"{'cond':15s} {'level':6s} {'n':>4s} {'kcal MAE':>9s} {'med APE':>8s} {'bias':>7s} "
           f"{'in range':>9s} {'width':>6s} {'fail':>5s} {'$/each':>8s} {'secs':>5s}")
    print(hdr)
    print("-" * len(hdr))
    for level in [*levels, "all"]:
        # Only cases every condition scored, so the comparison is paired.
        def rows_for(cond: str) -> dict:
            return {(r["id"], r["level"]): r for r in results
                    if r["cond"] == cond and (level == "all" or r["level"] == level)}
        by = {c: rows_for(c) for c in conditions}
        common = set.intersection(*({k for k, r in by[c].items() if r.get("ok")} for c in conditions))
        if not common:
            continue
        for c in conditions:
            rows = [by[c][k] for k in common]
            err = [r["kcal"] - r["gt_kcal"] for r in rows]
            ape = [abs(e) / r["gt_kcal"] * 100 for e, r in zip(err, rows)]
            inside = sum(1 for r in rows if r["low"] <= r["gt_kcal"] <= r["high"]) / len(rows) * 100
            width = statistics.median((r["high"] - r["low"]) / max(r["kcal"], 1) * 100 for r in rows)
            fails = sum(1 for r in by[c].values() if not r.get("ok"))
            # Cost and time of successful estimates only: a failed call
            # costs nothing and returns at once.
            print(
                f"{c:15s} {level:6s} {len(rows):4d} {statistics.fmean(abs(e) for e in err):9.0f} "
                f"{statistics.median(ape):7.1f}% {statistics.fmean(e / r['gt_kcal'] for e, r in zip(err, rows)) * 100:+6.1f}% "
                f"{inside:8.0f}% {width:5.0f}% {fails:5d} "
                f"{statistics.fmean(r['cost'] for r in rows):8.4f} "
                f"{statistics.fmean(r['secs'] for r in rows):5.1f}"
            )
        if level == "all" and len(conditions) > 1:
            base = conditions[0]
            for c in conditions[1:]:
                diffs = [abs(by[c][k]["kcal"] - by[c][k]["gt_kcal"])
                         - abs(by[base][k]["kcal"] - by[base][k]["gt_kcal"]) for k in common]
                lo, hi = _bootstrap_ci(diffs)
                better = sum(1 for x in diffs if x < 0)
                print(f"\n{c} vs {base}: kcal abs error change {statistics.fmean(diffs):+.0f} kcal "
                      f"(95% CI {lo:+.0f} to {hi:+.0f}); {c} closer on {better}/{len(diffs)}")
        print()
    print("in range = share of meals whose true kcal is inside the range shown; "
          "width = median range width as % of the estimate.")
    print(f"total spend in this results file: ${sum(r.get('cost', 0) for r in results):.2f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("describe")
    d.add_argument("--data", type=Path, default=DEFAULT_DATA)
    d.add_argument("--limit", type=int)
    d.add_argument("--yes", action="store_true", help="skip the cost confirmation")
    r = sub.add_parser("run")
    r.add_argument("--data", type=Path, default=DEFAULT_DATA)
    r.add_argument("--conditions", default="grounded,direct")
    r.add_argument("--levels", default="exact,rough,vague,own")
    r.add_argument("--limit", type=int, help="first N dishes only (a smoke run)")
    r.add_argument("--concurrency", type=int, default=4)
    r.add_argument("--no-usda", action="store_true", help="skip USDA; all macros via the Claude fallback")
    r.add_argument("--yes", action="store_true", help="skip the cost confirmation")
    s = sub.add_parser("report")
    s.add_argument("--data", type=Path, default=DEFAULT_DATA)
    s.add_argument("--conditions", default="grounded,direct")
    s.add_argument("--levels", default="exact,rough,vague,own")
    a = ap.parse_args()

    if a.cmd == "describe":
        asyncio.run(describe(a.data, a.limit, a.yes))
    elif a.cmd == "run":
        conds = a.conditions.split(",")
        unknown = [c for c in conds if c not in CONDITIONS]
        if unknown:
            sys.exit(f"unknown conditions: {unknown}; pick from {list(CONDITIONS)}")
        asyncio.run(run(a.data, conds, a.levels.split(","), a.limit, a.concurrency, not a.no_usda, a.yes))
    else:
        rows = [json.loads(l) for l in (a.data / "text_results.jsonl").read_text().splitlines()]
        report(rows, a.conditions.split(","), a.levels.split(","))


if __name__ == "__main__":
    main()
