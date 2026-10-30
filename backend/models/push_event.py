import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class PushEvent(Base):
    """One smart notification sent to a user (services/smart_notifications.py).

    The unique dedupe_key ("meal:lunch:2026-10-30") keeps a reminder to once
    per day or per stretch, even across restarts (the in-memory cache doesn't
    survive a deploy). opened_at comes from the app when the push is tapped;
    acted_at is filled in later when the user logged the thing it was about.
    Together they drive the per-kind backoff: reminders a user keeps ignoring
    pause on their own."""

    __tablename__ = "push_events"
    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_push_event_dedupe"),
        Index("ix_push_events_user_sent", "user_id", "sent_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # meal | workout_preview | workout_log | protein | weigh_in | comeback
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(96), nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationSettings(Base):
    """Which kinds of reminder a user switched off in Settings. A missing row
    means everything is on (the device-level Smart nudges switch still
    decides whether any push arrives at all)."""

    __tablename__ = "notification_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Category keys from services/smart_notifications.CATEGORIES.
    off: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
