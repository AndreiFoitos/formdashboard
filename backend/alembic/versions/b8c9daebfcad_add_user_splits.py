"""add user_splits

Per-weekday training split detected by services/split_detection.py from the
last 28 days of TrainingLog activity. Refreshed nightly.

Revision ID: b8c9daebfcad
Revises: a7b8c9daebfc
Create Date: 2026-06-03 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c9daebfcad"
down_revision: Union[str, Sequence[str], None] = "a7b8c9daebfc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_splits",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("group_name", sa.String(length=20), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "weekday", name="uq_user_split_weekday"),
    )
    op.create_index("ix_user_splits_user_id", "user_splits", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_splits_user_id", table_name="user_splits")
    op.drop_table("user_splits")
