"""
Verify Apple and Google identity tokens (OpenID Connect JWTs).

The flow on both sides is identical: the mobile app obtains a signed JWT from
the provider and POSTs it to our backend. We fetch the provider's public JWKS,
match by `kid`, and verify signature + `iss` + `aud` + `exp`. On success, we
return the stable `sub` and (when present) `email`.

JWKS are cached in-process for 24h. Apple/Google publish keys daily-ish and
clients tolerate slightly stale caches, so this is fine and avoids hammering
their endpoints.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import HTTPException
from jose import jwt, JWTError
from jose.utils import base64url_decode

from core.config import settings


APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"

JWKS_CACHE_TTL_SECONDS = 24 * 60 * 60


# Tiny in-process cache. Keyed by URL so Apple and Google don't share entries.
_jwks_cache: dict[str, tuple[float, dict]] = {}


@dataclass
class VerifiedIdentity:
    sub: str
    email: Optional[str]


async def _fetch_jwks(url: str) -> dict:
    now = time.time()
    cached = _jwks_cache.get(url)
    if cached and (now - cached[0]) < JWKS_CACHE_TTL_SECONDS:
        return cached[1]

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        jwks = resp.json()

    _jwks_cache[url] = (now, jwks)
    return jwks


def _find_key(jwks: dict, kid: str) -> Optional[dict]:
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


async def _verify_jwt(
    token: str,
    *,
    jwks_url: str,
    issuer: str | set[str],
    audiences: list[str],
) -> dict:
    """Common JWT verification path. Returns the decoded payload."""
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as e:
        raise HTTPException(401, f"Invalid identity token: {e}")

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(401, "Identity token missing key id")

    jwks = await _fetch_jwks(jwks_url)
    key = _find_key(jwks, kid)

    # Key rotation case: if we have a stale cache, force a refresh and try once more.
    if key is None:
        _jwks_cache.pop(jwks_url, None)
        jwks = await _fetch_jwks(jwks_url)
        key = _find_key(jwks, kid)
        if key is None:
            raise HTTPException(401, "Identity token signed by unknown key")

    # python-jose accepts an iterable for `audience` and matches if any value is found.
    # Filter out blanks so an unset client ID doesn't accidentally match an empty `aud`.
    audiences = [a for a in audiences if a]
    if not audiences:
        raise HTTPException(503, "Server is not configured to accept this provider")

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[unverified_header.get("alg", "RS256")],
            audience=audiences,
            issuer=issuer if isinstance(issuer, str) else None,
        )
    except JWTError as e:
        raise HTTPException(401, f"Identity token rejected: {e}")

    # `issuer` set-of-strings (Google) isn't supported by jose, so check manually.
    if not isinstance(issuer, str):
        if payload.get("iss") not in issuer:
            raise HTTPException(401, "Identity token issuer mismatch")

    return payload


async def verify_apple_token(identity_token: str) -> VerifiedIdentity:
    if not settings.APPLE_BUNDLE_ID:
        raise HTTPException(503, "Sign in with Apple is not configured")

    payload = await _verify_jwt(
        identity_token,
        jwks_url=APPLE_JWKS_URL,
        issuer=APPLE_ISSUER,
        audiences=[settings.APPLE_BUNDLE_ID],
    )

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(401, "Apple token missing subject")

    # `email` is included on first sign-in only; Apple omits it on re-auth.
    return VerifiedIdentity(sub=sub, email=payload.get("email"))


async def verify_google_token(id_token: str) -> VerifiedIdentity:
    audiences = [
        settings.GOOGLE_IOS_CLIENT_ID,
        settings.GOOGLE_ANDROID_CLIENT_ID,
        settings.GOOGLE_WEB_CLIENT_ID,
    ]
    if not any(audiences):
        raise HTTPException(503, "Sign in with Google is not configured")

    payload = await _verify_jwt(
        id_token,
        jwks_url=GOOGLE_JWKS_URL,
        issuer=GOOGLE_ISSUERS,
        audiences=audiences,
    )

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(401, "Google token missing subject")

    return VerifiedIdentity(sub=sub, email=payload.get("email"))
