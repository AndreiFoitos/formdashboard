"""users: add avatar

JSONB with the user's 3D avatar look and last applied body shape-key weights
(see schemas/avatar.py). Nullable: users without one get the default look.

Revision ID: b8d4f2a1c3e5
Revises: a7c3e1f09b2d
Create Date: 2026-09-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b8d4f2a1c3e5"
down_revision: Union[str, Sequence[str], None] = "a7c3e1f09b2d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar")
