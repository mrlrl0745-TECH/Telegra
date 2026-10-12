import json
import re
from typing import Any

from pydantic import ValidationError
from app.services.ai_service import generate_ai_response

from app.config import settings
from app.schemas import LessonContent, LessonInput
from app.services.ai_types import AIProviderError, AIResult
from app.services.google_ai_service import GoogleAIService
from app.services.openrouter_service import OpenRouterService


def get_ai_provider() -> GoogleAIService | OpenRouterService:
    if settings.ai_provider == "google":
        return GoogleAIService()
    return OpenRouterService()


def lesson_output_schema() -> dict[str, Any]:
    # Only pedagogical content is generated. Trusted metadata is restored locally.
    schema = LessonContent.model_json_schema()
    fields = {"title", "learning_objectives", "lesson_objectives", "stages", "homework", "reflection", "language_objectives", "differentiation_plan", "assessment_plan", "cross_curricular_links", "health_and_safety"}
    schema["properties"] = {key: value for key, value in schema["properties"].items() if key in fields}
    schema["required"] = list(schema["properties"])
    schema["properties"]["stages"].update(minItems=4, maxItems=5)
    schema["properties"]["reflection"]["description"] = "Инструкция для будущей рефлексии: 2 конкретных вопроса ученику. Урок ещё не состоялся; не утверждай, что ученики усвоили материал или успешно выполнили задания."
    schema["properties"]["homework"]["description"] = "Полные условия домашних упражнений и правильные ответы для педагога, без выдуманных номеров страниц учебника."
    return schema


