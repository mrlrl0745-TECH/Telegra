import pytest

from app.config import settings
from app.services.openrouter_service import OpenRouterService


@pytest.mark.asyncio
async def test_openrouter_request_returns_validated_json_and_usage(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-api-key")
    monkeypatch.setattr(settings, "openrouter_model", "test/model")
    captured = {}

    class Response:
        status_code = 200
        is_error = False

        @staticmethod
        def json():
            return {"model": "test/model", "choices": [{"message": {"content": '{"ok": true}'}}], "usage": {"prompt_tokens": 21, "completion_tokens": 8, "cost": 0.001}}

    class Client:
        def __init__(self, **kwargs):
            captured["timeout"] = kwargs["timeout"]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            captured.update({"url": url, "headers": headers, "payload": json})
            return Response()

    monkeypatch.setattr("app.services.openrouter_service.httpx.AsyncClient", Client)
    result = await OpenRouterService().generate_json([{"role": "user", "content": "return json"}])
    assert result.data == {"ok": True}
    assert result.prompt_tokens == 21
    assert result.completion_tokens == 8
    assert result.cost == 0.001
    assert captured["headers"]["Authorization"] == "Bearer test-api-key"
    assert captured["payload"]["model"] == "test/model"
    assert captured["payload"]["response_format"] == {"type": "json_object"}
