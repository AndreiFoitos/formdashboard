"""drop energy log and goals features

Revision ID: a0b1c2d3e4f5
Revises: f9b3c4d5e6a7
Create Date: 2026-06-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, Sequence[str], None] = "f9b3c4d5e6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Dropping the table drops its indexes too — no need to drop them explicitly,
    # and being explicit here trips up envs where one of the two historical index
    # names (`idx_energy_user_time` / `ix_energy_logs_user_logged_at`) is missing.
    op.execute("DROP TABLE IF EXISTS energy_logs CASCADE")
    op.execute("DROP TABLE IF EXISTS goals CASCADE")

    op.drop_column("daily_summaries", "energy_avg")
    op.drop_column("onboarding_baselines", "energy_rating")
    op.drop_column("users", "goal")


def downgrade() -> None:
    op.add_column("users", sa.Column("goal", sa.String(), nullable=True))
    op.add_column(
        "onboarding_baselines",
        sa.Column("energy_rating", sa.Integer(), nullable=True),
    )
    op.add_column(
        "daily_summaries",
        sa.Column("energy_avg", sa.Float(), nullable=True),
    )

    op.create_table(
        "goals",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "energy_logs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("logged_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_energy_user_time", "energy_logs", ["user_id", "logged_at"])
    op.create_index("ix_energy_logs_user_logged_at", "energy_logs", ["user_id", "logged_at"])
