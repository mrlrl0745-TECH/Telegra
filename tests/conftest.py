import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.database import get_db
from app.main import app
from app.models import Base


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}", connect_args={"timeout": 10})
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    from app.main import _rate_buckets
    _rate_buckets.clear()
    monkeypatch.setattr(settings, "dev_auth_enabled", True)
    monkeypatch.setattr(settings, "ai_test_mode", True)
    monkeypatch.setattr(settings, "payment_test_mode", True)
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(settings, "max_upload_bytes", 10 * 1024 * 1024)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest_asyncio.fixture
async def auth_headers(client):
    response = await client.post("/api/auth/dev")
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def lesson_payload():
    return {
        "teacher_name": "Айгуль Сагындык", "lesson_date": "2026-10-01", "subject": "Математика", "section": "Алгебра",
        "grade": "7А", "present_count": 24, "absent_count": 1, "topic": "Линейные уравнения",
        "learning_objectives": ["7.2.2.1 решать линейные уравнения"], "lesson_objectives": ["Решать уравнения с одной переменной"],
        "lesson_duration": 45, "language": "ru", "students_count": 25,
    }
