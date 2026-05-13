import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Float, Integer, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class OnboardingBaseline(Base):
    __tablename__ = "onboarding_baselines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)

    # From the 4-step onboarding quiz
    avg_sleep_hours: Mapped[float] = mapped_column(Float, nullable=True)
    training_frequency: Mapped[str] = mapped_column(String, nullable=True)  # 0-1x, 2-3x, 4-5x, 6x+
    caffeine_habit: Mapped[str] = mapped_column(String, nullable=True)      # none, 1_coffee, 2-3, preworkout
    energy_rating: Mapped[int] = mapped_column(Integer, nullable=True)      # 1-5
    device_connected: Mapped[str] = mapped_column(String, nullable=True)    # oura, apple_health, none

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user: Mapped["User"] = relationship(back_populates="onboarding_baseline")
