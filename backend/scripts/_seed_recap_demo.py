"""
One-off: seed a realistic Weekly Race demo for the 'Andrei Foitos' crew across
the recap window (Mon 2026-05-25 .. Sun 2026-05-31).

- Makes alex / alex2 / alex3 / lalla accepted friends of Andrei Foitos
  (andrei2 already is) -> crew of 6.
- Clears any training_logs in the window for those 6 users, then inserts a
  designed day-by-day set with lead changes + a dark-horse (lalla) who is 6th
  most days but jumps into the top-5 on Thursday.

Idempotent: re-running clears + reseeds the same window. To fully remove the
demo, delete training_logs for these users in [2026-05-25, 2026-05-31] and the
4 friendships (Andrei Foitos <-> alex/alex2/alex3/lalla).

Run:  ./venv/Scripts/python.exe scripts/_seed_recap_demo.py   (needs DATABASE_URL)
"""
import asyncio
import os
import uuid
from datetime import date, timedelta

import asyncpg

URL = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
WS = date(2026, 5, 25)  # Monday
WE = date(2026, 5, 31)  # Sunday
ME = "Andrei Foitos"
NEW_FRIENDS = ["alex", "alex2", "alex3", "lalla"]  # andrei2 already a friend

# Daily volume (kg = weight*reps), index 0=Mon .. 6=Sun. 0 = rest day.
DAILY = {
    "Andrei Foitos": [3000, 0, 5000, 0, 4000, 6000, 5000],   # wins Sunday
    "alex":          [5000, 4000, 3500, 0, 4000, 1200, 4000],  # early leader
    "alex2":         [4000, 6000, 2000, 3000, 0, 2800, 4200],  # 2nd place
    "andrei2":       [2000, 3000, 4000, 7000, 2000, 1000, 2500],  # mid-week leader
    "alex3":         [0, 2000, 3000, 2000, 7500, 3000, 2500],   # big Friday
    "lalla":         [1000, 500, 1500, 6000, 500, 500, 1000],   # dark horse (Thu)
}
EXERCISES = ["bench_press", "squat", "deadlift", "barbell_row",
             "overhead_press", "front_squat", "romanian_deadlift"]


async def main():
    conn = await asyncpg.connect(URL, statement_cache_size=0)

    # 1. Resolve users by name.
    ids = {}
    for nm in DAILY:
        row = await conn.fetchrow("SELECT id FROM users WHERE name=$1", nm)
        if not row:
            raise SystemExit(f"User not found: {nm}")
        ids[nm] = row["id"]
    me_id = ids[ME]

    # 2. Ensure accepted friendships with Andrei (either direction).
    for nm in NEW_FRIENDS:
        fid = ids[nm]
        existing = await conn.fetchrow(
            """SELECT id FROM friendships
               WHERE (requester_id=$1 AND addressee_id=$2)
                  OR (requester_id=$2 AND addressee_id=$1)""",
            me_id, fid,
        )
        if existing:
            await conn.execute(
                "UPDATE friendships SET status='accepted', accepted_at=now() WHERE id=$1",
                existing["id"],
            )
        else:
            await conn.execute(
                """INSERT INTO friendships (id, requester_id, addressee_id, status, accepted_at)
                   VALUES ($1,$2,$3,'accepted', now())""",
                uuid.uuid4(), me_id, fid,
            )

    # 3. Clear the window for all 6, then insert designed logs.
    crew_ids = list(ids.values())
    await conn.execute(
        "DELETE FROM training_logs WHERE user_id = ANY($1::uuid[]) AND date>=$2 AND date<=$3",
        crew_ids, WS, WE,
    )

    inserted = 0
    for nm, daily in DAILY.items():
        uid = ids[nm]
        for idx, vol in enumerate(daily):
            if vol <= 0:
                continue
            d = WS + timedelta(days=idx)
            reps = int(round(vol / 100))  # weight 100kg -> reps = vol/100
            await conn.execute(
                """INSERT INTO training_logs
                   (id, user_id, date, type, weight_kg, reps, intensity, source)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,'manual')""",
                uuid.uuid4(), uid, d, EXERCISES[idx], 100.0, reps, 4,
            )
            inserted += 1

    print(f"Seeded {inserted} logs across crew of {len(crew_ids)}.\n")

    # 4. Verify cumulative matches design.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for nm in DAILY:
        cum, run = [], 0
        for v in DAILY[nm]:
            run += v
            cum.append(run)
        print(f"  {nm:16} cum: " + "  ".join(f"{days[i]}={cum[i]}" for i in range(7)))
    await conn.close()


asyncio.run(main())
