import os

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from sqlalchemy.orm import DeclarativeBase

from core.config import settings


# MEDIUM-34: SSL mode is env-configurable. Supabase requires it, so default to
# "require"; local docker-compose Postgres / CI fixtures can opt out by setting
# DATABASE_SSL=disable. Other valid asyncpg values: prefer, allow, verify-ca,
# verify-full.
_db_ssl = os.environ.get("DATABASE_SSL", "require")
_connect_args: dict = {
    "statement_cache_size": 0,
    # Set a tight connect timeout so failures surface fast
    "command_timeout": 10,
}
if _db_ssl != "disable":
    _connect_args["ssl"] = _db_ssl

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,

    pool_size=10,
    max_overflow=20,

    # Remove pool_pre_ping — it adds a SELECT 1 round trip before EVERY query.
    # Only enable if you frequently see stale connection errors.
    pool_pre_ping=False,

    # Recycle connections every 10 min instead of 30 to avoid stale conns
    # without paying the pre_ping cost on every request.
    pool_recycle=600,

    # asyncpg: disable statement cache to avoid pg_prepared_statements issues
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session