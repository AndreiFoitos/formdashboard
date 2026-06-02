"""sus v2 + vouches

- sus_votes: add `reason` and `training_log_id` columns. Replace the single
  unique constraint with two partial unique indexes so weekly and per-log
  votes can coexist without conflict.
- vouches: new table mirroring sus_votes' weekly shape.

Revision ID: f0a1b2c3d4e5
Revises: d3e4f5a6b8c9
Create Date: 2026-06-01 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f0a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "d3e4f5a6b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── sus_votes — add columns ──────────────────────────────────────────────
    op.add_column("sus_votes", sa.Column("reason", sa.String(length=30), nullable=True))
    op.add_column(
        "sus_votes",
        sa.Column(
            "training_log_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("training_logs.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )

    # Replace the blanket weekly unique constraint with two partial indexes.
    # The old constraint blocked per-log votes (would always collide with the
    # weekly tuple). Partial indexes let weekly and per-log live side by side.
    op.drop_constraint("uq_sus_vote_week", "sus_votes", type_="unique")
    op.create_index(
        "uq_sus_week_vote",
        "sus_votes",
        ["voter_id", "target_user_id", "week_start"],
        unique=True,
        postgresql_where=sa.text("training_log_id IS NULL"),
    )
    op.create_index(
        "uq_sus_log_vote",
        "sus_votes",
        ["voter_id", "training_log_id"],
        unique=True,
        postgresql_where=sa.text("training_log_id IS NOT NULL"),
    )

    # ── vouches — new table ──────────────────────────────────────────────────
    op.create_table(
        "vouches",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "voter_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "target_user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("voter_id", "target_user_id", "week_start", name="uq_vouch_week"),
    )
    op.create_index("ix_vouches_target_week", "vouches", ["target_user_id", "week_start"])


def downgrade() -> None:
    op.drop_index("ix_vouches_target_week", table_name="vouches")
    op.drop_table("vouches")

    op.drop_index("uq_sus_log_vote", table_name="sus_votes")
    op.drop_index("uq_sus_week_vote", table_name="sus_votes")
    op.create_unique_constraint(
        "uq_sus_vote_week", "sus_votes", ["voter_id", "target_user_id", "week_start"]
    )

    op.drop_column("sus_votes", "training_log_id")
    op.drop_column("sus_votes", "reason")
