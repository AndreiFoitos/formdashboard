import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class PushToken(Base):
    __tablename__ = "push_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    # Expo push token string ("ExponentPushToken[...]") — unique so a device that
    # re-installs / re-onboards under a different account doesn't get duplicate sends.
    token: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    platform: Mapped[str] = mapped_column(String(10), nullable=False)  # ios | android
    # Flipped to false when Expo returns DeviceNotRegistered so the notifier
    # skips it without us having to delete the row.
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="push_tokens")
