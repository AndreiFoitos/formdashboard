import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, Integer, String, Text, Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class TrainingLog(Base):
    __tablename__ = "training_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)  # push, pull, legs, upper, lower, cardio, full_body
    duration_min: Mapped[int] = mapped_column(Integer, nullable=True)
    intensity: Mapped[int] = mapped_column(Integer, nullable=True)  # 1-5
    volume_sets: Mapped[int] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String, default="manual")
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="training_logs")