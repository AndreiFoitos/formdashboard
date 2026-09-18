"""Offline eval: does sending more angles of a plate improve the photo-calorie
estimate, and what does each extra angle cost?

Ground truth is Nutrition5k (Google, CC BY 4.0): real cafeteria plates with
every ingredient weighed, an overhead photo, and side-angle videos from up to
four fixed cameras. Conditions:

    v1  overhead only                 (what the app sends today)
    v2  overhead + one side angle
    v3  overhead + two side angles
    v1cal  overhead only, with a portion-calibration rule added to the prompt
    v1usda overhead only, run with USDA enabled (same prompt as v1 at run time)
    v1fndds   overhead only, FNDDS added to the USDA search, grams path (no pick step)
    v1portion overhead only, FNDDS + pick step (entry and household portion chosen by the model)

Each condition runs through the production pipeline (services.nutrition_estimate:
Claude vision -> USDA / Claude fallback -> totals), so the calorie error is what
a user would see. Mass error (sum of estimated grams vs. weighed total) isolates
the portion-size judgment from the nutrition lookup.

    # 1) download a sample (only the first ~3 MB of each side video is fetched;
    #    raw H.264 decodes fine from its start)
    python -m scripts.eval_food_views prepare --data <dir> --n 100

    # 2) run the model and score (spends API credits; prints the bill)
    python -m scripts.eval_food_views run --data <dir> --conditions v1,v2,v3

Needs opencv-python-headless for `prepare` only (not a backend dependency).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import random
import statistics
import sys
import time
import urllib.request
from pathlib import Path

BUCKET = "https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset"
LIST_API = "https://storage.googleapis.com/storage/v1/b/nutrition5k_dataset/o"
SIDE_BYTES = (3_000_000, 8_000_000)  # try the small range first, widen if too few frames
SIDE_FRAME_INDEX = 3  # skip the first frames in case the capture was settling
SAFETY_FRAMES = 3  # complete frames required after the chosen one
MAX_EDGE = 1568  # same as the app's client-side resize

# Sonnet 5 list prices, $/token. Keep in sync with services/ai_client.CLAUDE_MODEL.
PRICE_IN = 2.00 / 1_000_000
PRICE_OUT = 10.00 / 1_000_000


# ─── prepare ──────────────────────────────────────────────────────────────────

def _get(url: str, byte_range: tuple[int, int] | None = None) -> bytes:
    req = urllib.request.Request(url)
    if byte_range:
        req.add_header("Range", f"bytes={byte_range[0]}-{byte_range[1]}")
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def _side_cameras(dish: str) -> list[str]:
    url = f"{LIST_API}?fields=items(name)&prefix=nutrition5k_dataset/imagery/side_angles/{dish}/"
    items = json.loads(_get(url)).get("items", [])
    return sorted(
        Path(i["name"]).stem.split("_")[1] for i in items if i["name"].endswith(".h264")
    )


def _load_metadata() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for cafe in ("cafe1", "cafe2"):
        text = _get(f"{BUCKET}/metadata/dish_metadata_{cafe}.csv").decode()
        for row in csv.reader(io.StringIO(text)):
            if not row:
                continue
            ingredients = []
            rest = row[6:]
            for i in range(0, len(rest) - 6, 7):
                ingredients.append({"name": rest[i + 1], "grams": float(rest[i + 2])})
            out[row[0]] = {
                "calories": float(row[1]),
                "mass_g": float(row[2]),
                "fat_g": float(row[3]),
                "carbs_g": float(row[4]),
                "protein_g": float(row[5]),
                "ingredients": ingredients,
            }
    return out


def _frame_jpeg(h264: bytes, tmp: Path, flip: bool) -> bytes | None:
    """Pick one frame from the start of a truncated stream. The last frames
    decoded from a cut-off stream are smeared garbage, so the chosen frame
    must have several complete frames after it; otherwise return None and
    let the caller fetch more bytes."""
    import cv2  # prepare-only dependency

    tmp.write_bytes(h264)
    cap = cv2.VideoCapture(str(tmp))
    frames = []
    while len(frames) <= SIDE_FRAME_INDEX + SAFETY_FRAMES:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    if len(frames) <= SIDE_FRAME_INDEX + SAFETY_FRAMES:
        return None
    frame = frames[SIDE_FRAME_INDEX]
    if flip:
        frame = cv2.rotate(frame, cv2.ROTATE_180)
    h, w = frame.shape[:2]
    scale = MAX_EDGE / max(h, w)
    if scale < 1:
        frame = cv2.resize(frame, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes() if ok else None


def _png_to_jpeg(png: bytes) -> bytes:
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return buf.tobytes()


def prepare(data: Path, n: int, seed: int, flip_cameras: set[str]) -> None:
    data.mkdir(parents=True, exist_ok=True)
    meta = _load_metadata()
    # depth_test ids all have an overhead RGB image and are held out from the
    # paper's training data.
    ids = _get(f"{BUCKET}/dish_ids/splits/depth_test_ids.txt").decode().split()
    ids = [d for d in ids if d in meta and 30 <= meta[d]["mass_g"] <= 1500 and meta[d]["calories"] > 20]
    random.Random(seed).shuffle(ids)

    manifest_path = data / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    have = {m["dish"] for m in manifest}
    tmp = data / "_tmp.h264"

    for dish in ids:
        if len(manifest) >= n:
            break
        if dish in have:
            continue
        cams = _side_cameras(dish)
        if len(cams) < 2:
            continue
        d = data / dish
        d.mkdir(exist_ok=True)
        try:
            (d / "overhead.jpg").write_bytes(
                _png_to_jpeg(_get(f"{BUCKET}/imagery/realsense_overhead/{dish}/rgb.png"))
            )
            sides = []
            for cam in cams[:2]:
                jpg = None
                for size in SIDE_BYTES:
                    raw = _get(f"{BUCKET}/imagery/side_angles/{dish}/camera_{cam}.h264", (0, size - 1))
                    jpg = _frame_jpeg(raw, tmp, flip=cam in flip_cameras)
                    if jpg is not None:
                        break
                if jpg is None:
                    raise RuntimeError(f"no frame from camera_{cam}")
                (d / f"side_{cam}.jpg").write_bytes(jpg)
                sides.append(f"side_{cam}.jpg")
        except Exception as e:  # skip unusable dishes, keep going
            print(f"skip {dish}: {e}", file=sys.stderr)
            continue
        manifest.append({"dish": dish, "overhead": "overhead.jpg", "sides": sides, **meta[dish]})
        manifest_path.write_text(json.dumps(manifest, indent=1))
        print(f"[{len(manifest)}/{n}] {dish} cams={cams[:2]}")
    tmp.unlink(missing_ok=True)


# ─── run ──────────────────────────────────────────────────────────────────────

class UsageMeter:
    """Wraps the shared Anthropic client so every call's real token usage is
    recorded, tagged with whatever tag is active for the current task."""

    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.tag = __import__("contextvars").ContextVar("tag", default=None)

    def install(self) -> None:
        import services.ai_client as ai_client

        client = ai_client.get_client()
        original = client.messages.create
        meter = self

        async def create(*args, **kwargs):
            resp = await original(*args, **kwargs)
            u = resp.usage
            meter.rows.append({
                "tag": meter.tag.get(),
                "vision": any(
                    isinstance(b, dict) and b.get("type") == "image"
                    for m in kwargs.get("messages", [])
                    for b in (m["content"] if isinstance(m["content"], list) else [])
                ),
                "in": u.input_tokens,
                "out": u.output_tokens,
                "stop": resp.stop_reason,
            })
            return resp

        client.messages.create = create


def _memoize_usda(enabled: bool) -> None:
    """USDA allows 1,000 req/hour per key; the same ingredient names recur
    across dishes and conditions, so cache lookups by name for the run.
    With enabled=False every ingredient goes to the Claude fallback (use when
    api.nal.usda.gov is unreachable from the machine running the eval)."""
    import services.nutrition_estimate as ne

    cache: dict[str, list] = {}
    original = ne.search_foods

    async def search_foods(name, n, client):
        if not enabled:
            return []
        key = f"{name.strip().lower()}|{n}"
        if key not in cache:
            cache[key] = await original(name, n=n, client=client)
        return cache[key]

    ne.search_foods = search_foods


CONDITIONS = {"v1": 0, "v2": 1, "v3": 2, "v1cal": 0, "v1usda": 0, "v1fndds": 0, "v1portion": 0}  # number of side angles added to overhead

# Prompt variants, keyed by condition. Anything not listed uses the production prompt.
PORTION_CALIBRATION = (
    "\n- Judge sizes against the plate: a standard dinner plate is about 26 cm across "
    "(a side plate about 20 cm). For each item, estimate how much of the plate it covers "
    "and how tall it is before converting to grams.\n"
    "- Portions are often smaller than typical restaurant servings. When unsure between "
    "two amounts, choose the smaller one."
)


def _system_for(cond: str) -> str:
    from services.nutrition_estimate import VISION_SYSTEM

    return VISION_SYSTEM + PORTION_CALIBRATION if cond.endswith("cal") else VISION_SYSTEM


async def run(data: Path, conditions: list[str], limit: int | None, concurrency: int, out: Path, usda: bool) -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from services.nutrition_estimate import estimate_from_photos

    manifest = json.loads((data / "manifest.json").read_text())
    if limit:
        manifest = manifest[:limit]

    meter = UsageMeter()
    meter.install()
    _memoize_usda(usda)

    results_path = out
    done = set()
    results: list[dict] = []
    if results_path.exists():
        for line in results_path.read_text().splitlines():
            r = json.loads(line)
            results.append(r)
            done.add((r["dish"], r["cond"]))

    sem = asyncio.Semaphore(concurrency)
    lock = asyncio.Lock()

    async def one(m: dict, cond: str) -> None:
        if (m["dish"], cond) in done:
            return
        d = data / m["dish"]
        images = [(d / m["overhead"]).read_bytes()]
        images += [(d / s).read_bytes() for s in m["sides"][: CONDITIONS[cond]]]
        async with sem:
            tag = f"{m['dish']}:{cond}"
            meter.tag.set(tag)
            t0 = time.monotonic()
            row = {"dish": m["dish"], "cond": cond, "gt_kcal": m["calories"], "gt_mass": m["mass_g"]}
            try:
                est = await estimate_from_photos(
                    images,
                    system=_system_for(cond),
                    pick_portions=cond == "v1portion",
                )
                row.update(
                    ok=True,
                    kcal=est["totals"]["calories"],
                    mass=sum(i["grams"] for i in est["items"]),
                    n_items=len(est["items"]),
                    dish_name=est["dish"],
                    items=[
                        {k: i.get(k) for k in ("name", "grams", "calories", "source", "usda_name", "portion")}
                        for i in est["items"]
                    ],
                )
            except Exception as e:
                row.update(ok=False, error=f"{type(e).__name__}: {e}"[:300])
            row["secs"] = round(time.monotonic() - t0, 1)
            calls = [u for u in meter.rows if u["tag"] == tag]
            row["vision_in"] = sum(u["in"] for u in calls if u["vision"])
            row["vision_out"] = sum(u["out"] for u in calls if u["vision"])
            row["fallback_in"] = sum(u["in"] for u in calls if not u["vision"])
            row["fallback_out"] = sum(u["out"] for u in calls if not u["vision"])
            row["stop"] = next((u["stop"] for u in calls if u["vision"]), None)
            async with lock:
                results.append(row)
                with results_path.open("a") as f:
                    f.write(json.dumps(row) + "\n")
                print(
                    f"{len(results):4d} {tag:28s} "
                    + (f"kcal {row['kcal']:5.0f} vs {m['calories']:5.0f}" if row.get("ok") else row["error"][:60])
                )

    await asyncio.gather(*(one(m, c) for m in manifest for c in conditions))
    report(results, conditions)


def _bootstrap_ci(diffs: list[float], iters: int = 5000, seed: int = 0) -> tuple[float, float]:
    rng = random.Random(seed)
    n = len(diffs)
    means = sorted(statistics.fmean(rng.choices(diffs, k=n)) for _ in range(iters))
    return means[int(0.025 * iters)], means[int(0.975 * iters)]


def report(results: list[dict], conditions: list[str]) -> None:
    by = {c: {r["dish"]: r for r in results if r["cond"] == c} for c in conditions}
    # Only dishes where every condition succeeded, so comparisons are paired.
    common = set.intersection(*({d for d, r in by[c].items() if r.get("ok")} for c in conditions))

    def cost(r: dict) -> float:
        return (r["vision_in"] + r["fallback_in"]) * PRICE_IN + (r["vision_out"] + r["fallback_out"]) * PRICE_OUT

    print(f"\n{len(common)} dishes scored in every condition\n")
    hdr = f"{'cond':5s} {'kcal MAE':>9s} {'kcal MAPE':>10s} {'kcal bias':>10s} {'mass MAPE':>10s} " \
          f"{'fail':>5s} {'in tok':>7s} {'out tok':>8s} {'$/scan':>8s} {'secs':>5s}"
    print(hdr)
    print("-" * len(hdr))
    abs_err: dict[str, dict[str, float]] = {}
    for c in conditions:
        rows = [by[c][d] for d in common]
        all_rows = list(by[c].values())
        ae = {r["dish"]: abs(r["kcal"] - r["gt_kcal"]) for r in rows}
        abs_err[c] = ae
        mape = statistics.fmean(abs(r["kcal"] - r["gt_kcal"]) / r["gt_kcal"] for r in rows) * 100
        bias = statistics.fmean((r["kcal"] - r["gt_kcal"]) / r["gt_kcal"] for r in rows) * 100
        mass = statistics.fmean(abs(r["mass"] - r["gt_mass"]) / r["gt_mass"] for r in rows) * 100
        fails = sum(1 for r in all_rows if not r.get("ok"))
        print(
            f"{c:5s} {statistics.fmean(ae.values()):9.0f} {mape:9.1f}% {bias:+9.1f}% {mass:9.1f}% "
            f"{fails:5d} {statistics.fmean(r['vision_in'] + r['fallback_in'] for r in all_rows):7.0f} "
            f"{statistics.fmean(r['vision_out'] + r['fallback_out'] for r in all_rows):8.0f} "
            f"{statistics.fmean(cost(r) for r in all_rows):8.4f} {statistics.fmean(r['secs'] for r in all_rows):5.1f}"
        )

    base = conditions[0]
    for c in conditions[1:]:
        diffs = [abs_err[c][d] - abs_err[base][d] for d in common]
        lo, hi = _bootstrap_ci(diffs)
        better = sum(1 for x in diffs if x < 0)
        print(
            f"\n{c} vs {base}: kcal abs error change {statistics.fmean(diffs):+.0f} kcal "
            f"(95% CI {lo:+.0f} to {hi:+.0f}); {c} closer on {better}/{len(diffs)} dishes"
        )

    stops = {}
    for r in results:
        stops[(r["cond"], r.get("stop"))] = stops.get((r["cond"], r.get("stop")), 0) + 1
    print("\nvision stop reasons:", {f"{k[0]}:{k[1]}": v for k, v in sorted(stops.items(), key=str)})
    total = sum(cost(r) for r in results)
    print(f"total spend this results file: ${total:.2f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--n", type=int, default=100)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--flip", default="", help="comma-separated cameras mounted upside down, e.g. C,D")
    r = sub.add_parser("run")
    r.add_argument("--data", type=Path, required=True)
    r.add_argument("--conditions", default="v1,v2,v3")
    r.add_argument("--limit", type=int)
    r.add_argument("--concurrency", type=int, default=4)
    r.add_argument("--out", type=Path, help="results .jsonl (resumable); default <data>/results.jsonl")
    r.add_argument("--no-usda", action="store_true", help="skip USDA; all macros via the Claude fallback")
    s = sub.add_parser("report")
    s.add_argument("--results", type=Path, required=True)
    s.add_argument("--conditions", default="v1,v2,v3")
    a = ap.parse_args()

    if a.cmd == "prepare":
        prepare(a.data, a.n, a.seed, {c for c in a.flip.split(",") if c})
    elif a.cmd == "run":
        asyncio.run(run(a.data, a.conditions.split(","), a.limit, a.concurrency, a.out or a.data / "results.jsonl", not a.no_usda))
    else:
        rows = [json.loads(l) for l in a.results.read_text().splitlines()]
        report(rows, a.conditions.split(","))


if __name__ == "__main__":
    main()
