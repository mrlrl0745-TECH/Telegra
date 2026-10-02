import json
from pathlib import Path

import pytest

from app.config import settings
from app.schemas import LessonInput
from app.services.ai_types import AIResult
from app.services.lesson_generator import LessonGenerator


@pytest.mark.asyncio
async def test_api_body_limit_applies_to_chunked_requests(client):
    async def oversized_body():
        yield b'{"payment_id":"fake","status":"success"}'
        yield b" " * (2 * 1024 * 1024 + 1)

    response = await client.post(
        "/api/payments/webhook",
        content=oversized_body(),
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 413


@pytest.mark.asyncio
async def test_authentication_rate_limit_rejects_the_thirteenth_request(client):
    responses = [
        await client.post("/api/auth/telegram", json={"init_data": "bad"})
        for _ in range(13)
    ]

    assert all(response.status_code == 401 for response in responses[:12])
    assert responses[-1].status_code == 429


@pytest.mark.asyncio
async def test_upload_filename_cannot_choose_storage_path(client, auth_headers, tmp_path):
    response = await client.post(
        "/api/templates",
        headers=auth_headers,
        data={"name": "Traversal attempt"},
        files={"file": ("../../../../.env.png", b"\x89PNG\r\n\x1a\nimage", "image/png")},
    )

    assert response.status_code == 200
    assert "file_path" not in response.json()
    upload_root = (tmp_path / "uploads").resolve()
    stored_files = list(upload_root.rglob("*"))
    assert len([path for path in stored_files if path.is_file()]) == 1
    assert all(path.resolve().is_relative_to(upload_root) for path in stored_files)


@pytest.mark.asyncio
async def test_upload_rejects_mime_and_signature_mismatch(client, auth_headers):
    response = await client.post(
        "/api/templates",
        headers=auth_headers,
        data={"name": "Spoofed"},
        files={"file": ("spoofed.png", b"not a png", "image/png")},
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_ai_prompt_omits_teacher_identity_and_attendance_counts(lesson_payload, monkeypatch):
    monkeypatch.setattr(settings, "ai_test_mode", False)
    lesson = LessonInput.model_validate(lesson_payload)
    captured: dict[str, object] = {}

    class Provider:
        async def generate_json(self, messages):
            captured.update(json.loads(messages[1]["content"]))
            return AIResult(data=LessonGenerator._sample(lesson), model="test-model")

    result = await LessonGenerator(Provider()).generate(lesson)

    assert "teacher_name" not in captured
    assert "lesson_date" not in captured
    assert "present_count" not in captured
    assert "absent_count" not in captured
    assert result.data["teacher_name"] == lesson.teacher_name


@pytest.mark.asyncio
async def test_session_cookie_cannot_authorize_state_changing_api(client, lesson_payload):
    response = await client.post(
        "/api/lessons/generate",
        headers={"Cookie": "access_token=forged-session"},
        json=lesson_payload,
    )

    assert response.status_code == 401


def test_frontend_does_not_insert_user_content_as_raw_html():
    source_files = (Path(__file__).parents[1] / "frontend" / "src").rglob("*.tsx")
    source = "\n".join(path.read_text(encoding="utf-8") for path in source_files)

    assert "dangerouslySetInnerHTML" not in source
    assert ".innerHTML" not in source
