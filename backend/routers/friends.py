from __future__ import annotations

import math
import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, and_, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.training_log import TrainingLog
from models.friendship import Friendship
from models.sus_vote import SusVote

router = APIRouter(prefix="/friends", tags=["friends"])


# Exercises where the load IS the lifter — falls back to user.weight_kg when
# no added weight is logged. Weighted variants (e.g. weighted pull-ups) still
# work: the user logs the added weight and we use that instead.
BODYWEIGHT_EXERCISES = {
    "pull_up",
    "push_up",
    "tricep_dip",
    "hanging_leg_raise",
}


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _week_bounds(today: Optional[date] = None) -> tuple[date, date]:
    """Return (Monday, Sunday) for the week containing today."""
    today = today or date.today()
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


def _sus_threshold(circle_size: int) -> int:
    """
    Votes needed to light up the 🤨 badge, scaled to the friend circle.
    voters = circle_size - 1 (target can't vote on self).
    threshold = max(2, ceil(voters / 3)) — small groups stay at 2, big groups
    need more so badges don't trivially trigger.
    """
    voters = max(0, circle_size - 1)
    return max(2, math.ceil(voters / 3)) if voters > 0 else 2


def _effective_weight(log: TrainingLog, user_weight_kg: Optional[float]) -> float:
    if log.weight_kg is not None:
        return float(log.weight_kg)
    if log.type in BODYWEIGHT_EXERCISES and user_weight_kg is not None:
        return float(user_weight_kg)
    return 0.0


def _user_dict(u: User) -> dict:
    return {
        "id": str(u.id),
        "name": u.name or u.username or u.email.split("@")[0],
        "username": u.username,
        "email": u.email,
        "weight_kg": u.weight_kg,
    }


async def _accepted_friend_ids(user_id: uuid.UUID, db: AsyncSession) -> list[uuid.UUID]:
    """All user_ids the current user is friends with (accepted only)."""
    result = await db.execute(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
        )
    )
    friends = result.scalars().all()
    return [
        (f.addressee_id if f.requester_id == user_id else f.requester_id)
        for f in friends
    ]


# ─── Pydantic ────────────────────────────────────────────────────────────────


class InviteRequest(BaseModel):
    # Accept either form during the rollout but prefer username — the frontend
    # only sends username now, but old clients may still send email.
    username: str | None = Field(None, min_length=3, max_length=24)
    email: str | None = None


# ─── Friend graph ────────────────────────────────────────────────────────────


