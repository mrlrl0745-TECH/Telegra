import json

import httpx
import pytest

from app.config import settings
from app.services.ai_types import AIProviderError
from app.services.google_ai_service import GoogleAIService
from app.services.lesson_generator import get_ai_provider


@pytest.mark.asyncio
async def test_google_ai_sends_key_only_to_official_endpoint_and_parses_json(monkeypatch):
    monkeypatch.setattr(settings, "google_ai_api_key", "unit-test-secret")
    monkeypatch.setattr(settings, "google_ai_model", "gemini-3.8-flash")

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "generativelanguage.googleapis.com"
        assert request.headers["x-goog-api-key"] == "unit-test-secret"
        payload = json.loads(request.content)
        assert payload["systemInstruction"]["parts"][0]["text"] == "System instruction"
        assert payload["contents"] == [{"role": "user", "parts": [{"text": "Prompt"}]}]
        assert payload["generationConfig"]["responseMimeType"] == "application/json"
        return httpx.Response(200, json={
            "modelVersion": "gemini-3.8-flash",
            "candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}}],
            "usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 4},
        })

    transport = httpx.MockTransport(handle)
    service = GoogleAIService(lambda **kwargs: httpx.AsyncClient(transport=transport, **kwargs))
    result = await service.generate_json([
        {"role": "system", "content": "System instruction"},
        {"role": "user", "content": "Prompt"},
    ])
    assert result.data == {"ok": True}
    assert result.prompt_tokens == 12
    assert result.completion_tokens == 4


@pytest.mark.asyncio
async def test_google_ai_provider_errors_do_not_expose_response_body_or_key(monkeypatch):
    monkeypatch.setattr(settings, "google_ai_api_key", "unit-test-secret")

    def handle(_: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="unit-test-secret provider detail")

    transport = httpx.MockTransport(handle)
    service = GoogleAIService(lambda **kwargs: httpx.AsyncClient(transport=transport, **kwargs))
    with pytest.raises(AIProviderError) as captured:
        await service.generate_json([{"role": "user", "content": "Prompt"}])
    assert captured.value.code == "unauthorized"
    assert "unit-test-secret" not in str(captured.value)
    assert "provider detail" not in str(captured.value)


def test_google_is_the_selected_provider_by_default(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "google")
    assert isinstance(get_ai_provider(), GoogleAIService)
