from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.redis import incr_with_ttl
from middleware.auth import get_current_user
from models.ai_message import AiMessage
from models.user import User
from services.ai_client import AINotConfigured
from services.ai_features import answer_question, chat_history, generate_daily_digest
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
    question: str = Field(min_length=1, max_length=2000)
    # Ignored: history is read from ai_messages. Kept so app builds that still
    # send it don't get a 422.
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
    question = payload.question.strip()
    if not question:
        raise HTTPException(400, "Question is empty")
    asked_at = datetime.now(timezone.utc)
    # Plan quota (services/plans.py), handed back if no answer comes out.
    scan_id = await consume_scan(current_user, ASK, db)
    try:
        try:
            answer = await answer_question(
                current_user, question, db,
                days=plan_for(current_user).history_days,
            )
        except AINotConfigured:
            raise HTTPException(503, "AI is not configured on the server")
        if not answer:
            raise HTTPException(502, "The model returned an empty answer")
        # Explicit times: now() is fixed per transaction, so both rows would
        # tie and could come back answer-first.
        answered_at = max(datetime.now(timezone.utc), asked_at + timedelta(microseconds=1))
        db.add(AiMessage(user_id=current_user.id, role="user", content=question, created_at=asked_at))
        db.add(AiMessage(user_id=current_user.id, role="assistant", content=answer, created_at=answered_at))
        await db.commit()
        return {"answer": answer}
    except Exception:
        await refund_scan(scan_id, db)
        raise


@router.get("/messages")
async def get_messages(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The saved chat, oldest first (the last 50 messages)."""
    rows = await chat_history(current_user.id, db, limit=50)
    return {
        "messages": [
            {"id": str(m.id), "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in rows
        ]
    }


@router.delete("/messages", status_code=204)
async def clear_messages(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """New chat: forget the saved conversation."""
    await db.execute(delete(AiMessage).where(AiMessage.user_id == current_user.id))
    await db.commit()
