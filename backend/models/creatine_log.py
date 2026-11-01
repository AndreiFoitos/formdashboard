import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class CreatineLog(Base):
    """One day's creatine, ticked on Home (routers/creatine.py). Creatine is
    the same dose every day, so it's a yes/no per day rather than a log of
    amounts: one row per user per local day, and unticking deletes it. Counts
    towards the logging streak (services/streaks.py) and times the creatine
    reminder (services/smart_notifications.py)."""

    __tablename__ = "creatine_logs"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_creatine_log_day"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # The user's local day.
    date: Mapped[date] = mapped_column(Date, nullable=False)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # The dose set in Settings when it was ticked.
    dose_g: Mapped[float] = mapped_column(Float, nullable=False)
