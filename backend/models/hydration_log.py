import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, Integer, String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class HydrationLog(Base):
    __tablename__ = "hydration_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    amount_ml: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String, default="water")  # water, protein_shake, coffee, etc.

    user: Mapped["User"] = relationship(back_populates="hydration_logs")