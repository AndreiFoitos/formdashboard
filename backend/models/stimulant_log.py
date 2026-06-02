import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, Integer, Float, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class StimulantLog(Base):
    __tablename__ = "stimulant_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    substance: Mapped[str] = mapped_column(String, nullable=False)  # coffee, espresso, preworkout, etc.
    caffeine_mg: Mapped[int] = mapped_column(Integer, nullable=False)
    half_life_hours: Mapped[float] = mapped_column(Float, default=5.5)
    # Sum of base substance + any add-ons, captured at log time so deleting a
    # log can decrement the daily summary by the exact same values.
    calories: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    protein_g: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    carbs_g: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    fat_g: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    # JSON list of addition keys ("whole_milk_50ml", "sugar_tsp", ...), so the
    # UI can re-render what the user picked when they tap "repeat last".
    additions: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    note: Mapped[str] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="stimulant_logs")