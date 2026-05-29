import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, Date, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class SusVote(Base):
    """
    'Among Us' style cheat vote. One voter can cast at most one sus vote per
    target per week (Mon..Sun). >= 2 votes in a week lights up the 🤨 badge
    on the leaderboard. Resets every Monday.
    """
    __tablename__ = "sus_votes"
    __table_args__ = (
        UniqueConstraint("voter_id", "target_user_id", "week_start", name="uq_sus_vote_week"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    voter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    target_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    week_start: Mapped[date] = mapped_column(Date, nullable=False)  # Monday of the voted week
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    voter: Mapped["User"] = relationship(foreign_keys=[voter_id])
    target: Mapped["User"] = relationship(foreign_keys=[target_user_id])
