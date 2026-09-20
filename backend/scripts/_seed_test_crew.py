"""
One-off: wipe every user and rebuild a 15-person test crew that is fully
friended (all 105 pairs accepted), with 30 days of activity behind them.

Everything hangs off users by ON DELETE CASCADE, so `DELETE FROM users` is
enough to clear logs, friendships, votes, summaries and push tokens too.

All 15 log in with the same password (PASSWORD below) and emails u1@test.com
.. u15@test.com. Deterministic: the RNG is seeded, so re-running produces the
same crew and the same history (shifted to the new "today").

Run:  ./venv/Scripts/python.exe scripts/_seed_test_crew.py --yes
"""
import asyncio
import json
import random
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

import asyncpg
import bcrypt
from dotenv import dotenv_values

URL = dotenv_values(".env")["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")

PASSWORD = "Test1234!"
DAYS = 30
TZ = "Europe/Amsterdam"
TODAY = date.today()
WEEK_START = TODAY - timedelta(days=TODAY.weekday())  # Monday of the race week

rng = random.Random(20260920)

# --- The crew ---------------------------------------------------------------
# strength scales every working weight; freq = training days per week;
# plan mixes tiers so paywall gating is testable without buying anything.
CREW = [
    # name,           username,    sex,      age, h_cm, w_kg, strength, freq, split, plan
    ("Andrei Test",   "andrei",    "male",   24, 183, 82.0, 1.10, 5, "ppl", "pro"),
    ("Mia Chen",      "mia",       "female", 26, 166, 59.0, 0.62, 4, "ul",  "free"),
    ("Luca Rossi",    "luca",      "male",   29, 178, 79.5, 1.00, 4, "ppl", "plus"),
    ("Sofia Novak",   "sofia",     "female", 23, 171, 64.0, 0.70, 5, "ppl", "free"),
    ("Tom Bakker",    "tombakker", "male",   31, 190, 95.0, 1.25, 3, "ul",  "free"),
    ("Aisha Khan",    "aisha",     "female", 27, 163, 57.5, 0.58, 3, "fb",  "plus"),
    ("Daan Visser",   "daan",      "male",   22, 181, 77.0, 0.95, 6, "ppl", "free"),
    ("Elena Popa",    "elena",     "female", 30, 169, 62.0, 0.66, 4, "ul",  "free"),
    ("Marco Silva",   "marco",     "male",   28, 175, 84.0, 1.05, 4, "ppl", "pro"),
    ("Nora Lind",     "nora",      "female", 25, 174, 66.5, 0.74, 5, "ul",  "free"),
    ("Yusuf Demir",   "yusuf",     "male",   33, 177, 88.0, 1.15, 3, "fb",  "free"),
    ("Hana Sato",     "hana",      "female", 21, 160, 54.0, 0.52, 4, "fb",  "free"),
    ("Pieter Jansen", "pieter",    "male",   35, 186, 92.0, 0.90, 2, "ul",  "free"),
    ("Zoe Martin",    "zoe",       "female", 24, 168, 61.0, 0.68, 5, "ppl", "plus"),
    ("Kwame Osei",    "kwame",     "male",   26, 188, 90.0, 1.20, 4, "ppl", "free"),
]

# Per-user multiplier on THIS week's volume only, so the race has a real
# spread and a couple of dark horses instead of ranking by strength alone.
WEEK_BOOST = {
    "andrei": 1.15, "mia": 1.30, "luca": 0.85, "sofia": 1.35, "tombakker": 0.70,
    "aisha": 1.10, "daan": 1.20, "elena": 0.90, "marco": 1.00, "nora": 1.25,
    "yusuf": 0.80, "hana": 1.40, "pieter": 0.60, "zoe": 1.05, "kwame": 0.95,
}

