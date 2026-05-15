"""add_body_metrics

Revision ID: cd51666cb12a
Revises: add_perf_indexes
Create Date: 2026-05-15 13:34:39.238779

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cd51666cb12a'
down_revision: Union[str, Sequence[str], None] = 'add_perf_indexes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
 
 
def upgrade() -> None:
    op.create_table(
        'body_metrics',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('weight_kg', sa.Float(), nullable=True),
        sa.Column('body_fat_pct', sa.Float(), nullable=True),
        sa.Column('source', sa.String(), nullable=False, server_default='manual'),
        sa.Column('logged_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_body_metrics_user_date', 'body_metrics', ['user_id', 'date'])


def downgrade() -> None:
    op.drop_index('ix_body_metrics_user_date', table_name='body_metrics')
    op.drop_table('body_metrics')
 