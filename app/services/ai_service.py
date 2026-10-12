"""One primary attempt plus one bounded fallback, including schema validation."""
import asyncio
import logging
from collections.abc import Callable
from typing import Any, Protocol
from app.config import settings
from app.services.ai_types import AIProviderError, AIResult

logger = logging.getLogger(__name__)
USER_FRIENDLY_UNAVAILABLE = "AI-помощник временно недоступен. Попробуйте ещё раз. Генерация не списана."

class JsonProvider(Protocol):
    async def generate_json(self, messages: list[dict[str, str]]) -> AIResult: ...

async def generate_ai_response(
    messages: list[dict[str, str]], *, google_service: JsonProvider | None = None,
    openrouter_service: JsonProvider | None = None, response_schema: dict[str, Any] | None = None,
    validate: Callable[[AIResult], AIResult] | None = None,
) -> AIResult:
    from app.services.google_ai_service import GoogleAIService
    from app.services.openrouter_service import OpenRouterService

    google = google_service or GoogleAIService()
    router = openrouter_service or OpenRouterService()
    for service in (google, router):
        if isinstance(service, (GoogleAIService, OpenRouterService)):
            service.response_schema = response_schema
    providers = [(router, settings.ai_primary_timeout)] if settings.ai_provider == "openrouter" else [(google, settings.ai_primary_timeout)]
    if settings.ai_provider != "openrouter" and settings.openrouter_api_key:
        providers.append((router, settings.ai_fallback_timeout))
    last_error: AIProviderError | None = None
    # httpx's read timeout resets per received chunk; this deadline bounds the whole operation.
    try:
        async with asyncio.timeout(settings.ai_total_timeout):
            for service, budget in providers:
                try:
                    async with asyncio.timeout(budget):
                        result = await service.generate_json(messages)
                        return validate(result) if validate else result
                except TimeoutError:
                    last_error = AIProviderError("timeout")
                except AIProviderError as exc:
                    last_error = exc
                logger.warning("AI attempt failed: provider=%s code=%s", type(service).__name__, last_error.code)
    except TimeoutError:
        raise AIProviderError("timeout") from None
    raise last_error or AIProviderError("unavailable")

def user_friendly_error() -> str:
    return USER_FRIENDLY_UNAVAILABLE
