import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class AiPlan(Base):
    """A Pit Crew training + meal plan (docs/ai-plans-design.md §4, §6).

    Built in the background: the row is inserted as `generating`, then filled
    by services/plan_builder.py. `plan` is the validated, resolved plan the
    app renders: exercise keys checked, starting weights and every meal's
    grams and macros computed by us, not taken from the model. At most one
    row per user is `ready`; building a new plan archives the old one.
    """

    __tablename__ = "ai_plans"
    __table_args__ = (Index("ix_ai_plans_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # generating / ready / failed / archived
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="generating")
    # The user-local day it was built. The plan is a weekly template keyed by
    # weekday, so it applies from here until the next build.
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    plan: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Daily kcal/macros and how they were reached (estimates, safety clamps).
    targets: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    meal_plan_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # The plan-quota row (ai_scans) to refund if the build fails.
    scan_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
