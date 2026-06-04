"""
Per-IP rate limiter used by auth endpoints (login, register, refresh, SSO).

We import the same `limiter` from each router, so decorators land on a single
shared state. main.py also assigns it to app.state.limiter and registers the
RateLimitExceeded handler so slowapi can return 429s without our routers
needing to know about it.

In production the API sits behind Railway's edge proxy, so client.host is the
proxy IP. We pull the first hop of X-Forwarded-For instead — Railway is the
only thing that can write the header, so this is safe to trust.
"""
from __future__ import annotations

from fastapi import Request
from slowapi import Limiter


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# storage_uri left to the default in-memory store. For multi-instance
# deployments swap to "redis://..." — the same REDIS_URL we use elsewhere
# would work, but at single-replica scale on Railway the in-memory store
# is fine and avoids a second Redis dependency for the limiter alone.
#
# headers_enabled=False on purpose. The opt-in `X-RateLimit-Limit/Remaining`
# headers require every decorated endpoint to declare a `response: Response`
# parameter; we don't need those headers anyway because the 429 response from
# `_rate_limit_exceeded_handler` already includes `Retry-After`, which is the
# only header clients act on. Re-enable + add `response: Response` to each
# rate-limited handler if you ever want to surface remaining quota to the UI.
limiter = Limiter(key_func=_client_ip, headers_enabled=False)
