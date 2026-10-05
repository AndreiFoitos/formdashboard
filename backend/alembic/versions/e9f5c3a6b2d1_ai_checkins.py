"""ai_checkins: Pit Crew weekly check-ins

See models/ai_checkin.py and services/plan_checkin.py.

Revision ID: e9f5c3a6b2d1
Revises: d8e4b2f5a1c9
Create Date: 2026-10-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "e9f5c3a6b2d1"
down_revision: Union[str, Sequence[str], None] = "d8e4b2f5a1c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_checkins",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "plan_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ai_plans.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("stats", postgresql.JSONB(), nullable=False),
        sa.Column("review", sa.Text(), nullable=False),
        sa.Column("suggestions", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "week_start", name="uq_ai_checkin_week"),
    )


def downgrade() -> None:
    op.drop_table("ai_checkins")
