from __future__ import annotations
from pydantic import BaseModel, EmailStr
from datetime import datetime
import uuid


class UserOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    name: str | None
    age: int | None
    height_cm: float | None
    weight_kg: float | None
    goal: str | None
    timezone: str
    onboarding_complete: bool
    protein_target_g: float | None
    water_target_ml: int | None
    calorie_target: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    name: str | None = None
    age: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    goal: str | None = None
    timezone: str | None = None
    onboarding_complete: bool | None = None
    protein_target_g: float | None = None
    water_target_ml: int | None = None
    calorie_target: int | None = None
    