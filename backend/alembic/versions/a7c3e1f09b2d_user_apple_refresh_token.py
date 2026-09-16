"""users: add apple_refresh_token

Stores the Apple refresh token obtained by exchanging the Sign in with Apple
authorization code, so account deletion can revoke it (App Store Review
Guideline 5.1.1(v)). Nullable: existing Apple users get one on their next
sign-in; email and Google users never have one.

Revision ID: a7c3e1f09b2d
Revises: ebfcad1234ef
Create Date: 2026-09-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7c3e1f09b2d"
down_revision: Union[str, Sequence[str], None] = "ebfcad1234ef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("apple_refresh_token", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "apple_refresh_token")