SKINS = ["#f2d3b3", "#e8b98d", "#c68642", "#8d5524", "#5c3a21", "#ffdbac"]
HAIRS = ["#1a1a1a", "#3b2314", "#6b4423", "#b5651d", "#d9b382", "#7a2f2f"]
TOPS = ["#e63946", "#2a9d8f", "#264653", "#f4a261", "#457b9d", "#8338ec"]
BOTTOMS = ["#1d3557", "#343a40", "#495057", "#212529", "#3d405b"]
SHOES = ["#ffffff", "#111111", "#e5e5e5", "#ff006e", "#06d6a0"]

# --- Exercises --------------------------------------------------------------
# key -> base working weight at strength 1.0. None = bodyweight (the backend
# substitutes the user's bodyweight for volume, see friends._effective_weight).
BASE_KG = {
    "bench_press": 80, "incline_bench": 62, "db_shoulder_press": 26, "lateral_raise": 12,
    "tricep_pushdown": 32, "chest_fly": 20, "overhead_press": 50, "close_grip_bench": 65,
    "deadlift": 140, "barbell_row": 75, "lat_pulldown": 65, "cable_row": 70,
    "bicep_curl": 20, "hammer_curl": 18, "face_pull": 25, "pull_up": None,
    "squat": 110, "front_squat": 80, "romanian_dl": 100, "leg_press": 180,
    "leg_curl": 50, "leg_extension": 55, "calf_raise": 90, "hip_thrust": 120,
    "push_up": None, "hanging_leg_raise": None,
}

SPLITS = {
    "ppl": {
        0: ["bench_press", "incline_bench", "db_shoulder_press", "lateral_raise", "tricep_pushdown"],
        1: ["deadlift", "barbell_row", "lat_pulldown", "pull_up", "bicep_curl", "face_pull"],
        2: ["squat", "romanian_dl", "leg_press", "leg_curl", "calf_raise"],
    },
    "ul": {
        0: ["bench_press", "barbell_row", "overhead_press", "lat_pulldown", "bicep_curl", "tricep_pushdown"],
        1: ["squat", "romanian_dl", "leg_press", "leg_extension", "calf_raise", "hanging_leg_raise"],
    },
    "fb": {
        0: ["squat", "bench_press", "barbell_row", "db_shoulder_press", "hanging_leg_raise"],
        1: ["deadlift", "incline_bench", "lat_pulldown", "hip_thrust", "push_up"],
    },
}

# freq -> which weekdays (0=Mon) are training days
TRAINING_DAYS = {
    2: [1, 4], 3: [0, 2, 4], 4: [0, 1, 3, 4],
    5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5],
}

MEALS = [
    ("breakfast", 420, 32, 45, 12), ("lunch", 720, 48, 70, 24),
    ("dinner", 830, 55, 78, 30), ("snack", 260, 22, 24, 9),
]
MEAL_HOUR = {"breakfast": 8, "lunch": 13, "dinner": 19, "snack": 16}
DRINKS = [("water", 500), ("water", 750), ("water", 330), ("protein_shake", 400), ("coffee", 200)]
STIMS = [
    ("coffee", 95, 5.5, 5, 0.3, 0.6, 0.2),
    ("espresso", 64, 5.5, 3, 0.1, 0.5, 0.1),
    ("preworkout", 200, 5.5, 10, 0.0, 2.0, 0.0),
    ("energy_drink", 160, 5.5, 110, 0.0, 27.0, 0.0),
]


def at(d: date, hour: int, minute: int = 0) -> datetime:
    """A UTC timestamp for a wall clock on day d."""
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=timezone.utc)


def mifflin(sex: str, w: float, h: float, age: int) -> int:
    bmr = 10 * w + 6.25 * h - 5 * age + (5 if sex == "male" else -161)
    return int(round(bmr * 1.55 / 10) * 10)


