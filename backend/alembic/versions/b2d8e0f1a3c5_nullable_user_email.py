"""nullable_user_email

Apple only puts the email in the identity token on the first authorization.
If a user's row is deleted without Apple being revoked, their next Sign in
with Apple has a new-to-us sub and no email, so the account must be creatable
without one.

Revision ID: b2d8e0f1a3c5
Revises: a1c7d9e2f3b4
Create Date: 2026-10-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2d8e0f1a3c5"
down_revision: Union[str, Sequence[str], None] = "a1c7d9e2f3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    op.alter_column("users", "email", existing_type=sa.String(), nullable=False)
