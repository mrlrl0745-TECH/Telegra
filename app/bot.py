import asyncio
import logging
from datetime import datetime, timezone

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo
from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import LessonPlan, User

logger = logging.getLogger(__name__)
dp = Dispatcher()


def app_keyboard() -> InlineKeyboardMarkup | None:
    if not settings.app_url.startswith("https://"):
        return None
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Открыть КСП Генератор", web_app=WebAppInfo(url=settings.app_url))]])


@dp.message(Command("start"))
async def start(message: Message) -> None:
    await message.answer("Добро пожаловать в КСП Генератор!\n\nСоздавайте готовые поурочные планы за несколько минут.\n\nВам доступны 3 бесплатные генерации.", reply_markup=app_keyboard())


@dp.message(Command("help"))
async def help_command(message: Message) -> None:
    await message.answer("Откройте приложение кнопкой ниже, чтобы создать КСП, посмотреть тарифы и свои документы.", reply_markup=app_keyboard())


@dp.message(Command("profile"))
async def profile(message: Message) -> None:
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.telegram_user_id == message.from_user.id))
        if not user:
            await message.answer("Сначала откройте приложение и войдите через Telegram.", reply_markup=app_keyboard())
            return
        end = user.subscription_end
        if end and end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        active = user.subscription_status == "active" and end is not None and end > datetime.now(timezone.utc)
        status = f"Подписка активна до {end.astimezone(timezone.utc).strftime('%d.%m.%Y')}" if active else f"Бесплатных генераций: {user.free_generations}"
        await message.answer(f"Профиль КСП Генератора\nTelegram ID: {user.telegram_user_id}\n{status}", reply_markup=app_keyboard())


@dp.message(Command("tariff"))
async def tariff(message: Message) -> None:
    await message.answer("Бесплатно: 3 генерации\nМесяц: 750 ₸\nГод: 5500 ₸", reply_markup=app_keyboard())


@dp.message(Command("my_lessons"))
async def my_lessons(message: Message) -> None:
    async with SessionLocal() as session:
        user = await session.scalar(select(User).where(User.telegram_user_id == message.from_user.id))
        if not user:
            await message.answer("Откройте приложение, чтобы создать первый КСП.", reply_markup=app_keyboard())
            return
        plans = await session.scalars(select(LessonPlan).where(LessonPlan.user_id == user.id).order_by(LessonPlan.created_at.desc()).limit(10))
        items = [f"• {plan.topic} · {plan.grade} · {plan.lesson_date}" for plan in plans]
        text = "Ваши последние КСП:\n" + "\n".join(items) if items else "Пока нет сохранённых КСП. Создайте первый план в приложении."
        await message.answer(text, reply_markup=app_keyboard())


async def main() -> None:
    if not settings.telegram_bot_token:
        raise RuntimeError("Set TELEGRAM_BOT_TOKEN in .env before starting the bot")
    bot = Bot(settings.telegram_bot_token)
    try:
        await dp.start_polling(bot)
    finally:
        await bot.session.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
