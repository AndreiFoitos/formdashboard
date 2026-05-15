from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from sqlalchemy.orm import DeclarativeBase

from core.config import settings


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
    connect_args={
        "statement_cache_size": 0,
        # Set a tight connect timeout so failures surface fast
        "command_timeout": 10,
    },
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