"""user_preferences for AI training + meal plans

See models/user_preference.py and docs/ai-plans-design.md §4.

Revision ID: b5d2e8f1a9c3
Revises: a3c8e1f2b4d6
Create Date: 2026-10-02 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b5d2e8f1a9c3"
down_revision: Union[str, Sequence[str], None] = "a3c8e1f2b4d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    empty = sa.text("'[]'::jsonb")
    op.create_table(
        "user_preferences",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("goal", sa.String(10), nullable=True),
        sa.Column("equipment", sa.String(16), nullable=True),
        sa.Column("experience", sa.String(12), nullable=True),
        sa.Column("session_minutes", sa.SmallInteger(), nullable=True),
        sa.Column("training_days", sa.SmallInteger(), nullable=True),
        sa.Column("injuries", postgresql.JSONB(), nullable=False, server_default=empty),
        sa.Column("diet_style", sa.String(16), nullable=True),
        sa.Column("allergies", postgresql.JSONB(), nullable=False, server_default=empty),
        sa.Column("dislikes", postgresql.JSONB(), nullable=False, server_default=empty),
        sa.Column("cooking", sa.String(10), nullable=True),
        sa.Column("health_flags", postgresql.JSONB(), nullable=True),
        sa.Column("notes", postgresql.JSONB(), nullable=False, server_default=empty),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
