"""drop set_type + set_group_id from training_logs

W/D/S tagging removed — it was out of scope and added cognitive load to the
log-set flow without paying back enough downstream. PR detection is now back
to 'every set is eligible' (consistent with the volume / leaderboard math),
and supersets/circuits/drop sets are no longer modelled in the data layer.

Mirrors a7b8c9daebfc's add in reverse: drop the partial index first, then
the two columns.

Revision ID: daebfcad1234
Revises: c9daebfcad12
Create Date: 2026-06-03 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "daebfcad1234"
down_revision: Union[str, Sequence[str], None] = "c9daebfcad12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_training_logs_set_group_id", table_name="training_logs")
    op.drop_column("training_logs", "set_group_id")
    op.drop_column("training_logs", "set_type")


def downgrade() -> None:
    # Exact mirror of a7b8c9daebfc's upgrade(). Existing rows get the
    # 'normal' default; set_group_id starts NULL.
    op.add_column(
        "training_logs",
        sa.Column(
            "set_type",
            sa.String(length=12),
            nullable=False,
            server_default="normal",
        ),
    )
    op.add_column(
        "training_logs",
        sa.Column(
            "set_group_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_training_logs_set_group_id",
        "training_logs",
        ["set_group_id"],
        postgresql_where=sa.text("set_group_id IS NOT NULL"),
    )
