# Security Audit

Дата проверки: 2026-10-02  
Область: локальная копия проекта `C:\Users\ADMIN\Desktop\Telegram pomosh`; production-среда и внешние платёжные системы не подключались.

## Executive Summary

В приложении уже были серверная проверка HMAC Telegram `initData`, JWT-аутентификация, владельческие SQL-фильтры, серверные admin checks, ограничения загрузок, ограничение AI-токенов и отключение тестовой оплаты при production-настройке. Аудит выявил четыре подтверждённые уязвимости в бизнес-логике и запросах, а также два важных deployment-риска. Добавлены исправления и регрессионные тесты.

**Открытый высокий риск:** значение `GOOGLE_AI_API_KEY` в `.env.example` было непустым, не выглядело как placeholder и совпадало с локальным значением в `.env`. Значение удалено из примера, но ключ не был проверен у провайдера и не был отозван. Считайте его раскрытым и замените в Google AI; после замены обновите `.env`. Полное значение ключа здесь не приводится.

Второй deployment-риск был в PostgreSQL Compose: `POSTGRES_USER` создаётся официальным образом как superuser, а `env_file: .env` передавал секреты БД всем контейнерам приложения. Compose теперь создаёт отдельные роли `ksp_app` и `ksp_bot`, а backend и bot получают только свои DSN. Для уже инициализированного Docker volume скрипт ролей нужно применить вручную от имени старого администратора до следующего запуска миграций. Docker и PostgreSQL в этой среде отсутствуют, поэтому роль и контейнеры не запускались.

Подтверждённых CRITICAL findings не осталось. Проект пока нельзя считать готовым к production до ротации Google AI ключа и проверки настройки ролей на целевой PostgreSQL. Локальный `.env` сейчас настроен как development, с dev auth и тестовой оплатой; production validator эти флаги запрещает.

## Security Inventory

### Backend endpoints

| Endpoint | Кто вызывает | Контроль доступа и основные данные |
|---|---|---|
| `GET /`, `GET /health` | Публично | Только статус сервиса; docs redirect только в development |
| `POST /api/auth/telegram` | Публично | HMAC Telegram, срок `auth_date` 15 минут, одноразовый fingerprint после исправления |
| `POST /api/auth/dev` | Только development и loopback | Выдаёт локальную тестовую сессию; production config запрещает `DEV_AUTH_ENABLED` |
| `GET /api/users/me`, `GET /api/users/usage` | Любой вошедший пользователь | JWT `Authorization: Bearer`; только текущий аккаунт |
| `POST /api/lessons/generate` | Вошедший пользователь | Свой AI quota, подписка или бесплатный баланс; template ownership |
| `GET /api/lessons` | Вошедший пользователь | Список только своих КСП |
| `GET/PUT/DELETE /api/lessons/{lesson_id}` | Вошедший пользователь | Все запросы ограничены `LessonPlan.user_id` |
| `POST /api/lessons/{lesson_id}/copy`, `/regenerate`, `/export/docx`, `/export/pdf` | Вошедший пользователь | Проверяется ownership; генерация учитывает quota |
| `GET/POST /api/templates`, `GET/DELETE /api/templates/{template_id}` | Вошедший пользователь | Список и операции ограничены владельцем; upload валидируется и сохраняется под UUID-путём |
| `GET /api/subscription` | Вошедший пользователь | Состояние вычисляется backend из БД и времени |
| `POST /api/payments/create`, `GET /api/payments/status/{payment_id}` | Вошедший пользователь | Цена задаётся сервером; статус виден владельцу |
| `POST /api/payments/{payment_id}/simulate` | Вошедший пользователь, только development с test mode | Тестовая симуляция; production endpoint закрыт |
| `POST /api/payments/webhook` | Только платёжный token | Сейчас mock/test режим endpoint закрывает; реального provider adapter нет |
| `GET /api/admin/statistics`, `/users`, `/payments`, `/users/{id}`, `/ai/statistics`, `/ai/test` | Только Telegram ID из `ADMIN_TELEGRAM_IDS` | Backend dependency `require_admin` |
| `POST /api/admin/users/{id}/credits`, `/subscription`; `PUT /api/admin/users/{id}/block` | Только admin | Серверная роль и проверки параметров |
| `/docs`, `/redoc`, `/openapi.json` | Только non-production | В production отключаются при создании FastAPI приложения |

