"""Trends charts leave out the rows onboarding seeds before signup."""
import asyncio

from sqlalchemy.dialects import postgresql

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
