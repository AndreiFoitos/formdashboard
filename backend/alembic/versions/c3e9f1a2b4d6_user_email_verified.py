"""user_email_verified

Email/password sign-up never proved the address belongs to the person, yet
Apple/Google sign-in linked accounts by email. This flag records whether the
email was proven (a provider vouched for it or an emailed link was clicked),
and only proven emails are used for linking.

Revision ID: c3e9f1a2b4d6
Revises: b2d8e0f1a3c5
Create Date: 2026-10-27 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3e9f1a2b4d6"
down_revision: Union[str, Sequence[str], None] = "b2d8e0f1a3c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Apple and Google only hand over emails they've verified.
    op.execute(
        "UPDATE users SET email_verified = true "
        "WHERE email IS NOT NULL AND (apple_sub IS NOT NULL OR google_sub IS NOT NULL)"
    )


def downgrade() -> None:
    op.drop_column("users", "email_verified")
