"""per-lift vouches

Mirror the sus_votes shape onto vouches so users can endorse a specific lift
the same way they can sus a specific lift. Same partial-unique-index trick
lets weekly and per-lift vouches coexist.

Revision ID: a1b2c3d4e5f7
Revises: f0a1b2c3d4e5
Create Date: 2026-06-01 17:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, Sequence[str], None] = "f0a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vouches",
        sa.Column(
            "training_log_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("training_logs.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )

    op.drop_constraint("uq_vouch_week", "vouches", type_="unique")
    op.create_index(
        "uq_vouch_week_vote",
        "vouches",
        ["voter_id", "target_user_id", "week_start"],
        unique=True,
        postgresql_where=sa.text("training_log_id IS NULL"),
    )
    op.create_index(
        "uq_vouch_log_vote",
        "vouches",
        ["voter_id", "training_log_id"],
        unique=True,
        postgresql_where=sa.text("training_log_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_vouch_log_vote", table_name="vouches")
    op.drop_index("uq_vouch_week_vote", table_name="vouches")
    op.create_unique_constraint(
        "uq_vouch_week", "vouches", ["voter_id", "target_user_id", "week_start"]
    )
    op.drop_column("vouches", "training_log_id")
