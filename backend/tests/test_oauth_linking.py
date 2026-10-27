"""Apple/Google sign-in links to an existing account only through an email
both sides have proven, so registering someone else's address with a password
can't capture their later SSO sign-in."""
import asyncio
import re
import uuid
from datetime import datetime, timezone

from routers.auth import _find_or_create_oauth_user
from core.security import hash_password
from models.user import User


def make_user(**kw) -> User:
    base = dict(id=uuid.uuid4(), email="victim@test.com", username="someone", timezone="UTC",
                sleep_hour=23, onboarding_complete=True, created_at=datetime.now(timezone.utc))
    return User(**{**base, **kw})


class Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeDB:
    """Answers the three lookups the function makes: by sub, by email, by username."""

    def __init__(self, users):
        self.users = users

    async def execute(self, stmt):
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        value = re.search(r"= (?:lower\()?'([^']*)'", sql).group(1)
        if "apple_sub" in sql.split("WHERE")[1]:
            match = [u for u in self.users if u.apple_sub == value]
        elif "lower(users.email)" in sql:
            match = [u for u in self.users if u.email and u.email.lower() == value.lower()]
        else:
            match = [u for u in self.users if u.username == value]
        return Result(match[0] if match else None)

    def add(self, obj):
        if isinstance(obj, User):
            self.users.append(obj)

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass


def sign_in(db, *, email="victim@test.com", verified=True):
    return asyncio.run(_find_or_create_oauth_user(
        provider="apple", sub="apple-123", email=email, email_verified=verified, name=None, db=db,
    ))


def test_unproven_password_account_is_reclaimed_by_provider():
    squatter = make_user(hashed_password=hash_password("attacker1"), email_verified=False)
    db = FakeDB([squatter])
    user = sign_in(db)
    assert user is squatter
    assert user.apple_sub == "apple-123"
    assert user.hashed_password is None  # the squatter's password no longer works
    assert user.email_verified is True


def test_proven_password_account_links_and_keeps_password():
    owner = make_user(hashed_password=hash_password("owner123"), email_verified=True)
    db = FakeDB([owner])
    user = sign_in(db)
    assert user is owner and user.apple_sub == "apple-123"
    assert user.hashed_password is not None


def test_unverified_provider_email_never_links():
    owner = make_user(hashed_password=hash_password("owner123"), email_verified=True)
    db = FakeDB([owner])
    user = sign_in(db, verified=False)
    assert user is not owner and owner.apple_sub is None
    assert user.email is None and user.email_verified is False


def test_new_account_records_provider_verification():
    db = FakeDB([])
    user = sign_in(db, email="new@test.com")
    assert user.email == "new@test.com" and user.email_verified is True
