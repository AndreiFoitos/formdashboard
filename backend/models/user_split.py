import uuid
from datetime import datetime
from sqlalchemy import (
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    DateTime,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class UserSplit(Base):
    """Per-weekday auto-detected training split for one user.

    A row says 'on this weekday, the user usually trains this muscle group'.
    Detected by services/split_detection.py from the last 28 days of
    TrainingLog activity. Refreshed nightly. Confidence is the share of
    distinct training dates on that weekday that landed on the chosen group
    (1.0 = every Monday this month was Chest day).
    """

    __tablename__ = "user_splits"
    __table_args__ = (
        UniqueConstraint("user_id", "weekday", name="uq_user_split_weekday"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Python's Monday=0..Sunday=6 convention, matching date.weekday().
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # Chest / Back / Legs / Shoulders / Arms / Core / Other.
    group_name: Mapped[str] = mapped_column(String(20), nullable=False)
    # How many distinct dates within the lookback supported this assignment.
    # Useful for the UI to show 'detected from 5 sessions' on hover.
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
