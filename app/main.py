import hmac
import ipaddress
import logging
import time
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import engine, get_db
from app.models import AIRequest, Base, GenerationUsage, LessonPlan, LessonStage, Payment, Subscription, TelegramAuthReplay, Template, User, utcnow
from app.schemas import AdminBlockIn, AdminCreditsIn, AdminSubscriptionIn, LessonContent, LessonInput, LessonOut, PaymentCreateIn, PaymentOut, TelegramAuthIn, TemplateOut, TokenOut, UserOut
from app.security import create_access_token, get_current_user, require_admin, telegram_init_data_fingerprint, validate_telegram_init_data
from app.services.ai_types import AIProviderError
from app.services.document_service import DocumentService
from app.services.lesson_generator import LessonGenerator, get_ai_provider
from app.services.payment_service import payment_service
from app.services.template_service import TemplateService, get_owned_template

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("ksp")

if settings.app_component != "api":
    raise RuntimeError("APP_COMPONENT must be 'api' when starting the FastAPI application")


class RequestBodyLimitMiddleware:
    """Enforce API body limits while receiving chunks, including chunked requests."""

    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.application(scope, receive, send)
            return

        path = scope["path"]
        method = scope["method"]
        limit = settings.max_upload_bytes + 131072 if path == "/api/templates" and method == "POST" else _MAX_JSON_BODY_BYTES
        headers = dict(scope.get("headers", []))
        raw_length = headers.get(b"content-length")
        if raw_length is not None:
            try:
                declared_length = int(raw_length)
            except ValueError:
                declared_length = None
            if declared_length is not None and declared_length > limit:
                response = _secure_response(_json_error(413, "Размер запроса превышает допустимый лимит"), is_api=True)
                await response(scope, receive, send)
                return

        bytes_received = 0
        too_large = False
        response_started = False
        rejection_sent = False

        async def limited_receive():
            nonlocal bytes_received, too_large
            if too_large:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body", b"")
                if bytes_received + len(body) > limit:
                    too_large = True
                    return {"type": "http.request", "body": b"", "more_body": False}
                bytes_received += len(body)
            return message

        async def limited_send(message):
            nonlocal response_started, rejection_sent
            if rejection_sent:
                return
            if message["type"] == "http.response.start" and too_large:
                response_started = True
                rejection_sent = True
                response = _secure_response(_json_error(413, "Размер запроса превышает допустимый лимит"), is_api=True)
                await response(scope, limited_receive, send)
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.application(scope, limited_receive, limited_send)
        except Exception:
            if not too_large or response_started:
                raise
            response = _secure_response(_json_error(413, "Размер запроса превышает допустимый лимит"), is_api=True)
            await response(scope, limited_receive, send)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.app_env == "development" and settings.database_url.startswith("sqlite"):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="КСП Генератор API",
    description="API для Telegram Web App: создание, хранение и экспорт краткосрочных планов.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url="/redoc" if settings.app_env != "production" else None,
    openapi_url="/openapi.json" if settings.app_env != "production" else None,
)


@app.get("/", include_in_schema=False)
async def root():
    if settings.app_env == "development":
        return RedirectResponse(url="/docs", status_code=307)
    return {"service": "KSP Generator API", "status": "ok"}


allowed_origins = {settings.frontend_url.rstrip("/")}
if settings.app_env == "development":
    allowed_origins.update({"http://localhost:5173", "http://127.0.0.1:5173"})
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Payment-Token"],
)
app.add_middleware(RequestBodyLimitMiddleware)

_rate_buckets: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
_rate_checks = 0
_MAX_RATE_BUCKETS = 4096
_MAX_JSON_BODY_BYTES = 2 * 1024 * 1024


