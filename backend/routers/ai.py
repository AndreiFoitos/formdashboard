from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.redis import get_redis
from middleware.auth import get_current_user
from models.user import User
from services.ai_client import AINotConfigured
from services.ai_features import generate_daily_digest, answer_question

router = APIRouter(prefix="/ai", tags=["ai"])

ASK_DAILY_LIMIT = 20


class AskTurn(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class AskRequest(BaseModel):
    question: str
    history: list[AskTurn] | None = None


@router.get("/digest")
async def get_digest(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    try:
        digest = await generate_daily_digest(current_user, db, redis)
    except AINotConfigured:
        raise HTTPException(503, "AI is not configured on the server")
    await db.commit()  # persist the cached insight, if one was generated
    return {"digest": digest}


@router.post("/ask")
async def ask(
    payload: AskRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    # Rate limit: 20 questions per user per day.
    rate_key = f"ask_rate:{current_user.id}:{date.today().isoformat()}"
    count = await redis.incr(rate_key)
    await redis.expire(rate_key, 86400)
    if count > ASK_DAILY_LIMIT:
        raise HTTPException(429, f"Daily question limit reached ({ASK_DAILY_LIMIT}/day)")

    history = [t.model_dump() for t in payload.history] if payload.history else []
    try:
        answer = await answer_question(current_user, payload.question, history, db)
    except AINotConfigured:
        raise HTTPException(503, "AI is not configured on the server")
    return {"answer": answer}
