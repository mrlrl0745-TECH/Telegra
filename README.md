# КСП Генератор

Мобильный Telegram Web App для создания краткосрочных планов учителей Казахстана. Репозиторий содержит React/Vite frontend, FastAPI backend, PostgreSQL, Alembic, Telegram-бота, интеграции Google Gemini и OpenRouter, DOCX-экспорт, бесплатный лимит и тестовый платёжный сервис.

## Что готово в MVP

- Подтверждение HMAC и срока действия Telegram `initData`, однократное использование подписанных данных входа, затем серверная JWT-сессия.
- Пошаговая адаптивная форма, сохранение черновика, RU/KZ переключатель.
- Генерация и валидация структурированного КСП; цели программы передаются без переписывания.
- Каждая AI-генерация, включая создание другого варианта, использует одну бесплатную попытку. Списание резервируется атомарно и откатывается при ошибке генерации или экспорта.
- Сохранённые планы, редактирование, копирование, удаление и генерация другого варианта.
- DOCX и PDF по приложенному образцу: голубая строка «Раздел», блоки данных и целей, пятиколоночная таблица «Ход урока».
- Сохранение пользовательских файлов DOCX/PDF/PNG/JPG с проверкой расширения, MIME и размера. Из DOCX извлекаются абзацы и таблицы; из PDF — текстовый слой.
- Тестовая подписка на 30/365 дней с атомарными переходами статуса платежа и защитой от повторного webhook.
- Команды Telegram `/start`, `/help`, `/profile`, `/tariff`, `/my_lessons`.
- Административная панель для пользователей из `ADMIN_TELEGRAM_IDS`: статистика, платежи и AI, просмотр профиля и истории оплат, блокировка, выдача генераций и ручная подписка.
- PDF-экспорт с кириллическим шрифтом и альбомной таблицей из пяти колонок.

Тестовый режим использует локальную генерацию для проверки пользовательского сценария без AI-ключа. Для реальных запросов по умолчанию установите `AI_PROVIDER=google`, `AI_TEST_MODE=false` и задайте `GOOGLE_AI_API_KEY`; модель по умолчанию — `gemini-3.8-flash`. OpenRouter доступен как альтернативный провайдер через `AI_PROVIDER=openrouter`. Загруженная структура шаблона передаётся AI как контекст, но экспорт пока использует стандартный бланк КСП. Автоматическое OCR изображений и ручное сопоставление полей нестандартных шаблонов относятся к следующему этапу; текущий платёжный adapter намеренно не выполняет реальные списания.

## Быстрый запуск в Docker

1. Установите Docker Desktop.
2. Скопируйте пример настроек:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Для production сгенерируйте SECRET_KEY (минимум 48 символов), POSTGRES_PASSWORD для администратора PostgreSQL, POSTGRES_APP_PASSWORD и POSTGRES_BOT_PASSWORD. Замените placeholders в .env; DATABASE_URL должен использовать роль `ksp_app` и POSTGRES_APP_PASSWORD, а BOT_DATABASE_URL — роль `ksp_bot` и POSTGRES_BOT_PASSWORD. Используйте разные пароли. Задайте Telegram и Google AI secrets и реальные HTTPS-адреса приложения и API. SECRET_KEY можно создать командой python -c "import secrets; print(secrets.token_urlsafe(48))", пароль БД — python -c "import secrets; print(secrets.token_hex(32))".
4. Для локальной демонстрации установите APP_ENV=development, AI_TEST_MODE=true, PAYMENT_TEST_MODE=true, DEV_AUTH_ENABLED=true, FRONTEND_URL=http://localhost:5173, VITE_API_URL=http://localhost:8000 и DATABASE_URL с хостом postgres. Если нужна настоящая генерация, задайте `AI_TEST_MODE=false`, `AI_PROVIDER=google` и `GOOGLE_AI_API_KEY`. Для панели администратора добавьте ADMIN_TELEGRAM_IDS=42424242. Не используйте тестовые флаги при публичном развёртывании.

5. Запустите систему:
   ```powershell
   docker compose up --build
   ```

