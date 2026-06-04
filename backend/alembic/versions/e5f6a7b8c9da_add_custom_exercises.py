"""add custom_exercises

User-defined exercises that show up in the picker alongside the hardcoded
catalogue. Used as TrainingLog.type directly (free-text key) so no FK
linkage from training_logs — the JOIN-free approach keeps the existing
volume/PR logic untouched.

Revision ID: e5f6a7b8c9da
Revises: d4e5f6a8b9ca
Create Date: 2026-06-02 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f6a7b8c9da"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a8b9ca"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "custom_exercises",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("group_name", sa.String(length=20), nullable=False, server_default="Other"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_custom_exercise_name"),
    )
    op.create_index("ix_custom_exercises_user_id", "custom_exercises", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_exercises_user_id", table_name="custom_exercises")
    op.drop_table("custom_exercises")
