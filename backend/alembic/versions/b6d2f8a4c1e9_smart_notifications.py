"""smart_notifications

Smart reminders (meals, training, protein, weigh-in, comeback): a row per
push sent, for dedupe and for backing off reminders the user ignores, and
per-user switches for each kind.

Revision ID: b6d2f8a4c1e9
Revises: a7c3e9d1f5b2
Create Date: 2026-10-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b6d2f8a4c1e9"
down_revision: Union[str, Sequence[str], None] = "a7c3e9d1f5b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("dedupe_key", sa.String(96), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "dedupe_key", name="uq_push_event_dedupe"),
    )
    op.create_index("ix_push_events_user_sent", "push_events", ["user_id", "sent_at"])
    op.create_table(
        "notification_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("off", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("notification_settings")
    op.drop_index("ix_push_events_user_sent", table_name="push_events")
    op.drop_table("push_events")
