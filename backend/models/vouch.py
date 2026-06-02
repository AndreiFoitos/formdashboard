import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class Vouch(Base):
    """
    Counter-mechanic to SusVote, mirrored exactly. Two voting modes:

      1. Weekly vouch  — target_user_id, training_log_id IS NULL.
         One per (voter, target, week). Backs the 🛡️ Trusted badge.

      2. Per-lift vouch — training_log_id IS NOT NULL.
         One per (voter, training_log). Endorses a specific lift.

    Partial unique indexes (defined in the migration, not on the model)
    enforce the two different constraints.
    """
    __tablename__ = "vouches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    voter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    target_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    training_log_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("training_logs.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    voter: Mapped["User"] = relationship(foreign_keys=[voter_id])
    target: Mapped["User"] = relationship(foreign_keys=[target_user_id])
