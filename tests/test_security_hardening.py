from io import BytesIO
from zipfile import ZipFile

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.config import Settings, settings
from app.main import app
from app.services.template_service import TemplateService
import app.services.template_service as template_module


def _production_settings(**overrides):
    values = {
        "app_env": "production",
        "ai_provider": "openrouter",
        "secret_key": "s" * 64,
        "telegram_bot_token": "123456:telegram-test-token",
        "openrouter_api_key": "openrouter-test-token",
        "openrouter_model": "provider/model",
        "database_url": f"postgresql+asyncpg://ksp:{'d' * 32}@db:5432/ksp",
        "app_url": "https://app.example",
        "frontend_url": "https://app.example",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_production_configuration_rejects_missing_or_weak_secrets():
    assert _production_settings().app_env == "production"
    with pytest.raises(ValidationError):
        _production_settings(database_url="postgresql+asyncpg://ksp:CHANGE_THIS_TO_A_LONG_RANDOM_PASSWORD@db/ksp")
    with pytest.raises(ValidationError):
        _production_settings(payment_test_mode=True)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production")


def test_production_bot_configuration_does_not_require_api_or_ai_secrets():
    bot = Settings(
        _env_file=None,
        app_env="production",
        app_component="bot",
        telegram_bot_token="123456:telegram-test-token",
        database_url=f"postgresql+asyncpg://ksp_bot:{'b' * 32}@db:5432/ksp",
        app_url="https://app.example",
        frontend_url="https://app.example",
    )

    assert bot.app_component == "bot"


@pytest.mark.asyncio
async def test_dev_login_rejects_non_loopback_clients(client, monkeypatch):
    monkeypatch.setattr(settings, "dev_auth_enabled", True)
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("198.51.100.25", 12345)),
        base_url="http://test",
    ) as remote:
        response = await remote.post("/api/auth/dev")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_test_payment_routes_are_closed_outside_development(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    created = await client.post("/api/payments/create", headers=auth_headers, json={"tariff": "monthly"})
    assert created.status_code == 503
    webhook = await client.post(
        "/api/payments/webhook",
        headers={"X-Payment-Token": "any-token"},
        json={"payment_id": "missing", "status": "success"},
    )
    assert webhook.status_code == 404


def test_docx_expansion_limit_is_checked_before_parsing(monkeypatch):
    monkeypatch.setattr(template_module, "MAX_DOCX_EXPANDED_BYTES", 10)
    content = BytesIO()
    with ZipFile(content, "w") as archive:
        archive.writestr("[Content_Types].xml", "content-types")
        archive.writestr("word/document.xml", "document")
    with pytest.raises(ValueError, match="Распакованный DOCX"):
        TemplateService._analyze_docx(content.getvalue())