async def main(confirmed: bool) -> None:
    conn = await asyncpg.connect(URL, statement_cache_size=0)

    before = await conn.fetchval("SELECT count(*) FROM users")
    if not confirmed:
        print(f"Would DELETE {before} users (and all their data) -- pass --yes to run.")
        await conn.close()
        return

    print(f"Deleting {before} users (cascades to all child tables)...")
    await conn.execute("DELETE FROM users")

    pw_hash = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=12)).decode()
    plan_expiry = datetime.now(timezone.utc) + timedelta(days=365)

    ids: dict[str, uuid.UUID] = {}

    for i, (name, username, sex, age, h, w, strength, freq, split, plan) in enumerate(CREW, start=1):
        uid = uuid.uuid4()
        ids[username] = uid
        avatar = {
            "v": 1,
            "look": {
                "skin": SKINS[i % len(SKINS)], "hair": HAIRS[i % len(HAIRS)],
                "top": TOPS[i % len(TOPS)], "bottom": BOTTOMS[i % len(BOTTOMS)],
                "shoes": SHOES[i % len(SHOES)],
            },
            "body": {
                "fat": round(max(0.05, 0.45 - strength * 0.2), 2),
                "muscle": round(min(0.95, strength * 0.65), 2),
                "height_scale": round(min(1.2, max(0.8, 0.9 + (h - 160) / 120)), 3),
                "applied_at": TODAY.isoformat(),
            },
            "frozen": False,
            "share_body": True,
        }
        await conn.execute(
            """
            INSERT INTO users (id, email, hashed_password, username, name, age, height_cm,
                               weight_kg, sex, timezone, sleep_hour, onboarding_complete,
                               created_at, protein_target_g, water_target_ml, calorie_target,
                               avatar, plan, plan_expires_at, form_score_unlocked)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$13,$14,$15,$16::jsonb,$17,$18,true)
            """,
            uid, f"u{i}@test.com", pw_hash, username, name, age, float(h), w, sex, TZ,
            [22, 23, 23, 0][i % 4], at(TODAY - timedelta(days=DAYS + 5), 12),
            float(round(w * 2)), int(w * 35), mifflin(sex, w, h, age),
            json.dumps(avatar), plan,
            plan_expiry if plan != "free" else None,
        )
        await conn.execute(
            "INSERT INTO onboarding_baselines (id, user_id, avg_sleep_hours, training_frequency, "
            "caffeine_habit) VALUES ($1,$2,$3,$4,$5)",
            uuid.uuid4(), uid, rng.choice([6.5, 7.0, 7.5, 8.0]),
            {2: "0-1x", 3: "2-3x", 4: "2-3x", 5: "4-5x", 6: "6x+"}[freq],
            rng.choice(["none", "1_coffee", "2-3", "preworkout"]),
        )
    print(f"Created {len(ids)} users.")

    # --- Everyone friends with everyone: 15*14/2 = 105 accepted rows ---------
    handles = [c[1] for c in CREW]
    pairs = [(a, b) for x, a in enumerate(handles) for b in handles[x + 1:]]
    await conn.executemany(
        "INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, accepted_at) "
        "VALUES ($1,$2,$3,'accepted',$4,$5)",
        [
            (uuid.uuid4(), ids[a], ids[b],
             at(TODAY - timedelta(days=DAYS), 10), at(TODAY - timedelta(days=DAYS), 11))
            for a, b in pairs
        ],
    )
    print(f"Created {len(pairs)} accepted friendships (fully connected).")

    # --- 30 days of activity ------------------------------------------------
    training, nutrition, hydration, stimulants, summaries, body = [], [], [], [], [], []
    log_ids: dict[str, list] = {}

    for name, username, sex, age, h, w, strength, freq, split, plan in CREW:
        uid = ids[username]
        days_of_week = TRAINING_DAYS[freq]
        blocks = SPLITS[split]
        block_n = 0
        streak_run, best_run, current_streak = 0, 0, 0
        weight_now = w

        for back in range(DAYS - 1, -1, -1):
            d = TODAY - timedelta(days=back)
            boost = WEEK_BOOST[username] if d >= WEEK_START else 1.0
            trained = d.weekday() in days_of_week and rng.random() > 0.08
            # Progressive overload: ~0.4% per week of working weight.
            prog = 1 + (DAYS - back) * 0.0006

            day_cals = day_p = day_c = day_f = 0.0
            training_type = None

            if trained:
                exercises = blocks[block_n % len(blocks)]
                block_n += 1
                training_type = exercises[0]
                for ex in exercises:
                    base = BASE_KG[ex]
                    sets = rng.randint(3, 4)
                    for s in range(1, sets + 1):
                        reps = rng.randint(5, 12)
                        if base is None:
                            kg = None  # bodyweight -- backend substitutes user weight
                        else:
                            kg = round(base * strength * prog * boost * rng.uniform(0.92, 1.05) / 2.5) * 2.5
                        lid = uuid.uuid4()
                        log_ids.setdefault(username, []).append((lid, d))
                        training.append((
                            lid, uid, d, ex, None, rng.randint(6, 9), s, kg, reps,
                            None, "manual", at(d, rng.randint(17, 20), rng.randint(0, 59)),
                        ))

            # Meals
            for meal, cal, p, c, f in MEALS:
                if meal == "snack" and rng.random() < 0.35:
                    continue
                scale = (0.75 + strength * 0.35) * rng.uniform(0.82, 1.18)
                cals = int(cal * scale)
                pg, cg, fg = round(p * scale, 1), round(c * scale, 1), round(f * scale, 1)
                day_cals += cals
                day_p += pg
                day_c += cg
                day_f += fg
                nutrition.append((
                    uuid.uuid4(), uid, d, cals, pg, cg, fg, meal,
                    rng.choice(["manual", "photo", "barcode"]),
                    at(d, MEAL_HOUR[meal], rng.randint(0, 50)),
                ))

            # Water
            water = 0
            for _ in range(rng.randint(3, 6)):
                src, ml = rng.choice(DRINKS)
                water += ml
                hydration.append((uuid.uuid4(), uid, at(d, rng.randint(8, 22), rng.randint(0, 59)), ml, src))

            # Caffeine
            caffeine = 0
            for _ in range(rng.randint(0, 3)):
                sub, mg, hl, cal, p, c, f = rng.choice(STIMS)
                caffeine += mg
                day_cals += cal
                day_p += p
                day_c += c
                day_f += f
                stimulants.append((
                    uuid.uuid4(), uid, at(d, rng.randint(7, 17), rng.randint(0, 59)),
                    sub, mg, hl, cal, p, c, f, json.dumps([]), None,
                ))

            # Streak: any activity counts, and every day here has meals logged.
            streak_run += 1
            best_run = max(best_run, streak_run)
            current_streak = streak_run

            form = 55 + (18 if trained else 0) + min(12, water // 300) + rng.randint(-6, 8)
            form = max(35, min(98, form))
            summaries.append((
                uuid.uuid4(), uid, d, form, rng.randint(60, 95), rng.randint(45, 90),
                rng.randint(50, 95), rng.randint(3500, 14000), rng.randint(250, 900),
                water, caffeine, int(day_cals), round(day_p, 1), round(day_c, 1), round(day_f, 1),
                trained, training_type, None, None, "manual", False, at(d, 23),
            ))

            # Weekly weigh-in, drifting slightly
            if d.weekday() == 0:
                weight_now = round(weight_now + rng.uniform(-0.4, 0.3), 1)
                body.append((uuid.uuid4(), uid, d, weight_now,
                             round(max(7.0, 26 - strength * 9 + rng.uniform(-1.5, 1.5)), 1),
                             "manual", at(d, 7, 30)))

        await conn.execute(
            "INSERT INTO streaks (user_id, current_streak, longest_streak, last_processed_date) "
            "VALUES ($1,$2,$3,$4)",
            uid, current_streak, best_run, TODAY,
        )

    await conn.executemany(
        "INSERT INTO training_logs (id,user_id,date,type,duration_min,intensity,volume_sets,"
        "weight_kg,reps,notes,source,logged_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        training)
    await conn.executemany(
        "INSERT INTO nutrition_logs (id,user_id,date,calories,protein_g,carbs_g,fat_g,meal_name,"
        "source,logged_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", nutrition)
    await conn.executemany(
        "INSERT INTO hydration_logs (id,user_id,logged_at,amount_ml,source) VALUES ($1,$2,$3,$4,$5)",
        hydration)
    await conn.executemany(
        "INSERT INTO stimulant_logs (id,user_id,logged_at,substance,caffeine_mg,half_life_hours,"
        "calories,protein_g,carbs_g,fat_g,additions,note) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)", stimulants)
    await conn.executemany(
        "INSERT INTO daily_summaries (id,user_id,date,form_score,sleep_score,hrv_score,"
        "readiness_score,steps,active_calories,water_ml,caffeine_mg,calories_eaten,protein_g,"
        "carbs_g,fat_g,trained,training_type,notes,ai_digest,data_source,is_estimated,created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)",
        summaries)
    await conn.executemany(
        "INSERT INTO body_metrics (id,user_id,date,weight_kg,body_fat_pct,source,logged_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7)", body)

    print(f"Logs: {len(training)} training, {len(nutrition)} nutrition, {len(hydration)} hydration, "
          f"{len(stimulants)} stimulant, {len(summaries)} daily summaries, {len(body)} weigh-ins.")

    # --- Social: sus votes + vouches on this week ----------------------------
    # tombakker and kwame get enough weekly sus votes to trip the badge;
    # andrei and sofia get vouched. Plus a couple of per-lift call-outs.
    sus, vouch = [], []
    for target, voters in [("tombakker", ["mia", "luca", "sofia", "daan", "nora"]),
                           ("kwame", ["elena", "hana", "zoe", "yusuf"])]:
        for v in voters:
            sus.append((uuid.uuid4(), ids[v], ids[target], WEEK_START, None, at(TODAY, 12)))
    for target, voters in [("andrei", ["luca", "marco", "daan", "zoe"]),
                           ("sofia", ["mia", "nora", "hana"])]:
        for v in voters:
            vouch.append((uuid.uuid4(), ids[v], ids[target], WEEK_START, None, at(TODAY, 12)))
    tom_week = [(lid, d) for lid, d in log_ids.get("tombakker", []) if d >= WEEK_START]
    for lid, _ in tom_week[:2]:
        for v in ["mia", "sofia"]:
            sus.append((uuid.uuid4(), ids[v], ids["tombakker"], WEEK_START, lid, at(TODAY, 13)))

    await conn.executemany(
        "INSERT INTO sus_votes (id,voter_id,target_user_id,week_start,training_log_id,created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6)", sus)
    await conn.executemany(
        "INSERT INTO vouches (id,voter_id,target_user_id,week_start,training_log_id,created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6)", vouch)
    print(f"Social: {len(sus)} sus votes, {len(vouch)} vouches.")

    # --- This week's race standings -----------------------------------------
    rows = await conn.fetch(
        """
        SELECT u.username, u.name,
               round(sum(coalesce(t.weight_kg, u.weight_kg) * t.reps)::numeric) AS vol
        FROM training_logs t JOIN users u ON u.id = t.user_id
        WHERE t.date >= $1 GROUP BY u.username, u.name ORDER BY vol DESC
        """,
        WEEK_START,
    )
    print(f"\nWeekly race (from {WEEK_START}):")
    for n, r in enumerate(rows, 1):
        print(f"  {n:2}. {r['name']:15} @{r['username']:11} {int(r['vol']):>8,} kg")

    await conn.close()
    print(f"\nLogin: u1@test.com .. u15@test.com   password: {PASSWORD}")


asyncio.run(main("--yes" in sys.argv))
