"""add_friendships_and_sus_votes

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-05-29 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, Sequence[str], None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'friendships',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('requester_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('addressee_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['requester_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['addressee_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('requester_id', 'addressee_id', name='uq_friendship_pair'),
    )
    op.create_index('ix_friendships_requester_id', 'friendships', ['requester_id'])
    op.create_index('ix_friendships_addressee_id', 'friendships', ['addressee_id'])

    op.create_table(
        'sus_votes',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('voter_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('target_user_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('week_start', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['voter_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('voter_id', 'target_user_id', 'week_start', name='uq_sus_vote_week'),
    )
    op.create_index('ix_sus_votes_target_week', 'sus_votes', ['target_user_id', 'week_start'])


def downgrade() -> None:
    op.drop_index('ix_sus_votes_target_week', table_name='sus_votes')
    op.drop_table('sus_votes')
    op.drop_index('ix_friendships_addressee_id', table_name='friendships')
    op.drop_index('ix_friendships_requester_id', table_name='friendships')
    op.drop_table('friendships')
