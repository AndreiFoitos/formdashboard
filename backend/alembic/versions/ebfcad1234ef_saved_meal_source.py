"""saved_meals: add source column + drop pattern uniqueness

Saved meals can now be either user-composed ('manual') or auto-detected
('auto'). The previous unique constraint on (user_id, food_set_hash,
time_bucket) blocked manual + auto from coexisting for the same food set,
so we drop it. The auto-detector's dup-check is now scoped to source='auto'
rows only (handled in services/saved_meals.py).

Existing rows are backfilled to source='auto' (every SavedMeal pre-this-
migration came from the nightly detector). The column's server_default is
then set to 'manual' so new rows from the manual-create endpoint don't have
to specify it explicitly.

Revision ID: ebfcad1234ef
Revises: daebfcad1234
Create Date: 2026-06-03 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ebfcad1234ef"
down_revision: Union[str, Sequence[str], None] = "daebfcad1234"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: add the column with a backfill default of 'auto' so every
    # existing row gets labelled correctly without a separate UPDATE.
    op.add_column(
        "saved_meals",
        sa.Column(
            "source",
            sa.String(length=10),
            nullable=False,
            server_default="auto",
        ),
    )
    # Step 2: switch the default to 'manual' for future inserts. Existing
    # rows already have 'auto' from step 1.
    op.alter_column("saved_meals", "source", server_default="manual")

    # Manual meals don't carry a time_bucket; give the column a sensible
    # default so inserts can leave it empty.
    op.alter_column("saved_meals", "time_bucket", server_default="")

    # Drop the pattern-uniqueness constraint so manual + auto rows with the
    # same food_set_hash can coexist.
    op.drop_constraint(
        "uq_saved_meal_pattern", "saved_meals", type_="unique"
    )


def downgrade() -> None:
    # Re-create the unique constraint. If both manual and auto rows exist
    # for the same pattern, this will fail — the operator should resolve
    # the duplicates first.
    op.create_unique_constraint(
        "uq_saved_meal_pattern",
        "saved_meals",
        ["user_id", "food_set_hash", "time_bucket"],
    )
    op.alter_column("saved_meals", "time_bucket", server_default=None)
    op.drop_column("saved_meals", "source")
