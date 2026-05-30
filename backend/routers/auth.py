from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc
from pydantic import BaseModel, EmailStr
import redis.asyncio as aioredis

from core.database import get_db
from core.redis import get_redis
from core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from models.user import User
from models.streak import Streak
from services.oauth_verify import verify_apple_token, verify_google_token

router = APIRouter(prefix="/auth", tags=["auth"])


# --- Schemas ---

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class AppleSignInRequest(BaseModel):
    identity_token: str
    # Apple sends a name object only on the first auth ever. Pass it through so
    # we can populate `name` for brand-new accounts; we ignore it for returning users.
    full_name: str | None = None


class GoogleSignInRequest(BaseModel):
    id_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# --- Helpers ---

_USERNAME_RE = re.compile(r"[^a-z0-9_]")


async def _generate_username(seed: str | None, db: AsyncSession) -> str:
    """
    Suggest a unique username. Tries the email local-part or name first, then
    falls back to a random handle. Always returns something unique — the
    caller can let the user rename it later.
    """
    base = _USERNAME_RE.sub("", (seed or "").lower())[:16] or "user"
    if len(base) < 3:
        base = f"{base}_{secrets.token_hex(2)}"

    for suffix in ("", *(secrets.token_hex(2) for _ in range(5))):
        candidate = f"{base}{('_' + suffix) if suffix else ''}"[:24]
        existing = await db.execute(select(User.id).where(User.username == candidate))
        if not existing.scalar_one_or_none():
            return candidate

    # Astronomically unlikely fallback.
    return f"user_{secrets.token_hex(4)}"


async def _issue_tokens_for_user(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
    )


async def _find_or_create_oauth_user(
    *,
    provider: str,  # "apple" | "google"
    sub: str,
    email: str | None,
    name: str | None,
    db: AsyncSession,
) -> User:
    """
    Resolve an OAuth identity to a User row.

    Lookup order:
      1. Existing user with matching provider sub → return as-is.
      2. Existing user with matching email (case-insensitive) → link this sub
         to their account so they can use either method next time.
      3. Otherwise, create a new user with no password.
    """
    sub_col = User.apple_sub if provider == "apple" else User.google_sub

    by_sub = await db.execute(select(User).where(sub_col == sub))
    user = by_sub.scalar_one_or_none()
    if user:
        return user

    if email:
        by_email = await db.execute(
            select(User).where(sqlfunc.lower(User.email) == email.lower())
        )
        user = by_email.scalar_one_or_none()
        if user:
            setattr(user, f"{provider}_sub", sub)
            await db.commit()
            await db.refresh(user)
            return user

    # New user. Apple may not give us an email on re-auth, but on first auth it
    # does — and the only way to reach this branch is first auth (no sub match).
    if not email:
        raise HTTPException(
            400,
            "This account has no email on file. Sign in with your original method to link accounts.",
        )

    username = await _generate_username(email.split("@")[0] or name, db)
    user = User(
        email=email,
        hashed_password=None,
        name=name,
        username=username,
    )
    setattr(user, f"{provider}_sub", sub)
    db.add(user)
    await db.flush()

    db.add(Streak(user_id=user.id))
    await db.commit()
    await db.refresh(user)
    return user


# --- Endpoints ---

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check if email already exists
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    username = await _generate_username(body.email.split("@")[0] or body.name, db)

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        name=body.name,
        username=username,
    )
    db.add(user)
    await db.flush()  # get user.id before commit

    # Create empty streak record
    streak = Streak(user_id=user.id)
    db.add(streak)
    await db.commit()

    return await _issue_tokens_for_user(user)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # Reject OAuth-only accounts here so the error message is honest — users
    # don't get "wrong password" when they actually need to use Apple/Google.
    if user and user.hashed_password is None:
        raise HTTPException(
            status_code=401,
            detail="This account uses Sign in with Apple or Google",
        )

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return await _issue_tokens_for_user(user)


@router.post("/apple", response_model=TokenResponse)
async def apple_sign_in(body: AppleSignInRequest, db: AsyncSession = Depends(get_db)):
    identity = await verify_apple_token(body.identity_token)
    user = await _find_or_create_oauth_user(
        provider="apple",
        sub=identity.sub,
        email=identity.email,
        name=body.full_name,
        db=db,
    )
    return await _issue_tokens_for_user(user)


@router.post("/google", response_model=TokenResponse)
async def google_sign_in(body: GoogleSignInRequest, db: AsyncSession = Depends(get_db)):
    identity = await verify_google_token(body.id_token)
    user = await _find_or_create_oauth_user(
        provider="google",
        sub=identity.sub,
        email=identity.email,
        name=None,  # Google's name claim isn't passed through the mobile flow.
        db=db,
    )
    return await _issue_tokens_for_user(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    redis: aioredis.Redis = Depends(get_redis),
):
    # Check blacklist
    if await redis.get(f"blacklist:{body.refresh_token}"):
        raise HTTPException(status_code=401, detail="Token revoked")

    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")
    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: RefreshRequest,
    redis: aioredis.Redis = Depends(get_redis),
):
    payload = decode_token(body.refresh_token)
    if payload:
        exp = payload.get("exp", 0)
        import time
        ttl = int(exp - time.time())
        if ttl > 0:
            await redis.setex(f"blacklist:{body.refresh_token}", ttl, "1")