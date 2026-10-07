"""add_user_units: display units preference (metric / imperial)

Data stays metric; this only records how the app should display it, so the
choice follows the user across reinstalls and devices.

Revision ID: a1c7d9e2f3b4
Revises: e9f5c3a6b2d1
Create Date: 2026-10-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c7d9e2f3b4"
down_revision: Union[str, Sequence[str], None] = "e9f5c3a6b2d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("units", sa.String(8), nullable=False, server_default="metric"),
    )
    op.create_check_constraint("ck_users_units", "users", "units IN ('metric', 'imperial')")


def downgrade() -> None:
    op.drop_constraint("ck_users_units", "users", type_="check")
    op.drop_column("users", "units")