Frontend — React SPA с состояниями `home`, `wizard`, `lessons`, `templates`, `tariff`, `help`, `preview`, `admin`; URL router нет. JWT хранится в `sessionStorage`, Telegram `initData` поступает из Telegram WebApp JS SDK bridge. Backend проверяет JWT подпись HS256, expiry 12 часов, существование пользователя и блокировку.

Роли: анонимный, вошедший пользователь, admin по Telegram ID, заблокированный пользователь. Подписка и баланс хранятся на сервере; фронтенд не задаёт их.

Таблицы БД: `users`, `telegram_auth_replays`, `lesson_plans`, `lesson_stages`, `templates`, `template_fields`, `payments`, `subscriptions`, `generation_usage`, `ai_requests`. Telegram ID и `payments.external_payment_id` уникальны. КСП и шаблоны привязаны к user FK.

Файлы: шаблоны в `UPLOAD_DIR/<user_uuid>/<uuid>.<ext>`, в Compose том `/data/uploads`; публичного endpoint для прямого доступа к пути нет. Есть локальные `.db` файлы; содержимое не открывалось, так как они могут содержать данные пользователей.

Внешние интеграции: Telegram Bot API (aiogram polling), Google Gemini или OpenRouter (только backend), PostgreSQL. Реальный платёжный провайдер отсутствует; webhook предусмотрен, но mock/test конфигурация его закрывает.

Docker services: `postgres`, `backend`, `frontend`, опциональный `bot` в профиле `telegram`. PostgreSQL не публикует host port; API и frontend опубликованы на loopback. Backend запускается как `app`, frontend теперь как `nginx`; для backend/frontend/bot включены read-only root filesystem, tmpfs и сброшенные capabilities.

