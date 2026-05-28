import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Integer, Text, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class AIInsight(Base):
    __tablename__ = "ai_insights"

    __table_args__ = (
        Index("ix_ai_insights_user_type", "user_id", "insight_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))

    insight_type: Mapped[str] = mapped_column(String, nullable=False)  # daily_digest, pattern, suggestion, ...
    content: Mapped[str] = mapped_column(Text, nullable=False)
    data_window_days: Mapped[int] = mapped_column(Integer, default=7)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="ai_insights")
