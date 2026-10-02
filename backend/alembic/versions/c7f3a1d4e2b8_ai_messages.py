"""ai_messages: saved Ask / Pit Crew chat

See models/ai_message.py and docs/ai-plans-design.md §4.

Revision ID: c7f3a1d4e2b8
Revises: b5d2e8f1a9c3
Create Date: 2026-10-02 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c7f3a1d4e2b8"
down_revision: Union[str, Sequence[str], None] = "b5d2e8f1a9c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("actions", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_messages_user_created", "ai_messages", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_messages_user_created", table_name="ai_messages")
    op.drop_table("ai_messages")
