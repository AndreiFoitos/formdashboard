"""add_oauth_and_username

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-05-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, Sequence[str], None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # OAuth-only users have no password; existing rows keep their hash.
    op.alter_column('users', 'hashed_password', existing_type=sa.String(), nullable=True)

    op.add_column('users', sa.Column('username', sa.String(), nullable=True))
    op.add_column('users', sa.Column('apple_sub', sa.String(), nullable=True))
    op.add_column('users', sa.Column('google_sub', sa.String(), nullable=True))

    op.create_unique_constraint('uq_users_username', 'users', ['username'])
    op.create_unique_constraint('uq_users_apple_sub', 'users', ['apple_sub'])
    op.create_unique_constraint('uq_users_google_sub', 'users', ['google_sub'])

    # Friend lookups hit this column on every invite; an index pays for itself.
    op.create_index('ix_users_username', 'users', ['username'])


def downgrade() -> None:
    op.drop_index('ix_users_username', table_name='users')
    op.drop_constraint('uq_users_google_sub', 'users', type_='unique')
    op.drop_constraint('uq_users_apple_sub', 'users', type_='unique')
    op.drop_constraint('uq_users_username', 'users', type_='unique')
    op.drop_column('users', 'google_sub')
    op.drop_column('users', 'apple_sub')
    op.drop_column('users', 'username')
    op.alter_column('users', 'hashed_password', existing_type=sa.String(), nullable=False)
