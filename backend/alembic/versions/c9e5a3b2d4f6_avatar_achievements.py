"""avatar_achievements table

Daily combo hits + milestone unlocks for the avatar reward system
(services/avatar_rewards.py).

Revision ID: c9e5a3b2d4f6
Revises: b8d4f2a1c3e5
Create Date: 2026-09-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c9e5a3b2d4f6"
down_revision: Union[str, Sequence[str], None] = "b8d4f2a1c3e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "avatar_achievements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("seen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "key", "date", name="uq_avatar_achievement_day"),
    )
    op.create_index("ix_avatar_achievements_user_id", "avatar_achievements", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_avatar_achievements_user_id", table_name="avatar_achievements")
    op.drop_table("avatar_achievements")
