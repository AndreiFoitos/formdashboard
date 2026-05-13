from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from core.database import get_db
from core.redis import get_redis
from core.security import decode_token
from models.user import User

security = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> User:
    token = credentials.credentials

    # Fast Redis blacklist check (catches logged-out tokens)
    # Gracefully skip if Redis is unavailable (e.g. local dev without Redis running)
    try:
        if await redis.get(f"blacklist:{token}"):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
    except HTTPException:
        raise
    except Exception:
        pass  # Redis down — skip blacklist check, JWT validation still protects the route

    payload = decode_token(token)

    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user