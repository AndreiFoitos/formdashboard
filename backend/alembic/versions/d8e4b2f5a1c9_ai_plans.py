"""ai_plans: Pit Crew training + meal plans

See models/ai_plan.py and docs/ai-plans-design.md §4.

Revision ID: d8e4b2f5a1c9
Revises: c7f3a1d4e2b8
Create Date: 2026-10-02 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d8e4b2f5a1c9"
down_revision: Union[str, Sequence[str], None] = "c7f3a1d4e2b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("plan", postgresql.JSONB(), nullable=True),
        sa.Column("targets", postgresql.JSONB(), nullable=True),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("meal_plan_enabled", sa.Boolean(), nullable=False),
        sa.Column("scan_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_plans_user_created", "ai_plans", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_plans_user_created", table_name="ai_plans")
    op.drop_table("ai_plans")
