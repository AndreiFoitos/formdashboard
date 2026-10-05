import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class AiCheckin(Base):
    """A Pit Crew weekly check-in: how the plan went this week, a short
    review from Claude, and up to two suggestions the user can apply with
    one tap. See services/plan_checkin.py."""

    __tablename__ = "ai_checkins"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_ai_checkin_week"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_plans.id", ondelete="SET NULL"), nullable=True
    )
    # User-local Monday of the week reviewed.
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    # Numbers computed in code (sessions, meals, intake, weight, lifts).
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False)
    review: Mapped[str] = mapped_column(Text, nullable=False)
    # [{id, kind, title, detail, args, status: pending/applied/dismissed, result}]
    suggestions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # new / seen (the user closed the card)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="new")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
