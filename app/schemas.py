from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UserOut(BaseModel):
    id: str
    telegram_user_id: int
    username: str | None
    first_name: str
    last_name: str
    language: str
    free_generations: int
    subscription_status: str
    subscription_type: str | None
    subscription_end: datetime | None
    is_blocked: bool
    is_admin: bool = False

    model_config = ConfigDict(from_attributes=True)


class TelegramAuthIn(BaseModel):
    init_data: str = Field(min_length=1, max_length=10000)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class TeacherProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=3, max_length=200)
    classes: list[str] = Field(min_length=1, max_length=20)
    subjects: list[str] = Field(min_length=1, max_length=30)

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 3:
            raise ValueError("Укажите ФИО полностью")
        return value

    @field_validator("classes", "subjects")
    @classmethod
    def clean_items(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw_value in values:
            value = " ".join(raw_value.split())
            if not value or len(value) > 80:
                raise ValueError("Каждое значение должно содержать от 1 до 80 символов")
            key = value.casefold()
            if key not in seen:
                seen.add(key)
                cleaned.append(value)
        if not cleaned:
            raise ValueError("Добавьте хотя бы одно значение")
        return cleaned


class TeacherProfileOut(BaseModel):
    user_id: str
    full_name: str
    classes: list[str]
    subjects: list[str]

    model_config = ConfigDict(from_attributes=True)


class LessonInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    teacher_name: str = Field(default="Учитель на замене", min_length=2, max_length=200)
    lesson_date: str = Field(default_factory=lambda: date.today().isoformat(), min_length=1, max_length=40)
    subject: str = Field(min_length=2, max_length=160)
    section: str = Field(default="", max_length=300)
    grade: str = Field(min_length=1, max_length=40)
    present_count: int = Field(default=0, ge=0, le=1000)
    absent_count: int = Field(default=0, ge=0, le=1000)
    topic: str = Field(default="", max_length=300)
    learning_objectives: list[str] = Field(default_factory=list, max_length=10)
    lesson_objectives: list[str] = Field(default_factory=list, max_length=10)
    lesson_duration: int = Field(default=45, ge=20, le=120)
    lesson_type: str = Field(default="Комбинированный урок", max_length=100)
    class_level: str = Field(default="Средний", max_length=100)
    students_count: int = Field(default=0, ge=0, le=1000)
    language: Literal["ru", "kk"] = "ru"
    difficulty: str = Field(default="Средний", max_length=100)
    work_formats: list[str] = Field(default_factory=list, max_length=12)
    pair_work: bool = False
    group_work: bool = False
    individual_work: bool = True
    differentiation: bool = False
    homework_required: bool = True
    reflection_required: bool = True
    interactive_tasks: bool = False
    substitute_mode: bool = False
    additional_requirements: str = Field(default="", max_length=3000)
    template_id: str | None = None

    @field_validator("learning_objectives", "lesson_objectives")
    @classmethod
    def clean_objectives(cls, values: list[str]) -> list[str]:
        return [value.strip()[:500] for value in values if value.strip()]

    @model_validator(mode="after")
    def require_topic_or_learning_objective(self):
        if not self.topic.strip() and not self.learning_objectives:
            raise ValueError("Укажите тему урока или цель обучения")
        return self


class LessonStageOut(BaseModel):
    stage_name: str = Field(min_length=1, max_length=160)
    time: str = Field(min_length=1, max_length=40)
    teacher_actions: str = Field(min_length=1, max_length=5000)
    student_actions: str = Field(min_length=1, max_length=5000)
    resources: str = Field(min_length=1, max_length=2000)
    assessment: str = Field(min_length=1, max_length=3000)


class LessonContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="Краткосрочный (поурочный) план", max_length=160)
    language: Literal["ru", "kk"] = "ru"
    section: str = Field(min_length=1, max_length=300)
    teacher_name: str = Field(min_length=1, max_length=200)
    date: str = Field(min_length=1, max_length=40)
    subject: str = Field(min_length=1, max_length=160)
    class_name: str = Field(min_length=1, max_length=40)
    present_count: int = Field(ge=0, le=1000)
    absent_count: int = Field(ge=0, le=1000)
    lesson_topic: str = Field(min_length=1, max_length=300)
    lesson_duration: int = Field(default=45, ge=20, le=120)
    substitute_mode: bool = False
    learning_objectives: list[str] = Field(min_length=1, max_length=10)
    lesson_objectives: list[str] = Field(min_length=1, max_length=10)
    stages: list[LessonStageOut] = Field(min_length=2, max_length=14)
    homework: str = Field(default="", max_length=5000)
    reflection: str = Field(default="", max_length=5000)

    @field_validator("learning_objectives", "lesson_objectives")
    @classmethod
    def validate_content_objectives(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value) > 500 for value in values):
            raise ValueError("Each objective must contain 1 to 500 characters")
        return [value.strip() for value in values]


class LessonOut(BaseModel):
    id: str
    subject: str
    section: str
    grade: str
    topic: str
    lesson_date: str
    teacher_name: str
    present_count: int
    absent_count: int
    learning_objectives: list[str]
    lesson_objectives: list[str]
    content_json: LessonContent
    language: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TemplateOut(BaseModel):
    id: str
    name: str
    file_type: str
    template_structure: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaymentCreateIn(BaseModel):
    tariff: Literal["monthly", "yearly"]


class PaymentOut(BaseModel):
    id: str
    external_payment_id: str
    amount: int
    currency: str
    status: str
    tariff: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminCreditsIn(BaseModel):
    amount: int = Field(ge=1, le=1000)


class AdminBlockIn(BaseModel):
    blocked: bool


class AdminSubscriptionIn(BaseModel):
    type: Literal["monthly", "yearly"]
    days: int | None = Field(default=None, ge=1, le=3660)

