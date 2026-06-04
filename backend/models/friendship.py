import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class Friendship(Base):
    """
    Directional record of a friend invite. A friendship exists as a single row.
    'pending' = invite sent, awaiting addressee's accept. 'accepted' = both sides
    are friends. Either user can delete the row to unfriend.
    """
    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("requester_id", "addressee_id", name="uq_friendship_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    addressee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | accepted
    # Set when the friendship was created by redeeming an invite link, so the
    # inviter's list of links can show 'X joined via this'. Null for friendships
    # created via the username invite flow. SET NULL on invite delete so dropping
    # a link doesn't cascade and unfriend people.
    invite_token_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("friend_invites.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    requester: Mapped["User"] = relationship(foreign_keys=[requester_id])
    addressee: Mapped["User"] = relationship(foreign_keys=[addressee_id])
