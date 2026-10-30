"""Predictive nudges and the notification quick-log without Redis (production):
the daily cap, the one-push-per-slot rule and the quick-log replay dedupe must
hold on the in-memory fallback. Push sending and the DB are faked."""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import core.redis as redis_mod
import routers.notifications as notif_routes
import services.notifier as notifier
from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from services.log_patterns import PatternSlot


def make_user() -> User:
    return User(id=uuid.uuid4(), email="u@test.com", username="tester", timezone="UTC")


def slot_now(log_type="hydration", offset_min=0) -> PatternSlot:
    now = datetime.now(timezone.utc)
    return PatternSlot(
        log_type=log_type,
        weekday=now.weekday(),
        slot_minute=(now.hour * 60 + now.minute + offset_min) % 1440,
        confidence=0.9,
        sample_count=4,
        suggested_amount_ml=500,
    )


@pytest.fixture(autouse=True)
def no_redis(monkeypatch):
    monkeypatch.setattr(redis_mod, "redis_client", None)
    redis_mod._memory.clear()
    yield
    redis_mod._memory.clear()


@pytest.fixture
def pushes(monkeypatch):
    sent = []

    async def fake_send(user_id, db, **kw):
        sent.append(kw)
        return 1

    async def yes(*a, **kw):
        return True

    async def no(*a, **kw):
        return False

    monkeypatch.setattr(notifier.push, "send_to_user", fake_send)
    monkeypatch.setattr(notifier, "_user_has_active_tokens", yes)

    async def none_off(*a, **kw):
        return set()

    monkeypatch.setattr(notifier, "switched_off", none_off)
    monkeypatch.setattr(notifier, "_already_logged_near_slot", no)
    return sent


def use_patterns(monkeypatch, slots):
    async def fake_patterns(*a, **kw):
        return slots

    monkeypatch.setattr(notifier, "get_patterns_for_user", fake_patterns)


def test_slot_pushes_once_across_runs_in_its_window(monkeypatch, pushes):
    use_patterns(monkeypatch, [slot_now()])
    user = make_user()
    # The 15-min scheduler can pick the same slot up on consecutive runs.
    for _ in range(3):
        asyncio.run(notifier._process_user(user, db=None))
    assert len(pushes) == 1


def test_daily_cap_holds_across_runs(monkeypatch, pushes):
    monkeypatch.setattr(notifier, "DAILY_PUSH_CAP", 2)
    use_patterns(monkeypatch, [
        slot_now("hydration"), slot_now("stimulant"),
        slot_now("hydration", 1), slot_now("stimulant", 1),
    ])
    user = make_user()
    assert asyncio.run(notifier._process_user(user, db=None)) == 2
    assert asyncio.run(notifier._process_user(user, db=None)) == 0
    assert len(pushes) == 2


def test_cap_is_per_user(monkeypatch, pushes):
    use_patterns(monkeypatch, [slot_now()])
    asyncio.run(notifier._process_user(make_user(), db=None))
    asyncio.run(notifier._process_user(make_user(), db=None))
    assert len(pushes) == 2


class FakeSession:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        pass

    async def refresh(self, row):
        row.id = uuid.uuid4()


def test_quick_log_replay_is_deduped(monkeypatch):
    async def fake_increment(*a, **kw):
        pass

    monkeypatch.setattr(notif_routes, "increment_daily_field", fake_increment)
    session = FakeSession()
    user = make_user()
    app = FastAPI()
    app.include_router(notif_routes.quick_log_router)
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)

    body = {"type": "hydration", "request_id": "notif-abc12345", "amount_ml": 250}
    first = client.post("/logs/quick", json=body)
    second = client.post("/logs/quick", json=body)
    assert first.status_code == 201 and first.json()["amount_ml"] == 250
    assert second.json()["status"] == "duplicate"
    assert len(session.added) == 1

    other = client.post("/logs/quick", json={**body, "request_id": "notif-def67890"})
    assert other.json()["amount_ml"] == 250
    assert len(session.added) == 2
