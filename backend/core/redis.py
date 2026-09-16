import time

import redis.asyncio as aioredis

from core.config import settings


# None when Redis isn't configured or didn't answer at startup (production
# currently runs without it, see render.yaml).
redis_client: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis | None:
    return redis_client


async def init_redis():
    global redis_client

    redis_client = aioredis.from_url(
        settings.REDIS_URL,
        decode_responses=True,

        # Prevent hanging requests
        socket_timeout=1,
        socket_connect_timeout=1,

        # Health/perf
        health_check_interval=30,
        retry_on_timeout=True,
    )

    try:
        await redis_client.ping()
        print("Redis connected")
    except Exception as e:
        print(f"Redis unavailable, using in-memory fallback: {e}")
        try:
            await redis_client.aclose()
        except Exception:
            pass
        redis_client = None


async def close_redis():
    global redis_client

    if redis_client:
        await redis_client.aclose()

# ── Redis-or-memory helpers ──────────────────────────────────────────────────
# Rate limits, the AI spend cap, the digest cache and the logout blacklist go
# through these. They use Redis when it's reachable and otherwise a per-process
# in-memory store, so those features keep working without Redis on a single
# instance. The memory store resets on restart and isn't shared between
# instances; add Redis before running more than one.

_memory: dict[str, tuple[float, str]] = {}  # key -> (expires_at monotonic, value)
_MEMORY_SWEEP_THRESHOLD = 10_000


def _memory_get(key: str) -> str | None:
    item = _memory.get(key)
    if item is None:
        return None
    expires_at, value = item
    if expires_at <= time.monotonic():
        _memory.pop(key, None)
        return None
    return value


def _memory_set(key: str, ttl_seconds: int, value: str) -> None:
    if len(_memory) >= _MEMORY_SWEEP_THRESHOLD:
        now = time.monotonic()
        for expired in [k for k, (exp, _) in _memory.items() if exp <= now]:
            del _memory[expired]
    _memory[key] = (time.monotonic() + ttl_seconds, value)


async def cache_get(key: str) -> str | None:
    if redis_client is not None:
        try:
            return await redis_client.get(key)
        except Exception:
            pass
    return _memory_get(key)


async def cache_setex(key: str, ttl_seconds: int, value: str) -> None:
    if redis_client is not None:
        try:
            await redis_client.setex(key, ttl_seconds, value)
            return
        except Exception:
            pass
    _memory_set(key, ttl_seconds, str(value))


async def incr_with_ttl(key: str, ttl_seconds: int) -> int:
    """Increment a counter and return the new value. The counter expires
    ttl_seconds after its first increment (Redis refreshes it on each call)."""
    if redis_client is not None:
        try:
            count = await redis_client.incr(key)
            await redis_client.expire(key, ttl_seconds)
            return count
        except Exception:
            pass
    count = int(_memory_get(key) or 0) + 1
    existing = _memory.get(key)
    if existing is not None:
        _memory[key] = (existing[0], str(count))
    else:
        _memory_set(key, ttl_seconds, str(count))
    return count
