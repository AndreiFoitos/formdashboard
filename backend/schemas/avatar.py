from __future__ import annotations

from pydantic import BaseModel, Field

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class AvatarLook(BaseModel):
    skin: str = Field(pattern=HEX_COLOR)
    hair: str = Field(pattern=HEX_COLOR)
    top: str = Field(pattern=HEX_COLOR)
    bottom: str = Field(pattern=HEX_COLOR)
    shoes: str = Field(pattern=HEX_COLOR)

    model_config = {"extra": "forbid"}


class AvatarBody(BaseModel):
    """The body the user last *applied* (level-up flow), as 3D shape-key weights.
    Stored instead of raw metrics so friends never see weight / body-fat numbers."""
    fat: float = Field(ge=0, le=1)
    muscle: float = Field(ge=0, le=1)
    height_scale: float = Field(ge=0.8, le=1.2)
    applied_at: str | None = Field(None, max_length=32)

    model_config = {"extra": "forbid"}


class AvatarEquipped(BaseModel):
    """Unlockable cosmetics (ids from services/avatar_rewards.EQUIP_SLOTS).
    Ownership is verified on save."""
    aura: str | None = Field(None, max_length=40)
    frame: str | None = Field(None, max_length=40)
    eyes: str | None = Field(None, max_length=40)

    model_config = {"extra": "forbid"}


class AvatarConfig(BaseModel):
    v: int = Field(1, ge=1, le=1)
    look: AvatarLook
    body: AvatarBody | None = None
    # Keep the body as-is even when metrics change (body-image sensitivity).
    frozen: bool = False
    # Friends see this body shape on the race/podium; off = neutral body for them.
    share_body: bool = True
    equipped: AvatarEquipped | None = None

    model_config = {"extra": "forbid"}


def public_avatar(raw: dict | None) -> dict | None:
    """What friends may see: the look always, the body only if shared."""
    if not raw or "look" not in raw:
        return None
    out = {"look": raw["look"]}
    if raw.get("equipped"):
        out["equipped"] = raw["equipped"]
    body = raw.get("body")
    if body and raw.get("share_body", True):
        out["body"] = {k: body[k] for k in ("fat", "muscle", "height_scale") if k in body}
    return out
