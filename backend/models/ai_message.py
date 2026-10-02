import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class AiMessage(Base):
    """One turn of the Ask / Pit Crew chat. Stored server-side so a chat
    survives leaving the tab, and so the model's history comes from us
    rather than from whatever the client sends."""

    __tablename__ = "ai_messages"
    __table_args__ = (Index("ix_ai_messages_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # user / assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Plan changes the chat made this turn (step 5), for the Undo chip.
    actions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