@app.middleware("http")
async def security_and_rate_limits(request: Request, call_next):
    global _rate_checks
    path = request.url.path
    if path.startswith("/api/"):
        try:
            body_size = int(request.headers.get("content-length", "0"))
        except ValueError:
            return _secure_response(_json_error(400, "Некорректный размер запроса"), is_api=True)
        body_limit = settings.max_upload_bytes + 131072 if path == "/api/templates" and request.method == "POST" else _MAX_JSON_BODY_BYTES
        if body_size > body_limit:
            return _secure_response(_json_error(413, "Размер запроса превышает допустимый лимит"), is_api=True)

        if path in {"/api/auth/telegram", "/api/auth/dev"}:
            scope, limit = "auth", 12
        elif path == "/api/lessons/generate" or (path.endswith("/regenerate") and path.startswith("/api/lessons/")):
            scope, limit = "ai", 8
        elif path == "/api/templates" and request.method == "POST":
            scope, limit = "upload", 10
        else:
            scope, limit = "api", 180
        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        key = (client_ip, scope)
        recent = _rate_buckets.setdefault(key, deque())
        while recent and now - recent[0] >= 60:
            recent.popleft()
        if len(recent) >= limit:
            return _secure_response(_json_error(429, "Слишком много запросов. Попробуйте позже."), is_api=True)
        recent.append(now)
        _rate_buckets.move_to_end(key)
        _rate_checks += 1
        if _rate_checks % 256 == 0:
            stale = [bucket_key for bucket_key, stamps in _rate_buckets.items() if not stamps or now - stamps[-1] >= 60]
            for bucket_key in stale:
                _rate_buckets.pop(bucket_key, None)
            while len(_rate_buckets) > _MAX_RATE_BUCKETS:
                _rate_buckets.popitem(last=False)

    response = await call_next(request)
    return _secure_response(response, is_api=path.startswith("/api/"))


def _secure_response(response, *, is_api: bool = False):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if is_api:
        response.headers["Cache-Control"] = "no-store"
    if settings.app_env == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


def _json_error(status_code: int, detail: str):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=status_code, content={"detail": detail})


def _is_subscription_active(user: User) -> bool:
    if user.subscription_status != "active" or not user.subscription_end:
        return False
    end = user.subscription_end
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return end > datetime.now(timezone.utc)


async def _enforce_ai_quota(db: AsyncSession, user_id: str) -> None:
    hour_ago = utcnow() - timedelta(hours=1)
    used = await db.scalar(
        select(func.count())
        .select_from(AIRequest)
        .where(AIRequest.user_id == user_id, AIRequest.created_at >= hour_ago)
    ) or 0
    if used >= settings.max_ai_requests_per_hour:
        raise HTTPException(status_code=429, detail="Достигнут часовой лимит генераций. Попробуйте позже.")


async def _lock_user_for_ai(db: AsyncSession, user_id: str) -> User | None:
    # The write also serializes concurrent requests on SQLite, where FOR UPDATE is ignored.
    await db.execute(update(User).where(User.id == user_id).values(last_activity=utcnow()))
    return await db.scalar(select(User).where(User.id == user_id).with_for_update())


