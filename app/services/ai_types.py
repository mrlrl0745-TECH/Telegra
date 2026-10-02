from dataclasses import dataclass
from typing import Any


@dataclass
class AIResult:
    data: dict[str, Any]
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost: float | None = None


class AIProviderError(Exception):
    def __init__(self, code: str, message: str = "AI provider request failed"):
        self.code = code
        super().__init__(message)
