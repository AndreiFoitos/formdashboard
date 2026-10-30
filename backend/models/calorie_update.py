import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class CalorieUpdate(Base):
    """One week's adaptive-calorie check: the estimate behind it and, when
    the target should move, the suggestion the user accepts or dismisses.
    See services/adaptive_calories.py."""

    __tablename__ = "calorie_updates"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_calorie_update_week"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # User-local Monday of the week the check ran in.
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    old_kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # pending / accepted / dismissed / expired, or none (no change needed).
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    # One or two plain sentences on why, written in code.
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # services/energy.Estimate.to_dict() at the time of the check.
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
