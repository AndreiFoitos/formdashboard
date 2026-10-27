"""Emailed account links: set/change password and confirm an added email.
Email sending and the DB are faked; links are pulled from the sent text."""
import re
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.account_links as links
from core.database import get_db
from core.rate_limit import limiter
from core.security import create_access_token, hash_password, verify_password
from middleware.auth import get_current_user
from models.user import User

limiter.enabled = False


def make_user(**kw) -> User:
    base = dict(
        id=uuid.uuid4(), email="u@test.com", username="tester", timezone="UTC",
        sleep_hour=23, onboarding_complete=True, email_verified=False, created_at=datetime.now(timezone.utc),
    )
    return User(**{**base, **kw})


class FakeSession:
    def __init__(self, users):
        self.users = users

    async def get(self, model, key):
        return next((u for u in self.users if u.id == key), None)

    async def commit(self):
        pass


@pytest.fixture
def env(monkeypatch):
    sent = []

    async def fake_send(**kw):
        sent.append(kw)

    async def fake_find(email, db):
        return next((u for u in db.users if u.email and u.email.lower() == email.lower()), None)

    monkeypatch.setattr(links, "send_email", fake_send)
    monkeypatch.setattr(links, "_find_by_email", fake_find)

    users = []
    session = FakeSession(users)
    app = FastAPI()
    app.include_router(links.router)
    app.dependency_overrides[get_db] = lambda: session
    current = {}
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    return TestClient(app), users, current, sent


def link_token(sent) -> str:
    return re.search(r"token=([\w.-]+)", sent[-1]["text"]).group(1)


def test_set_password_for_account_without_one(env):
    client, users, current, sent = env
    user = make_user(hashed_password=None)
    users.append(user)
    current["user"] = user

    r = client.post("/auth/password/link")
    assert r.status_code == 202
    assert sent[-1]["to"] == "u@test.com" and "Set" in sent[-1]["subject"]

    token = link_token(sent)
    page = client.get("/auth/password/reset", params={"token": token})
    assert page.status_code == 200 and "Set your password" in page.text

    r = client.post("/auth/password/reset", data={"token": token, "password": "newpass123", "confirm": "newpass123"})
    assert r.status_code == 200 and "Password saved" in r.text
    assert verify_password("newpass123", user.hashed_password)

    # Single use: the hash changed, so the same link is dead.
    again = client.post("/auth/password/reset", data={"token": token, "password": "other1234", "confirm": "other1234"})
    assert again.status_code == 400 and verify_password("newpass123", user.hashed_password)


def test_change_password_validates_input(env):
    client, users, current, sent = env
    user = make_user(hashed_password=hash_password("oldpass123"))
    users.append(user)
    current["user"] = user

    client.post("/auth/password/link")
    assert "Change" in sent[-1]["subject"]
    token = link_token(sent)

    short = client.post("/auth/password/reset", data={"token": token, "password": "short", "confirm": "short"})
    assert short.status_code == 400 and "characters" in short.text
    mismatch = client.post("/auth/password/reset", data={"token": token, "password": "abcdefgh1", "confirm": "abcdefgh2"})
    assert mismatch.status_code == 400 and "match" in mismatch.text
    assert verify_password("oldpass123", user.hashed_password)


def test_password_link_needs_an_email(env):
    client, users, current, _ = env
    current["user"] = make_user(email=None)
    assert client.post("/auth/password/link").status_code == 400


def test_forgot_password_does_not_reveal_accounts(env):
    client, users, _, sent = env
    users.append(make_user(email="Real@Test.com"))
    assert client.post("/auth/password/forgot", json={"email": "nobody@test.com"}).status_code == 202
    assert sent == []
    assert client.post("/auth/password/forgot", json={"email": "real@test.com"}).status_code == 202
    assert sent[-1]["to"] == "Real@Test.com"


def test_access_token_is_not_a_password_link(env):
    client, users, _, _ = env
    user = make_user()
    users.append(user)
    page = client.get("/auth/password/reset", params={"token": create_access_token(str(user.id))})
    assert page.status_code == 400


def test_add_email_saved_only_after_confirm(env):
    client, users, current, sent = env
    user = make_user(email=None)
    users.append(user)
    current["user"] = user

    r = client.post("/users/me/email", json={"email": "new@test.com"})
    assert r.status_code == 202 and sent[-1]["to"] == "new@test.com"
    assert user.email is None

    token = link_token(sent)
    page = client.get("/auth/email/confirm", params={"token": token})
    assert page.status_code == 200 and user.email is None  # GET never changes anything
    done = client.post("/auth/email/confirm", data={"token": token})
    assert done.status_code == 200 and user.email == "new@test.com"


def test_add_email_rejects_taken_or_existing(env):
    client, users, current, _ = env
    users.append(make_user(email="taken@test.com"))
    current["user"] = make_user(email=None)
    assert client.post("/users/me/email", json={"email": "TAKEN@test.com"}).status_code == 409
    current["user"] = make_user(email="has@test.com")
    assert client.post("/users/me/email", json={"email": "free@test.com"}).status_code == 409


def test_confirm_fails_if_email_taken_meanwhile(env):
    client, users, current, sent = env
    user = make_user(email=None)
    users.append(user)
    current["user"] = user
    client.post("/users/me/email", json={"email": "race@test.com"})
    users.append(make_user(email="race@test.com"))
    r = client.post("/auth/email/confirm", data={"token": link_token(sent)})
    assert r.status_code == 409 and user.email is None


def test_password_link_proves_the_email(env):
    client, users, current, sent = env
    user = make_user(hashed_password=None, email_verified=False)
    users.append(user)
    current["user"] = user
    client.post("/auth/password/link")
    client.post("/auth/password/reset", data={"token": link_token(sent), "password": "newpass123", "confirm": "newpass123"})
    assert user.email_verified is True


def test_resend_confirm_marks_existing_email_verified(env):
    client, users, current, sent = env
    user = make_user(email_verified=False)
    users.append(user)
    current["user"] = user
    assert client.post("/users/me/email/confirm-link").status_code == 202
    assert sent[-1]["to"] == "u@test.com"
    client.post("/auth/email/confirm", data={"token": link_token(sent)})
    assert user.email_verified is True
    assert client.post("/users/me/email/confirm-link").status_code == 409
