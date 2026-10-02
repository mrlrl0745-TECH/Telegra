import json
import logging

import httpx

from app.config import settings
from app.services.ai_types import AIProviderError, AIResult

logger = logging.getLogger(__name__)


# Backwards-compatible name for callers and tests using the original provider.
OpenRouterError = AIProviderError


class OpenRouterService:
    def __init__(self) -> None:
        self.base_url = settings.openrouter_base_url.rstrip("/")

    async def generate(self, messages: list[dict[str, str]]) -> AIResult:
        if not settings.openrouter_api_key or not settings.openrouter_model:
            raise OpenRouterError("not_configured")
        headers = {
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": settings.app_url,
            "X-Title": settings.app_name,
        }
        payload = {
            "model": settings.openrouter_model,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "temperature": 0.65,
            "max_tokens": 5000,
        }
        try:
            async with httpx.AsyncClient(timeout=settings.openrouter_timeout) as client:
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
            content = body["choices"][0]["message"]["content"]
            data = json.loads(content)
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
        last_error: OpenRouterError | None = None
        current = list(messages)
        for attempt in range(2):
            try:
                return await self.generate(current)
            except OpenRouterError as exc:
                last_error = exc
                if exc.code != "invalid_response" or attempt:
                    raise
                current = current + [
                    {"role": "assistant", "content": "Предыдущий ответ не был корректным JSON."},
                    {"role": "user", "content": "Повтори ответ как один корректный JSON-объект без Markdown и комментариев."},
                ]
        raise last_error or OpenRouterError("invalid_response")

    async def test_connection(self) -> dict[str, str | bool]:
        result = await self.generate_json([
            {"role": "system", "content": "Верни JSON {\"ok\": true}."},
            {"role": "user", "content": "Проверь соединение."},
        ])
        return {"ok": bool(result.data.get("ok")), "model": result.model}
