"""drop reason from sus_votes

Sus voting is now a one-tap toggle (approve / sus) with no reason taxonomy,
so the column is dead weight. Drop it. Downgrade re-adds it nullable.

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-06-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a8"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("sus_votes", "reason")


def downgrade() -> None:
    op.add_column(
        "sus_votes",
        sa.Column("reason", sa.String(length=30), nullable=True),
    )