async def _consume_free_generation(db: AsyncSession, user_id: str) -> None:
    result = await db.execute(
        update(User)
        .where(User.id == user_id, User.is_blocked.is_(False), User.free_generations > 0)
        .values(free_generations=User.free_generations - 1)
        .returning(User.id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=402, detail="Бесплатные генерации закончились. Выберите тариф 750 ₸/месяц или 5500 ₸/год.")


async def _save_stages(db: AsyncSession, lesson_id: str, data: LessonContent) -> None:
    for position, stage in enumerate(data.stages):
        db.add(LessonStage(lesson_id=lesson_id, position=position, **stage.model_dump()))


def _sync_lesson_fields(record: LessonPlan, data: LessonContent) -> None:
    record.subject = data.subject
    record.section = data.section
    record.grade = data.class_name
    record.topic = data.lesson_topic
    record.lesson_date = data.date
    record.teacher_name = data.teacher_name
    record.present_count = data.present_count
    record.absent_count = data.absent_count
    record.learning_objectives = data.learning_objectives
    record.lesson_objectives = data.lesson_objectives
    record.content_json = data.model_dump()
    record.updated_at = utcnow()


@app.get("/health", tags=["system"], summary="Проверка доступности API")
async def health():
    return {"status": "ok"}


@app.post("/api/auth/telegram", response_model=TokenOut, tags=["auth"], summary="Проверить Telegram initData и войти")
async def auth_telegram(payload: TelegramAuthIn, db: AsyncSession = Depends(get_db)):
    try:
        tg_user = validate_telegram_init_data(payload.init_data, settings.telegram_bot_token)
        telegram_id = int(tg_user["id"])
        data_hash = telegram_init_data_fingerprint(payload.init_data)
    except Exception as exc:
        # Do not expose signature details or any submitted initData.
        logger.info("Telegram authentication rejected")
        raise HTTPException(status_code=401, detail="Не удалось подтвердить вход через Telegram") from exc
    try:
        now = utcnow()
        await db.execute(delete(TelegramAuthReplay).where(TelegramAuthReplay.expires_at <= now))
        db.add(TelegramAuthReplay(data_hash=data_hash, expires_at=now + timedelta(minutes=15)))
        user = await db.scalar(select(User).where(User.telegram_user_id == telegram_id).with_for_update())
        if user is None:
            user = User(
                telegram_user_id=telegram_id,
                username=tg_user.get("username"),
                first_name=tg_user.get("first_name", ""),
                last_name=tg_user.get("last_name", ""),
                language=(tg_user.get("language_code") or "ru")[:8],
                free_generations=settings.free_generations,
            )
            db.add(user)
        else:
            user.username = tg_user.get("username")
            user.first_name = tg_user.get("first_name", user.first_name)
            user.last_name = tg_user.get("last_name", user.last_name)
            user.last_activity = utcnow()
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        logger.info("Telegram authentication replay or duplicate account rejected")
        raise HTTPException(status_code=401, detail="Не удалось подтвердить вход через Telegram") from exc
    await db.refresh(user)
    public_user = UserOut.model_validate(user).model_copy(update={"is_admin": user.telegram_user_id in settings.admin_ids})
    return TokenOut(access_token=create_access_token(user.id), user=public_user)


@app.post("/api/auth/dev", response_model=TokenOut, tags=["auth"], summary="Локальный вход для разработки")
async def auth_dev(request: Request, db: AsyncSession = Depends(get_db)):
    if not settings.dev_auth_enabled or settings.app_env != "development":
        raise HTTPException(status_code=404, detail="Not found")
    try:
        is_loopback = bool(request.client and (
            request.client.host == "testclient" or ipaddress.ip_address(request.client.host).is_loopback
        ))
    except ValueError:
        is_loopback = False
    if not is_loopback:
        raise HTTPException(status_code=404, detail="Not found")
    telegram_id = 42424242
    user = await db.scalar(select(User).where(User.telegram_user_id == telegram_id))
    if user is None:
        user = User(telegram_user_id=telegram_id, first_name="Тестовый пользователь", language="ru", free_generations=settings.free_generations)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    public_user = UserOut.model_validate(user).model_copy(update={"is_admin": user.telegram_user_id in settings.admin_ids})
    return TokenOut(access_token=create_access_token(user.id), user=public_user)


@app.get("/api/users/me", response_model=UserOut, tags=["users"], summary="Текущий пользователь")
async def get_me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user).model_copy(update={"is_admin": user.telegram_user_id in settings.admin_ids})


