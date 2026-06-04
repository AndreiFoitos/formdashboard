"""add saved_meals + saved_meal_items + dismissed_meal_patterns

Auto-detected recurring meal patterns. The detector groups NutritionLog rows
by (date, time_bucket), computes a hash of the food set, and creates a
SavedMeal when that pattern repeats >=3 times in 14 days. Items hold the
averaged portions + macros; dismissed_meal_patterns is the user's blocklist
for meals they've explicitly deleted so the detector doesn't resurface them.

Revision ID: d4e5f6a8b9ca
Revises: c3d4e5f6a8b9
Create Date: 2026-06-02 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a8b9ca"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_meals",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("time_bucket", sa.String(length=10), nullable=False),
        sa.Column("food_set_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "auto_generated_name",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "food_set_hash", "time_bucket", name="uq_saved_meal_pattern"
        ),
    )
    op.create_index("ix_saved_meals_user_id", "saved_meals", ["user_id"])

    op.create_table(
        "saved_meal_items",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "saved_meal_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("food_name", sa.String(), nullable=False),
        sa.Column("grams", sa.Float(), nullable=True),
        sa.Column("calories", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("protein_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("carbs_g", sa.Float(), nullable=False, server_default="0"),
        sa.Column("fat_g", sa.Float(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["saved_meal_id"], ["saved_meals.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_saved_meal_items_saved_meal_id", "saved_meal_items", ["saved_meal_id"]
    )

    op.create_table(
        "dismissed_meal_patterns",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("food_set_hash", sa.String(length=64), nullable=False),
        sa.Column("time_bucket", sa.String(length=10), nullable=False),
        sa.Column(
            "dismissed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "food_set_hash",
            "time_bucket",
            name="uq_dismissed_meal_pattern",
        ),
    )
    op.create_index(
        "ix_dismissed_meal_patterns_user_id",
        "dismissed_meal_patterns",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_dismissed_meal_patterns_user_id", table_name="dismissed_meal_patterns"
    )
    op.drop_table("dismissed_meal_patterns")
    op.drop_index("ix_saved_meal_items_saved_meal_id", table_name="saved_meal_items")
    op.drop_table("saved_meal_items")
    op.drop_index("ix_saved_meals_user_id", table_name="saved_meals")
    op.drop_table("saved_meals")