@router.post("/invite", status_code=201)
async def invite_friend(
    body: InviteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target: User | None = None
    if body.username:
        handle = body.username.strip().lstrip("@").lower()
        if handle == (current_user.username or "").lower():
            raise HTTPException(400, "Cannot add yourself")
        result = await db.execute(select(User).where(sqlfunc.lower(User.username) == handle))
        target = result.scalar_one_or_none()
        if not target:
            raise HTTPException(404, "No Protocol user with that username")
    elif body.email:
        target_email = body.email.strip().lower()
        if target_email == (current_user.email or "").lower():
            raise HTTPException(400, "Cannot add yourself")
        result = await db.execute(select(User).where(sqlfunc.lower(User.email) == target_email))
        target = result.scalar_one_or_none()
        if not target:
            raise HTTPException(404, "No Protocol user with that email")
    else:
        raise HTTPException(400, "Username is required")

    # Already friends or pending in either direction?
    existing = await db.execute(
        select(Friendship).where(
            or_(
                and_(Friendship.requester_id == current_user.id, Friendship.addressee_id == target.id),
                and_(Friendship.requester_id == target.id, Friendship.addressee_id == current_user.id),
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Already invited or already friends")

    friendship = Friendship(
        requester_id=current_user.id,
        addressee_id=target.id,
        status="pending",
    )
    db.add(friendship)
    await db.commit()
    await db.refresh(friendship)

    return {
        "id": str(friendship.id),
        "status": friendship.status,
        "addressee": _user_dict(target),
    }


@router.get("")
async def list_friends(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns accepted friends + pending requests (incoming + outgoing)."""
    result = await db.execute(
        select(Friendship).where(
            or_(Friendship.requester_id == current_user.id, Friendship.addressee_id == current_user.id)
        )
    )
    rows = result.scalars().all()

    other_ids = {
        (r.addressee_id if r.requester_id == current_user.id else r.requester_id)
        for r in rows
    }
    if other_ids:
        users_result = await db.execute(select(User).where(User.id.in_(other_ids)))
        users_by_id = {u.id: u for u in users_result.scalars().all()}
    else:
        users_by_id = {}

    friends, pending_in, pending_out = [], [], []
    for r in rows:
        other_id = r.addressee_id if r.requester_id == current_user.id else r.requester_id
        other = users_by_id.get(other_id)
        if not other:
            continue
        entry = {
            "id": str(r.id),
            "status": r.status,
            "created_at": r.created_at.isoformat(),
            "user": _user_dict(other),
        }
        if r.status == "accepted":
            friends.append(entry)
        elif r.requester_id == current_user.id:
            pending_out.append(entry)
        else:
            pending_in.append(entry)

    return {
        "friends": friends,
        "pending_in": pending_in,
        "pending_out": pending_out,
    }


@router.post("/accept/{friendship_id}")
async def accept_friend(
    friendship_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Friendship).where(Friendship.id == friendship_id))
    f = result.scalar_one_or_none()
    if not f or f.addressee_id != current_user.id:
        raise HTTPException(404, "Friend request not found")
    if f.status == "accepted":
        return {"id": str(f.id), "status": f.status}

    f.status = "accepted"
    f.accepted_at = sqlfunc.now()
    await db.commit()
    await db.refresh(f)
    return {"id": str(f.id), "status": f.status}


@router.post("/reject/{friendship_id}", status_code=204)
async def reject_friend(
    friendship_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Friendship).where(Friendship.id == friendship_id))
    f = result.scalar_one_or_none()
    if not f or f.addressee_id != current_user.id or f.status != "pending":
        raise HTTPException(404, "Friend request not found")
    await db.delete(f)
    await db.commit()


@router.delete("/{friendship_id}", status_code=204)
async def remove_friend(
    friendship_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Friendship).where(Friendship.id == friendship_id))
    f = result.scalar_one_or_none()
    if not f or current_user.id not in (f.requester_id, f.addressee_id):
        raise HTTPException(404, "Friendship not found")
    await db.delete(f)
    await db.commit()


# ─── Sus vote ────────────────────────────────────────────────────────────────


@router.post("/vote-sus/{target_user_id}")
async def vote_sus(
    target_user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if target_user_id == current_user.id:
        raise HTTPException(400, "Cannot vote yourself sus")

    friend_ids = await _accepted_friend_ids(current_user.id, db)
    if target_user_id not in friend_ids:
        raise HTTPException(403, "Can only vote on friends")

    monday, _ = _week_bounds()

    # Idempotent: if already voted this week, return current tally
    existing = await db.execute(
        select(SusVote).where(
            SusVote.voter_id == current_user.id,
            SusVote.target_user_id == target_user_id,
            SusVote.week_start == monday,
        )
    )
    if not existing.scalar_one_or_none():
        db.add(SusVote(
            voter_id=current_user.id,
            target_user_id=target_user_id,
            week_start=monday,
        ))
        await db.commit()

    count_result = await db.execute(
        select(sqlfunc.count(SusVote.id)).where(
            SusVote.target_user_id == target_user_id,
            SusVote.week_start == monday,
        )
    )
    count = count_result.scalar() or 0
    threshold = _sus_threshold(len(friend_ids) + 1)

    return {
        "target_user_id": str(target_user_id),
        "week_votes": count,
        "sus_threshold": threshold,
        "is_sus": count >= threshold,
    }


# ─── Leaderboard ─────────────────────────────────────────────────────────────


async def _build_volume_leaderboard(
    current_user: User,
    db: AsyncSession,
    exercise_key: Optional[str] = None,
) -> list[dict]:
    """
    Compute weekly Σ weight × reps for current user + all accepted friends.
    Falls back to user.weight_kg for bodyweight-tagged exercises.
    """
    friend_ids = await _accepted_friend_ids(current_user.id, db)
    circle_ids = [current_user.id, *friend_ids]

    if not circle_ids:
        return []

    monday, sunday = _week_bounds()

    # Pull all logs for the circle this week
    conditions = [
        TrainingLog.user_id.in_(circle_ids),
        TrainingLog.date >= monday,
        TrainingLog.date <= sunday,
    ]
    if exercise_key:
        conditions.append(TrainingLog.type == exercise_key)

    logs_result = await db.execute(select(TrainingLog).where(*conditions))
    logs = logs_result.scalars().all()

    # Pull user rows so we can use weight_kg for bodyweight exercises
    users_result = await db.execute(select(User).where(User.id.in_(circle_ids)))
    users_by_id = {u.id: u for u in users_result.scalars().all()}

    # Aggregate per user
    volume_by_user: dict[uuid.UUID, float] = defaultdict(float)
    days_by_user: dict[uuid.UUID, set[date]] = defaultdict(set)
    for log in logs:
        user = users_by_id.get(log.user_id)
        if not user:
            continue
        w = _effective_weight(log, user.weight_kg)
        volume_by_user[log.user_id] += w * (log.reps or 0)
        days_by_user[log.user_id].add(log.date)

    # Sus vote tally
    sus_result = await db.execute(
        select(SusVote.target_user_id, sqlfunc.count(SusVote.id))
        .where(
            SusVote.target_user_id.in_(circle_ids),
            SusVote.week_start == monday,
        )
        .group_by(SusVote.target_user_id)
    )
    sus_by_user = {uid: cnt for uid, cnt in sus_result.all()}

    threshold = _sus_threshold(len(circle_ids))

    rows = []
    for uid in circle_ids:
        user = users_by_id.get(uid)
        if not user:
            continue
        sus = sus_by_user.get(uid, 0)
        rows.append({
            "user": _user_dict(user),
            "total_volume_kg": round(volume_by_user.get(uid, 0.0), 1),
            "days_trained": len(days_by_user.get(uid, set())),
            "sus_votes": sus,
            "sus_threshold": threshold,
            "is_sus": sus >= threshold,
            "is_me": uid == current_user.id,
        })

    rows.sort(key=lambda r: r["total_volume_kg"], reverse=True)
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows


@router.get("/leaderboard")
async def leaderboard(
    exercise: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    monday, sunday = _week_bounds()
    rows = await _build_volume_leaderboard(current_user, db, exercise_key=exercise)
    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "exercise": exercise,
        "sus_threshold": rows[0]["sus_threshold"] if rows else 2,
        "rows": rows,
    }


# ─── Sunday recap ────────────────────────────────────────────────────────────


@router.get("/recap")
async def weekly_recap(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    This week's headlines for the friend circle:
      - top_volume: who moved the most kg
      - most_consistent: who trained the most days
      - most_pr: who hit the most new PRs vs prior 90 days
      - most_sus: who has the most sus votes (if >= 2)
      - me: my row from the leaderboard
    """
    monday, sunday = _week_bounds()
    rows = await _build_volume_leaderboard(current_user, db)

    if not rows:
        return {
            "week_start": monday.isoformat(),
            "week_end": sunday.isoformat(),
            "circle_size": 0,
            "headlines": {},
            "me": None,
        }

    top_volume = max(rows, key=lambda r: r["total_volume_kg"])
    most_consistent = max(rows, key=lambda r: r["days_trained"])
    most_sus = max(rows, key=lambda r: r["sus_votes"])
    threshold = rows[0]["sus_threshold"]

    # PR count: compare this week's top set per exercise vs the 90 days before
    friend_ids = await _accepted_friend_ids(current_user.id, db)
    circle_ids = [current_user.id, *friend_ids]

    cutoff = monday - timedelta(days=90)
    prior_q = await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id.in_(circle_ids),
            TrainingLog.date >= cutoff,
            TrainingLog.date < monday,
        )
    )
    week_q = await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id.in_(circle_ids),
            TrainingLog.date >= monday,
            TrainingLog.date <= sunday,
        )
    )

    # prior best weight per (user, exercise)
    prior_best: dict[tuple[uuid.UUID, str], float] = {}
    for log in prior_q.scalars().all():
        if log.weight_kg is None:
            continue
        key = (log.user_id, log.type)
        if log.weight_kg > prior_best.get(key, 0):
            prior_best[key] = float(log.weight_kg)

    week_best: dict[tuple[uuid.UUID, str], float] = {}
    for log in week_q.scalars().all():
        if log.weight_kg is None:
            continue
        key = (log.user_id, log.type)
        if log.weight_kg > week_best.get(key, 0):
            week_best[key] = float(log.weight_kg)

    pr_count_by_user: dict[uuid.UUID, int] = defaultdict(int)
    for (uid, ex), wk in week_best.items():
        prior = prior_best.get((uid, ex), 0)
        if wk > prior and prior > 0:  # require prior history to call it a PR
            pr_count_by_user[uid] += 1

    users_by_id = {uuid.UUID(r["user"]["id"]): r["user"] for r in rows}
    if pr_count_by_user:
        top_pr_uid = max(pr_count_by_user, key=lambda k: pr_count_by_user[k])
        most_pr = {
            "user": users_by_id.get(top_pr_uid),
            "pr_count": pr_count_by_user[top_pr_uid],
        }
    else:
        most_pr = None

    headlines = {
        "top_volume": {
            "user": top_volume["user"],
            "total_volume_kg": top_volume["total_volume_kg"],
        } if top_volume["total_volume_kg"] > 0 else None,
        "most_consistent": {
            "user": most_consistent["user"],
            "days_trained": most_consistent["days_trained"],
        } if most_consistent["days_trained"] > 0 else None,
        "most_pr": most_pr,
        "most_sus": {
            "user": most_sus["user"],
            "votes": most_sus["sus_votes"],
            "threshold": threshold,
        } if most_sus["sus_votes"] >= threshold else None,
    }

    me_row = next((r for r in rows if r["is_me"]), None)

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "circle_size": len(rows),
        "headlines": headlines,
        "me": me_row,
    }
