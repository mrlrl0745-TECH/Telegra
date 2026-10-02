import json
import logging
from urllib.parse import quote
from typing import Any, Callable

import httpx

from app.config import settings
from app.services.ai_types import AIProviderError, AIResult

logger = logging.getLogger(__name__)


class GoogleAIService:
    """Google Gemini API client. API keys only travel in the Google auth header."""

    API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, client_factory: Callable[..., Any] | None = None) -> None:
        self._client_factory = client_factory or httpx.AsyncClient

    @staticmethod
    def _to_gemini_contents(messages: list[dict[str, str]]) -> tuple[list[dict[str, Any]], str | None]:
        contents: list[dict[str, Any]] = []
        system_parts: list[str] = []
        for message in messages:
            content = message.get("content")
            role = message.get("role")
            if not isinstance(content, str) or role not in {"system", "user", "assistant"}:
                raise AIProviderError("invalid_request")
            if role == "system":
                system_parts.append(content)
                continue
            gemini_role = "model" if role == "assistant" else "user"
            contents.append({"role": gemini_role, "parts": [{"text": content}]})
        if not contents:
            raise AIProviderError("invalid_request")
        system_instruction = "\n\n".join(system_parts) if system_parts else None
        return contents, system_instruction

    async def generate(self, messages: list[dict[str, str]]) -> AIResult:
        if not settings.google_ai_api_key or not settings.google_ai_model:
            raise AIProviderError("not_configured")
        contents, system_instruction = self._to_gemini_contents(messages)
        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.65,
                "maxOutputTokens": 5000,
            },
        }
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
        model = quote(settings.google_ai_model, safe="-._")
        url = f"{self.API_BASE_URL}/models/{model}:generateContent"
        headers = {"x-goog-api-key": settings.google_ai_api_key, "Content-Type": "application/json"}
        try:
            async with self._client_factory(timeout=settings.openrouter_timeout, follow_redirects=False) as client:
                response = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException:
            raise AIProviderError("timeout") from None
        except httpx.HTTPError:
            raise AIProviderError("unavailable") from None
        if response.status_code in {401, 403}:
            raise AIProviderError("unauthorized")
        if response.status_code == 429:
            raise AIProviderError("rate_limit")
        if response.status_code >= 500:
            raise AIProviderError("provider_unavailable")
        if response.is_error:
            logger.warning("Google AI returned HTTP %s", response.status_code)
            raise AIProviderError("provider_error")
        try:
            body = response.json()
            parts = body["candidates"][0]["content"]["parts"]
            response_text = "".join(part["text"] for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str))
            data = json.loads(response_text)
            if not isinstance(data, dict):
                raise ValueError("Expected JSON object")
            usage = body.get("usageMetadata") or {}
            return AIResult(
                data=data,
                model=body.get("modelVersion") or settings.google_ai_model,
                prompt_tokens=usage.get("promptTokenCount"),
                completion_tokens=usage.get("candidatesTokenCount"),
            )
        except (ValueError, KeyError, IndexError, TypeError):
            raise AIProviderError("invalid_response") from None

    async def generate_json(self, messages: list[dict[str, str]]) -> AIResult:
        try:
            return await self.generate(messages)
        except AIProviderError as exc:
            if exc.code != "invalid_response":
                raise
        retry_messages = list(messages) + [
            {"role": "assistant", "content": "Предыдущий ответ не был корректным JSON."},
            {"role": "user", "content": "Повтори ответ как один корректный JSON-объект без Markdown и комментариев."},
        ]
        return await self.generate(retry_messages)

    async def test_connection(self) -> dict[str, str | bool]:
        result = await self.generate_json([
            {"role": "system", "content": 'Верни JSON {"ok": true}.'},
            {"role": "user", "content": "Проверь соединение."},
        ])
        return {"ok": bool(result.data.get("ok")), "model": result.model}
