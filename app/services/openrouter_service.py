import json
import logging
from typing import Any, Callable

import httpx

from app.config import settings
from app.services.ai_types import AIProviderError, AIResult

logger = logging.getLogger(__name__)


# Backwards-compatible name for callers and tests using the original provider.
OpenRouterError = AIProviderError


class OpenRouterService:
    """OpenRouter free-model fallback. Base URL only, endpoint is built in code."""

    def __init__(self, client_factory: Callable[..., Any] | None = None) -> None:
        self._client_factory = client_factory or httpx.AsyncClient
        self.base_url = settings.openrouter_base_url.rstrip("/")
        self.response_schema: dict[str, Any] | None = None

    async def generate(self, messages: list[dict[str, str]]) -> AIResult:
        if not settings.openrouter_api_key or not settings.openrouter_model:
            raise OpenRouterError("not_configured")
        headers = {
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": settings.app_url,
            "X-Title": settings.app_name,
        }
        if self.response_schema:
            messages = [*messages, {"role": "system", "content": "Return exactly this JSON schema: " + json.dumps(self.response_schema, ensure_ascii=False)}]
        payload = {
            "model": settings.openrouter_model,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
            "max_tokens": 4200,
        }
        try:
            async with self._client_factory(timeout=min(settings.openrouter_timeout, settings.ai_fallback_timeout)) as client:
                response = await client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise OpenRouterError("timeout") from exc
        except httpx.HTTPError as exc:
            raise OpenRouterError("unavailable") from exc
        if response.status_code == 401:
            raise OpenRouterError("unauthorized")
        if response.status_code == 429:
            raise OpenRouterError("rate_limit")
        if response.status_code >= 500:
            raise OpenRouterError("provider_unavailable")
        if response.is_error:
            logger.warning("OpenRouter returned HTTP %s", response.status_code)
            raise OpenRouterError("provider_error")
        try:
            body = response.json()
            choice = body["choices"][0]
            if choice.get("finish_reason", "stop") != "stop":
                raise OpenRouterError("incomplete_response")
            content = choice["message"]["content"]
            data = json.loads(content)
            if not isinstance(data, dict):
                raise ValueError("Expected object")
            usage = body.get("usage") or {}
            return AIResult(
                data=data,
                model=body.get("model", settings.openrouter_model),
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                cost=usage.get("cost"),
            )
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise OpenRouterError("invalid_response") from exc

    async def generate_json(self, messages: list[dict[str, str]]) -> AIResult:
        return await self.generate(messages)

    async def test_connection(self) -> dict[str, str | bool]:
        result = await self.generate_json([
            {"role": "system", "content": "Верни JSON {\"ok\": true}."},
            {"role": "user", "content": "Проверь соединение."},
        ])
        return {"ok": bool(result.data.get("ok")), "model": result.model}
