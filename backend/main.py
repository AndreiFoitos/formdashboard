import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from core.config import settings
from core.redis import init_redis, close_redis
from core.database import engine, get_db
from core.rate_limit import limiter
from services.scheduler import start_scheduler, shutdown_scheduler


# Sentry must be initialised BEFORE the FastAPI app object is constructed so
# its asyncio / FastAPI integrations hook into everything that follows. When
# SENTRY_DSN is unset (dev or pre-signup), init is a no-op.
if settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        integrations=[FastApiIntegration(), StarletteIntegration()],
        # Sample 10% of transactions — enough APM signal without burning the
        # free-tier 5k events/month quota on a launch app.
        traces_sample_rate=0.1,
        # Tag the environment so prod / preview alerts don't fire in dev.
        environment=os.environ.get("ENV", "dev"),
        # Don't ship request bodies (PII risk on logs / nutrition endpoints).
        send_default_pii=False,
    )

from routers.auth import router as auth_router
from routers.users import router as users_router
from routers.daily import router as daily_router
from routers.hydration import router as hydration_router
from routers.nutrition import router as nutrition_router
from routers.stimulants import router as stimulants_router
from routers.training import router as training_router
from routers.dashboard import router as dashboard_router
from routers.body import router as body_router
from routers.ai import router as ai_router
from routers.friends import router as friends_router
from routers.notifications import notif_router, quick_log_router


import socket
socket.setdefaulttimeout(10)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up DB connection pool so the first user request isn't slow
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))

    print("DB connection pool warmed up")

    await init_redis()
    # Scheduler must start AFTER Redis so prewarm_digests has a client to write to.
    start_scheduler()
    yield
    shutdown_scheduler()
    await close_redis()


app = FastAPI(title="Gainrace API", lifespan=lifespan)

# slowapi requires the limiter on app.state so its middleware/decorators can
# find it. The exception handler turns RateLimitExceeded into a 429 with the
# right Retry-After header.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — React Native clients don't trigger CORS, so this only affects browser
# callers. We keep dev wide open for the legacy `frontend/` web app and any
# future admin tooling, but production locks origins down to the public marketing
# site so a hostile browser page can't drive the API on behalf of a stolen
# bearer token (e.g. via leaked XSS payload elsewhere).
_env = os.environ.get("ENV", "dev")
_origin_list = os.environ.get("CORS_ORIGINS", "").strip()

if _env == "production" and _origin_list:
    _allowed_origins = [o.strip() for o in _origin_list.split(",") if o.strip()]
else:
    # Dev / unset: keep the previous behaviour so local web + RN dev clients work.
    _allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(daily_router)
app.include_router(hydration_router)
app.include_router(nutrition_router)
app.include_router(stimulants_router)
app.include_router(training_router)
app.include_router(dashboard_router)
app.include_router(body_router)
app.include_router(ai_router)
app.include_router(friends_router)
app.include_router(notif_router)
app.include_router(quick_log_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/ping-db")
async def ping_db(db: AsyncSession = Depends(get_db)):
    import time

    t = time.time()

    await db.execute(text("SELECT 1"))

    return {
        "db_ms": round((time.time() - t) * 1000)
    }