from __future__ import annotations

import logging
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc
from pydantic import BaseModel, EmailStr

from core.database import get_db
from core.rate_limit import limiter
from core.redis import cache_get, cache_setex
from core.security import hash_password, verify_password, create_access_token, create_refresh_token, decode_token
from models.user import User
from models.streak import Streak
from schemas.user import RESERVED_USERNAMES
from services.oauth_verify import verify_apple_token, verify_google_token
from services.apple_revoke import exchange_authorization_code
from routers.account_links import send_email_confirm_link

log = logging.getLogger(__name__)

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
    # Single-use code (valid ~5 min) we exchange for an Apple refresh token so
    # account deletion can revoke Sign in with Apple. Optional so builds that
    # predate it can still sign in.
    authorization_code: str | None = None


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
    # Reserved bases get a random suffix so we never seed an OAuth user with
    # `@admin` or `@gainrace`. MEDIUM-31.
    if base in RESERVED_USERNAMES:
        base = f"{base}_{secrets.token_hex(2)}"

    for suffix in ("", *(secrets.token_hex(2) for _ in range(5))):
        candidate = f"{base}{('_' + suffix) if suffix else ''}"[:24]
        if candidate in RESERVED_USERNAMES:
            continue
        existing = await db.execute(select(User.id).where(User.username == candidate))
        if not existing.scalar_one_or_none():
            return candidate

    # Astronomically unlikely fallback. Still bypasses RESERVED check because
    # any "user_<hex>" handle can't collide with the reserved set.
    return f"user_{secrets.token_hex(4)}"


def _is_relay_email(email: str) -> bool:
    return email.lower().endswith("@privaterelay.appleid.com")


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
    email_verified: bool,
    name: str | None,
    db: AsyncSession,
) -> User:
    """
    Resolve an OAuth identity to a User row.

    Lookup order:
      1. Existing user with matching provider sub → return as-is.
      2. Existing user with matching email (case-insensitive), when the
         provider verified that email → link this sub to their account so they
         can use either method next time.
      3. Otherwise, create a new user with no password.
    """
    sub_col = User.apple_sub if provider == "apple" else User.google_sub

    by_sub = await db.execute(select(User).where(sub_col == sub))
    user = by_sub.scalar_one_or_none()
    if user:
        return user

    existing = None
    if email:
        by_email = await db.execute(
            select(User).where(sqlfunc.lower(User.email) == email.lower())
        )
        existing = by_email.scalar_one_or_none()
    if existing and email_verified:
        user = existing
        if not user.email_verified:
            # Whoever registered this address with a password never proved
            # they own it; the provider just proved this person does. They get
            # the account and the unproven password stops working (they can
            # set their own via Settings or Forgot password).
            user.hashed_password = None
            user.email_verified = True
        setattr(user, f"{provider}_sub", sub)
        await db.commit()
        await db.refresh(user)
        return user

    # New user. Usually first auth, where Apple includes the email. But if the
    # row was deleted without revoking Apple (revoke is best-effort), Apple
    # still treats the app as authorized and omits the email — create the
    # account anyway rather than dead-ending them.
    if existing:
        # Unverified provider email that another account already uses: don't
        # link, and don't take the address. They can add one from Settings.
        email = None
    # A "Hide My Email" relay address has a random local part, which would make
    # a gibberish handle; their name (sent on first Apple auth) reads better.
    local_part = email.split("@")[0] if email and not _is_relay_email(email) else None
    username = await _generate_username(local_part or name, db)
    user = User(
        email=email,
        email_verified=bool(email and email_verified),
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
@limiter.limit("3/hour")
async def register(request: Request, body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check if email already exists
    result = await db.execute(select(User).where(sqlfunc.lower(User.email) == body.email.lower()))
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

    # Prove the address. Until then it can't be used to link Apple/Google
    # sign-ins. Best-effort: a mail hiccup must not fail sign-up; they can
    # resend from Settings.
    try:
        await send_email_confirm_link(user, body.email)
    except HTTPException as e:
        log.warning("Sign-up confirm email to user %s not sent: %s", user.id, e.detail)

    return await _issue_tokens_for_user(user)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(sqlfunc.lower(User.email) == body.email.lower()))
    user = result.scalar_one_or_none()

    # Reject OAuth-only accounts here so the error message is honest — users
    # don't get "wrong password" when they actually need to use Apple/Google.
    if user and user.hashed_password is None:
        raise HTTPException(
            status_code=401,
            detail="This account uses Sign in with Apple or Google. To use a password, tap Forgot password.",
        )

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return await _issue_tokens_for_user(user)


@router.post("/apple", response_model=TokenResponse)
@limiter.limit("10/minute")
async def apple_sign_in(request: Request, body: AppleSignInRequest, db: AsyncSession = Depends(get_db)):
    identity = await verify_apple_token(body.identity_token)
    user = await _find_or_create_oauth_user(
        provider="apple",
        sub=identity.sub,
        email=identity.email,
        email_verified=identity.email_verified,
        name=body.full_name,
        db=db,
    )
    tokens = await _issue_tokens_for_user(user)

    # Every sign-in brings a fresh code; keep the latest refresh token. A failed
    # exchange only means we can't revoke later, so it never fails the login.
    if body.authorization_code:
        apple_refresh_token = await exchange_authorization_code(body.authorization_code)
        if apple_refresh_token:
            user.apple_refresh_token = apple_refresh_token
            await db.commit()
    return tokens


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
async def google_sign_in(request: Request, body: GoogleSignInRequest, db: AsyncSession = Depends(get_db)):
    identity = await verify_google_token(body.id_token)
    user = await _find_or_create_oauth_user(
        provider="google",
        sub=identity.sub,
        email=identity.email,
        email_verified=identity.email_verified,
        name=None,  # Google's name claim isn't passed through the mobile flow.
        db=db,
    )
    return await _issue_tokens_for_user(user)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh(
    request: Request,
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    # Check blacklist
    if await cache_get(f"blacklist:{body.refresh_token}"):
        raise HTTPException(status_code=401, detail="Token revoked")

    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload.get("sub")

    # Verify the user still exists. Without this, a refresh token held by
    # someone whose account was deleted (BLOCKER-5 delete-account flow) would
    # keep minting access tokens. The access tokens would fail at the next
    # middleware lookup, but the round-trip is wasted — and any code path that
    # trusts a fresh refresh as "user is real" would be wrong.
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: RefreshRequest,
):
    payload = decode_token(body.refresh_token)
    if payload:
        exp = payload.get("exp", 0)
        import time
        ttl = int(exp - time.time())
        if ttl > 0:
            await cache_setex(f"blacklist:{body.refresh_token}", ttl, "1")