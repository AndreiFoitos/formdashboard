import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, Float, Date, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class BodyMetric(Base):
    __tablename__ = "body_metrics"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date, nullable=False)
    weight_kg: Mapped[float] = mapped_column(Float, nullable=True)
    body_fat_pct: Mapped[float] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String, default="manual")  # manual, withings
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="body_metrics")