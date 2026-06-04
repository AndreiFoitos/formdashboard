import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from core.database import Base


class SavedMeal(Base):
    """A user-saved meal: either auto-detected by the nightly scheduler or
    manually composed by the user via the Saved tab.

    `source` distinguishes the two paths and drives the Saved-tab grouping:
    'manual' rows surface under 'My meals'; 'auto' rows under 'Suggested by
    Protocol'. Auto rows are identified by (food_set_hash, time_bucket); the
    nightly detector dup-checks against existing source='auto' rows only, so
    a user can manually save a meal with the same food set without blocking
    a future suggestion of the same pattern (and vice versa).

    `auto_generated_name` flips to False the first time the user renames the
    meal; UI uses it to know when to surface the rename pencil more loudly.
    Manual meals start with it False (the user named it themselves).
    """

    __tablename__ = "saved_meals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Bucketed time-of-day for auto-detected meals: morning | midday | evening
    # | late. Manual meals default to '' (empty) since the user doesn't pick
    # a time. Kept non-null so SQL group-bys stay simple.
    time_bucket: Mapped[str] = mapped_column(String(10), nullable=False, server_default="")
    # Deterministic hash of the sorted, normalized food names. Two occurrences
    # with the same hash describe the same set of foods.
    food_set_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # 'manual' = user composed via Saved tab. 'auto' = nightly detector.
    # Drives Saved-tab grouping + dup-check scope.
    source: Mapped[str] = mapped_column(
        String(10), nullable=False, default="manual", server_default="manual"
    )
    auto_generated_name: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    items: Mapped[list["SavedMealItem"]] = relationship(
        back_populates="saved_meal", cascade="all, delete-orphan"
    )


class SavedMealItem(Base):
    """One food inside a SavedMeal. Macros are averages computed at detection
    time — re-logging this meal duplicates these values into fresh
    NutritionLog rows (no re-lookup against USDA). Stale if the underlying
    pattern occurrences change; the nightly job overwrites items when it
    re-evaluates the pattern."""

    __tablename__ = "saved_meal_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    saved_meal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("saved_meals.id", ondelete="CASCADE"), nullable=False
    )
    # Display name = the user-typed meal_name from their logs (e.g. "Eggs",
    # not the USDA description). Carries the casing the user actually uses.
    food_name: Mapped[str] = mapped_column(String, nullable=False)
    # Grams can be null on legacy rows logged before we tracked portions; the
    # detector still works (averages over occurrences with known grams).
    grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    calories: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    protein_g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    carbs_g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    fat_g: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    saved_meal: Mapped[SavedMeal] = relationship(back_populates="items")


class DismissedMealPattern(Base):
    """Per-user blocklist of food-set + time-bucket pairs the user explicitly
    deleted. The detector skips these so a deleted meal doesn't auto-resurface
    every night. Permanent until the row is removed."""

    __tablename__ = "dismissed_meal_patterns"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "food_set_hash",
            "time_bucket",
            name="uq_dismissed_meal_pattern",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    food_set_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    time_bucket: Mapped[str] = mapped_column(String(10), nullable=False)
    dismissed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
