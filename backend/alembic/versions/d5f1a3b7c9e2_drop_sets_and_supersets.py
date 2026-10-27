"""drop sets and supersets on training_logs

Brings back set typing, smaller than the June version (a7b8c9daebfc, dropped
in daebfcad1234): only "normal" and "drop", no warm-up tag (progression
already ignores light sets), and superset_id links the sets of exercises done
back to back. Drop sets are left out of progression targets; volume counts
them like any set.

Revision ID: d5f1a3b7c9e2
Revises: c3e9f1a2b4d6
Create Date: 2026-10-27 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d5f1a3b7c9e2"
down_revision: Union[str, Sequence[str], None] = "c3e9f1a2b4d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "training_logs",
        sa.Column("set_type", sa.String(length=8), nullable=False, server_default="normal"),
    )
    op.add_column(
        "training_logs",
        sa.Column("superset_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("training_logs", "superset_id")
    op.drop_column("training_logs", "set_type")
