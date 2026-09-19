"""plans, ai_scans and purchases

Subscription plan on users, a per-scan ledger for plan quotas, and one-off
store purchases (avatar packs). See services/plans.py and services/billing.py.

Revision ID: d7a1c4e9b2f3
Revises: c9e5a3b2d4f6
Create Date: 2026-09-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d7a1c4e9b2f3"
down_revision: Union[str, Sequence[str], None] = "c9e5a3b2d4f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("plan", sa.String(16), nullable=False, server_default="free"))
    op.add_column("users", sa.Column("plan_expires_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "ai_scans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_ai_scans_user_kind_created", "ai_scans", ["user_id", "kind", "created_at"])

    op.create_table(
        "purchases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.String(128), nullable=False),
        sa.Column("transaction_id", sa.String(128), nullable=False, unique=True),
        sa.Column("purchased_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_purchases_user_id", "purchases", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_purchases_user_id", table_name="purchases")
    op.drop_table("purchases")
    op.drop_index("ix_ai_scans_user_kind_created", table_name="ai_scans")
    op.drop_table("ai_scans")
    op.drop_column("users", "plan_expires_at")
    op.drop_column("users", "plan")
