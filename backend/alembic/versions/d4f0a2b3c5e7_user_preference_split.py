"""user_preference_split

Plans only took a day count, so the builder always picked the split itself
and a rebuild gave the same upper/lower week. This stores the user's own
split: the session focuses in the order they cycle.

Revision ID: d4f0a2b3c5e7
Revises: d5f1a3b7c9e2
Create Date: 2026-10-27 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d4f0a2b3c5e7"
down_revision: Union[str, Sequence[str], None] = "d5f1a3b7c9e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_preferences", sa.Column("split", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_preferences", "split")
