"""add set_type + set_group_id to training_logs

Lets a TrainingLog row carry kind information (normal / warmup / drop /
superset) and link grouped sets via a shared UUID. Both columns are
backfill-safe: existing rows default to 'normal' and NULL respectively.

Revision ID: a7b8c9daebfc
Revises: f6a7b8c9daeb
Create Date: 2026-06-02 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9daebfc"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9daeb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "training_logs",
        sa.Column(
            "set_type",
            sa.String(length=12),
            nullable=False,
            server_default="normal",
        ),
    )
    op.add_column(
        "training_logs",
        sa.Column(
            "set_group_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_training_logs_set_group_id",
        "training_logs",
        ["set_group_id"],
        postgresql_where=sa.text("set_group_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_training_logs_set_group_id", table_name="training_logs")
    op.drop_column("training_logs", "set_group_id")
    op.drop_column("training_logs", "set_type")
