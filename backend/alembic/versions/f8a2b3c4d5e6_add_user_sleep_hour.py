"""add_user_sleep_hour

Revision ID: f8a2b3c4d5e6
Revises: e7f1a2b3c4d5
Create Date: 2026-05-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f8a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'e7f1a2b3c4d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('sleep_hour', sa.Integer(), nullable=False, server_default='23'))


def downgrade() -> None:
    op.drop_column('users', 'sleep_hour')
