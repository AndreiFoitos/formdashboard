from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    REDIS_URL: str = "redis://localhost:6379"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Anthropic API (empty by default; AI endpoints return 503 until it's set).
    ANTHROPIC_API_KEY: str = ""

    # USDA FoodData Central API key — looks up nutrition values for ingredients
    # identified from food photos. Empty by default; the photo estimate endpoint
    # falls back to Claude-only estimates when this isn't set.
    USDA_API_KEY: str = ""

    # Global per-day ceiling on Anthropic API calls across all users. Catches
    # runaway loops / abuse that slip past the per-user limits. The default is
    # generous (5000 calls = roughly $30/day on Sonnet at typical token sizes);
    # tune via env var ANTHROPIC_DAILY_CALL_LIMIT for prod.
    ANTHROPIC_DAILY_CALL_LIMIT: int = 5000

    # Expo Push API access token. When set, services/push.py sends it as a
    # Bearer header so unauthenticated callers can't spoof pushes to your
    # users. HIGH-28. Empty by default to keep dev frictionless.
    EXPO_ACCESS_TOKEN: str = ""

    # Sentry DSN for backend error reporting. Empty disables Sentry. HIGH-19.
    SENTRY_DSN: str = ""

    # Sign in with Apple — the bundle ID is also the audience claim Apple signs.
    APPLE_BUNDLE_ID: str = ""

    # Google Sign-In — Client IDs are public (they ship in app.json), but they're
    # deployment-specific, so they go in .env rather than as code defaults. The
    # audience varies per-platform, so we accept all three and validate against
    # whichever one was used to mint the token.
    GOOGLE_IOS_CLIENT_ID: str = ""
    GOOGLE_ANDROID_CLIENT_ID: str = ""
    GOOGLE_WEB_CLIENT_ID: str = ""

    model_config = SettingsConfigDict(
            env_file=".env",
            extra="ignore",
        )


settings = Settings()