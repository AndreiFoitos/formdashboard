from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.redis import init_redis, close_redis
from core.database import engine, get_db

from routers.auth import router as auth_router
from routers.users import router as users_router
from routers.daily import router as daily_router
from routers.goals import router as goals_router
from routers.energy import router as energy_router
from routers.hydration import router as hydration_router
from routers.nutrition import router as nutrition_router
from routers.stimulants import router as stimulants_router
from routers.training import router as training_router
from routers.dashboard import router as dashboard_router
from routers.body import router as body_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up DB connection pool so the first user request isn't slow
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))

    print("DB connection pool warmed up")

    await init_redis()
    yield
    await close_redis()


app = FastAPI(title="Protocol API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(daily_router)
app.include_router(goals_router)
app.include_router(energy_router)
app.include_router(hydration_router)
app.include_router(nutrition_router)
app.include_router(stimulants_router)
app.include_router(training_router)
app.include_router(dashboard_router)
app.include_router(body_router)


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