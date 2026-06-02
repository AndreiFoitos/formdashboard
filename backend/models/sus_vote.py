import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class SusVote(Base):
    """
    'Among Us' style cheat vote, lift-only in v2. Two voting modes, both a
    one-tap toggle with no reason — posting the same scope again clears it:

      1. Weekly sus  — target_user_id, training_log_id IS NULL.
         One per (voter, target, week). >= threshold -> badge for the week.

      2. Per-lift sus — training_log_id IS NOT NULL.
         One per (voter, training_log). Calls out a specific lift.

    Both modes share this table. Partial unique indexes (defined in the
    migration, not on the model) enforce the two different constraints.
    """
    __tablename__ = "sus_votes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    voter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    target_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    week_start: Mapped[date] = mapped_column(Date, nullable=False)  # Monday of the voted week
    # Per-lift mode: which TrainingLog is being called out.
    training_log_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("training_logs.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    voter: Mapped["User"] = relationship(foreign_keys=[voter_id])
    target: Mapped["User"] = relationship(foreign_keys=[target_user_id])
