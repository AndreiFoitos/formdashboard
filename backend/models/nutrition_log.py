import uuid
from datetime import date, datetime
from sqlalchemy import ForeignKey, Integer, Float, String, Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class NutritionLog(Base):
    __tablename__ = "nutrition_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date, nullable=False)
    calories: Mapped[int] = mapped_column(Integer, nullable=True)
    protein_g: Mapped[float] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float] = mapped_column(Float, nullable=True)
    meal_name: Mapped[str] = mapped_column(String, nullable=True)  # breakfast, lunch, dinner, snack
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="nutrition_logs")