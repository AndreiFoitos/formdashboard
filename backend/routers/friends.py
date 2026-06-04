from __future__ import annotations

import math
import secrets
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
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
from models.friend_invite import FriendInvite
from models.sus_vote import SusVote
from models.vouch import Vouch
from services.dots import dots_score

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
    # Email and weight_kg are intentionally NOT exposed to friends.
    # - email: most apps hide this from accepted friends; not needed once
    #   username is required at registration.
    # - weight_kg: needed server-side for DOTS / bodyweight-exercise volume,
    #   but the raw number stays on the server. Friends see DOTS output only.
    return {
        "id": str(u.id),
        "name": u.name or u.username or "User",
        "username": u.username,
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
            raise HTTPException(404, "No PeakForm user with that username")
    elif body.email:
        target_email = body.email.strip().lower()
        if target_email == (current_user.email or "").lower():
            raise HTTPException(400, "Cannot add yourself")
        result = await db.execute(select(User).where(sqlfunc.lower(User.email) == target_email))
        target = result.scalar_one_or_none()
        if not target:
            raise HTTPException(404, "No PeakForm user with that email")
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


# ─── Invite links ────────────────────────────────────────────────────────────
#
# Per-invite shareable link. Multi-use until revoked or expired. Deep-link
# format is peakform://invite/<token>; the new-user case (no app installed)
# is intentionally unsupported — the recipient just falls back to manual
# @username invite once they install. See the spec on the Friends UI for
# why we don't run a web landing.

# Crockford-ish base32, minus visually ambiguous 0/1/I/O. 32 chars × 8 = 32^8
# ≈ 1.1 trillion combos. Plenty of entropy with no rate-limit needed.
_INVITE_TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_INVITE_TOKEN_LENGTH = 8
INVITE_MAX_ACTIVE_PER_USER = 20
INVITE_EXPIRY_DAYS = 90


def _generate_invite_token() -> str:
    return "".join(secrets.choice(_INVITE_TOKEN_ALPHABET) for _ in range(_INVITE_TOKEN_LENGTH))


def _deep_link_for(token: str) -> str:
    return f"peakform://invite/{token}"


async def _active_invite_count(user_id: uuid.UUID, db: AsyncSession) -> int:
    """Active = not revoked AND not expired. Used for the per-user cap."""
    result = await db.execute(
        select(sqlfunc.count(FriendInvite.id)).where(
            FriendInvite.inviter_id == user_id,
            FriendInvite.revoked_at.is_(None),
            FriendInvite.expires_at > sqlfunc.now(),
        )
    )
    return result.scalar() or 0


@router.post("/invites", status_code=201)
async def create_invite_link(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a fresh invite link. Caps at 20 active per user — older links
    must be revoked or expire first. Token generation retries on the
    astronomically-rare collision."""
    active = await _active_invite_count(current_user.id, db)
    if active >= INVITE_MAX_ACTIVE_PER_USER:
        raise HTTPException(
            409,
            f"You already have {INVITE_MAX_ACTIVE_PER_USER} active invite links. "
            "Revoke one to create a new one.",
        )

    # 8 chars from 32-symbol alphabet — collision probability per request is
    # roughly N / 32^8. We retry a handful of times and bail loud if something
    # is very wrong.
    invite: FriendInvite | None = None
    for _ in range(5):
        token = _generate_invite_token()
        existing = await db.execute(select(FriendInvite.id).where(FriendInvite.token == token))
        if existing.scalar_one_or_none() is not None:
            continue
        invite = FriendInvite(
            inviter_id=current_user.id,
            token=token,
            expires_at=datetime.now(timezone.utc) + timedelta(days=INVITE_EXPIRY_DAYS),
        )
        db.add(invite)
        await db.commit()
        await db.refresh(invite)
        break
    if invite is None:
        raise HTTPException(500, "Could not generate a unique invite token")

    return {
        "id": str(invite.id),
        "token": invite.token,
        "deep_link": _deep_link_for(invite.token),
        "created_at": invite.created_at.isoformat(),
        "expires_at": invite.expires_at.isoformat(),
        "joined_count": 0,
    }


@router.get("/invites")
async def list_invite_links(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the caller's active (non-revoked, non-expired) invite links with
    a joined-count for each — joined = an accepted friendship that points at
    this invite."""
    result = await db.execute(
        select(
            FriendInvite,
            sqlfunc.count(Friendship.id).label("joined_count"),
        )
        .outerjoin(
            Friendship,
            and_(
                Friendship.invite_token_id == FriendInvite.id,
                Friendship.status == "accepted",
            ),
        )
        .where(
            FriendInvite.inviter_id == current_user.id,
            FriendInvite.revoked_at.is_(None),
            FriendInvite.expires_at > sqlfunc.now(),
        )
        .group_by(FriendInvite.id)
        .order_by(FriendInvite.created_at.desc())
    )
    rows = result.all()
    invites = [
        {
            "id": str(inv.id),
            "token": inv.token,
            "deep_link": _deep_link_for(inv.token),
            "created_at": inv.created_at.isoformat(),
            "expires_at": inv.expires_at.isoformat(),
            "joined_count": int(joined_count),
        }
        for inv, joined_count in rows
    ]
    return {
        "invites": invites,
        "active_count": len(invites),
        "cap": INVITE_MAX_ACTIVE_PER_USER,
    }


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite_link(
    invite_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Soft revoke. We keep the row so existing friendships' invite_token_id
    still resolves to something for analytics purposes — and so a freshly
    revoked link can be re-checked by /redeem to show 'link revoked'."""
    result = await db.execute(select(FriendInvite).where(FriendInvite.id == invite_id))
    invite = result.scalar_one_or_none()
    if not invite or invite.inviter_id != current_user.id:
        raise HTTPException(404, "Invite link not found")
    if invite.revoked_at is None:
        invite.revoked_at = datetime.now(timezone.utc)
        await db.commit()


@router.get("/invites/{token}/preview")
async def preview_invite_link(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """Unauthenticated lookup so the login screen can show
    'Log in to accept @andrei's invite' before the user has a session.
    Reveals only the inviter's public name + username, never email or stats."""
    result = await db.execute(
        select(FriendInvite).where(FriendInvite.token == token)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invite link not found")

    inviter_result = await db.execute(select(User).where(User.id == invite.inviter_id))
    inviter = inviter_result.scalar_one_or_none()
    if not inviter:
        # Shouldn't happen given the FK cascade, but defensive.
        raise HTTPException(404, "Invite link not found")

    now = datetime.now(timezone.utc)
    return {
        "inviter": {
            "name": inviter.name or inviter.username or "User",
            "username": inviter.username,
        },
        "revoked": invite.revoked_at is not None,
        "expired": invite.expires_at <= now,
    }


@router.post("/invites/{token}/redeem")
async def redeem_invite_link(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Idempotent. Looks up the invite, validates state, then either
    surfaces an existing relationship or creates a new pending one
    (inviter → current_user, status=pending) tagged with this invite."""
    result = await db.execute(select(FriendInvite).where(FriendInvite.token == token))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(404, "Invite link not found")
    if invite.revoked_at is not None:
        raise HTTPException(410, "This invite link was revoked")
    if invite.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(410, "This invite link has expired")
    if invite.inviter_id == current_user.id:
        raise HTTPException(400, "You can't redeem your own invite link")

    inviter_result = await db.execute(select(User).where(User.id == invite.inviter_id))
    inviter = inviter_result.scalar_one_or_none()
    if not inviter:
        raise HTTPException(404, "Inviter no longer exists")
    inviter_dict = _user_dict(inviter)

    # Already a relationship in either direction?
    existing_q = await db.execute(
        select(Friendship).where(
            or_(
                and_(Friendship.requester_id == inviter.id, Friendship.addressee_id == current_user.id),
                and_(Friendship.requester_id == current_user.id, Friendship.addressee_id == inviter.id),
            )
        )
    )
    existing = existing_q.scalar_one_or_none()
    if existing is not None:
        if existing.status == "accepted":
            return {
                "status": "already_friends",
                "inviter": inviter_dict,
                "friendship_id": str(existing.id),
            }
        return {
            "status": "already_pending",
            "inviter": inviter_dict,
            "friendship_id": str(existing.id),
            "direction": "incoming" if existing.requester_id == inviter.id else "outgoing",
        }

    friendship = Friendship(
        requester_id=inviter.id,
        addressee_id=current_user.id,
        status="pending",
        invite_token_id=invite.id,
    )
    db.add(friendship)
    await db.commit()
    await db.refresh(friendship)

    return {
        "status": "created",
        "inviter": inviter_dict,
        "friendship_id": str(friendship.id),
        "direction": "incoming",  # the request now sits in the redeemer's inbox
    }


# ─── Sus + Vouch ─────────────────────────────────────────────────────────────


class SusVoteRequest(BaseModel):
    # Weekly (training_log_id null) or per-lift. Sus is a one-tap toggle now,
    # no reason — posting the same scope again clears the vote.
    training_log_id: uuid.UUID | None = None


@router.post("/vote-sus/{target_user_id}")
async def vote_sus(
    target_user_id: uuid.UUID,
    body: SusVoteRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if target_user_id == current_user.id:
        raise HTTPException(400, "Cannot vote yourself sus")

    friend_ids = await _accepted_friend_ids(current_user.id, db)
    if target_user_id not in friend_ids:
        raise HTTPException(403, "Can only vote on friends")

    body = body or SusVoteRequest()
    monday, _ = _week_bounds()

    if body.training_log_id is not None:
        # Verify the target actually owns that log — prevents cross-targeting.
        log_check = await db.execute(
            select(TrainingLog).where(
                TrainingLog.id == body.training_log_id,
                TrainingLog.user_id == target_user_id,
            )
        )
        if not log_check.scalar_one_or_none():
            raise HTTPException(404, "That lift isn't on the target's log")

        existing = await db.execute(
            select(SusVote).where(
                SusVote.voter_id == current_user.id,
                SusVote.training_log_id == body.training_log_id,
            )
        )
    else:
        existing = await db.execute(
            select(SusVote).where(
                SusVote.voter_id == current_user.id,
                SusVote.target_user_id == target_user_id,
                SusVote.week_start == monday,
                SusVote.training_log_id.is_(None),
            )
        )

    # One-tap toggle, symmetric with vouch: a second tap on the same scope
    # clears the vote.
    row = existing.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    else:
        db.add(SusVote(
            voter_id=current_user.id,
            target_user_id=target_user_id,
            week_start=monday,
            training_log_id=body.training_log_id,
        ))
        await db.commit()

    # All sus votes against the target this week (weekly + per-log) count
    # toward the badge. Per-log votes are a stronger signal so they pull
    # double weight when computing the tally.
    weekly_count_result = await db.execute(
        select(sqlfunc.count(SusVote.id)).where(
            SusVote.target_user_id == target_user_id,
            SusVote.week_start == monday,
            SusVote.training_log_id.is_(None),
        )
    )
    per_log_count_result = await db.execute(
        select(sqlfunc.count(SusVote.id)).where(
            SusVote.target_user_id == target_user_id,
            SusVote.week_start == monday,
            SusVote.training_log_id.is_not(None),
        )
    )
    weekly_count = weekly_count_result.scalar() or 0
    per_log_count = per_log_count_result.scalar() or 0
    total_sus = weekly_count + per_log_count * 2

    threshold = _sus_threshold(len(friend_ids) + 1)

    return {
        "target_user_id": str(target_user_id),
        "week_votes": weekly_count,
        "per_lift_votes": per_log_count,
        "sus_score": total_sus,
        "sus_threshold": threshold,
        "is_sus": total_sus >= threshold,
    }


class VouchRequest(BaseModel):
    # Same shape as SusVoteRequest minus the reason — vouches don't need a
    # justification, they're just kudos.
    training_log_id: uuid.UUID | None = None


@router.post("/vouch/{target_user_id}")
async def vouch(
    target_user_id: uuid.UUID,
    body: VouchRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggleable one-tap vouch. Two modes:
      - Weekly  (no training_log_id) — endorses the week's weight-moved total
      - Per-lift (with training_log_id) — endorses one specific lift

    POSTing again with the same scope removes the vouch."""
    if target_user_id == current_user.id:
        raise HTTPException(400, "Cannot vouch yourself")

    friend_ids = await _accepted_friend_ids(current_user.id, db)
    if target_user_id not in friend_ids:
        raise HTTPException(403, "Can only vouch for friends")

    body = body or VouchRequest()
    monday, _ = _week_bounds()

    if body.training_log_id is not None:
        # Verify the target owns that lift before we touch the table.
        log_check = await db.execute(
            select(TrainingLog).where(
                TrainingLog.id == body.training_log_id,
                TrainingLog.user_id == target_user_id,
            )
        )
        if not log_check.scalar_one_or_none():
            raise HTTPException(404, "That lift isn't on the target's log")

        existing = await db.execute(
            select(Vouch).where(
                Vouch.voter_id == current_user.id,
                Vouch.training_log_id == body.training_log_id,
            )
        )
    else:
        existing = await db.execute(
            select(Vouch).where(
                Vouch.voter_id == current_user.id,
                Vouch.target_user_id == target_user_id,
                Vouch.week_start == monday,
                Vouch.training_log_id.is_(None),
            )
        )

    row = existing.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
        toggled = False
    else:
        db.add(Vouch(
            voter_id=current_user.id,
            target_user_id=target_user_id,
            week_start=monday,
            training_log_id=body.training_log_id,
        ))
        await db.commit()
        toggled = True

    # Total vouches for this week, both modes combined.
    count_result = await db.execute(
        select(sqlfunc.count(Vouch.id)).where(
            Vouch.target_user_id == target_user_id,
            Vouch.week_start == monday,
        )
    )
    count = count_result.scalar() or 0
    return {
        "target_user_id": str(target_user_id),
        "vouches": count,
        "active": toggled,
    }


@router.get("/friend-lifts/{target_user_id}")
async def friend_recent_lifts(
    target_user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Last 7 days of a friend's training logs (top set per exercise per day).
    Used as the picker source for per-lift sus voting. Only data already
    visible on the leaderboard — no nutrition, no body metrics."""
    friend_ids = await _accepted_friend_ids(current_user.id, db)
    if target_user_id not in friend_ids:
        raise HTTPException(403, "Not friends")

    cutoff = date.today() - timedelta(days=7)
    result = await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id == target_user_id,
            TrainingLog.date >= cutoff,
        ).order_by(TrainingLog.date.desc())
    )
    logs = result.scalars().all()

    # Reduce noise: keep the heaviest set per (date, exercise) so the picker
    # doesn't show 6 rows for one exercise. Voter sees the lift, not the rep
    # scheme.
    top_by_key: dict[tuple, TrainingLog] = {}
    for log in logs:
        key = (log.date, log.type)
        existing = top_by_key.get(key)
        if existing is None or (
            (log.weight_kg or 0) > (existing.weight_kg or 0)
        ):
            top_by_key[key] = log

    # Track this viewer's existing sus + vouch state per lift, so the picker
    # can disable buttons they've already used.
    log_ids = [log.id for log in top_by_key.values()]
    sus_ids: set[uuid.UUID] = set()
    vouch_ids: set[uuid.UUID] = set()
    if log_ids:
        sus_result = await db.execute(
            select(SusVote.training_log_id).where(
                SusVote.voter_id == current_user.id,
                SusVote.training_log_id.in_(log_ids),
            )
        )
        sus_ids = {row[0] for row in sus_result.all()}
        vouch_result = await db.execute(
            select(Vouch.training_log_id).where(
                Vouch.voter_id == current_user.id,
                Vouch.training_log_id.in_(log_ids),
            )
        )
        vouch_ids = {row[0] for row in vouch_result.all()}

    rows = []
    for log in sorted(top_by_key.values(), key=lambda l: l.date, reverse=True):
        rows.append({
            "id": str(log.id),
            "date": log.date.isoformat(),
            "type": log.type,
            "weight_kg": log.weight_kg,
            "reps": log.reps,
            "already_sus": log.id in sus_ids,
            "already_vouched": log.id in vouch_ids,
        })
    return {"lifts": rows}


# ─── Leaderboard ─────────────────────────────────────────────────────────────


async def _build_volume_leaderboard(
    current_user: User,
    db: AsyncSession,
    exercise_key: Optional[str] = None,
    sort_by: str = "raw",
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

    # Sus tally — split weekly vs per-lift so the badge weighting can value
    # per-lift votes more heavily (they require picking a specific lift;
    # weekly is a single tap).
    sus_weekly_result = await db.execute(
        select(SusVote.target_user_id, sqlfunc.count(SusVote.id))
        .where(
            SusVote.target_user_id.in_(circle_ids),
            SusVote.week_start == monday,
            SusVote.training_log_id.is_(None),
        )
        .group_by(SusVote.target_user_id)
    )
    sus_weekly_by_user = {uid: cnt for uid, cnt in sus_weekly_result.all()}

    sus_log_result = await db.execute(
        select(SusVote.target_user_id, sqlfunc.count(SusVote.id))
        .where(
            SusVote.target_user_id.in_(circle_ids),
            SusVote.week_start == monday,
            SusVote.training_log_id.is_not(None),
        )
        .group_by(SusVote.target_user_id)
    )
    sus_log_by_user = {uid: cnt for uid, cnt in sus_log_result.all()}

    # Did *I* sus / vouch on each target this week? Powers UI button state.
    my_sus_weekly_result = await db.execute(
        select(SusVote.target_user_id).where(
            SusVote.voter_id == current_user.id,
            SusVote.week_start == monday,
            SusVote.training_log_id.is_(None),
        )
    )
    my_sus_weekly = {row[0] for row in my_sus_weekly_result.all()}

    # Vouches
    vouch_result = await db.execute(
        select(Vouch.target_user_id, sqlfunc.count(Vouch.id))
        .where(
            Vouch.target_user_id.in_(circle_ids),
            Vouch.week_start == monday,
        )
        .group_by(Vouch.target_user_id)
    )
    vouch_by_user = {uid: cnt for uid, cnt in vouch_result.all()}

    my_vouch_result = await db.execute(
        select(Vouch.target_user_id).where(
            Vouch.voter_id == current_user.id,
            Vouch.week_start == monday,
        )
    )
    my_vouches = {row[0] for row in my_vouch_result.all()}

    threshold = _sus_threshold(len(circle_ids))
    TRUSTED_MIN_VOUCHES = 2  # >= this many vouches + no sus badge → 🛡️

    rows = []
    for uid in circle_ids:
        user = users_by_id.get(uid)
        if not user:
            continue
        sus_weekly = sus_weekly_by_user.get(uid, 0)
        sus_log = sus_log_by_user.get(uid, 0)
        sus_score = sus_weekly + sus_log * 2  # per-lift counts double
        vouches = vouch_by_user.get(uid, 0)
        is_sus = sus_score >= threshold
        is_trusted = (not is_sus) and vouches >= TRUSTED_MIN_VOUCHES
        volume_kg = volume_by_user.get(uid, 0.0)
        # DOTS-adjusted volume — bodyweight-normalised version of total kg
        # moved, so a 60 kg lifter and a 100 kg lifter compete on the same
        # axis. None when we lack sex or bodyweight; UI shows "—".
        dots_volume = dots_score(volume_kg, user.weight_kg, user.sex) if volume_kg else None
        rows.append({
            "user": _user_dict(user),
            "total_volume_kg": round(volume_kg, 1),
            "dots_volume": dots_volume,
            "days_trained": len(days_by_user.get(uid, set())),
            "sus_votes": sus_weekly,
            "sus_per_lift_votes": sus_log,
            "sus_score": sus_score,
            "sus_threshold": threshold,
            "is_sus": is_sus,
            "vouches": vouches,
            "is_trusted": is_trusted,
            "i_sus_weekly": uid in my_sus_weekly,
            "i_vouched": uid in my_vouches,
            "is_me": uid == current_user.id,
        })

    # Two sort orders, surfaced by ?sort= on the endpoint.
    # - "raw": total kg moved (default; matches what the dashboard race shows)
    # - "dots": DOTS-adjusted, with raw kg as tiebreaker. Rows missing DOTS
    #          (no sex / no bodyweight) sink to the bottom so they don't game
    #          the ranking by simply not setting those fields.
    if sort_by == "dots":
        rows.sort(
            key=lambda r: (r["dots_volume"] is not None, r["dots_volume"] or 0, r["total_volume_kg"]),
            reverse=True,
        )
    else:
        rows.sort(key=lambda r: r["total_volume_kg"], reverse=True)
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows


@router.get("/leaderboard")
async def leaderboard(
    exercise: Optional[str] = None,
    sort: str = "raw",   # "raw" | "dots"
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    monday, sunday = _week_bounds()
    rows = await _build_volume_leaderboard(
        current_user, db, exercise_key=exercise, sort_by=sort,
    )
    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "exercise": exercise,
        "sort": sort,
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
    most_sus = max(rows, key=lambda r: r["sus_score"])
    most_vouched = max(rows, key=lambda r: r["vouches"])
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
            "votes": most_sus["sus_score"],
            "weekly_votes": most_sus["sus_votes"],
            "per_lift_votes": most_sus["sus_per_lift_votes"],
            "threshold": threshold,
        } if most_sus["is_sus"] else None,
        "most_trusted": {
            "user": most_vouched["user"],
            "vouches": most_vouched["vouches"],
        } if most_vouched["is_trusted"] else None,
    }

    me_row = next((r for r in rows if r["is_me"]), None)

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "circle_size": len(rows),
        "headlines": headlines,
        "me": me_row,
    }


# ─── Weekly race (animated recap) ────────────────────────────────────────────


def _recap_week_bounds(today: date, week_offset: int = 0) -> tuple[date, date]:
    """
    The recap shows the ISO Mon-Sun week ending on the most recent Sunday.
    - today is Sunday  → recap = this week (Mon-Sun, today is Sun)
    - today is Mon-Sat → recap = the prior Mon-Sun (last completed week)

    `week_offset` shifts further back: 0 = current visible week, 1 = the week
    before that, etc. Frontend uses 0 for the dashboard card.
    """
    weekday = today.weekday()  # Mon=0 ... Sun=6
    days_to_recent_sunday = 0 if weekday == 6 else weekday + 1
    week_end = today - timedelta(days=days_to_recent_sunday) - timedelta(weeks=week_offset)
    week_start = week_end - timedelta(days=6)
    return week_start, week_end


@router.get("/recap/race")
async def weekly_recap_race(
    week_offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Per-day cumulative weight moved for every crew member across the prior
    ISO week (Mon-Sun ending on the most recent Sunday). Drives the animated
    Weekly Race recap on the dashboard.

    `daily_cumulative_kg` is a length-7 array indexed Mon=0..Sun=6, where
    [i] = Σ (weight × reps) on days 0..i inclusive. The line graph plots
    these directly.

    `trusted_crossed_on_day` / `sus_crossed_on_day` are ISO weekday integers
    (1=Mon..7=Sun) — the day on which the user crossed the threshold for
    their END-STATE badge. Only set if their final state has that badge;
    otherwise null. Frontend uses this to time the badge fade-in mid-race.
    """
    week_start, week_end = _recap_week_bounds(date.today(), week_offset)

    friend_ids = await _accepted_friend_ids(current_user.id, db)
    circle_ids = [current_user.id, *friend_ids]

    if not circle_ids:
        return {
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "crew": [],
        }

    users_result = await db.execute(select(User).where(User.id.in_(circle_ids)))
    users_by_id = {u.id: u for u in users_result.scalars().all()}

    # Training logs in the week
    logs_result = await db.execute(
        select(TrainingLog).where(
            TrainingLog.user_id.in_(circle_ids),
            TrainingLog.date >= week_start,
            TrainingLog.date <= week_end,
        )
    )
    logs = logs_result.scalars().all()

    # Per-day non-cumulative kg by user (index 0..6 = Mon..Sun)
    daily_kg: dict[uuid.UUID, list[float]] = defaultdict(lambda: [0.0] * 7)
    days_trained: dict[uuid.UUID, set[date]] = defaultdict(set)
    for log in logs:
        user = users_by_id.get(log.user_id)
        if not user:
            continue
        w = _effective_weight(log, user.weight_kg)
        day_idx = (log.date - week_start).days
        if 0 <= day_idx <= 6:
            daily_kg[log.user_id][day_idx] += w * (log.reps or 0)
            days_trained[log.user_id].add(log.date)

    # Cumulative kg by user (rounded once at the end so JSON stays tidy)
    cumulative_by_user: dict[uuid.UUID, list[float]] = {}
    for uid in circle_ids:
        daily = daily_kg.get(uid, [0.0] * 7)
        cum = []
        running = 0.0
        for d in daily:
            running += d
            cum.append(round(running, 1))
        cumulative_by_user[uid] = cum

    # All week's vouches + sus votes against anyone in the circle, ordered
    # so we can walk them in time order when computing crossing days.
    vouches_result = await db.execute(
        select(Vouch)
        .where(
            Vouch.target_user_id.in_(circle_ids),
            Vouch.week_start == week_start,
        )
        .order_by(Vouch.created_at.asc())
    )
    vouches = vouches_result.scalars().all()

    sus_result = await db.execute(
        select(SusVote)
        .where(
            SusVote.target_user_id.in_(circle_ids),
            SusVote.week_start == week_start,
        )
        .order_by(SusVote.created_at.asc())
    )
    sus_votes = sus_result.scalars().all()

    threshold = _sus_threshold(len(circle_ids))
    TRUSTED_MIN_VOUCHES = 2

    # Bucket once per user so we don't filter the full lists per crew member.
    vouches_by_target: dict[uuid.UUID, list[Vouch]] = defaultdict(list)
    for v in vouches:
        vouches_by_target[v.target_user_id].append(v)
    sus_by_target: dict[uuid.UUID, list[SusVote]] = defaultdict(list)
    for s in sus_votes:
        sus_by_target[s.target_user_id].append(s)

    def _iso_day_in_week(d: date) -> int | None:
        """Returns ISO weekday (1=Mon..7=Sun) if `d` falls within the recap
        week, otherwise None."""
        if week_start <= d <= week_end:
            return d.isoweekday()
        return None

    crew = []
    for uid in circle_ids:
        user = users_by_id.get(uid)
        if not user:
            continue

        user_vouches = vouches_by_target.get(uid, [])
        user_sus = sus_by_target.get(uid, [])

        # Crossing day for vouches: first time cumulative count >= threshold.
        vc = 0
        trusted_day: int | None = None
        for v in user_vouches:
            vc += 1
            if vc >= TRUSTED_MIN_VOUCHES and trusted_day is None:
                trusted_day = _iso_day_in_week(v.created_at.date())

        # Crossing day for sus: first time weighted sus_score >= threshold.
        # Per-lift sus votes count double, matching _build_volume_leaderboard.
        score = 0
        sus_day: int | None = None
        for s in user_sus:
            score += 2 if s.training_log_id is not None else 1
            if score >= threshold and sus_day is None:
                sus_day = _iso_day_in_week(s.created_at.date())

        # End-of-week state — sus wins over trusted if both happened.
        final_vouches = len(user_vouches)
        final_sus_score = sum(
            2 if s.training_log_id is not None else 1 for s in user_sus
        )
        is_sus = final_sus_score >= threshold
        is_trusted = (not is_sus) and final_vouches >= TRUSTED_MIN_VOUCHES

        cum = cumulative_by_user[uid]
        crew.append({
            "user_id": str(uid),
            "name": user.name or user.username or "User",
            "username": user.username,
            "daily_cumulative_kg": cum,
            "days_trained": len(days_trained.get(uid, set())),
            "total_kg": cum[-1],
            "is_trusted": is_trusted,
            "is_sus": is_sus,
            # Only surface the crossing day for the badge they actually earned.
            "trusted_crossed_on_day": trusted_day if is_trusted else None,
            "sus_crossed_on_day": sus_day if is_sus else None,
            "is_me": uid == current_user.id,
        })

    # Sort by final total so frontend can pull podium top-3 without resorting.
    crew.sort(key=lambda c: c["total_kg"], reverse=True)

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "crew": crew,
    }
