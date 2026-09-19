from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import get_db
from middleware.auth import get_current_user
from models.user import User
from models.body_metric import BodyMetric
from services.ai_client import AINotConfigured
from services.bf_estimate import estimate_bf_from_photos
from services.plans import BF, consume_scan, refund_scan


MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB; matches the nutrition photo cap
ALLOWED_PHOTO_MIME = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

router = APIRouter(prefix="/body", tags=["body"])


class LogBodyMetricRequest(BaseModel):
    weight_kg: Optional[float] = None
    body_fat_pct: Optional[float] = None
    date: Optional[date] = None


def _metric_dict(m: BodyMetric) -> dict:
    return {
        "id": str(m.id),
        "date": m.date.isoformat(),
        "weight_kg": m.weight_kg,
        "body_fat_pct": m.body_fat_pct,
        "source": m.source,
        "logged_at": m.logged_at.isoformat(),
    }


def _compute_moving_avg(values: list[float | None], window: int) -> list[float | None]:
    """Compute a simple moving average over a list, ignoring None values."""
    result = []
    for i, v in enumerate(values):
        window_vals = [x for x in values[max(0, i - window + 1):i + 1] if x is not None]
        result.append(round(sum(window_vals) / len(window_vals), 2) if window_vals else None)
    return result


@router.post("/metrics", status_code=201)
async def log_body_metric(
    body: LogBodyMetricRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.weight_kg is None and body.body_fat_pct is None:
        raise HTTPException(400, "Provide at least weight_kg or body_fat_pct")

    target_date = body.date or date.today()

    # Upsert: if a manual entry exists for this date, update it
    result = await db.execute(
        select(BodyMetric).where(
            BodyMetric.user_id == current_user.id,
            BodyMetric.date == target_date,
            BodyMetric.source == "manual",
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        if body.weight_kg is not None:
            existing.weight_kg = body.weight_kg
        if body.body_fat_pct is not None:
            existing.body_fat_pct = body.body_fat_pct
        await db.commit()
        await db.refresh(existing)
        return _metric_dict(existing)

    entry = BodyMetric(
        user_id=current_user.id,
        date=target_date,
        weight_kg=body.weight_kg,
        body_fat_pct=body.body_fat_pct,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return _metric_dict(entry)


@router.get("/history")
async def get_history(
    days: int = 90,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cutoff = date.today() - timedelta(days=days)
    result = await db.execute(
        select(BodyMetric)
        .where(BodyMetric.user_id == current_user.id, BodyMetric.date >= cutoff)
        .order_by(BodyMetric.date.asc())
    )
    metrics = result.scalars().all()

    if not metrics:
        return {
            "entries": [],
            "stats": None,
        }

    entries = [_metric_dict(m) for m in metrics]

    # Compute trend stats
    weights = [m.weight_kg for m in metrics if m.weight_kg is not None]
    bf_vals = [m.body_fat_pct for m in metrics if m.body_fat_pct is not None]

    # 7-day and 30-day deltas
    today = date.today()
    week_ago = today - timedelta(days=7)
    month_ago = today - timedelta(days=30)

    def latest_before(target_date: date, field: str) -> float | None:
        for m in reversed(metrics):
            if m.date <= target_date:
                val = getattr(m, field)
                if val is not None:
                    return val
        return None

    current_weight = latest_before(today, "weight_kg")
    week_weight = latest_before(week_ago, "weight_kg")
    month_weight = latest_before(month_ago, "weight_kg")

    current_bf = latest_before(today, "body_fat_pct")
    week_bf = latest_before(week_ago, "body_fat_pct")
    month_bf = latest_before(month_ago, "body_fat_pct")

    stats = {
        "current_weight_kg": current_weight,
        "current_body_fat_pct": current_bf,
        "weight_change_7d": round(current_weight - week_weight, 2) if current_weight and week_weight else None,
        "weight_change_30d": round(current_weight - month_weight, 2) if current_weight and month_weight else None,
        "bf_change_7d": round(current_bf - week_bf, 2) if current_bf and week_bf else None,
        "bf_change_30d": round(current_bf - month_bf, 2) if current_bf and month_bf else None,
        "lowest_weight_kg": min(weights) if weights else None,
        "highest_weight_kg": max(weights) if weights else None,
        "total_entries": len(metrics),
    }

    return {
        "entries": entries,
        "stats": stats,
    }


# ─── BF% estimate from photo ─────────────────────────────────────────────────
#
# Privacy stance: the captured images are forwarded to Claude for the estimate
# and dropped from the request scope on return. We never persist user photos
# server-side — progress photos were removed in 2026 for exactly this reason.


BF_VIEWS = ("front", "side", "back")
MAX_BF_PHOTOS = len(BF_VIEWS)


async def _read_photo(upload: UploadFile) -> bytes:
    if upload.content_type not in ALLOWED_PHOTO_MIME:
        raise HTTPException(415, f"Unsupported image type: {upload.content_type}")
    body = await upload.read()
    if not body:
        raise HTTPException(400, "Empty image upload")
    if len(body) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "Image too large (max 5MB)")
    return body


@router.post("/estimate-bf")
async def estimate_bf(
    images: Optional[list[UploadFile]] = File(None),
    views: Optional[list[str]] = Form(None),
    image: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Run Claude vision on body photos and return an estimated BF% band.

    New clients send up to three `images` (front, side, back) with a matching
    `views` field per image; builds before the multi-angle flow send a single
    `image`. All photos go to Claude in ONE call. Nothing is persisted: the
    user gets the estimate back and decides separately whether to log a
    body_metric row from the midpoint."""
    uploads = list(images or [])
    if image is not None:
        uploads.append(image)
    if not uploads:
        raise HTTPException(400, "No image uploaded")
    if len(uploads) > MAX_BF_PHOTOS:
        raise HTTPException(400, f"At most {MAX_BF_PHOTOS} photos")

    names = list(views or [])
    if names and len(names) != len(uploads):
        raise HTTPException(400, "views must match images one-to-one")
    if any(n not in BF_VIEWS for n in names):
        raise HTTPException(400, f"views must be one of {', '.join(BF_VIEWS)}")

    # Plan quota (services/plans.py), handed back if no estimate comes out.
    scan_id = await consume_scan(current_user, BF, db)
    try:
        photos = [await _read_photo(u) for u in uploads]
        labelled = list(zip(names or [None] * len(photos), photos))

        try:
            return await estimate_bf_from_photos(labelled)
        except AINotConfigured as e:
            raise HTTPException(503, str(e))
        except ValueError as e:
            raise HTTPException(502, str(e))
    except Exception:
        await refund_scan(scan_id, db)
        raise


@router.delete("/{metric_id}", status_code=204)
async def delete_metric(
    metric_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BodyMetric).where(
            BodyMetric.id == metric_id,
            BodyMetric.user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Metric not found")
    await db.delete(entry)
    await db.commit()