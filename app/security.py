import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, utcnow

bearer = HTTPBearer(auto_error=False)


def validate_telegram_init_data(init_data: str, bot_token: str, max_age_seconds: int = 900) -> dict:
    pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    if len({key for key, _ in pairs}) != len(pairs):
        raise ValueError("Duplicate Telegram authentication fields")
    if not bot_token:
        raise ValueError("Telegram bot is not configured")
    values = dict(pairs)
    supplied_hash = values.pop("hash", None)
    if not supplied_hash:
        raise ValueError("Missing Telegram signature")
    check_string = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, supplied_hash):
        raise ValueError("Invalid Telegram signature")
    auth_date = int(values.get("auth_date", "0"))
    if auth_date <= 0 or time.time() - auth_date > max_age_seconds or auth_date - time.time() > 60:
        raise ValueError("Telegram login has expired")
    user = json.loads(values.get("user", "{}"))
    if not isinstance(user, dict) or not user.get("id"):
        raise ValueError("Telegram user is missing")
    return user


def telegram_init_data_fingerprint(init_data: str) -> str:
    """Hash canonical signed fields without storing the Telegram payload itself."""
    pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    if len({key for key, _ in pairs}) != len(pairs):
        raise ValueError("Duplicate Telegram authentication fields")
    values = dict(pairs)
    values.pop("hash", None)
    check_string = "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
    return hashlib.sha256(check_string.encode()).hexdigest()


def create_access_token(user_id: str) -> str:
    return jwt.encode({"sub": user_id, "iat": int(time.time()), "exp": int(time.time()) + 60 * 60 * 12}, settings.secret_key, algorithm="HS256")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")
    try:
        payload = jwt.decode(credentials.credentials, settings.secret_key, algorithms=["HS256"])
        user_id = payload.get("sub")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Сессия истекла. Откройте приложение заново.") from exc
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user or user.is_blocked:
        raise HTTPException(status_code=403, detail="Доступ к аккаунту ограничен")
    user.last_activity = utcnow()
    await db.commit()
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.telegram_user_id not in settings.admin_ids:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return user
