import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class UserPreference(Base):
    """What the AI plans need to know that the logs can't tell us: goal,
    equipment, experience, diet and health constraints. One row per user,
    filled by the onboarding Training/Food steps, Settings, and (later) the
    Pit Crew chat. See docs/ai-plans-design.md §4.

    Every column is nullable: both onboarding steps are skippable, and a
    missing answer means "ask later", not a default.
    """

    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # cut / maintain / bulk. Onboarding used to compute calorie_target from
    # this and throw it away.
    goal: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # gym / home_weights / bodyweight
    equipment: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # new / some / experienced
    experience: Mapped[str | None] = mapped_column(String(12), nullable=True)
    session_minutes: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # Explicit days per week. When null, plans fall back to the onboarding
    # training_frequency bucket.
    training_days: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    injuries: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # anything / vegetarian / vegan / pescatarian / halal / kosher
    diet_style: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Hard constraint: a plan containing one of these is rejected.
    allergies: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # Soft constraint: foods to avoid. Grows from the chat ("I hate salmon").
    dislikes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # minimal / some / loves
    cooking: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # pregnant / eating_disorder / diabetes / kidney. Any of these turns the
    # meal plan off (docs/ai-plans-design.md §8). [] means the user answered
    # "None"; null means they haven't answered yet.
    health_flags: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    # Free-form facts the chat saves ("works night shifts").
    notes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
