import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, Date, Boolean, String, Text, Float, Integer, DateTime, func, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class DailySummary(Base):
    __tablename__ = "daily_summaries"
    __table_args__ = (UniqueConstraint("user_id", "date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date, nullable=False)

    # Scores
    form_score: Mapped[int] = mapped_column(Integer, nullable=True)       # 0-100 composite
    sleep_score: Mapped[int] = mapped_column(Integer, nullable=True)      # 0-100
    hrv_score: Mapped[int] = mapped_column(Integer, nullable=True)
    readiness_score: Mapped[int] = mapped_column(Integer, nullable=True)  # from Oura/Garmin

    # Activity
    steps: Mapped[int] = mapped_column(Integer, nullable=True)
    active_calories: Mapped[int] = mapped_column(Integer, nullable=True)

    # Self-reported
    energy_avg: Mapped[float] = mapped_column(Float, nullable=True)

    # Nutrition
    water_ml: Mapped[int] = mapped_column(Integer, nullable=True)
    caffeine_mg: Mapped[int] = mapped_column(Integer, nullable=True)
    calories_eaten: Mapped[int] = mapped_column(Integer, nullable=True)
    protein_g: Mapped[float] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float] = mapped_column(Float, nullable=True)

    # Training
    trained: Mapped[bool] = mapped_column(Boolean, default=False)
    training_type: Mapped[str] = mapped_column(String, nullable=True)

    # Meta
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    ai_digest: Mapped[str] = mapped_column(Text, nullable=True)
    data_source: Mapped[str] = mapped_column(String, default="manual")  # manual, oura, healthkit_backfill
    is_estimated: Mapped[bool] = mapped_column(Boolean, default=False)  # true for cold-start seeded rows
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user: Mapped["User"] = relationship(back_populates="daily_summaries")
