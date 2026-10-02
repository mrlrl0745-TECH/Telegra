from functools import lru_cache
import secrets
from typing import Literal
from urllib.parse import unquote, urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "KSP Generator"
    app_component: Literal["api", "bot"] = "api"
    app_env: str = "development"
    app_url: str = "http://localhost:5173"
    frontend_url: str = "http://localhost:5173"
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    database_url: str = "sqlite+aiosqlite:///./ksp.db"
    telegram_bot_token: str = ""
    bot_username: str = ""
    ai_provider: Literal["google", "openrouter"] = "google"
    google_ai_api_key: str = ""
    google_ai_model: str = "gemini-3.8-flash"
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_timeout: int = Field(default=90, ge=1, le=180)
    ai_test_mode: bool = False
    dev_auth_enabled: bool = False
    payment_test_mode: bool = False
    payment_provider: str = "mock"
    payment_provider_token: str = ""
    admin_telegram_ids: str = ""
    upload_dir: str = "uploads"
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1024, le=50 * 1024 * 1024)
    free_generations: int = Field(default=3, ge=0, le=100)
    max_ai_requests_per_hour: int = Field(default=20, ge=1, le=1000)
    max_templates_per_user: int = Field(default=20, ge=1, le=200)

    @property
    def active_ai_model(self) -> str:
        if self.ai_provider == "google":
            return self.google_ai_model
        return self.openrouter_model

    @property
    def admin_ids(self) -> set[int]:
        return {int(value.strip()) for value in self.admin_telegram_ids.split(",") if value.strip().isdigit()}

    @model_validator(mode="after")
    def validate_production_settings(self):
        if self.app_env not in {"development", "production"}:
            raise ValueError("APP_ENV must be development or production")
        if self.app_env != "production":
            return self

        if self.dev_auth_enabled or self.ai_test_mode or self.payment_test_mode:
            raise ValueError("Development authentication and test modes must be disabled in production")
        if self.app_component == "api":
            if "secret_key" not in self.model_fields_set or len(self.secret_key) < 48:
                raise ValueError("Production API requires an explicitly configured SECRET_KEY of at least 48 characters")
            if any(marker in self.secret_key.lower() for marker in ("replace", "change-me", "your-secret")):
                raise ValueError("Replace the example SECRET_KEY before production")
        if not self.telegram_bot_token:
            raise ValueError("Production requires TELEGRAM_BOT_TOKEN")
        if self.app_component == "api" and self.ai_provider == "google" and (not self.google_ai_api_key or not self.google_ai_model):
            raise ValueError("Production requires GOOGLE_AI_API_KEY and GOOGLE_AI_MODEL when AI_PROVIDER=google")
        if self.app_component == "api" and self.ai_provider == "openrouter" and (not self.openrouter_api_key or not self.openrouter_model):
            raise ValueError("Production requires OPENROUTER_API_KEY and OPENROUTER_MODEL when AI_PROVIDER=openrouter")
        if not self.database_url.startswith("postgresql+asyncpg://"):
            raise ValueError("Production requires PostgreSQL with asyncpg")
        database_password = unquote(urlsplit(self.database_url).password or "")
        if len(database_password) < 24 or any(marker in database_password.lower() for marker in ("change_this", "replace", "password")):
            raise ValueError("Production DATABASE_URL requires a non-placeholder password of at least 24 characters")
        if not self.app_url.startswith("https://") or not self.frontend_url.startswith("https://"):
            raise ValueError("Production APP_URL and FRONTEND_URL must use HTTPS")
        if self.app_component == "api" and self.ai_provider == "openrouter" and not self.openrouter_base_url.startswith("https://"):
            raise ValueError("Production OPENROUTER_BASE_URL must use HTTPS")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