@app.get("/api/users/usage", tags=["users"], summary="Лимит, подписка и количество КСП")
async def usage(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    total = await db.scalar(select(func.count()).select_from(LessonPlan).where(LessonPlan.user_id == user.id)) or 0
    active = _is_subscription_active(user)
    status = user.subscription_status
    if status == "active" and not active:
        status = "expired"
    return {
        "free_generations": user.free_generations,
        "free_generations_total": settings.free_generations,
        "subscription_active": active,
        "subscription_status": status,
        "subscription_type": user.subscription_type,
        "subscription_end": user.subscription_end,
        "lessons_created": total,
    }


@app.post("/api/lessons/generate", response_model=LessonOut, tags=["lessons"], summary="Создать КСП и списать генерацию только после успеха")
async def generate_lesson(payload: LessonInput, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user_id = user.id
    locked_user = await _lock_user_for_ai(db, user_id)
    if not locked_user or locked_user.is_blocked:
        raise HTTPException(status_code=403, detail="Доступ к аккаунту ограничен")
    await _enforce_ai_quota(db, user_id)
    active_subscription = _is_subscription_active(locked_user)
    if not active_subscription and locked_user.free_generations <= 0:
        raise HTTPException(status_code=402, detail="Бесплатные генерации закончились. Выберите тариф 750 ₸/месяц или 5500 ₸/год.")
    was_free = not active_subscription
    if was_free:
        await _consume_free_generation(db, user_id)
    template_structure = LessonGenerator.standard_structure()
    if payload.template_id:
        template = await get_owned_template(db, user_id, payload.template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Шаблон не найден")
        template_structure = template.template_structure or template_structure
    try:
        result = await LessonGenerator().generate(payload, template_structure)
        content = LessonContent.model_validate(result.data)
        # Render both formats before commit so an export error does not consume a free generation.
        DocumentService.to_docx(content)
        DocumentService.to_pdf(content)
    except AIProviderError as exc:
        await db.rollback()
        logger.warning("KSP generation failed (%s)", exc.code)
        db.add(AIRequest(user_id=user_id, model=settings.active_ai_model or "test-mode", status="error", error_code=exc.code))
        await db.commit()
        raise HTTPException(status_code=503, detail="Не удалось создать КСП. Проверьте настройки AI или попробуйте ещё раз.") from exc
    except Exception as exc:
        await db.rollback()
        logger.warning("KSP validation or document rendering failed (%s)", type(exc).__name__)
        db.add(AIRequest(user_id=user_id, model=settings.active_ai_model or "test-mode", status="error", error_code="invalid_output"))
        await db.commit()
        raise HTTPException(status_code=422, detail="Не удалось подготовить документ. Проверьте данные и попробуйте ещё раз.") from exc
    plan = LessonPlan(user_id=user_id, template_id=payload.template_id, language=payload.language, content_json=content.model_dump())
    _sync_lesson_fields(plan, content)
    db.add(plan)
    await db.flush()
    await _save_stages(db, plan.id, content)
    db.add(GenerationUsage(user_id=user_id, lesson_id=plan.id, was_free=was_free))
    db.add(AIRequest(user_id=user_id, model=result.model, status="success", prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens, cost=result.cost))
    await db.commit()
    await db.refresh(plan)
    return plan


@app.get("/api/lessons", response_model=list[LessonOut], tags=["lessons"], summary="Список моих КСП")
async def list_lessons(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.scalars(select(LessonPlan).where(LessonPlan.user_id == user.id).order_by(LessonPlan.created_at.desc()))
    return list(result)


@app.get("/api/lessons/{lesson_id}", response_model=LessonOut, tags=["lessons"], summary="Открыть КСП")
async def get_lesson(lesson_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.id == lesson_id, LessonPlan.user_id == user.id))
    if not plan:
        raise HTTPException(status_code=404, detail="КСП не найден")
    return plan


@app.put("/api/lessons/{lesson_id}", response_model=LessonOut, tags=["lessons"], summary="Сохранить отредактированный КСП")
async def update_lesson(lesson_id: str, content: LessonContent, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.id == lesson_id, LessonPlan.user_id == user.id).with_for_update())
    if not plan:
        raise HTTPException(status_code=404, detail="КСП не найден")
    try:
        DocumentService.to_docx(content)
        DocumentService.to_pdf(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Не удалось сформировать документ") from exc
    _sync_lesson_fields(plan, content)
    await db.execute(LessonStage.__table__.delete().where(LessonStage.lesson_id == lesson_id))
    await _save_stages(db, plan.id, content)
    await db.commit()
    await db.refresh(plan)
    return plan


@app.delete("/api/lessons/{lesson_id}", tags=["lessons"], summary="Удалить КСП")
async def delete_lesson(lesson_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.id == lesson_id, LessonPlan.user_id == user.id))
    if not plan:
        raise HTTPException(status_code=404, detail="КСП не найден")
    await db.delete(plan)
    await db.commit()
    return {"ok": True}


@app.post("/api/lessons/{lesson_id}/copy", response_model=LessonOut, tags=["lessons"], summary="Скопировать КСП без новой генерации")
async def copy_lesson(lesson_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    original = await db.scalar(select(LessonPlan).where(LessonPlan.id == lesson_id, LessonPlan.user_id == user.id))
    if not original:
        raise HTTPException(status_code=404, detail="КСП не найден")
    duplicate = LessonPlan(
        user_id=user.id, template_id=original.template_id, subject=original.subject, section=original.section,
        grade=original.grade, topic=original.topic, lesson_date=original.lesson_date, teacher_name=original.teacher_name,
        present_count=original.present_count, absent_count=original.absent_count,
        learning_objectives=list(original.learning_objectives), lesson_objectives=list(original.lesson_objectives),
        content_json=dict(original.content_json), language=original.language,
    )
    db.add(duplicate)
    await db.flush()
    content = LessonContent.model_validate(duplicate.content_json)
    await _save_stages(db, duplicate.id, content)
    await db.commit()
    await db.refresh(duplicate)
    return duplicate


@app.post("/api/lessons/{lesson_id}/regenerate", response_model=LessonOut, tags=["lessons"], summary="Создать другой вариант с учётом лимита генераций")
async def regenerate_lesson(lesson_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    locked_user = await _lock_user_for_ai(db, user.id)
    if not locked_user or locked_user.is_blocked:
        raise HTTPException(status_code=403, detail="Доступ к аккаунту ограничен")
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.id == lesson_id, LessonPlan.user_id == user.id).with_for_update())
    if not plan:
        raise HTTPException(status_code=404, detail="КСП не найден")
    await _enforce_ai_quota(db, user.id)
    active_subscription = _is_subscription_active(locked_user)
    if not active_subscription and locked_user.free_generations <= 0:
        raise HTTPException(status_code=402, detail="Бесплатные генерации закончились. Выберите тариф 750 ₸/месяц или 5500 ₸/год.")
    was_free = not active_subscription
    if was_free:
        await _consume_free_generation(db, user.id)
    old = LessonContent.model_validate(plan.content_json)
    payload = LessonInput(
        teacher_name=old.teacher_name, lesson_date=old.date, subject=old.subject, section=old.section, grade=old.class_name,
        present_count=old.present_count, absent_count=old.absent_count, topic=old.lesson_topic,
        learning_objectives=old.learning_objectives, lesson_objectives=old.lesson_objectives, language=plan.language,
        lesson_duration=45, homework_required=bool(old.homework), reflection_required=bool(old.reflection),
    )
    try:
        result = await LessonGenerator().generate(payload, LessonGenerator.standard_structure())
        content = LessonContent.model_validate(result.data)
        DocumentService.to_docx(content)
        DocumentService.to_pdf(content)
    except Exception as exc:
        await db.rollback()
        logger.warning("KSP variant generation failed (%s)", type(exc).__name__)
        db.add(AIRequest(user_id=user.id, model=settings.active_ai_model or "test-mode", status="error", error_code="variant_generation_failed"))
        await db.commit()
        raise HTTPException(status_code=503, detail="Не удалось создать другой вариант. Попробуйте ещё раз.") from exc
    _sync_lesson_fields(plan, content)
    await db.execute(LessonStage.__table__.delete().where(LessonStage.lesson_id == lesson_id))
    await _save_stages(db, plan.id, content)
    db.add(GenerationUsage(user_id=user.id, lesson_id=plan.id, was_free=was_free))
    db.add(AIRequest(user_id=user.id, model=result.model, status="success", prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens, cost=result.cost))
    await db.commit()
    await db.refresh(plan)
    return plan


@app.post("/api/lessons/{lesson_id}/export/docx", tags=["lessons"], summary="Скачать редактируемый DOCX по образцу")
async def export_docx(lesson_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.id == lesson_id, LessonPlan.user_id == user.id))
    if not plan:
        raise HTTPException(status_code=404, detail="КСП не найден")
    content = LessonContent.model_validate(plan.content_json)
    try:
        file = DocumentService.to_docx(content)
    except Exception as exc:
        logger.warning("DOCX export failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Не удалось сформировать DOCX") from exc
    safe_topic = "".join(ch for ch in plan.topic if ch.isalnum() or ch in " -_")[:60].strip().replace(" ", "-") or "ksp"
    ascii_filename = quote(f"ksp-{safe_topic}.docx")
    return StreamingResponse(iter([file]), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{ascii_filename}"})


@app.post("/api/lessons/{lesson_id}/export/pdf", tags=["lessons"], summary="Скачать PDF с таблицей по образцу")
async def export_pdf(lesson_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    plan = await db.scalar(select(LessonPlan).where(LessonPlan.id == lesson_id, LessonPlan.user_id == user.id))
    if not plan:
        raise HTTPException(status_code=404, detail="КСП не найден")
    try:
        file = DocumentService.to_pdf(LessonContent.model_validate(plan.content_json))
    except Exception as exc:
        logger.warning("PDF export failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Не удалось сформировать PDF") from exc
    safe_topic = "".join(ch for ch in plan.topic if ch.isalnum() or ch in " -_")[:60].strip().replace(" ", "-") or "ksp"
    ascii_filename = quote(f"ksp-{safe_topic}.pdf")
    return StreamingResponse(iter([file]), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{ascii_filename}"})


@app.get("/api/templates", response_model=list[TemplateOut], tags=["templates"], summary="Мои шаблоны")
async def list_templates(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await db.scalars(select(Template).where(Template.user_id == user.id).order_by(Template.created_at.desc()))
    return list(items)


@app.post("/api/templates", response_model=TemplateOut, tags=["templates"], summary="Загрузить и сохранить шаблон")
async def upload_template(name: str = Form(""), file: UploadFile = File(...), user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    saved_count = await db.scalar(select(func.count()).select_from(Template).where(Template.user_id == user.id)) or 0
    if saved_count >= settings.max_templates_per_user:
        raise HTTPException(status_code=429, detail="Достигнут лимит сохранённых шаблонов")
    content = await file.read(settings.max_upload_bytes + 1)
    try:
        template = await TemplateService().save_upload(db, user, name, file.filename or "template", file.content_type or "", content)
        await db.commit()
        await db.refresh(template)
        return template
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.warning("Template upload failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=422, detail="Не удалось прочитать шаблон. Проверьте файл.") from exc


@app.get("/api/templates/{template_id}", response_model=TemplateOut, tags=["templates"], summary="Получить структуру шаблона")
async def get_template(template_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    template = await get_owned_template(db, user.id, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    return template


@app.delete("/api/templates/{template_id}", tags=["templates"], summary="Удалить шаблон")
async def delete_template(template_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    template = await get_owned_template(db, user.id, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    user_dir = (Path(settings.upload_dir) / user.id).resolve()
    path = Path(template.file_path).resolve()
    await db.delete(template)
    await db.commit()
    if path.is_relative_to(user_dir):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not remove stored template file")
    else:
        logger.error("Stored template path is outside the owner's upload directory")
    return {"ok": True}


@app.get("/api/subscription", tags=["payments"], summary="Планы и активная подписка")
async def subscription(user: User = Depends(get_current_user)):
    active = _is_subscription_active(user)
    status = "expired" if user.subscription_status == "active" and not active else user.subscription_status
    return {"active": active, "status": status, "type": user.subscription_type, "end_date": user.subscription_end, "tariffs": [{"type": "monthly", "price": 750, "currency": "KZT"}, {"type": "yearly", "price": 5500, "currency": "KZT"}]}


@app.post("/api/payments/create", response_model=PaymentOut, tags=["payments"], summary="Создать платёж на тариф")
async def create_payment(payload: PaymentCreateIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if settings.app_env != "development" or not settings.payment_test_mode:
        raise HTTPException(status_code=503, detail="Платёжный провайдер не настроен")
    payment = await payment_service.create_payment(db, user, payload.tariff)
    return payment


@app.get("/api/payments/status/{payment_id}", response_model=PaymentOut, tags=["payments"], summary="Проверить статус платежа")
async def payment_status(payment_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id, Payment.user_id == user.id))
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")
    return await payment_service.check_payment(db, payment)


@app.post("/api/payments/{payment_id}/simulate", response_model=PaymentOut, tags=["payments"], summary="Симулировать платёж в тестовом режиме")
async def simulate_payment(payment_id: str, status: str = "success", user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if settings.app_env != "development" or not settings.payment_test_mode:
        raise HTTPException(status_code=404, detail="Not found")
    payment = await db.scalar(select(Payment).where(Payment.id == payment_id, Payment.user_id == user.id))
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")
    updated = await payment_service.process_webhook(db, payment.external_payment_id, status)
    return updated


@app.post("/api/payments/webhook", tags=["payments"], summary="Подтверждённое уведомление платёжного провайдера")
async def payment_webhook(payload: dict, x_payment_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    if settings.payment_test_mode or settings.payment_provider == "mock":
        raise HTTPException(status_code=404, detail="Not found")
    if not settings.payment_provider_token or not x_payment_token or not hmac.compare_digest(x_payment_token, settings.payment_provider_token):
        raise HTTPException(status_code=401, detail="Недействительная подпись")
    try:
        payment = await payment_service.process_webhook(db, str(payload["payment_id"]), str(payload["status"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Некорректное уведомление") from exc
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")
    return {"ok": True, "status": payment.status}


@app.get("/api/admin/statistics", tags=["admin"], summary="Административная сводка")
async def admin_statistics(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    start_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    day = await db.scalar(select(func.count()).select_from(GenerationUsage).where(GenerationUsage.created_at >= start_day)) or 0
    month = await db.scalar(select(func.count()).select_from(GenerationUsage).where(GenerationUsage.created_at >= start_month)) or 0
    total_generations = await db.scalar(select(func.count()).select_from(GenerationUsage)) or 0
    return {
        "users_total": await db.scalar(select(func.count()).select_from(User)) or 0,
        "users_new_today": await db.scalar(select(func.count()).select_from(User).where(User.created_at >= start_day)) or 0,
        "users_active_30d": await db.scalar(select(func.count()).select_from(User).where(User.last_activity >= now - timedelta(days=30))) or 0,
        "users_blocked": await db.scalar(select(func.count()).select_from(User).where(User.is_blocked.is_(True))) or 0,
        "lessons_total": await db.scalar(select(func.count()).select_from(LessonPlan)) or 0,
        "generations_total": total_generations,
        "generations_today": day,
        "generations_month": month,
        "generations_free": await db.scalar(select(func.count()).select_from(GenerationUsage).where(GenerationUsage.was_free.is_(True))) or 0,
        "generations_paid": await db.scalar(select(func.count()).select_from(GenerationUsage).where(GenerationUsage.was_free.is_(False))) or 0,
        "active_subscriptions": await db.scalar(select(func.count()).select_from(Subscription).where(Subscription.status == "active", Subscription.end_date > now)) or 0,
        "expired_subscriptions": await db.scalar(select(func.count()).select_from(Subscription).where(Subscription.end_date <= now)) or 0,
        "monthly_subscriptions": await db.scalar(select(func.count()).select_from(Subscription).where(Subscription.type == "monthly", Subscription.status == "active", Subscription.end_date > now)) or 0,
        "yearly_subscriptions": await db.scalar(select(func.count()).select_from(Subscription).where(Subscription.type == "yearly", Subscription.status == "active", Subscription.end_date > now)) or 0,
        "payments_success": await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "success")) or 0,
        "payments_pending": await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "pending")) or 0,
        "payments_failed": await db.scalar(select(func.count()).select_from(Payment).where(Payment.status == "failed")) or 0,
        "payments_amount": await db.scalar(select(func.sum(Payment.amount)).where(Payment.status == "success")) or 0,
        "ai_requests": await db.scalar(select(func.count()).select_from(AIRequest)) or 0,
        "ai_errors": await db.scalar(select(func.count()).select_from(AIRequest).where(AIRequest.status == "error")) or 0,
        "ai_prompt_tokens": await db.scalar(select(func.sum(AIRequest.prompt_tokens))) or 0,
        "ai_completion_tokens": await db.scalar(select(func.sum(AIRequest.completion_tokens))) or 0,
        "ai_cost": float(await db.scalar(select(func.sum(AIRequest.cost))) or 0),
    }


@app.get("/api/admin/users", tags=["admin"], summary="Пользователи для администратора")
async def admin_users(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    users = await db.scalars(select(User).order_by(User.created_at.desc()).limit(500))
    return [UserOut.model_validate(item).model_copy(update={"is_admin": item.telegram_user_id in settings.admin_ids}) for item in users]


@app.get("/api/admin/payments", tags=["admin"], summary="Платежи для администратора")
async def admin_payments(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    payments = await db.scalars(select(Payment).order_by(Payment.created_at.desc()).limit(500))
    return [PaymentOut.model_validate(item) for item in payments]


@app.get("/api/admin/users/{user_id}", tags=["admin"], summary="Профиль пользователя, подписки и оплаты")
async def admin_user_detail(user_id: str, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    target = await db.scalar(select(User).where(User.id == user_id))
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    payments = await db.scalars(select(Payment).where(Payment.user_id == user_id).order_by(Payment.created_at.desc()))
    subscriptions = await db.scalars(select(Subscription).where(Subscription.user_id == user_id).order_by(Subscription.created_at.desc()))
    return {
        "user": UserOut.model_validate(target).model_copy(update={"is_admin": target.telegram_user_id in settings.admin_ids}),
        "payments": [PaymentOut.model_validate(item) for item in payments],
        "subscriptions": [{"id": item.id, "type": item.type, "status": item.status, "start_date": item.start_date, "end_date": item.end_date, "payment_id": item.payment_id, "created_at": item.created_at} for item in subscriptions],
    }


@app.post("/api/admin/users/{user_id}/credits", tags=["admin"], summary="Добавить пользователю бесплатные генерации")
async def admin_add_credits(user_id: str, payload: AdminCreditsIn, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    target = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    target.free_generations += payload.amount
    await db.commit()
    return {"user_id": target.id, "free_generations": target.free_generations}


@app.put("/api/admin/users/{user_id}/block", tags=["admin"], summary="Заблокировать или разблокировать аккаунт")
async def admin_set_block(user_id: str, payload: AdminBlockIn, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if user_id == admin.id and payload.blocked:
        raise HTTPException(status_code=400, detail="Нельзя заблокировать собственный аккаунт")
    target = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    target.is_blocked = payload.blocked
    await db.commit()
    return {"user_id": target.id, "is_blocked": target.is_blocked}


@app.post("/api/admin/users/{user_id}/subscription", tags=["admin"], summary="Вручную выдать или продлить подписку")
async def admin_set_subscription(user_id: str, payload: AdminSubscriptionIn, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    target = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=payload.days or (365 if payload.type == "yearly" else 30))
    current = await db.scalars(select(Subscription).where(Subscription.user_id == target.id, Subscription.status == "active"))
    for item in current:
        item.status = "cancelled"
        item.updated_at = now
    db.add(Subscription(user_id=target.id, type=payload.type, status="active", start_date=now, end_date=end))
    target.subscription_status = "active"
    target.subscription_type = payload.type
    target.subscription_start = now
    target.subscription_end = end
    await db.commit()
    return {"user_id": target.id, "subscription_type": target.subscription_type, "subscription_end": target.subscription_end}


@app.get("/api/admin/ai/statistics", tags=["admin"], summary="Использование AI")
async def admin_ai_statistics(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(AIRequest.status, func.count(AIRequest.id), func.sum(AIRequest.prompt_tokens), func.sum(AIRequest.completion_tokens), func.sum(AIRequest.cost)).group_by(AIRequest.status))
    return [{"status": row[0], "requests": row[1], "prompt_tokens": row[2] or 0, "completion_tokens": row[3] or 0, "cost": float(row[4] or 0)} for row in rows]


@app.get("/api/admin/ai/test", tags=["admin"], summary="Проверить подключение AI")
async def admin_ai_test(_: User = Depends(require_admin)):
    try:
        return await get_ai_provider().test_connection()
    except AIProviderError as exc:
        raise HTTPException(status_code=503, detail="Не удалось проверить соединение AI") from exc
