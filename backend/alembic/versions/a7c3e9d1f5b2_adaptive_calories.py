"""adaptive_calories

Weekly calorie suggestions from weigh-ins and food logs: a pace for the
goal and an on/off switch on user_preferences, and one calorie_updates row
per user per week. See services/energy.py and services/adaptive_calories.py.

Revision ID: a7c3e9d1f5b2
Revises: d4f0a2b3c5e7
Create Date: 2026-10-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a7c3e9d1f5b2"
down_revision: Union[str, Sequence[str], None] = "d4f0a2b3c5e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_preferences", sa.Column("pace", sa.String(8), nullable=True))
    op.add_column(
        "user_preferences",
        sa.Column("adaptive_calories", sa.Boolean(), server_default="true", nullable=False),
    )
    op.create_table(
        "calorie_updates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("old_kcal", sa.Integer(), nullable=True),
        sa.Column("new_kcal", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("details", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "week_start", name="uq_calorie_update_week"),
    )


def downgrade() -> None:
    op.drop_table("calorie_updates")
    op.drop_column("user_preferences", "adaptive_calories")
    op.drop_column("user_preferences", "pace")
