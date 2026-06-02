"""drop device_connections + onboarding_baselines.device_connected

Revision ID: b1c2d3e4f5a7
Revises: a0b1c2d3e4f5
Create Date: 2026-06-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1c2d3e4f5a7"
down_revision: Union[str, Sequence[str], None] = "a0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Dropping the table drops its indexes too — use IF EXISTS so the migration
    # is safe to run on envs where the index/table is partially missing.
    op.execute("DROP TABLE IF EXISTS device_connections CASCADE")
    op.drop_column("onboarding_baselines", "device_connected")


def downgrade() -> None:
    op.add_column(
        "onboarding_baselines",
        sa.Column("device_connected", sa.String(), nullable=True),
    )
    op.create_table(
        "device_connections",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("access_token", sa.String(), nullable=True),
        sa.Column("refresh_token", sa.String(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("connected_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "provider", name="uq_device_connections_user_provider"),
    )
    op.create_index("ix_device_connections_user", "device_connections", ["user_id"])
