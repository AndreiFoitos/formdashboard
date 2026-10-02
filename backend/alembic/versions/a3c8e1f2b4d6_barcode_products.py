"""barcode_products cache

Open Food Facts lookups shared across users. See models/barcode_product.py.

Revision ID: a3c8e1f2b4d6
Revises: d7a1c4e9b2f3
Create Date: 2026-10-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a3c8e1f2b4d6"
down_revision: Union[str, Sequence[str], None] = "d7a1c4e9b2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "barcode_products",
        sa.Column("barcode", sa.String(14), primary_key=True),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("barcode_products")
