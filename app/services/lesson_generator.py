import json
import asyncio
from typing import Any

from pydantic import ValidationError

from app.config import settings
from app.schemas import LessonContent, LessonInput
from app.services.ai_types import AIProviderError, AIResult
from app.services.google_ai_service import GoogleAIService
from app.services.openrouter_service import OpenRouterService


def get_ai_provider() -> GoogleAIService | OpenRouterService:
    if settings.ai_provider == "google":
        return GoogleAIService()
    return OpenRouterService()


class LessonGenerator:
    def __init__(self, provider: GoogleAIService | OpenRouterService | None = None) -> None:
        self.provider = provider or get_ai_provider()

    async def generate(self, lesson: LessonInput, template_structure: dict[str, Any] | None = None) -> AIResult:
        if settings.ai_test_mode:
            if settings.app_env == "production":
                raise AIProviderError("test_mode_not_allowed")
            return AIResult(data=self._sample(lesson), model="test-mode")
        # The model does not need teacher identity or exact attendance metadata;
        # restore these trusted form values server-side after generation.
        payload = lesson.model_dump(exclude={"teacher_name", "lesson_date", "present_count", "absent_count"})
        payload["template_structure"] = template_structure or self.standard_structure()
        language_name = "казахском" if lesson.language == "kk" else "русском"
        system = (
            "Ты опытный педагог Казахстана. Создай качественный краткосрочный план урока. "
            f"Пиши на {language_name} языке. Верни только JSON по заданной структуре. "
            "Не добавляй HTML, Markdown или пояснения. Используй переданные цели обучения без изменения. "
            "У каждого этапа должны быть время, связанные действия учителя и ученика и критерий оценивания. "
            "Суммарное время этапов должно соответствовать длительности урока."
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        last: Exception | None = None
        for attempt in range(2):
            try:
                result = await self.provider.generate_json(messages)
            except AIProviderError as exc:
                if attempt or exc.code not in {"timeout", "unavailable", "rate_limit", "provider_unavailable"}:
                    raise
                await asyncio.sleep(0.5 if exc.code != "rate_limit" else 1.0)
                continue
            try:
                if isinstance(result.data, dict):
                    result.data.update({
                        "section": lesson.section,
                        "teacher_name": lesson.teacher_name,
                        "date": lesson.lesson_date,
                        "subject": lesson.subject,
                        "class_name": lesson.grade,
                        "present_count": lesson.present_count,
                        "absent_count": lesson.absent_count,
                        "lesson_topic": lesson.topic,
                        "learning_objectives": lesson.learning_objectives,
                        "lesson_objectives": lesson.lesson_objectives,
                        "language": lesson.language,
                    })
                content = LessonContent.model_validate(result.data)
                # Programme objectives are source material and must stay verbatim.
                result.data = content.model_dump()
                return result
            except ValidationError as exc:
                last = exc
                if attempt:
                    break
                messages.extend([
                    {"role": "assistant", "content": json.dumps(result.data, ensure_ascii=False)},
                    {"role": "user", "content": f"Исправь JSON по схеме. Ошибки: {str(exc)[:1500]}. Верни только JSON."},
                ])
        raise AIProviderError("invalid_schema", str(last or "Invalid generated KSP"))

    @staticmethod
    def standard_structure() -> dict[str, Any]:
        return {
            "sections": ["Раздел", "ФИО педагога", "Дата", "Класс", "Количество присутствующих", "Количество отсутствующих", "Тема урока", "Цели обучения в соответствии с учебной программой", "Цели урока"],
            "tables": [{"title": "Ход урока", "columns": ["Этап урока/время", "Действия педагога", "Действия ученика", "Ресурсы", "Оценивание"]}],
        }

    @staticmethod
    def _sample(lesson: LessonInput) -> dict[str, Any]:
        kk = lesson.language == "kk"
        weights = [3, 7, 15, 12, 8]
        stage_minutes = [max(1, lesson.lesson_duration * weight // sum(weights)) for weight in weights[:4]]
        stage_minutes.append(max(1, lesson.lesson_duration - sum(stage_minutes)))
        stages = [
            ("Ұйымдастыру кезеңі" if kk else "Организационный момент", stage_minutes[0],
             "Сәлемдесіп, сабақтың мақсаты мен жұмыс тәртібін хабарлайды." if kk else "Приветствует класс, сообщает цель урока и порядок работы.",
             "Сабаққа дайындалып, оқу мақсатын тыңдайды." if kk else "Готовятся к уроку, слушают цель занятия.",
             "Слайд, тақта" if kk else "Слайд, доска", "Дайындықты бақылау" if kk else "Наблюдение за готовностью класса"),
            ("Білімді өзектендіру" if kk else "Актуализация знаний", stage_minutes[1],
             f"{lesson.topic} тақырыбына байланысты қысқа сұрақтар қойып, бастапқы түсініктерді анықтайды." if kk else f"Задает короткие вопросы по теме «{lesson.topic}», выявляет исходные представления.",
             "Сұрақтарға жауап беріп, бұрынғы білімін мысалмен байланыстырады." if kk else "Отвечают на вопросы и связывают предыдущие знания с примерами.",
             "Сұрақтар картасы" if kk else "Карточки с вопросами", "Жауаптардың дәлдігін ауызша кері байланыспен бағалайды" if kk else "Устная обратная связь по точности ответов"),
            ("Жаңа материалмен жұмыс" if kk else "Изучение нового материала", stage_minutes[2],
             f"{lesson.learning_objectives[0]} мақсатына сай түсіндіру мен үлгі көрсетеді." if kk else f"Объясняет материал и показывает пример в соответствии с целью: {lesson.learning_objectives[0]}.",
             "Үлгіні талдап, негізгі қадамдарды дәптерге жазады." if kk else "Анализируют пример и записывают ключевые шаги в тетрадь.",
             "Оқулық, презентация" if kk else "Учебник, презентация", "Нақтылау сұрақтары мен жауап үлгісі" if kk else "Уточняющие вопросы и проверка ответа по образцу"),
            ("Тәжірибелік тапсырма" if kk else "Практическое задание", stage_minutes[3],
             "Тапсырманы түсіндіріп, орындау кезінде бағыттаушы сұрақтар қояды." if kk else "Объясняет задание и задает наводящие вопросы во время выполнения.",
             "Тапсырманы жеке немесе жұппен орындайды, шешу жолын түсіндіреді." if kk else "Выполняют задание индивидуально или в паре, поясняют способ решения.",
             "Жұмыс парағы" if kk else "Рабочий лист", "Бағалау критерийі бойынша өзін-өзі тексеру" if kk else "Самопроверка по критериям задания"),
            ("Қорытынды және рефлексия" if kk else "Итог и рефлексия", stage_minutes[4],
             "Негізгі ойларды жинақтап, рефлексия жүргізеді." if kk else "Подводит итог по ключевым понятиям и проводит рефлексию.",
             "Бір жетістігін және келесі қадамды атайды." if kk else "Называют одно достижение и следующий шаг.",
             "Рефлексия парағы" if kk else "Лист рефлексии", "Өзін-өзі бағалау" if kk else "Самооценка по цели урока"),
        ]
        return {
            "title": "Қысқа мерзімді (сабақ) жоспары" if kk else "Краткосрочный (поурочный) план",
            "language": lesson.language,
            "section": lesson.section, "teacher_name": lesson.teacher_name, "date": lesson.lesson_date,
            "subject": lesson.subject, "class_name": lesson.grade, "present_count": lesson.present_count,
            "absent_count": lesson.absent_count, "lesson_topic": lesson.topic,
            "learning_objectives": lesson.learning_objectives, "lesson_objectives": lesson.lesson_objectives,
            "stages": [{"stage_name": n, "time": f"{t} минут", "teacher_actions": a, "student_actions": b, "resources": r, "assessment": c} for n, t, a, b, r, c in stages],
            "homework": ("Тақырып бойынша бір бекіту тапсырмасын орындау." if kk else "Выполнить одно закрепляющее задание по теме.") if lesson.homework_required else "",
            "reflection": ("Сабақ бойынша қысқа рефлексия." if kk else "Краткая рефлексия по уроку.") if lesson.reflection_required else "",
        }
