"""Units preference on /users/me: default, read, update, validation, and
older app builds that never send the field."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from routers.users import router


class FakeSession:
    async def commit(self):
        pass

    async def refresh(self, obj):
        pass


def make_user(**kw) -> User:
    return User(
        id=uuid.uuid4(),
        email="u@test.com",
        username="tester",
        timezone="UTC",
        sleep_hour=23,
        onboarding_complete=True,
        created_at=datetime.now(timezone.utc),
        **kw,
    )


@pytest.fixture
def user():
    return make_user(units="metric")


@pytest.fixture
def client(user):
    app = FastAPI()
    app.include_router(router)

    async def fake_db():
        yield FakeSession()

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = fake_db
    return TestClient(app)


def test_column_defaults_to_metric():
    col = User.__table__.c.units
    assert col.nullable is False
    assert col.server_default.arg == "metric"
    assert col.default.arg == "metric"


def test_read_returns_units(client, user):
    user.units = "imperial"
    r = client.get("/users/me")
    assert r.status_code == 200
    assert r.json()["units"] == "imperial"


def test_read_default_is_metric(client):
    assert client.get("/users/me").json()["units"] == "metric"


def test_update_units(client, user):
    r = client.put("/users/me", json={"units": "imperial"})
    assert r.status_code == 200
    assert r.json()["units"] == "imperial"
    assert user.units == "imperial"

    r = client.put("/users/me", json={"units": "metric"})
    assert r.json()["units"] == "metric"


@pytest.mark.parametrize("bad", ["Imperial", "us", "", 1, ["metric"]])
def test_invalid_units_rejected(client, user, bad):
    r = client.put("/users/me", json={"units": bad})
    assert r.status_code == 422
    assert user.units == "metric"


def test_older_client_without_units_keeps_value(client, user):
    user.units = "imperial"
    r = client.put("/users/me", json={"sleep_hour": 22})
    assert r.status_code == 200
    assert r.json()["units"] == "imperial"
    assert user.sleep_hour == 22


def test_explicit_null_is_ignored(client, user):
    user.units = "imperial"
    r = client.put("/users/me", json={"units": None})
    assert r.status_code == 200
    assert user.units == "imperial"
