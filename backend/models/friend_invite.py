import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class FriendInvite(Base):
    """One shareable per-invite link an inviter generates. Multi-use until
    revoked or expired. Joined-via count is computed by COUNT over friendships
    pointing at this row, so we don't carry a denormalised counter."""

    __tablename__ = "friend_invites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    inviter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # 8-char base32 (no 0/1/I/O). Globally unique so /redeem can look up by token alone.
    token: Mapped[str] = mapped_column(String(8), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    inviter: Mapped["User"] = relationship(foreign_keys=[inviter_id])
