"""add_weight_reps_to_training_logs

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-05-29 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('training_logs', sa.Column('weight_kg', sa.Float(), nullable=True))
    op.add_column('training_logs', sa.Column('reps', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('training_logs', 'reps')
    op.drop_column('training_logs', 'weight_kg')
