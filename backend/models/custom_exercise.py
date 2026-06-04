import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class CustomExercise(Base):
    """User-defined exercise. Shows up in the picker alongside the hardcoded
    catalogue and is usable as a TrainingLog.type. Uniqueness is per-user on
    name so a user can't create two 'Reverse Pec Deck' rows by accident."""

    __tablename__ = "custom_exercises"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_custom_exercise_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # Bucket name matches the front-end Group taxonomy: Chest / Back / Legs /
    # Shoulders / Arms / Core / Other. UI uses it to slot the exercise into the
    # matching coloured section.
    group_name: Mapped[str] = mapped_column(String(20), nullable=False, default="Other")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
