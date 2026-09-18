"""Avatar rewards: daily habit combos + lifetime milestones.

Everything is evaluated server-side from logged data, so rewards can't be
granted by a client. The catalog below is the single source of truth; the app
mirrors ids/names/visuals in lib/avatar/rewards.ts.

Guardrails (deliberate product decisions):
  - Nothing rewards unhealthy amounts: caffeine above 400 mg, or calories far
    off target, never satisfies a recipe. `too_wired` is a warning, not a prize.
  - Nothing rewards body-composition change. Only effort (training, logging,
    streaks) unlocks items.
  - Legendary milestones also require having been "Trusted" (>= 2 vouches in
    some week), so they can't be farmed with fake logs.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import user_today
from models.avatar_achievement import AvatarAchievement
from models.daily_summary import DailySummary
from models.friendship import Friendship
from models.streak import Streak
from models.training_log import TrainingLog
from models.user import User
from models.vouch import Vouch
from services.social_notifications import BODYWEIGHT_EXERCISES
from services.stimulants import get_caffeine_curve

GOLDEN_AFTER_DAYS = 7
BACKFILL_DAYS = 120
TRUSTED_MIN_VOUCHES = 2
MAX_REWARDED_CAFFEINE_MG = 400
RACE_LOOKBACK_WEEKS = 52

# ─── Catalog ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Day:
    trained: bool
    protein_g: float
    water_ml: float
    calories: float
    caffeine_mg: float
    caffeine_at_bed_mg: float
    protein_target: float | None
    water_target: float | None
    calorie_target: float | None

    @property
    def protein_hit(self) -> bool:
        return bool(self.protein_target) and self.protein_g >= self.protein_target

    @property
    def water_hit(self) -> bool:
        return bool(self.water_target) and self.water_ml >= self.water_target

    @property
    def calorie_ratio(self) -> float | None:
        if not self.calorie_target or self.calories <= 0:
            return None
        return self.calories / self.calorie_target

    @property
    def calories_on_target(self) -> bool:
        r = self.calorie_ratio
        return r is not None and 0.9 <= r <= 1.1

    @property
    def safe_caffeine(self) -> bool:
        return self.caffeine_mg <= MAX_REWARDED_CAFFEINE_MG

    @property
    def preworkout_caffeine(self) -> bool:
        return 150 <= self.caffeine_mg <= MAX_REWARDED_CAFFEINE_MG


@dataclass(frozen=True)
class Combo:
    id: str
    name: str
    rarity: str  # common | rare | epic | legendary
    recipe: str
    reward: str | None  # item id; None = effect only (no unlock)
    has_art: bool
    secret: bool
    check: Callable[[Day], bool]


def _ratio_between(d: Day, lo: float, hi: float) -> bool:
    r = d.calorie_ratio
    return r is not None and lo <= r <= hi


COMBOS: list[Combo] = [
    Combo("gorilla_mode", "Gorilla Mode", "epic", "Trained + protein hit + water hit + 150–400 mg caffeine",
          "head_gorilla", False, True,
          lambda d: d.trained and d.protein_hit and d.water_hit and d.preworkout_caffeine),
    Combo("pre_workout_demon", "Pre-Workout Demon", "rare", "Trained + 150–400 mg caffeine",
          "eyes_demon", True, False,
          lambda d: d.trained and d.preworkout_caffeine),
    Combo("bulk_szn", "Bulk Szn", "rare", "Trained + protein hit + calories 10–25% over target",
          "top_stringer", False, False,
          lambda d: d.trained and d.protein_hit and _ratio_between(d, 1.1, 1.25)),
    Combo("shredder", "Shredder", "rare", "Trained + protein hit + calories 10–25% under target",
          "frame_shredded", True, False,
          lambda d: d.trained and d.protein_hit and _ratio_between(d, 0.75, 0.9)),
    Combo("rest_day_royalty", "Rest Day Royalty", "rare", "No training + protein, water and calories on target",
          "head_crown", False, False,
          lambda d: not d.trained and d.protein_hit and d.water_hit and d.calories_on_target),
    Combo("hydro_homie", "Hydro Homie", "common", "Trained + water ≥ 120% of target",
          "colorway_aqua", True, False,
          lambda d: d.trained and bool(d.water_target) and d.water_ml >= 1.2 * d.water_target),
    Combo("protein_goblin", "Protein Goblin", "common", "Protein ≥ 130% of target",
          "hand_shaker", False, False,
          lambda d: bool(d.protein_target) and d.protein_g >= 1.3 * d.protein_target),
    Combo("clean_machine", "Clean Machine", "rare", "Every target hit + under 100 mg caffeine",
          "aura_blue", True, False,
          lambda d: d.protein_hit and d.water_hit and d.calories_on_target and d.caffeine_mg < 100),
    Combo("perfect_day", "Perfect Day", "epic", "Trained + every target hit + caffeine ≤ 400 mg",
          "colorway_gold", True, True,
          lambda d: d.trained and d.protein_hit and d.water_hit and d.calories_on_target and d.safe_caffeine),
    Combo("too_wired", "Too Wired", "common", "400+ mg caffeine, or 100+ mg still in you at bedtime",
          None, True, False,
          lambda d: d.caffeine_mg > MAX_REWARDED_CAFFEINE_MG or d.caffeine_at_bed_mg >= 100),
]
COMBOS_BY_ID = {c.id: c for c in COMBOS}


@dataclass(frozen=True)
class Milestone:
    id: str
    name: str
    rarity: str
    description: str
    reward: str
    has_art: bool
    metric: str  # key into the stats dict
    target: float
    needs_trusted: bool = False
    evaluated: bool = True  # False = tracked later (needs data we don't aggregate yet)


MILESTONES: list[Milestone] = [
    Milestone("volume_10k", "10 Tonne Club", "common", "Lift 10,000 kg in total", "wrist_wraps", False, "volume_kg", 10_000),
    Milestone("volume_100k", "100 Tonne Club", "rare", "Lift 100,000 kg in total", "lifting_belt", False, "volume_kg", 100_000),
    Milestone("volume_1m", "The Million", "legendary", "Lift 1,000,000 kg in total", "beard_million", False, "volume_kg", 1_000_000, needs_trusted=True),
    Milestone("workouts_50", "Gym Rat", "rare", "Train on 50 different days", "headband_gym_rat", False, "workout_days", 50),
    Milestone("workouts_365", "Year of Iron", "legendary", "Train on 365 different days", "gold_chain", False, "workout_days", 365, needs_trusted=True),
    Milestone("streak_7", "On Fire", "common", "Reach a 7-day streak", "aura_flame", True, "longest_streak", 7),
    Milestone("streak_30", "Blue Flame", "epic", "Reach a 30-day streak", "aura_flame_blue", True, "longest_streak", 30),
    Milestone("first_pr", "First PR", "common", "Set your first PR", "frame_pr", True, "pr_count", 1),
    Milestone("prs_25", "PR Machine", "rare", "Set 25 PRs", "frame_pr_gold", True, "pr_count", 25),
    Milestone("race_win", "Champion", "epic", "Win a weekly race (crown for the next week)", "crown_champion", False, "race_wins", 1),
    Milestone("vouched_10", "Certified", "rare", "Get vouched 10 times", "frame_trusted", True, "vouches", 10),
    Milestone("water_30", "Gallon Gang", "rare", "Hit your water target on 30 days", "hand_gallon", False, "water_days", 30),
]
MILESTONES_BY_ID = {m.id: m for m in MILESTONES}

# Look colors only available after unlocking a colorway (checked on avatar save).
EXCLUSIVE_COLORS: dict[str, set[str]] = {
    "colorway_aqua": {"#06b6d4", "#0e7490", "#67e8f9"},
    "colorway_gold": {"#d4a017", "#8a6d1d", "#f5d061"},
}

# Equippable items by slot (see schemas/avatar.AvatarEquipped).
# ─── Emotes (podium) ─────────────────────────────────────────────────────────
# Clips live in the app (assets/avatar/emotes_*.glb, built by
# tools/avatar/build_emotes.py). Free ones are owned by everyone; the rest are
# a second reward on an existing combo/milestone. (kind, id, needs_golden)
FREE_EMOTES = {
    "wave", "clap", "cheer", "fist_pump", "thumbs_up",
    "salute", "point", "victory_jump", "blow_kiss", "bicep_curl",
}
EMOTE_UNLOCKS: dict[str, tuple[str, str, bool]] = {
    "beast_mode": ("combo", "gorilla_mode", False),
    "shadow_boxing": ("combo", "pre_workout_demon", True),
    "cow_milking": ("combo", "bulk_szn", False),
    "drop_kick": ("combo", "shredder", False),
    "rumba_dancing": ("combo", "rest_day_royalty", False),
    "silly_dancing": ("combo", "hydro_homie", False),
    "breakdance": ("combo", "hydro_homie", True),
    "shake_chug": ("combo", "protein_goblin", False),
    "shrugging": ("combo", "clean_machine", False),
    "singing": ("combo", "perfect_day", False),
    "hip_hop": ("combo", "perfect_day", True),
    "loser": ("milestone", "volume_10k", False),
    "victory_pose": ("milestone", "volume_100k", False),
    "entry": ("milestone", "workouts_50", False),
    "backflip": ("milestone", "streak_30", False),
    "dismiss": ("milestone", "prs_25", False),
    "king_pose": ("milestone", "race_win", False),
    "taunt": ("milestone", "vouched_10", False),
    "swing_dancing": ("milestone", "water_30", False),
}
ALL_EMOTES = FREE_EMOTES | set(EMOTE_UNLOCKS)


def emotes_for(kind: str, ident: str) -> dict[str, str | None]:
    """{"emote": id unlocked by the source, "emote_golden": id unlocked by its golden upgrade}."""
    out: dict[str, str | None] = {"emote": None, "emote_golden": None}
    for emote, (k, i, golden) in EMOTE_UNLOCKS.items():
        if k == kind and i == ident:
            out["emote_golden" if golden else "emote"] = emote
    return out


EQUIP_SLOTS: dict[str, set[str]] = {
    "aura": {"aura_blue", "aura_flame", "aura_flame_blue"},
    "frame": {"frame_shredded", "frame_pr", "frame_pr_gold", "frame_trusted"},
    "eyes": {"eyes_demon"},
    "emote": ALL_EMOTES,
}

RARITY_ORDER = {"common": 0, "rare": 1, "epic": 2, "legendary": 3}


# ─── Stats ────────────────────────────────────────────────────────────────────

def _day_from_summary(s: DailySummary, user: User, caffeine_at_bed: float = 0.0) -> Day:
    return Day(
        trained=bool(s.trained),
        protein_g=float(s.protein_g or 0),
        water_ml=float(s.water_ml or 0),
        calories=float(s.calories_eaten or 0),
        caffeine_mg=float(s.caffeine_mg or 0),
        caffeine_at_bed_mg=caffeine_at_bed,
        protein_target=user.protein_target_g,
        water_target=user.water_target_ml,
        calorie_target=user.calorie_target,
    )


def count_prs(logs: list[tuple[str, date, float]]) -> int:
    """PRs per the app's methodology: an exercise's best set in an ISO week beats
    every set of that exercise in the prior 90 days (which must be non-empty)."""
    by_ex: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for ex, d, w in logs:
        if w and w > 0:
            by_ex[ex].append((d, w))
    prs = 0
    for sets in by_ex.values():
        sets.sort()
        weeks: dict[date, float] = {}
        for d, w in sets:
            wk = d - timedelta(days=d.weekday())
            weeks[wk] = max(weeks.get(wk, 0.0), w)
        for wk, best in weeks.items():
            prior = [w for d, w in sets if wk - timedelta(days=90) <= d < wk]
            if prior and best > max(prior):
                prs += 1
    return prs


async def _stats(user: User, db: AsyncSession) -> dict[str, float]:
    uid = user.id
    volume = await db.scalar(
        select(func.coalesce(func.sum(TrainingLog.weight_kg * TrainingLog.reps), 0.0)).where(
            TrainingLog.user_id == uid, TrainingLog.weight_kg.is_not(None), TrainingLog.reps.is_not(None)
        )
    )
    workout_days = await db.scalar(
        select(func.count(func.distinct(TrainingLog.date))).where(TrainingLog.user_id == uid)
    )
    streak = await db.scalar(select(Streak.longest_streak).where(Streak.user_id == uid))
    vouches = await db.scalar(select(func.count(Vouch.id)).where(Vouch.target_user_id == uid))
    water_days = 0
    if user.water_target_ml:
        water_days = await db.scalar(
            select(func.count(DailySummary.id)).where(
                DailySummary.user_id == uid, DailySummary.water_ml >= user.water_target_ml
            )
        ) or 0
    pr_rows = (
        await db.execute(
            select(TrainingLog.type, TrainingLog.date, TrainingLog.weight_kg).where(
                TrainingLog.user_id == uid, TrainingLog.weight_kg.is_not(None)
            )
        )
    ).all()
    return {
        "volume_kg": float(volume or 0),
        "workout_days": float(workout_days or 0),
        "longest_streak": float(streak or 0),
        "vouches": float(vouches or 0),
        "water_days": float(water_days),
        "pr_count": float(count_prs([(r[0], r[1], r[2]) for r in pr_rows])),
    }


async def _race_record(user: User, db: AsyncSession, today: date) -> tuple[int, bool]:
    """(weeks won, won the most recent completed week).

    A win = most kg moved (weight x reps, bodyweight exercises use body weight,
    same as the weekly race) in a completed Mon-Sun week, against the user's
    current crew. Needs at least one friend and a non-zero total; ties all win.
    """
    friendships = (
        await db.execute(
            select(Friendship.requester_id, Friendship.addressee_id).where(
                Friendship.status == "accepted",
                or_(Friendship.requester_id == user.id, Friendship.addressee_id == user.id),
            )
        )
    ).all()
    friend_ids = {a if b == user.id else b for a, b in friendships}
    if not friend_ids:
        return 0, False
    circle = [user.id, *friend_ids]

    body_weight = dict((await db.execute(select(User.id, User.weight_kg).where(User.id.in_(circle)))).all())
    this_monday = today - timedelta(days=today.weekday())
    start = this_monday - timedelta(weeks=RACE_LOOKBACK_WEEKS)
    logs = (
        await db.execute(
            select(TrainingLog.user_id, TrainingLog.date, TrainingLog.type, TrainingLog.weight_kg, TrainingLog.reps).where(
                TrainingLog.user_id.in_(circle), TrainingLog.date >= start, TrainingLog.date < this_monday
            )
        )
    ).all()

    volume: dict[date, dict[uuid.UUID, float]] = defaultdict(lambda: defaultdict(float))
    for uid, d, ex_type, weight, reps in logs:
        if weight is not None:
            w = float(weight)
        elif ex_type in BODYWEIGHT_EXERCISES and body_weight.get(uid):
            w = float(body_weight[uid])
        else:
            w = 0.0
        volume[d - timedelta(days=d.weekday())][uid] += w * (reps or 0)

    won_weeks = [
        week for week, by_user in volume.items()
        if (top := max(by_user.values(), default=0)) > 0 and by_user.get(user.id, 0) == top
    ]
    return len(won_weeks), (this_monday - timedelta(weeks=1)) in won_weeks


async def _was_ever_trusted(user_id: uuid.UUID, db: AsyncSession) -> bool:
    row = await db.execute(
        select(Vouch.week_start)
        .where(Vouch.target_user_id == user_id)
        .group_by(Vouch.week_start)
        .having(func.count(Vouch.id) >= TRUSTED_MIN_VOUCHES)
        .limit(1)
    )
    return row.first() is not None


# ─── Sync + read ──────────────────────────────────────────────────────────────

async def _record(db: AsyncSession, user_id: uuid.UUID, key: str, day: date) -> None:
    stmt = (
        pg_insert(AvatarAchievement)
        .values(id=uuid.uuid4(), user_id=user_id, key=key, date=day, seen=False)
        .on_conflict_do_nothing(constraint="uq_avatar_achievement_day")
    )
    await db.execute(stmt)


def owned_items(rows: list[AvatarAchievement]) -> set[str]:
    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[r.key] += 1
    owned: set[str] = set(FREE_EMOTES)
    for key, n in counts.items():
        kind, _, ident = key.partition(":")
        item = (COMBOS_BY_ID[ident].reward if kind == "combo" and ident in COMBOS_BY_ID
                else MILESTONES_BY_ID[ident].reward if kind == "milestone" and ident in MILESTONES_BY_ID
                else None)
        if item:
            owned.add(item)
            if kind == "combo" and n >= GOLDEN_AFTER_DAYS:
                owned.add(f"{item}_gold")
    for emote, (kind, ident, needs_golden) in EMOTE_UNLOCKS.items():
        n = counts.get(f"{kind}:{ident}", 0)
        if n > 0 and (not needs_golden or n >= GOLDEN_AFTER_DAYS):
            owned.add(emote)
    return owned


async def load_owned(user_id: uuid.UUID, db: AsyncSession) -> set[str]:
    rows = (await db.execute(select(AvatarAchievement).where(AvatarAchievement.user_id == user_id))).scalars().all()
    return owned_items(list(rows))


async def sync_and_describe(user: User, db: AsyncSession) -> dict:
    """Record any newly hit combos (today + backfill) and reached milestones, then
    return today's active combos, owned items, unseen unlocks and the full dex."""
    today = user_today(user.timezone)

    summaries = (
        await db.execute(
            select(DailySummary).where(
                DailySummary.user_id == user.id,
                DailySummary.date >= today - timedelta(days=BACKFILL_DAYS),
                DailySummary.date <= today,
            )
        )
    ).scalars().all()

    caffeine = await get_caffeine_curve(user.id, db, user.sleep_hour, tz_name=user.timezone)
    bed_mg = float(caffeine.get("caffeine_at_bedtime") or 0)

    active_today: list[str] = []
    for s in summaries:
        is_today = s.date == today
        d = _day_from_summary(s, user, bed_mg if is_today else 0.0)
        for c in COMBOS:
            if not c.check(d):
                continue
            if is_today:
                active_today.append(c.id)
            if c.reward:  # effect-only combos (too_wired) are never recorded
                await _record(db, user.id, f"combo:{c.id}", s.date)

    stats = await _stats(user, db)
    race_wins, champion = await _race_record(user, db, today)
    stats["race_wins"] = float(race_wins)
    trusted = await _was_ever_trusted(user.id, db)
    for m in MILESTONES:
        if m.evaluated and stats[m.metric] >= m.target and (trusted or not m.needs_trusted):
            await _record(db, user.id, f"milestone:{m.id}", today)
    await db.commit()

    rows = list((await db.execute(select(AvatarAchievement).where(AvatarAchievement.user_id == user.id))).scalars().all())
    owned = owned_items(rows)
    days_by_key: dict[str, int] = defaultdict(int)
    for r in rows:
        days_by_key[r.key] += 1

    # Unseen unlocks. Per key: a first unlock (no row shown yet) and/or a golden
    # upgrade (crossed GOLDEN_AFTER_DAYS since the rows the user already saw).
    unseen_by_key: dict[str, int] = defaultdict(int)
    for r in rows:
        if not r.seen:
            unseen_by_key[r.key] += 1
    new: list[dict] = []
    for key, unseen in unseen_by_key.items():
        kind, _, ident = key.partition(":")
        entry = COMBOS_BY_ID.get(ident) if kind == "combo" else MILESTONES_BY_ID.get(ident)
        if not entry:
            continue
        total = days_by_key[key]
        seen_before = total - unseen
        first_unlock = seen_before == 0
        golden_now = kind == "combo" and seen_before < GOLDEN_AFTER_DAYS <= total
        if first_unlock or golden_now:
            em = emotes_for(kind, ident)
            new_emotes = [e for e in ((em["emote"] if first_unlock else None), (em["emote_golden"] if golden_now else None)) if e]
            new.append({
                "key": key,
                "name": entry.name,
                "rarity": entry.rarity,
                "reward": f"{entry.reward}_gold" if golden_now else entry.reward,
                "golden": golden_now,
                "has_art": entry.has_art,
                "emotes": new_emotes,
            })
    new.sort(key=lambda n: RARITY_ORDER[n["rarity"]], reverse=True)

    # Pick today's lead effect (highest rarity) for the "signature" look.
    active_today.sort(key=lambda cid: RARITY_ORDER[COMBOS_BY_ID[cid].rarity], reverse=True)

    dex_combos = []
    for c in COMBOS:
        n = days_by_key.get(f"combo:{c.id}", 0)
        found = n > 0 or c.id in active_today
        dex_combos.append({
            **emotes_for("combo", c.id),
            "id": c.id,
            "name": c.name if (found or not c.secret) else "???",
            "rarity": c.rarity,
            "recipe": c.recipe if (found or not c.secret) else "Secret combo — keep grinding.",
            "reward": c.reward,
            "has_art": c.has_art,
            "secret": c.secret,
            "found": found,
            "days": n,
            "golden": n >= GOLDEN_AFTER_DAYS,
            "active_today": c.id in active_today,
        })
    dex_milestones = []
    for m in MILESTONES:
        unlocked = f"milestone:{m.id}" in days_by_key
        dex_milestones.append({
            **emotes_for("milestone", m.id),
            "id": m.id,
            "name": m.name,
            "rarity": m.rarity,
            "description": m.description,
            "reward": m.reward,
            "has_art": m.has_art,
            "unlocked": unlocked,
            "progress": min(stats[m.metric], m.target) if m.evaluated else None,
            "target": m.target,
            "needs_trusted": m.needs_trusted,
            "blocked_by_trust": m.needs_trusted and not trusted and stats[m.metric] >= m.target,
            "evaluated": m.evaluated,
        })

    return {
        "today": {"combos": active_today},
        "owned": sorted(owned),
        "new": new,
        "trusted": trusted,
        "free_emotes": sorted(FREE_EMOTES),
        # Won last week's race: wears the champion crown this week.
        "champion": champion,
        "dex": {"combos": dex_combos, "milestones": dex_milestones},
    }


async def mark_seen(user_id: uuid.UUID, db: AsyncSession) -> None:
    await db.execute(
        update(AvatarAchievement)
        .where(AvatarAchievement.user_id == user_id, AvatarAchievement.seen.is_(False))
        .values(seen=True)
    )
    await db.commit()


def ownership_errors(avatar: dict, owned: set[str]) -> list[str]:
    """Items/colors in a saved avatar the user hasn't unlocked (anti-cheat)."""
    errors: list[str] = []
    equipped = avatar.get("equipped") or {}
    for slot, item in equipped.items():
        if item is None:
            continue
        base = item[:-5] if item.endswith("_gold") else item
        if slot not in EQUIP_SLOTS or base not in EQUIP_SLOTS[slot]:
            errors.append(f"{item} can't go in {slot}")
        elif item not in owned:
            errors.append(f"{item} is locked")
    look = avatar.get("look") or {}
    for colorway, colors in EXCLUSIVE_COLORS.items():
        if colorway in owned:
            continue
        for slot, color in look.items():
            if str(color).lower() in colors:
                errors.append(f"{slot} color needs {colorway}")
    return errors
