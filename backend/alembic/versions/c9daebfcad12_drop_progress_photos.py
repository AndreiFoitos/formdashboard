"""drop progress_photos

Photo timeline feature removed. We deliberately do not store user photos —
the BF% estimator forwards images to Claude and drops them; nothing else
needs persistence. This migration is irreversible from a privacy standpoint:
downgrade() recreates the table shape but cannot restore deleted user images.

Revision ID: c9daebfcad12
Revises: b8c9daebfcad
Create Date: 2026-06-03 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9daebfcad12"
down_revision: Union[str, Sequence[str], None] = "b8c9daebfcad"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Mirror the actual index created in f6a7b8c9daeb_add_progress_photos.py:
    # composite (user_id, taken_at), not user_id alone. Naming this wrong on
    # the first attempt fired UndefinedObjectError on production.
    op.drop_index("ix_progress_photos_user_taken", table_name="progress_photos")
    op.drop_table("progress_photos")


def downgrade() -> None:
    # Exact mirror of f6a7b8c9daeb's upgrade(): same column types, defaults,
    # and composite index. Re-running the original migration after this one
    # would otherwise fail with conflicting schema.
    op.create_table(
        "progress_photos",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("taken_at", sa.Date(), nullable=False),
        sa.Column("image_b64", sa.Text(), nullable=False),
        sa.Column(
            "mime_type",
            sa.String(length=40),
            nullable=False,
            server_default="image/jpeg",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("weight_snapshot_kg", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_progress_photos_user_taken",
        "progress_photos",
        ["user_id", "taken_at"],
    )
