"""Trends charts leave out the rows onboarding seeds before signup."""
import asyncio
from datetime import date

from sqlalchemy.dialects import postgresql

from models.daily_summary import DailySummary
from models.user import User
from routers.dashboard import get_trends


class _Result:
    def scalars(self):
        return self

    def all(self):
        return []


class RecordingSession:
    def __init__(self):
        self.statements = []

    async def execute(self, stmt):
        self.statements.append(str(stmt.compile(dialect=postgresql.dialect())))
        return _Result()


def test_trends_skip_estimated_days():
    db = RecordingSession()
    out = asyncio.run(get_trends(days=30, current_user=User(timezone="UTC"), db=db))
    summary_sql = next(s for s in db.statements if "FROM daily_summaries" in s)
    assert "daily_summaries.is_estimated IS NOT true" in summary_sql
    assert out["form_score"] == [] and out["protein_g"] == []
    assert out["calories"] == [] and out["calorie_target"] is None


def test_trends_chart_calories_per_day():
    class Rows(RecordingSession):
        async def execute(self, stmt):
            await super().execute(stmt)
            res = _Result()
            if "FROM daily_summaries" in self.statements[-1]:
                res.all = lambda: [
                    DailySummary(date=date(2026, 11, 8), calories_eaten=2400, protein_g=150),
                    DailySummary(date=date(2026, 11, 9), calories_eaten=None, protein_g=120),
                ]
            return res

    out = asyncio.run(get_trends(days=30, current_user=User(timezone="UTC", calorie_target=2500), db=Rows()))
    # Days with nothing eaten logged are left out, not charted as 0.
    assert out["calories"] == [{"date": "2026-11-08", "value": 2400}]
    assert out["calorie_target"] == 2500
