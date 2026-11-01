"""creatine

Creatine tracking: a daily tick (one row per user per local day) and the
on/off switch and dose on user_preferences.

Revision ID: c4e8a2f6b1d3
Revises: b6d2f8a4c1e9
Create Date: 2026-11-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c4e8a2f6b1d3"
down_revision: Union[str, Sequence[str], None] = "b6d2f8a4c1e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "creatine_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("logged_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("dose_g", sa.Float(), nullable=False),
        sa.UniqueConstraint("user_id", "date", name="uq_creatine_log_day"),
    )
    op.add_column("user_preferences", sa.Column("creatine_on", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("user_preferences", sa.Column("creatine_dose_g", sa.Float(), server_default="5", nullable=False))


def downgrade() -> None:
    op.drop_column("user_preferences", "creatine_dose_g")
    op.drop_column("user_preferences", "creatine_on")
    op.drop_table("creatine_logs")
