from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Payment, Subscription, User

PRICES = {"monthly": 750, "yearly": 5500}


class PaymentService:
    async def create_payment(self, db: AsyncSession, user: User, tariff: str) -> Payment:
        if tariff not in PRICES:
            raise ValueError("Неизвестный тариф")
        payment = Payment(user_id=user.id, provider=settings.payment_provider, external_payment_id=f"test_{uuid4().hex}", amount=PRICES[tariff], currency="KZT", status="pending", tariff=tariff)
        db.add(payment)
        await db.flush()
        db.add(Subscription(user_id=user.id, type=tariff, status="pending", payment_id=payment.id))
        await db.commit()
        await db.refresh(payment)
        return payment

    async def check_payment(self, db: AsyncSession, payment: Payment) -> Payment:
        await db.refresh(payment)
        return payment

    async def process_webhook(self, db: AsyncSession, external_payment_id: str, status: str) -> Payment | None:
        if status not in {"pending", "success", "failed", "cancelled"}:
            raise ValueError("Недопустимый статус платежа")

        # Only pending payments may transition. A conditional update makes this
        # state machine atomic on PostgreSQL and SQLite and makes webhook replay safe.
        transitioned_id = await db.scalar(
            update(Payment)
            .where(Payment.external_payment_id == external_payment_id, Payment.status == "pending")
            .values(status=status)
            .returning(Payment.id)
        )
        payment = await db.scalar(select(Payment).where(Payment.id == transitioned_id)) if transitioned_id else await db.scalar(
            select(Payment).where(Payment.external_payment_id == external_payment_id)
        )
        if not payment:
            return None
        if status == "success":
            if transitioned_id is None:
                return payment
            await self.activate_subscription(db, payment)
        await db.commit()
        await db.refresh(payment)
        return payment

    async def activate_subscription(self, db: AsyncSession, payment: Payment) -> None:
        now = datetime.now(timezone.utc)
        end = now + (timedelta(days=365) if payment.tariff == "yearly" else timedelta(days=30))
        subscription = await db.scalar(select(Subscription).where(Subscription.payment_id == payment.id).with_for_update())
        if not subscription:
            subscription = Subscription(user_id=payment.user_id, type=payment.tariff, payment_id=payment.id)
            db.add(subscription)
        subscription.status = "active"
        subscription.start_date = now
        subscription.end_date = end
        user = await db.scalar(select(User).where(User.id == payment.user_id).with_for_update())
        if user:
            user.subscription_status = "active"
            user.subscription_type = payment.tariff
            user.subscription_start = now
            user.subscription_end = end


payment_service = PaymentService()
