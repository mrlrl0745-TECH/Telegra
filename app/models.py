from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(128))
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str] = mapped_column(String(128), default="")
    language: Mapped[str] = mapped_column(String(8), default="ru")
    free_generations: Mapped[int] = mapped_column(Integer, default=3)
    subscription_status: Mapped[str] = mapped_column(String(16), default="inactive")
    subscription_type: Mapped[str | None] = mapped_column(String(16))
    subscription_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    subscription_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_activity: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    lessons: Mapped[list["LessonPlan"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    templates: Mapped[list["Template"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class TelegramAuthReplay(Base):
    __tablename__ = "telegram_auth_replays"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    data_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Template(Base):
    __tablename__ = "templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    file_path: Mapped[str] = mapped_column(String(512))
    file_type: Mapped[str] = mapped_column(String(16))
    template_structure: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user: Mapped[User] = relationship(back_populates="templates")
    fields: Mapped[list["TemplateField"]] = relationship(back_populates="template", cascade="all, delete-orphan")


class TemplateField(Base):
    __tablename__ = "template_fields"
    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"), index=True)
    field_key: Mapped[str] = mapped_column(String(80))
    label: Mapped[str] = mapped_column(String(160))
    position: Mapped[int] = mapped_column(Integer, default=0)
    template: Mapped[Template] = relationship(back_populates="fields")


class LessonPlan(Base):
    __tablename__ = "lesson_plans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    template_id: Mapped[str | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"))
    subject: Mapped[str] = mapped_column(String(160))
    section: Mapped[str] = mapped_column(String(300), default="")
    grade: Mapped[str] = mapped_column(String(40))
    topic: Mapped[str] = mapped_column(String(300))
    lesson_date: Mapped[str] = mapped_column(String(40), default="")
    teacher_name: Mapped[str] = mapped_column(String(200), default="")
    present_count: Mapped[int] = mapped_column(Integer, default=0)
    absent_count: Mapped[int] = mapped_column(Integer, default=0)
    learning_objectives: Mapped[list[str]] = mapped_column(JSON, default=list)
    lesson_objectives: Mapped[list[str]] = mapped_column(JSON, default=list)
    content_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    language: Mapped[str] = mapped_column(String(8), default="ru")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    user: Mapped[User] = relationship(back_populates="lessons")
    stages: Mapped[list["LessonStage"]] = relationship(back_populates="lesson", cascade="all, delete-orphan", order_by="LessonStage.position")


class LessonStage(Base):
    __tablename__ = "lesson_stages"
    id: Mapped[int] = mapped_column(primary_key=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lesson_plans.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    stage_name: Mapped[str] = mapped_column(String(160))
    time: Mapped[str] = mapped_column(String(40))
    teacher_actions: Mapped[str] = mapped_column(Text)
    student_actions: Mapped[str] = mapped_column(Text)
    resources: Mapped[str] = mapped_column(Text, default="")
    assessment: Mapped[str] = mapped_column(Text)
    lesson: Mapped[LessonPlan] = relationship(back_populates="stages")


class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id", use_alter=True, name="fk_subscription_payment"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), default="mock")
    external_payment_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(8), default="KZT")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    tariff: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class GenerationUsage(Base):
    __tablename__ = "generation_usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lesson_plans.id", ondelete="CASCADE"))
    was_free: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AIRequest(Base):
    __tablename__ = "ai_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    model: Mapped[str] = mapped_column(String(160), default="test")
    status: Mapped[str] = mapped_column(String(16))
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    cost: Mapped[float | None] = mapped_column(Numeric(12, 6))
    error_code: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