class LessonGenerator:
    def __init__(self, provider: GoogleAIService | OpenRouterService | None = None) -> None:
        self.provider = provider or get_ai_provider()

    async def generate(self, lesson: LessonInput, template_structure: dict[str, Any] | None = None) -> AIResult:
        effective_topic = lesson.topic.strip() or (lesson.learning_objectives[0] if lesson.learning_objectives else "")
        effective_section = lesson.section.strip() or ("Көрсетілмеген" if lesson.language == "kk" else "Не указан")
        if settings.ai_test_mode:
            if settings.app_env == "production":
                raise AIProviderError("test_mode_not_allowed")
            return AIResult(data=self._sample(lesson, effective_topic, effective_section), model="test-mode")
        # The model does not need teacher identity or exact attendance metadata;
        # restore these trusted form values server-side after generation.
        payload = lesson.model_dump(exclude={"teacher_name", "lesson_date", "present_count", "absent_count"})
        payload["topic"] = effective_topic
        payload["section"] = effective_section
        payload["template_structure"] = template_structure or self.standard_structure()
        language_name = "казахском" if lesson.language == "kk" else "русском"
        system = (
            "Ты опытный учитель Казахстана. Подготовь полностью пригодный к проведению краткосрочный план урока "
            f"на {language_name} языке. Верни только один JSON-объект, без HTML, Markdown и пояснений. "
            "Если переданы официальные цели обучения, дословно сохрани их и не меняй коды. Никогда не выдумывай "
            "код цели. Если официальная цель не передана, сформулируй одну предметную ориентировочную цель "
            "простыми словами без кода и не называй её официальной. Создай измеримые цели урока, критерии и "
            "понятные дескрипторы. Каждый этап должен содержать конкретные действия учителя и учеников, "
            "готовое задание с точной инструкцией, формативную обратную связь, ресурсы и способ проверки. "
            "Для задач с проверяемым ответом укажи правильный ответ или ключ в действиях учителя/оценивании. "
            "Добавь посильную дифференциацию, рефлексию и домашнее задание, если они запрошены. "
            "Сложность и терминология должны соответствовать классу, предмету, теме и целям. "
            "Продолжительность этапов укажи целыми минутами; сумма должна точно равняться длительности урока. "
            "Не добавляй присутствие/отсутствие учеников в материал, который нужно отправить AI."
        )
        if lesson.substitute_mode:
            system += (
                " Режим учителя на замене: не предполагай, что учитель знает класс или предыдущие уроки. "
                "Распиши каждый шаг самостоятельно и недвусмысленно: что подготовить, что сказать/показать, "
                "какое задание выдать, сколько времени дать и как проверить ответ. Включи ключи ответов, "
                "чтобы план можно было провести без дополнительной подготовки."
            )
        system += " Составь 4–5 этапов, общий объём 450–650 слов. Пиши компактно: конкретные задания и ответы вместо повторов и общих фраз. Не создавай дополнительные поля вне схемы. Для дифференциации и домашней работы укажи сами упражнения с ответами; не пиши «дать дополнительное задание» без его содержания."
        system += " Это план будущего урока, не отчёт о проведённом. Рефлексия — только вопросы/инструкции, без утверждений об успехах учеников. Используй формативное оценивание с конкретными дескрипторами, не объявляй суммативное оценивание. Проверь вычисления и единицы: единица скорости СИ — м/с; км/ч вне СИ."
        if lesson.differentiation:
            system += " Дифференциация обязательна в практическом этапе: укажи конкретную подсказку для поддержки и одно полностью сформулированное усложнённое задание с ответом."
        system += " Объединённый шаблон: language_objectives — термины и одна речевая конструкция; differentiation_plan — краткие способы поддержки и усложнения; assessment_plan — проверяемые критерии; cross_curricular_links — конкретная связь с другим предметом; health_and_safety — правила для запланированных действий. Каждый дополнительный блок — 1–2 предложения, общий объём ответа не увеличивай. Цели урока сформулируй для всех, большинства и некоторых учащихся, если пользователь не задал свои. Не выдумывай школу или организацию."
        schema = lesson_output_schema()
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        def validate_result(result: AIResult) -> AIResult:
            if not isinstance(result.data, dict):
                raise AIProviderError("invalid_schema")
            data = dict(result.data)
            data.update({
                "section": effective_section, "teacher_name": lesson.teacher_name,
                "date": lesson.lesson_date, "subject": lesson.subject, "class_name": lesson.grade,
                "present_count": lesson.present_count, "absent_count": lesson.absent_count,
                "lesson_topic": effective_topic, "lesson_duration": lesson.lesson_duration,
                "substitute_mode": lesson.substitute_mode, "language": lesson.language,
            })
            if lesson.learning_objectives:
                data["learning_objectives"] = lesson.learning_objectives
            if lesson.lesson_objectives:
                data["lesson_objectives"] = lesson.lesson_objectives
            if not lesson.homework_required:
                data["homework"] = ""
            if not lesson.reflection_required:
                data["reflection"] = ""
            try:
                content = LessonContent.model_validate(data)
            except ValidationError as exc:
                raise AIProviderError("invalid_schema") from exc
            self.normalize_stage_times(content, lesson.lesson_duration)
            result.data = content.model_dump()
            return result

        # Injected providers keep the same interface; production requests have one deadline.
        if not isinstance(self.provider, (GoogleAIService, OpenRouterService)):
            return validate_result(await self.provider.generate_json(messages))
        return await generate_ai_response(
            messages, response_schema=schema, validate=validate_result,
            google_service=self.provider if isinstance(self.provider, GoogleAIService) else None,
            openrouter_service=self.provider if isinstance(self.provider, OpenRouterService) else None,
        )

    @staticmethod
    def standard_structure() -> dict[str, Any]:
        return {
            "sections": ["Школа / организация", "Предмет", "Раздел", "ФИО педагога", "Дата", "Класс", "Количество присутствующих", "Количество отсутствующих", "Тема урока", "Цели обучения в соответствии с учебной программой", "Цели урока", "Языковые цели", "Дифференциация", "Оценивание", "Межпредметные связи", "Здоровье и безопасность", "Домашнее задание", "Рефлексия"],
            "tables": [{"title": "Ход урока", "columns": ["Этап урока/время", "Действия педагога", "Действия ученика", "Ресурсы", "Оценивание"]}],
        }

    @staticmethod
    def _sample(lesson: LessonInput, effective_topic: str = "", effective_section: str = "") -> dict[str, Any]:
        kk = lesson.language == "kk"
        effective_topic = effective_topic or lesson.topic.strip() or (lesson.learning_objectives[0] if lesson.learning_objectives else "")
        effective_section = effective_section or lesson.section.strip() or ("Көрсетілмеген" if kk else "Не указан")
        weights = [3, 7, 15, 12, 8]
        stage_minutes = [max(1, lesson.lesson_duration * weight // sum(weights)) for weight in weights[:4]]
        stage_minutes.append(max(1, lesson.lesson_duration - sum(stage_minutes)))
        stages = [
            ("Ұйымдастыру кезеңі" if kk else "Организационный момент", stage_minutes[0],
             "Сәлемдесіп, сабақтың мақсаты мен жұмыс тәртібін хабарлайды." if kk else "Приветствует класс, сообщает цель урока и порядок работы.",
             "Сабаққа дайындалып, оқу мақсатын тыңдайды." if kk else "Готовятся к уроку, слушают цель занятия.",
             "Слайд, тақта" if kk else "Слайд, доска", "Дайындықты бақылау" if kk else "Наблюдение за готовностью класса"),
            ("Білімді өзектендіру" if kk else "Актуализация знаний", stage_minutes[1],
             f"{effective_topic} тақырыбына байланысты қысқа сұрақтар қойып, бастапқы түсініктерді анықтайды." if kk else f"Задает короткие вопросы по теме «{effective_topic}», выявляет исходные представления.",
             "Сұрақтарға жауап беріп, бұрынғы білімін мысалмен байланыстырады." if kk else "Отвечают на вопросы и связывают предыдущие знания с примерами.",
             "Сұрақтар картасы" if kk else "Карточки с вопросами", "Жауаптардың дәлдігін ауызша кері байланыспен бағалайды" if kk else "Устная обратная связь по точности ответов"),
            ("Жаңа материалмен жұмыс" if kk else "Изучение нового материала", stage_minutes[2],
             f"{(lesson.learning_objectives or [effective_topic])[0]} мақсатына сай түсіндіру мен үлгі көрсетеді." if kk else f"Объясняет материал и показывает пример по теме: {(lesson.learning_objectives or [effective_topic])[0]}.",
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
            "section": effective_section, "teacher_name": lesson.teacher_name, "date": lesson.lesson_date,
            "subject": lesson.subject, "class_name": lesson.grade, "present_count": lesson.present_count,
            "absent_count": lesson.absent_count, "lesson_topic": effective_topic, "lesson_duration": lesson.lesson_duration,
            "substitute_mode": lesson.substitute_mode,
            "learning_objectives": lesson.learning_objectives or ([f"Учебная цель по теме «{effective_topic}» без кода" if not kk else f"{effective_topic} тақырыбы бойынша кодсыз оқу мақсаты"]),
            "lesson_objectives": lesson.lesson_objectives or ([f"Объяснять и применять ключевые знания по теме «{effective_topic}»." if not kk else f"{effective_topic} тақырыбы бойынша негізгі білімді түсіндіріп, қолдану."]),
            "stages": [{"stage_name": n, "time": f"{t} минут", "teacher_actions": a, "student_actions": b, "resources": r, "assessment": c} for n, t, a, b, r, c in stages],
            "homework": ("Тақырып бойынша бір бекіту тапсырмасын орындау." if kk else "Выполнить одно закрепляющее задание по теме.") if lesson.homework_required else "",
            "reflection": ("Сабақ бойынша қысқа рефлексия." if kk else "Краткая рефлексия по уроку.") if lesson.reflection_required else "",
        }

    @staticmethod
    def normalize_stage_times(content: LessonContent, duration: int) -> None:
        """Keep AI-produced stage proportions while enforcing the requested lesson length."""
        raw_minutes: list[int] = []
        for stage in content.stages:
            values = [int(value) for value in re.findall(r"\d+", stage.time)]
            minutes = values[-1] - values[0] if len(values) >= 2 and values[-1] > values[0] else (values[0] if values else 1)
            raw_minutes.append(max(1, minutes))
        if sum(raw_minutes) == duration:
            return
        remaining = duration - len(content.stages)
        weight_total = sum(raw_minutes) or len(raw_minutes)
        shares = [remaining * value / weight_total for value in raw_minutes]
        allocated = [1 + int(value) for value in shares]
        leftover = duration - sum(allocated)
        order = sorted(range(len(shares)), key=lambda index: shares[index] - int(shares[index]), reverse=True)
        for index in order[:leftover]:
            allocated[index] += 1
        for stage, minutes in zip(content.stages, allocated):
            stage.time = f"{minutes} минут"
