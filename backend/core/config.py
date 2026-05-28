from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    REDIS_URL: str = "redis://localhost:6379"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Anthropic API (empty by default; AI endpoints return 503 until it's set).
    ANTHROPIC_API_KEY: str = ""

    # Oura OAuth2 (empty by default so the app boots without it; the connect
    # endpoint returns 503 until these are set).
    OURA_CLIENT_ID: str = ""
    OURA_CLIENT_SECRET: str = ""
    OURA_REDIRECT_URI: str = ""  # must exactly match the URI registered with Oura
    # Where the backend OAuth callback redirects to hand control back to the app.
    OAUTH_APP_RETURN_URL: str = "protocol://oura-callback"

    model_config = SettingsConfigDict(
            env_file=".env",
            extra="ignore",
        )


settings = Settings()