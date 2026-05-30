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

    # Oura OAuth2 (empty by default so the app boots without it; the connect
    # endpoint returns 503 until these are set).
    OURA_CLIENT_ID: str = ""
    OURA_CLIENT_SECRET: str = ""
    OURA_REDIRECT_URI: str = ""  # must exactly match the URI registered with Oura
    # Where the backend OAuth callback redirects to hand control back to the app.
    OAUTH_APP_RETURN_URL: str = "protocol://oura-callback"

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