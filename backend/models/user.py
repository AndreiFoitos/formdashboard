import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=True)
    age: Mapped[int] = mapped_column(nullable=True)
    height_cm: Mapped[float] = mapped_column(nullable=True)
    weight_kg: Mapped[float] = mapped_column(nullable=True)
    goal: Mapped[str] = mapped_column(String, nullable=True)  # bulk, cut, maintain, recomp
    timezone: Mapped[str] = mapped_column(String, default="UTC")
    onboarding_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Targets (pre-populated from onboarding, editable in settings)
    protein_target_g: Mapped[float] = mapped_column(nullable=True)
    water_target_ml: Mapped[int] = mapped_column(nullable=True)
    calorie_target: Mapped[int] = mapped_column(nullable=True)

    # Form Score unlock state
    form_score_unlocked: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relationships
    daily_summaries: Mapped[list["DailySummary"]] = relationship(back_populates="user", cascade="all, delete")
    goals: Mapped[list["Goal"]] = relationship(back_populates="user", cascade="all, delete")
    streak: Mapped["Streak"] = relationship(back_populates="user", cascade="all, delete", uselist=False)
    onboarding_baseline: Mapped["OnboardingBaseline"] = relationship(back_populates="user", cascade="all, delete", uselist=False)
    energy_logs: Mapped[list["EnergyLog"]] = relationship(back_populates="user", cascade="all, delete")
    stimulant_logs: Mapped[list["StimulantLog"]] = relationship(back_populates="user", cascade="all, delete")
    hydration_logs: Mapped[list["HydrationLog"]] = relationship(back_populates="user", cascade="all, delete")
    nutrition_logs: Mapped[list["NutritionLog"]] = relationship(back_populates="user", cascade="all, delete")
    training_logs: Mapped[list["TrainingLog"]] = relationship(back_populates="user", cascade="all, delete")
    body_metrics: Mapped[list["BodyMetric"]] = relationship(back_populates="user", cascade="all, delete")