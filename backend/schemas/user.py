from __future__ import annotations
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
import uuid


# Reusable constraint so the regex stays in one place.
USERNAME_PATTERN = r"^[a-z0-9_]{3,24}$"

# Handles users can't claim — impersonation surfaces and reserved brand names.
# Checked at /users/username-available, the onboarding "username" step write,
# and in auth._generate_username so OAuth seeding can't accidentally pick one.
RESERVED_USERNAMES = frozenset({
    # Operational / admin
    "admin", "administrator", "root", "system", "bot", "moderator", "mod",
    "support", "help", "sales", "info", "contact", "abuse", "security",
    "staff", "owner", "operator",
    # Brand / official
    "protocol", "protocol_official", "protocol_team", "protocol_support",
    "official", "team", "founder", "ceo", "cto", "marketing", "press",
    # Reserved / placeholder
    "anonymous", "deleted", "removed", "null", "undefined", "none",
    "user", "test", "demo", "guest",
})


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    username: str | None
    name: str | None
    age: int | None
    height_cm: float | None
    weight_kg: float | None
    sex: str | None
    timezone: str
    sleep_hour: int
    onboarding_complete: bool
    protein_target_g: float | None
    water_target_ml: int | None
    calorie_target: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    name: str | None = None
    username: str | None = Field(None, pattern=USERNAME_PATTERN)
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    sex: str | None = Field(None, pattern=r"^(male|female)$")
    timezone: str | None = None
    sleep_hour: int | None = Field(None, ge=0, le=23)
    onboarding_complete: bool | None = None
    protein_target_g: float | None = None
    water_target_ml: int | None = None
    calorie_target: int | None = None
