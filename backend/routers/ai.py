from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.redis import incr_with_ttl
from middleware.auth import get_current_user
from models.user import User
from services.ai_client import AINotConfigured
from services.ai_features import generate_daily_digest, answer_question
from services.plans import ASK, consume_scan, plan_for, refund_scan

router = APIRouter(prefix="/ai", tags=["ai"])

# Digest is cached per-user per-day, so the first call of the day costs a full
# Claude turn and subsequent calls are free. 5/day covers cache-busting edge
# cases (timezone hop on travel, redis flush in dev) without letting a hostile
# client loop the endpoint to inflate cost.
DIGEST_DAILY_LIMIT = 5


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
):
    # Per-user daily cap on digest fetches. HIGH-27.
    rate_key = f"digest_rate:{current_user.id}:{date.today().isoformat()}"
    count = await incr_with_ttl(rate_key, 86400)
    if count > DIGEST_DAILY_LIMIT:
        raise HTTPException(429, f"Daily digest limit reached ({DIGEST_DAILY_LIMIT}/day)")

    try:
        digest = await generate_daily_digest(current_user, db)
    except AINotConfigured:
        raise HTTPException(503, "AI is not configured on the server")
    await db.commit()  # persist the cached insight, if one was generated
    return {"digest": digest}


@router.post("/ask")
async def ask(
    payload: AskRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Plan quota (services/plans.py), handed back if no answer comes out.
    scan_id = await consume_scan(current_user, ASK, db)
    try:
        history = [t.model_dump() for t in payload.history] if payload.history else []
        try:
            answer = await answer_question(
                current_user, payload.question, history, db,
                days=plan_for(current_user).history_days,
            )
        except AINotConfigured:
            raise HTTPException(503, "AI is not configured on the server")
        return {"answer": answer}
    except Exception:
        await refund_scan(scan_id, db)
        raise
