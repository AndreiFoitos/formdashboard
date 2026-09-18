import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, String, Date, DateTime, Boolean, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class AvatarAchievement(Base):
    """One row per (user, reward key, day).

    - Daily combos: key "combo:<id>", one row per day the recipe was hit. The
      row count drives the golden upgrade (7 days).
    - Milestones: key "milestone:<id>", a single row dated the unlock day.

    Unlocks are derived from these rows (services/avatar_rewards.py), so the
    table is the only source of truth for what a user owns.
    """
    __tablename__ = "avatar_achievements"
    __table_args__ = (UniqueConstraint("user_id", "key", "date", name="uq_avatar_achievement_day"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    # False until the app has shown the "unlocked" moment for it.
    seen: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
