"""add calories/macros/additions to stimulant_logs

Revision ID: d3e4f5a6b8c9
Revises: c2d3e4f5a6b8
Create Date: 2026-06-01 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "d3e4f5a6b8c9"
down_revision: Union[str, Sequence[str], None] = "c2d3e4f5a6b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("stimulant_logs", sa.Column("calories", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("stimulant_logs", sa.Column("protein_g", sa.Float(), nullable=False, server_default="0"))
    op.add_column("stimulant_logs", sa.Column("carbs_g", sa.Float(), nullable=False, server_default="0"))
    op.add_column("stimulant_logs", sa.Column("fat_g", sa.Float(), nullable=False, server_default="0"))
    op.add_column("stimulant_logs", sa.Column("additions", JSONB(), nullable=False, server_default="[]"))


def downgrade() -> None:
    op.drop_column("stimulant_logs", "additions")
    op.drop_column("stimulant_logs", "fat_g")
    op.drop_column("stimulant_logs", "carbs_g")
    op.drop_column("stimulant_logs", "protein_g")
    op.drop_column("stimulant_logs", "calories")
