"""add users.sex (for Mifflin-St Jeor BMR)

Revision ID: c2d3e4f5a6b8
Revises: b1c2d3e4f5a7
Create Date: 2026-06-01 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2d3e4f5a6b8"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("sex", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "sex")
