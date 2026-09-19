import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, DateTime, Index, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class AiScan(Base):
    """One row per AI camera scan that counted against the user's plan quota
    (services/plans.py). Stored in Postgres, not the in-process counter, so a
    server restart doesn't hand everyone a fresh allowance. A scan that fails
    is deleted again, so only delivered results count."""
    __tablename__ = "ai_scans"
    __table_args__ = (Index("ix_ai_scans_user_kind_created", "user_id", "kind", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # "food" | "bf"
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Purchase(Base):
    """A one-off store purchase (avatar pack), synced from RevenueCat.
    Subscriptions are not stored here: the plan lives on users.plan."""
    __tablename__ = "purchases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[str] = mapped_column(String(128), nullable=False)
    # RevenueCat's id for the transaction; makes re-syncs idempotent.
    transaction_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    purchased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
