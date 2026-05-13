"""phase 1b tables

Revision ID: a1b2c3d4e5f6
Revises: 366cd26b2b8c
Create Date: 2026-05-13 15:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '366cd26b2b8c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add form_score_unlocked to users
    op.add_column('users', sa.Column('form_score_unlocked', sa.Boolean(), nullable=False, server_default='false'))

    # Energy logs
    op.create_table(
        'energy_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('logged_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('level', sa.Integer(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_energy_user_time', 'energy_logs', ['user_id', 'logged_at'])

    # Stimulant logs
    op.create_table(
        'stimulant_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('logged_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('substance', sa.String(), nullable=False),
        sa.Column('caffeine_mg', sa.Integer(), nullable=False),
        sa.Column('half_life_hours', sa.Float(), nullable=False, server_default='5.5'),
        sa.Column('note', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Hydration logs
    op.create_table(
        'hydration_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('logged_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('amount_ml', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(), nullable=False, server_default='water'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Nutrition logs
    op.create_table(
        'nutrition_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('calories', sa.Integer(), nullable=True),
        sa.Column('protein_g', sa.Float(), nullable=True),
        sa.Column('carbs_g', sa.Float(), nullable=True),
        sa.Column('fat_g', sa.Float(), nullable=True),
        sa.Column('meal_name', sa.String(), nullable=True),
        sa.Column('logged_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    # Training logs
    op.create_table(
        'training_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('duration_min', sa.Integer(), nullable=True),
        sa.Column('intensity', sa.Integer(), nullable=True),
        sa.Column('volume_sets', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('source', sa.String(), nullable=False, server_default='manual'),
        sa.Column('logged_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('training_logs')
    op.drop_table('nutrition_logs')
    op.drop_table('hydration_logs')
    op.drop_table('stimulant_logs')
    op.drop_index('idx_energy_user_time', table_name='energy_logs')
    op.drop_table('energy_logs')
    op.drop_column('users', 'form_score_unlocked')