6. Откройте [http://localhost:5173](http://localhost:5173). В production Telegram Web App требует HTTPS; публичный домен задаётся в APP_URL и регистрируется через BotFather. Compose публикует порты только на loopback, поэтому публичный трафик должен проходить через TLS reverse proxy.
7. Swagger API доступен в development по адресу [http://localhost:8000/docs](http://localhost:8000/docs); в production документация и OpenAPI отключены.

Compose запускает миграции Alembic перед FastAPI. PostgreSQL создаёт отдельную роль `ksp_app` без superuser/createdb/createrole и роль `ksp_bot` без записи; миграция даёт боту чтение только таблиц `users` и `lesson_plans`. Контейнеры backend и bot не получают пароль администратора PostgreSQL. Инициализационный скрипт создаёт/обновляет роли при первом запуске с пустым volume. Для уже инициализированного `postgres_data` примените этот скрипт вручную от имени `POSTGRES_USER` до запуска миграции; не удаляйте volume. Данные PostgreSQL и загруженные пользовательские шаблоны остаются в Docker volumes.

## Запуск локально без Docker

Нужны Python 3.12+, Node.js 24 LTS и PostgreSQL. Для запуска backend с локального компьютера укажите в .env адрес PostgreSQL и пароль роли приложения, например postgresql+asyncpg://ksp_app:<your-app-password>@localhost:5432/ksp. При запуске через Compose используйте хост postgres.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
   pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
```

В отдельном терминале:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Для локального просмотра без Telegram включите `DEV_AUTH_ENABLED=true` в корневом `.env` и `VITE_DEV_MODE=true` в `frontend/.env`. Этот режим предназначен для разработки; отключите его на публичном сервере. В локальном SQLite-режиме схема создаётся при запуске FastAPI.

## Telegram

1. Создайте бота через [@BotFather](https://t.me/BotFather) и сохраните токен только в `.env` как `TELEGRAM_BOT_TOKEN`.
2. Разверните Web App на HTTPS, внесите URL в `APP_URL`, имя бота — в `BOT_USERNAME`.
3. Запустите polling-бота:

   ```powershell
   python -m app.bot
   ```

4. Зарегистрируйте HTTPS Web App URL в BotFather и добавьте кнопку меню или deep link. Команды бота отвечают на `/start`, `/help`, `/profile`, `/tariff`, `/my_lessons`.

В Docker Compose бота можно запустить отдельным профилем после настройки токена: `docker compose --profile telegram up --build`.

Backend проверяет HMAC Telegram initData с помощью bot token, отвергает подписи старше 15 минут и не принимает повторно использованный подписанный payload. Отпечаток сохраняется временно без исходного initData. Frontend передаёт исходное initData; Telegram ID из формы не принимается.

## AI-провайдеры

По умолчанию backend вызывает Google Gemini. Ключ храните только в `.env` на сервере; он передаётся Google в заголовке `x-goog-api-key` и не включается во frontend-сборку.

```env
AI_PROVIDER=google
AI_TEST_MODE=false
GOOGLE_AI_API_KEY=...
GOOGLE_AI_MODEL=gemini-3.8-flash
```

Для OpenRouter задайте `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` и `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`. Запросы выполняются с backend, требуют JSON и проверяются Pydantic; при неверной структуре выполняется корректирующая попытка. Секрет не возвращается frontend и не записывается в логи.

## PostgreSQL и миграции

Модель БД находится в `app/models.py`; начальная схема — `migrations/versions/0001_initial_schema.py`.

```powershell
alembic upgrade head
alembic revision --autogenerate -m "описание изменения"
alembic upgrade head
alembic downgrade -1
```

При изменении моделей создавайте новую миграцию, а не редактируйте уже применённую.

## Оплата

Пока используется тестовый adapter без реальных денежных операций. Он работает только в development при PAYMENT_TEST_MODE=true; production endpoint оплаты закрыт до подключения реального provider adapter и проверки его webhook-подписи. Тестовая симуляция недоступна в production.

## Переменные окружения

Все параметры перечислены в .env.example. Файлы .env исключены из Git и Docker build contexts. Production startup проверяет секреты, HTTPS, PostgreSQL и выключенные test/dev flags. API ограничивает частоту запросов, число AI-запросов на пользователя и загрузки шаблонов. ADMIN_TELEGRAM_IDS принимает список Telegram ID через запятую; административные API закрыты серверной проверкой.

## Проверки

```powershell
pytest
cd frontend
npm run build
```

Тесты покрывают подпись Telegram, dev-регистрацию, бесплатный лимит и ошибки AI/рендеринга, сохранение целей, DOCX/PDF-выгрузку, загрузку шаблонов, тестовые платежи, административные действия и защиту от повтора вебхука.