Настройки приложения: `APP_NAME`, `APP_COMPONENT`, `APP_ENV`, `APP_URL`, `FRONTEND_URL`, `SECRET_KEY`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `BOT_USERNAME`, `AI_PROVIDER`, `GOOGLE_AI_API_KEY`, `GOOGLE_AI_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `OPENROUTER_TIMEOUT`, `AI_TEST_MODE`, `DEV_AUTH_ENABLED`, `PAYMENT_TEST_MODE`, `PAYMENT_PROVIDER`, `PAYMENT_PROVIDER_TOKEN`, `ADMIN_TELEGRAM_IDS`, `UPLOAD_DIR`, `MAX_UPLOAD_BYTES`, `FREE_GENERATIONS`, `MAX_AI_REQUESTS_PER_HOUR`, `MAX_TEMPLATES_PER_USER`. Compose дополнительно использует `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_APP_USER`, `POSTGRES_APP_PASSWORD`, `POSTGRES_BOT_PASSWORD`, `BOT_DATABASE_URL`, `VITE_API_URL`, `VITE_DEV_MODE`.

Потенциально критичные точки входа: Telegram login, все lesson/template ID операции, generate/regenerate, загрузка и разбор DOCX/PDF, payment webhook и test simulation, admin API, AI provider requests, DB migration/bootstrap, переменные окружения и сборка frontend.

## Critical Findings

Подтверждённых Critical severity проблем не обнаружено.

## High Findings

### SEC-001 — Возможное раскрытие Google AI API key

- **Severity:** HIGH; CVSS v3.1 оценка 5.1, ориентировочная. CVSS не отражает расход средств у AI-провайдера.
- **Компонент:** Secrets/config; `.env.example`.
- **Endpoint:** нет.
- **Описание:** в исходном `.env.example` находилось непустое значение Google AI API key, не похожее на placeholder. Без вывода значения сравнено с локальным `.env`: строки совпадали. Публичность и действительность ключа не проверялись.
- **Причина:** секрет был скопирован в пример конфигурации, который явно исключён из `.gitignore` и предназначен для распространения.
- **Безопасное воспроизведение:** до исправления точное сравнение локально подтвердило совпадение; ключ не отправлялся провайдеру и не печатался. Валидность не проверена.
- **Влияние:** если ключ действующий и пример был передан или опубликован, посторонний может использовать AI quota/учётную запись владельца.
- **Исправление:** значение удалено из `.env.example`; поле оставлено пустым.
- **Изменённые файлы:** `.env.example`.
- **Security test:** повторный exact-value scan backend/frontend/tests/Docker/build не нашёл локальные credential values; поле в примере пустое.
- **Результат повторной проверки:** source/build очищены. Требуется отозвать старый ключ и выпустить новый; это не делалось, чтобы не использовать реальные секреты и не менять внешнюю учётную запись. `.git` отсутствует, поэтому Git history проверить нельзя.

## Medium Findings

### SEC-002 — PostgreSQL superuser credentials передавались приложению

- **Severity:** HIGH; CVSS v3.1 оценка 8.8 при условии компрометации backend credentials.
- **Компонент:** Docker Compose / database permissions.
- **Endpoint:** все backend endpoints могли использовать эту роль через общий DSN.
- **Описание:** Compose создавал PostgreSQL пользователя через `POSTGRES_USER`; официальный образ создаёт эту роль с superuser power. Backend и bot получали весь `.env` через `env_file`, включая PostgreSQL administrator password. [Документация официального образа PostgreSQL](https://github.com/docker-library/docs/blob/master/postgres/README.md#postgres_user) описывает это поведение.
- **Причина:** один пользователь БД применялся для bootstrap и работы приложения; `.env` полностью передавался контейнерам.
- **Безопасное воспроизведение:** статическая проверка Compose и документации образа; БД не запускалась.
- **Влияние:** при RCE/компрометации любого сервиса злоумышленник получил бы полномочия администратора БД, включая изменение ролей и кластерных данных.
- **Исправление:** Compose больше не передаёт `env_file`; создана роль `ksp_app` без superuser/createdb/createrole и роль `ksp_bot` без записи, с доступом только к `users` и `lesson_plans`. Bot получает отдельный `BOT_DATABASE_URL`. Backend/frontend/bot работают без capabilities и с read-only root filesystem.
- **Изменённые файлы:** `docker-compose.yml`, `docker/postgres-init-app-user.sh`, `migrations/versions/0003_read_only_telegram_bot.py`, `.env.example`, `README.md`, `app/config.py`, `app/main.py`.
- **Security test:** YAML parsed; статически проверено, что backend/bot не получают `POSTGRES_PASSWORD` и пароли других ролей; полный Alembic upgrade прошёл на изолированной SQLite.
- **Результат повторной проверки:** код исправлен. Docker/psql отсутствуют, поэтому роль PostgreSQL и контейнеры не запускались. Для существующего `postgres_data` init scripts автоматически не выполняются; запустите `docker/postgres-init-app-user.sh` вручную от текущего PostgreSQL superuser, затем `alembic upgrade head`. Не удаляйте volume.

### SEC-003 — Telegram initData можно было повторно обменять на JWT

- **Severity:** MEDIUM; CVSS v3.1 оценка 5.4, при условии кражи действующего `initData`.
- **Компонент:** authentication.
- **Endpoint:** `POST /api/auth/telegram`.
- **Описание:** подпись и срок 15 минут проверялись, но тот же свежий Telegram payload принимался неограниченное число раз.
- **Причина:** сервер не запоминал, что подписанный payload уже обменян.
- **Безопасное воспроизведение:** тестовый HMAC payload до исправления принимался дважды (оба ответа были 200).
- **Влияние:** обладатель перехваченного действующего `initData` мог повторно получить 12-часовой backend JWT в течение временного окна.
- **Исправление:** сохраняется SHA-256 fingerprint канонических подписанных полей на 15 минут; уникальное ограничение делает обмен одноразовым. Исходный payload и Telegram PII в таблице не хранятся.
- **Изменённые файлы:** `app/security.py`, `app/models.py`, `app/main.py`, `migrations/versions/0002_telegram_auth_replays.py`.
- **Security test:** `test_telegram_init_data_cannot_be_replayed`, `test_telegram_auth_ignores_frontend_user_id_and_rejects_old_init_data`.
- **Результат повторной проверки:** первый вход 200, повтор того же `initData` 401; старый payload 401; дополнительный `user_id` из JSON не меняет пользователя.

### SEC-004 — Regenerate обходил бесплатную квоту, параллельный generate списывал один кредит дважды

- **Severity:** MEDIUM; CVSS v3.1 оценка 6.5 с учётом сетевого доступа вошедшего пользователя и внешнего AI cost.
- **Компонент:** AI business logic/quota.
- **Endpoints:** `POST /api/lessons/{lesson_id}/regenerate`, `POST /api/lessons/generate`.
- **Описание:** regenerate раньше не проверял и не списывал бесплатный баланс. Одновременные generate-запросы с одним кредитом оба проходили на SQLite, потому что `SELECT FOR UPDATE` там игнорируется.
- **Причина:** regenerate вызывал AI вне кредитной транзакции; для quota использовалась только блокировка строки, без атомарного условного списания.
- **Безопасное воспроизведение:** тест с одним бесплатным кредитом и двумя параллельными вызовами до исправления получил `[200, 200]`.
- **Влияние:** бесплатный пользователь мог получать дополнительные AI ответы и расходовать средства владельца; конкурентные запросы обходили лимит.
- **Исправление:** каждая AI генерация, включая regenerate, потребляет попытку. Перед вызовом AI выполняется атомарный `UPDATE ... WHERE free_generations > 0`; write lock сериализует параллельные SQLite/PostgreSQL транзакции. Ошибка AI/экспорта откатывает списание.
- **Изменённые файлы:** `app/main.py`, `app/services/lesson_generator.py`, `frontend/src/App.tsx`, `README.md`.
- **Security test:** `test_regeneration_consumes_free_generation_and_cannot_bypass_quota`, `test_parallel_generation_cannot_spend_the_same_free_credit_twice`.
- **Результат повторной проверки:** одна параллельная генерация получает 200, вторая 402; provider вызывается один раз. После трёх бесплатных AI generation regenerate получает 402. Списание откатывается при ошибке.

### SEC-005 — Content-Length проверка обходилась chunked запросом

- **Severity:** MEDIUM; CVSS v3.1 оценка 5.3, вектор `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`.
- **Компонент:** HTTP request body / resource exhaustion.
- **Endpoint:** все `/api/*`, особенно upload и webhook.
- **Описание:** исходный middleware смотрел только на `Content-Length`; запрос без этого заголовка мог передать тело больше лимита.
- **Причина:** лимит применялся к заявленному размеру, не к фактически полученным ASGI chunks.
- **Безопасное воспроизведение:** более 2 MiB chunked JSON без `Content-Length` до исправления дошёл до webhook и получил 404 вместо 413.
- **Влияние:** лишнее потребление памяти/временных файлов при JSON и multipart обработке.
- **Исправление:** добавлен потоковый ASGI body limiter, который считает фактические bytes и останавливает чтение при превышении лимита.
- **Изменённые файлы:** `app/main.py`.
- **Security test:** `test_api_body_limit_applies_to_chunked_requests`.
- **Результат повторной проверки:** тот же chunked запрос получил 413; обычные запросы и suite продолжают проходить.

### SEC-006 — Платёжный статус можно было перевести из failed/cancelled в success

- **Severity:** LOW в текущем mock-only продукте; CVSS v3.1 оценка 4.3, webhook secret/provider trust требуется.
- **Компонент:** payment state machine.
- **Endpoint:** `POST /api/payments/webhook`; в development также `/api/payments/{payment_id}/simulate`.
- **Описание:** после `failed` или `cancelled` сервис принимал поздний `success` и активировал subscription.
- **Причина:** переходы статуса не были ограничены состоянием `pending`.
- **Безопасное воспроизведение:** тестовый платёж до исправления успешно переходил `failed → success` и `cancelled → success`.
- **Влияние:** устаревшее/повторное событие могло изменить итоговый статус; production платежи сейчас не подключены, create закрыт, mock webhook возвращает 404.
- **Исправление:** атомарный conditional update разрешает переход только из `pending`; terminal states больше не открываются.
- **Изменённые файлы:** `app/services/payment_service.py`.
- **Security test:** `test_terminal_payment_status_cannot_be_resurrected` для `failed` и `cancelled`; существующий тест повторной success activation.
- **Результат повторной проверки:** terminal статус сохраняется, subscription остаётся неактивной.

## Low Findings

Отдельных подтверждённых Low findings, помимо исправленного SEC-006, не обнаружено.

## Informational Findings

### INFO-001 — Пользовательский текст и извлечённый шаблон отправляются AI провайдеру

Сервис отправляет тему/предмет/класс, цели, дополнительные пожелания и извлечённую структуру загруженного шаблона в выбранный Google AI или OpenRouter. Поля `teacher_name`, точная дата, посещаемость удаляются из prompt и восстанавливаются backend после ответа. Приложение не имеет инструментов/доступа AI к БД, а ответ проходит Pydantic validation; prompt injection может ухудшить текст, но код не передаёт модели секреты или пользовательские документы других аккаунтов. Добавлено предупреждение перед генерацией на RU/KK: не включать личные данные учеников. Сроки хранения провайдера, DPA/договор и законность обработки не проверялись.

### INFO-002 — Python dependency audit неполный

`pnpm audit --prod --json` сообщил 0 advisories для 5 production dependencies. `pip-audit`, `safety`, `bandit`, `osv-scanner` и Docker scanner недоступны. Python зависимости описаны диапазонами в `requirements.txt` без lockfile, поэтому транзитивные версии и CVE не подтверждены инструментом. `pytest` удалён из production `requirements.txt` и остаётся в `requirements-dev.txt`.

### INFO-003 — In-memory IP rate limit не разделяется между процессами

Текущий Compose запускает один Uvicorn worker; auth/upload/API limiter проверен и ограничен памятью. Счётчики пропадают при перезапуске и не синхронизируются между несколькими replicas. AI quota дополнительно хранится в БД на пользователя. Перед горизонтальным масштабированием вынесите IP limiter в shared Redis/DB storage.

### INFO-004 — Docker runtime и production PostgreSQL не были запущены

Docker, `psql` и Bash отсутствуют в среде. Проверены Compose YAML, переменные, отсутствие опубликованного порта PostgreSQL, migration upgrade на временной SQLite и статические Docker настройки. Фактический запуск Nginx под `nginx`, роли PostgreSQL и проверка read-only grants остаются NOT TESTED.

## Authentication

Telegram HMAC вычисляется на backend из `TELEGRAM_BOT_TOKEN` через `hmac.compare_digest`. Повторные поля отклоняются; `auth_date` не может быть старше 900 секунд или более чем на 60 секунд в будущем; `user.id` берётся только из подписанного JSON. JWT HS256 ограничен 12 часами, блокировка и наличие пользователя проверяются на каждом защищённом запросе. Dev login ограничен loopback/development и запрещён production-конфигурацией.

Проверены подмена подписанного `user`, фальшивый frontend `user_id`, устаревший и повторный initData, rate limiting auth. Production Bot Token в этой среде не установлен и не использовался.

## Authorization

Lesson и Template операции включают одновременно объектный ID и `user_id` текущего пользователя. Admin API проверяет список Telegram ID backend dependency. Subscription/credits/payment status не задаются frontend. Список пользователей/платежей доступен только admin. Заблокированный пользователь отвергается `get_current_user`.

## Telegram Security

Frontend передаёт raw `initData`, но backend проверяет подпись и возраст. Внутренний пользователь создаётся/обновляется только из Telegram signed user data. Fingerprint хранится только 15 минут и не содержит исходный payload.

## API Security

CORS разрешает только `FRONTEND_URL` плюс localhost origins в development, credentials выключены. Аутентификация для API передаётся Bearer header, а не cookie; CSRF test-cookie без Authorization получил 401. Backend headers включают `nosniff`, no-referrer, frame deny и Permissions Policy; API ответы `no-store`. Production HSTS добавляется backend, TLS proxy отдельно не проверялся. Frontend nginx CSP разрешает Telegram WebApp script и frame ancestors Telegram; добавлено `object-src 'none'`.

## Database Security

SQL обращения используют SQLAlchemy expression/ORM и bind parameters; динамической SQL сборки из request input не найдено. PostgreSQL имеет отдельные app и bot роли после bootstrap. Bot migration выдаёт SELECT только на `users` и `lesson_plans`. Роль приложения получает DML, но не superuser/createdb/createrole.

Production DB TLS, backup encryption/retention, сетевые ACL, права реального `DATABASE_URL`, существующие роли/таблицы и соответствие имеющегося volume не проверялись. Локальные SQLite файлы не читались.

## File Upload Security

Upload проверяет расширение, MIME и file signature; предел по настройке 10 MiB, DOCX ограничивает число ZIP entries и uncompressed size, PDF ограничен страницами и запрещает encrypted. File path строится из user UUID и нового случайного имени, а не из имени файла; `TemplateOut` не возвращает путь. Загруженные файлы не доступны как статические URL.

Проверены traversal filename, MIME/signature mismatch и DOCX expanded-size guard. Фаззинг реальных DOCX/PDF парсеров, полноценные zip bomb corpora и runtime disk exhaustion не проводились.

## Payment Security

Тариф и сумма создаются backend-константами; поддельные `amount`, `status`, `user_id` в create request игнорируются. Test routes закрыты вне development + `PAYMENT_TEST_MODE`. В production mock webhook закрыт, payment create отвечает 503 до внедрения реального adapter.

Реальная webhook подпись/сверка amount/currency/payment state у внешнего провайдера не тестировалась: такого provider adapter нет. Не отправлялись реальные платежи. Перед запуском подключить provider-specific signature verification, amount/currency/merchant сверку, event idempotency и получать authoritative payment status у provider.

## AI Security

OpenRouter/Gemini зовутся только backend HTTP clients, key передаётся в Authorization/header, redirects отключены/не следуются, output ограничен 5000 tokens, timeout 90 секунд, retry ограничен. User prompt и template идут как данные сообщения `user`, не в system instruction; AI не имеет DB/API tools. Ответ валидируется `LessonContent` schema.

Local API key не найден во frontend source или собранном bundle после исправления примера. Запросы к реальному AI не выполнялись. AI prompt injection может влиять на содержание плана, но не даёт модели инструменты для чтения секретов.

## Secrets

`.env` и `.env.*` игнорируются Git; `.dockerignore` и `frontend/.dockerignore` исключают `.env`. После удаления значения `.env.example` exact-value scan не нашёл local credentials в app/frontend/tests/build/Docker/README. `GOOGLE_AI_API_KEY` всё ещё задан в локальном `.env` и совпадал с прежним примером; замените ключ у провайдера. Telegram/OpenRouter/payment provider secrets локально пусты. `.git` отсутствует — история и удалённые refs не проверены.

## Docker

Backend запускается как non-root `app`, frontend как `nginx` на 8080, frontend/backend/bot имеют read-only root filesystem, ограниченный `/tmp`, `cap_drop: ALL` и `no-new-privileges`. Postgres host ports нет; Compose app ports loopback-only. В app/bot не прокидывается superuser password. Содержимое `docker/postgres-init-app-user.sh` и runtime images не проверялись запуском из-за отсутствия Docker/Bash/psql.

## Dependencies

Frontend audit: `pnpm audit --prod --json` — 0 vulnerabilities/advisories, 5 production dependencies. Python dependency CVE scan — NOT TESTED (нет локального scanner). Python requirements не lockfile; зафиксируйте транзитивные версии и повторите `pip-audit`/аналог в CI. В production requirements удалён `pytest`.

## Rate Limiting

`/api/auth/telegram` ограничен 12 запросами/минуту, генерация и regenerate — 8 запросами/минуту на IP, API — 180/мин, upload — 10/мин. Есть per-user AI hourly count. Тест подтвердил 13-й auth запрос получает 429. Ограничения IP in-memory и не подходят для нескольких workers без shared storage; DB AI quota остаётся независимой.

## Business Logic

Одна бесплатная попытка расходуется на каждую AI generation, включая regenerate. Ошибка AI/рендеринга откатывает попытку. Активная подписка определяется backend из БД и даты. Fake amount/status/user_id при создании платежа не меняют сумму и статус. Payment state теперь может перейти только из pending в terminal status; повтор terminal события идемпотентен.

## Fixed Vulnerabilities

| ID | Исправление | Проверка после исправления |
|---|---|---|
| SEC-001 | Удалено непустое Google API key из `.env.example` | Exact credential scan source/build: совпадений нет; ключ требуется ротировать отдельно |
| SEC-002 | Отдельные PostgreSQL app/read-only bot роли; superuser env из backend/bot удалён | Compose YAML/static checks + SQLite Alembic upgrade; Postgres runtime NOT TESTED |
| SEC-003 | Одноразовый Telegram initData fingerprint | Повтор возвращает 401 |
| SEC-004 | Атомарное списание квоты и учёт regenerate | Параллельный SQLite race: 1×200 и 1×402 |
| SEC-005 | Потоковый request body cap | Chunked over-limit request возвращает 413 |
| SEC-006 | Запрет перехода из failed/cancelled в success | Failed/cancelled остаются terminal |

## Validation Performed

- `.\.venv\Scripts\python.exe -m pytest -q` — **36 passed** после исправлений. Перед исправлениями соответствующие локальные regression checks воспроизвели повторное использование Telegram `initData`, бесплатный regenerate, двойное списание одной квоты при параллельном SQLite запросе, возврат terminal payment state в success и обход лимита chunked body.
- `pnpm run build` — успешно.
- `pnpm audit --prod --json` — 0 advisories для 5 production dependencies.
- `alembic upgrade head` на отдельной временной SQLite базе — успешно, миграции 0001–0003.
- Compose YAML и статические проверки конфигурации/секретов — успешно. Docker, PostgreSQL client и Bash недоступны, поэтому контейнеры, nginx runtime и реальные PostgreSQL grants не проверялись.
- Production payment provider и его webhook не подключены; реальные платежи и внешние AI вызовы не выполнялись.

## Remaining Risks

1. Заменить Google AI key, который совпадал с прежним `.env.example`; действие от имени владельца провайдера не выполнялось.
2. На существующем PostgreSQL volume запустить роль bootstrap script вручную и проверить grants; Docker/psql runtime проверки нет.
3. Провести real PostgreSQL concurrency/webhook tests до запуска с production БД.
4. Реальный платёжный adapter/webhook не реализован; пока платежи — только тестовая симуляция.
5. Python dependency CVE scan и Git history scan не выполнены.
6. Подтвердить политику хранения и условия обработки пользовательских данных в выбранном AI provider; не включать персональные данные учеников в prompt/template.
7. Добавить shared rate limiter при deployment более чем с одним backend process/replica.

## Security Recommendations

- Немедленно отозвать прежний Google AI key и заменить значение в локальном `.env` и секретах CI/host.
- Для существующего PostgreSQL volume выполнить роль bootstrap вручную от старого superuser, затем проверить `ksp_app` без superuser и `ksp_bot` с SELECT только на нужные таблицы. Не удалять volume.
- Подключать только реальный payment adapter с подписью провайдера, сверкой суммы/валюты и event idempotency.
- Сгенерировать lockfile Python зависимостей, прогонять `pip-audit` и `pnpm audit` в CI.
- Добавить PostgreSQL concurrency и webhook integration tests на изолированной тестовой БД.
- Развернуть TLS на внешнем reverse proxy и проверить HSTS там; не публиковать API/frontend за HTTP.
- Масштабировать backend только после переноса IP rate buckets в shared backend.
- Установить правила хранения пользовательских шаблонов и AI provider data retention; публиковать понятное согласие на обработку.

## SECURITY STATUS

| Проверка | Результат |
|---|---|
| Telegram authentication | PASS |
| Authorization | PASS |
| IDOR | PASS |
| Admin security | PASS |
| Free generation bypass | PASS |
| Subscription bypass | PASS |
| Payment security | NOT TESTED |
| Webhook replay | PARTIAL — mock payment state transitions tested; provider webhook unavailable |
| File upload | PASS |
| Path traversal | PASS |
| SQL injection | PASS |
| XSS | PASS |
| CSRF | PASS |
| Rate limiting | PASS |
| Race conditions | PARTIAL — one free-credit race tested on SQLite; PostgreSQL and other races NOT TESTED |
| OpenRouter security | PASS |
| Secrets | FAIL — rotate candidate Google AI key; Git history unavailable |
| Docker security | NOT TESTED — static checks only, Docker unavailable |
| Dependencies | NOT TESTED — Python scanner unavailable; pnpm audit had 0 findings |

Итоговый статус: **HIGH RISK REMAINS** до ротации Google AI ключа. Docker/PostgreSQL и реальные payment/dependency integrations остаются непроверенными.
