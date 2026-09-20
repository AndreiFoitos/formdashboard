"""Export everything a user logged, as a ZIP of CSV files (Pro).

Deliberately complete: the point of an export is that people can leave with
their data, so it covers every table they write to, not a summary. Built in
memory — a heavy user after a year is on the order of a few MB, well within
what Render's free instance can hold for one request.
"""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.body_metric import BodyMetric
from models.daily_summary import DailySummary
from models.hydration_log import HydrationLog
from models.nutrition_log import NutritionLog
from models.stimulant_log import StimulantLog
from models.training_log import TrainingLog
from models.user import User

# table name -> (model, columns)
TABLES = {
    "daily_summaries": (DailySummary, [
        "date", "form_score", "water_ml", "caffeine_mg", "calories_eaten",
        "protein_g", "carbs_g", "fat_g", "trained", "training_type", "notes", "is_estimated",
    ]),
    "nutrition_logs": (NutritionLog, [
        "date", "meal_name", "calories", "protein_g", "carbs_g", "fat_g", "source", "logged_at",
    ]),
    "training_logs": (TrainingLog, [
        "date", "type", "volume_sets", "weight_kg", "reps", "duration_min",
        "intensity", "notes", "source", "logged_at",
    ]),
    # Hydration and stimulants are timestamped only (no date column).
    "hydration_logs": (HydrationLog, ["logged_at", "amount_ml", "source"]),
    "stimulant_logs": (StimulantLog, [
        "logged_at", "substance", "caffeine_mg", "half_life_hours",
        "calories", "protein_g", "carbs_g", "fat_g", "additions", "note",
    ]),
    "body_metrics": (BodyMetric, ["date", "weight_kg", "body_fat_pct", "source", "logged_at"]),
}


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


async def build_zip(user: User, db: AsyncSession) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, (model, columns) in TABLES.items():
            available = [c for c in columns if hasattr(model, c)]
            # `or` would raise: a SQLAlchemy column has no truth value.
            order = getattr(model, "date", None)
            if order is None:
                order = model.logged_at
            rows = (await db.execute(
                select(model).where(model.user_id == user.id).order_by(order)
            )).scalars().all()

            out = io.StringIO(newline="")
            writer = csv.writer(out)
            writer.writerow(available)
            for row in rows:
                writer.writerow([_cell(getattr(row, c, None)) for c in available])
            zf.writestr(f"{name}.csv", out.getvalue())

        profile = io.StringIO(newline="")
        w = csv.writer(profile)
        w.writerow(["field", "value"])
        for field in (
            "email", "username", "name", "age", "sex", "height_cm", "weight_kg",
            "timezone", "sleep_hour", "protein_target_g", "water_target_ml",
            "calorie_target", "plan", "created_at",
        ):
            w.writerow([field, _cell(getattr(user, field, None))])
        zf.writestr("profile.csv", profile.getvalue())

    return buffer.getvalue()
