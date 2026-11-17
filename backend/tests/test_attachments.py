"""Cable attachments: a rope and a triangle pushdown are separate lifts.

22 kg on the rope and 30 kg on the triangle must not mix in targets, PRs,
1RM or plan suggestions; volume and plans still see one exercise."""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from models.training_log import TrainingLog
from models.user import User
from routers import training
from routers.training import LogExerciseRequest, LogSetRequest, _add_exercise_sets
from services import plan_builder, plan_today
from services.exercise_taxonomy import (
    ATTACHMENT_LABEL,
    EXERCISE_ATTACHMENTS,
    EXERCISE_TO_GROUP,
    clean_attachment,
    lift_key,
    with_attachment,
)

TODAY = date(2026, 11, 10)


def _log(day_offset, weight, reps, attachment, type_="tricep_pushdown", n=1):
    d = TODAY - timedelta(days=day_offset)
    return TrainingLog(
        id=uuid.uuid4(), user_id=uuid.uuid4(), date=d, type=type_, weight_kg=weight, reps=reps,
        attachment=attachment, set_type="normal", volume_sets=n,
        logged_at=datetime(d.year, d.month, d.day, 18, n, tzinfo=timezone.utc),
    )


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows


class FakeDB:
    """Hands back `rows` for selects and records the SQL it was asked."""

    def __init__(self, rows, scalar=None):
        self.rows, self._scalar, self.sql = rows, scalar, []

    async def execute(self, stmt):
        self.sql.append(str(stmt.compile(dialect=postgresql.dialect())))
        return _Result(self.rows)

    async def scalar(self, stmt):
        self.sql.append(str(stmt.compile(dialect=postgresql.dialect())))
        return self._scalar


def test_catalogue_is_consistent():
    for key, options in EXERCISE_ATTACHMENTS.items():
        assert key in EXERCISE_TO_GROUP
        assert set(options) <= set(ATTACHMENT_LABEL)


def test_clean_attachment_only_keeps_offered_ones():
    assert clean_attachment("tricep_pushdown", "rope") == "rope"
    assert clean_attachment("tricep_pushdown", "wide_bar") is None
    assert clean_attachment("bench_press", "rope") is None
    assert clean_attachment("tricep_pushdown", None) is None


def test_lift_key_and_name():
    assert lift_key("tricep_pushdown", "rope") != lift_key("tricep_pushdown", "triangle")
    assert lift_key("bench_press", None) == "bench_press"
    assert with_attachment("Tricep Pushdown", "rope") == "Tricep Pushdown (rope)"
    assert with_attachment("Bench Press", None) == "Bench Press"


def test_logged_sets_carry_a_valid_attachment():
    user = User(id=uuid.uuid4())
    db = SimpleNamespace(add=lambda _: None)
    body = LogExerciseRequest(type="tricep_pushdown", attachment="rope",
                              sets=[LogSetRequest(weight_kg=22, reps=12)])
    assert _add_exercise_sets(body, user, TODAY, db)[0].attachment == "rope"
    body = LogExerciseRequest(type="bench_press", attachment="rope",
                              sets=[LogSetRequest(weight_kg=80, reps=8)])
    assert _add_exercise_sets(body, user, TODAY, db)[0].attachment is None


def test_target_only_looks_at_the_chosen_attachment(monkeypatch):
    monkeypatch.setattr("core.timezone.user_today", lambda tz=None: TODAY)
    rope = [_log(7, 22, 12, "rope", n=1), _log(7, 22, 12, "rope", n=2)]
    db = FakeDB(rope)
    out = asyncio.run(training.progression_for_exercise(
        "tricep_pushdown", attachment="rope", current_user=User(id=uuid.uuid4(), timezone="UTC"), db=db,
    ))
    assert out["attachment"] == "rope"
    # 12 reps on every set at 22 kg: up to 25 kg, from the rope sets alone.
    assert out["target"]["kind"] == "weight" and out["target"]["weight_kg"] == 25
    assert any("training_logs.attachment = " in s for s in db.sql)


def test_no_attachment_asked_uses_the_last_one(monkeypatch):
    monkeypatch.setattr("core.timezone.user_today", lambda tz=None: TODAY)
    db = FakeDB([], scalar="triangle")
    out = asyncio.run(training.progression_for_exercise(
        "tricep_pushdown", current_user=User(id=uuid.uuid4(), timezone="UTC"), db=db,
    ))
    assert out["attachment"] == "triangle"
    assert out["target"]["kind"] == "first"


def test_none_means_sets_without_an_attachment(monkeypatch):
    monkeypatch.setattr("core.timezone.user_today", lambda tz=None: TODAY)
    db = FakeDB([])
    asyncio.run(training.progression_for_exercise(
        "tricep_pushdown", attachment="none", current_user=User(id=uuid.uuid4(), timezone="UTC"), db=db,
    ))
    assert any("training_logs.attachment IS NULL" in s for s in db.sql)


def test_plan_rep_range_is_used_when_passed(monkeypatch):
    monkeypatch.setattr("core.timezone.user_today", lambda tz=None: TODAY)
    db = FakeDB([_log(7, 22, 10, "rope", n=1), _log(7, 22, 10, "rope", n=2)])
    out = asyncio.run(training.progression_for_exercise(
        "tricep_pushdown", attachment="rope", reps_min=8, reps_max=10, sets=3,
        current_user=User(id=uuid.uuid4(), timezone="UTC"), db=db,
    ))
    # Two sets of 10 but the plan wants three: one more set before more weight.
    assert out["target"]["range"] == [8, 10]
    assert len(out["target"]["sets"]) == 3


def test_overview_badge_follows_the_last_attachment(monkeypatch):
    monkeypatch.setattr("core.timezone.user_today", lambda tz=None: TODAY)
    rows = [
        _log(14, 30, 12, "triangle", n=1), _log(14, 30, 12, "triangle", n=2),
        _log(7, 22, 10, "rope", n=1), _log(7, 22, 9, "rope", n=2),
    ]
    out = asyncio.run(training.progression_overview(
        current_user=User(id=uuid.uuid4(), timezone="UTC"), db=FakeDB(rows),
    ))["exercises"]["tricep_pushdown"]
    # The rope was last and isn't at the top of its range yet; the
    # triangle's "ready for weight" doesn't leak in.
    assert out["attachment"] == "rope"
    assert out["kind"] == "reps" and not out["ready_for_weight"]


def test_plan_sessions_keep_the_last_attachment():
    rows = [_log(14, 30, 12, "triangle"), _log(7, 22, 10, "rope"), _log(7, 80, 5, None, type_="bench_press")]
    by_key = asyncio.run(plan_today._sessions_by_key(
        SimpleNamespace(id=uuid.uuid4()), {"tricep_pushdown", "bench_press"}, TODAY, FakeDB(rows),
    ))
    pushdown = by_key["tricep_pushdown"]
    assert [s.weight_kg for d in pushdown for s in pushdown[d]] == [22]
    assert plan_today._attachment(pushdown) == "rope"
    assert plan_today._attachment(by_key["bench_press"]) is None


def test_plan_start_weight_uses_the_last_attachment():
    rows = [_log(14, 30, 10, "triangle"), _log(7, 22, 10, "rope")]
    best = asyncio.run(plan_builder.best_one_rms(SimpleNamespace(id=uuid.uuid4()), TODAY, FakeDB(rows)))
    # 22 kg x 10 -> about 29 kg, not the triangle's ~40.
    assert 25 < best["tricep_pushdown"] < 32
