from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from core.database import Base


class BarcodeProduct(Base):
    """Shared cache of Open Food Facts lookups (services/openfoodfacts.py),
    keyed by the barcode as scanned. Kept in Postgres rather than the
    in-process cache so popular products survive restarts and we stay well
    under OFF's rate limit. Refetched once stale (see routers/nutrition.py)."""
    __tablename__ = "barcode_products"

    barcode: Mapped[str] = mapped_column(String(14), primary_key=True)
    # The payload parse_product returns, served as-is.
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
