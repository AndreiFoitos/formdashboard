"""training attachment

The cable attachment a set was done with (rope, triangle, ...), so a rope
pushdown and a triangle pushdown keep their own weights, targets and PRs.

Revision ID: e2a7c5d9f3b1
Revises: c4e8a2f6b1d3
Create Date: 2026-11-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2a7c5d9f3b1"
down_revision: Union[str, Sequence[str], None] = "c4e8a2f6b1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("training_logs", sa.Column("attachment", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("training_logs", "attachment")
