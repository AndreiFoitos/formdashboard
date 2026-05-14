import redis.asyncio as aioredis

from core.config import settings


redis_client: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
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
        print(f"Redis unavailable: {e}")


async def close_redis():
    global redis_client

    if redis_client:
        await redis_client.aclose()