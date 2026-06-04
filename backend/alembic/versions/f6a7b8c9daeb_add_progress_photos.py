"""add progress_photos

Before/after body photo timeline. Images live in a TEXT column as base64 —
small scale, no S3 yet. Future migration can move to URL pointers without
changing the API shape much.

Revision ID: f6a7b8c9daeb
Revises: e5f6a7b8c9da
Create Date: 2026-06-02 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9daeb"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9da"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "progress_photos",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("taken_at", sa.Date(), nullable=False),
        sa.Column("image_b64", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=40), nullable=False, server_default="image/jpeg"),
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


def downgrade() -> None:
    op.drop_index("ix_progress_photos_user_taken", table_name="progress_photos")
    op.drop_table("progress_photos")
