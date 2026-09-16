"""
Sign in with Apple token exchange + revocation.

Apps that offer Sign in with Apple must revoke the user's Apple tokens when
they delete their account (App Store Review Guideline 5.1.1(v)). Revoking
needs a refresh token, and the only way to get one is to exchange the
single-use authorization code the app receives at sign-in. So /auth/apple
exchanges the code and stores the refresh token, and DELETE /users/me
revokes it.

Both Apple endpoints authenticate with a short-lived ES256 "client secret"
JWT signed by the Sign in with Apple key. Everything here is best-effort: a
failure is logged and never blocks sign-in or account deletion.
"""
from __future__ import annotations

import logging
import time

import httpx
from jose import jwt

from core.config import settings

log = logging.getLogger(__name__)

APPLE_AUDIENCE = "https://appleid.apple.com"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"

# Apple accepts up to 6 months, but we mint one per call, so keep it short.
CLIENT_SECRET_TTL_SECONDS = 5 * 60


def is_configured() -> bool:
    return all((
        settings.APPLE_BUNDLE_ID,
        settings.APPLE_TEAM_ID,
        settings.APPLE_SIGNIN_KEY_ID,
        settings.APPLE_SIGNIN_PRIVATE_KEY,
    ))


def _client_secret() -> str:
    # Env var editors often flatten the .p8 file onto one line with literal "\n".
    private_key = settings.APPLE_SIGNIN_PRIVATE_KEY.replace("\\n", "\n").strip()
    now = int(time.time())
    return jwt.encode(
        {
            "iss": settings.APPLE_TEAM_ID,
            "iat": now,
            "exp": now + CLIENT_SECRET_TTL_SECONDS,
            "aud": APPLE_AUDIENCE,
            "sub": settings.APPLE_BUNDLE_ID,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": settings.APPLE_SIGNIN_KEY_ID},
    )


async def _post_to_apple(url: str, data: dict) -> httpx.Response | None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await client.post(url, data={
                "client_id": settings.APPLE_BUNDLE_ID,
                "client_secret": _client_secret(),
                **data,
            })
    except Exception as e:  # noqa: BLE001 — bad key, network, DNS: all non-fatal
        log.warning("Apple request to %s failed: %s", url, e)
        return None


async def exchange_authorization_code(code: str) -> str | None:
    """Trade the app's single-use authorization code for an Apple refresh token."""
    if not is_configured():
        log.warning("Apple code exchange skipped: Sign in with Apple key is not configured")
        return None

    resp = await _post_to_apple(APPLE_TOKEN_URL, {
        "code": code,
        "grant_type": "authorization_code",
    })
    if resp is None:
        return None
    if resp.status_code != 200:
        # Apple's error body is a small JSON like {"error": "invalid_grant"}.
        log.warning("Apple code exchange rejected: HTTP %s %s", resp.status_code, resp.text[:200])
        return None

    refresh_token = resp.json().get("refresh_token")
    if not refresh_token:
        log.warning("Apple code exchange succeeded but returned no refresh_token")
    return refresh_token


async def revoke_refresh_token(refresh_token: str) -> bool:
    """Revoke a user's Apple refresh token. Returns True on HTTP 200.

    Apple answers 200 even for unknown tokens and unregistered keys, so True
    only means the request went through. To confirm revocation for real,
    check the device: Settings > Apple ID > Sign in with Apple should no
    longer list the app after the account is deleted.
    """
    if not is_configured():
        log.warning("Apple token revocation skipped: Sign in with Apple key is not configured")
        return False

    resp = await _post_to_apple(APPLE_REVOKE_URL, {
        "token": refresh_token,
        "token_type_hint": "refresh_token",
    })
    if resp is None:
        return False
    if resp.status_code != 200:
        log.warning("Apple token revocation rejected: HTTP %s %s", resp.status_code, resp.text[:200])
        return False
    return True
