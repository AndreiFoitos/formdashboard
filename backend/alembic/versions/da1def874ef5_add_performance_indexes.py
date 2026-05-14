from alembic import op


revision = "add_perf_indexes"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_daily_summaries_user_date",
        "daily_summaries",
        ["user_id", "date"],
    )

    op.create_index(
        "ix_energy_logs_user_logged_at",
        "energy_logs",
        ["user_id", "logged_at"],
    )

    op.create_index(
        "ix_hydration_logs_user_logged_at",
        "hydration_logs",
        ["user_id", "logged_at"],
    )

    op.create_index(
        "ix_nutrition_logs_user_date",
        "nutrition_logs",
        ["user_id", "date"],
    )

    op.create_index(
        "ix_training_logs_user_date",
        "training_logs",
        ["user_id", "date"],
    )


def downgrade():
    op.drop_index("ix_training_logs_user_date")
    op.drop_index("ix_nutrition_logs_user_date")
    op.drop_index("ix_hydration_logs_user_logged_at")
    op.drop_index("ix_energy_logs_user_logged_at")
    op.drop_index("ix_daily_summaries_user_date")