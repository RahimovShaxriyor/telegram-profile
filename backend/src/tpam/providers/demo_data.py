"""Deterministic demo dataset. Every entity here is fictional and only used in demo mode."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from tpam.models import Account, ChatKind, Media, Message, Participant

ME = Account(
    id=100000001,
    first_name="Демо",
    last_name="Пользователь",
    username="demo_user",
    phone_masked="+998 ** *** ** 01",
    is_premium=False,
)


@dataclass
class DemoChat:
    id: int
    title: str
    kind: ChatKind
    username: str | None = None
    about: str | None = None
    members: list[Participant] = field(default_factory=list)
    members_count: int | None = None
    members_hidden: bool = False
    is_creator: bool = False
    is_admin: bool = False
    can_send: bool = True
    can_post: bool = False
    pinned: bool = False
    unread: int = 0
    messages: list[Message] = field(default_factory=list)
    scheduled: list[Message] = field(default_factory=list)
    peer_is_bot: bool = False


def _p(
    pid: int,
    name: str,
    username: str | None = None,
    role: str = "member",
    bot: bool = False,
) -> Participant:
    return Participant(id=pid, name=name, username=username, role=role, is_bot=bot)


ANNA = _p(2001, "Анна Смирнова", "anna_smirnova")
DMITRY = _p(2002, "Дмитрий Козлов", "dkozlov")
MARIA = _p(2003, "Мария Иванова")
ALEXEY = _p(2004, "Алексей Петров", "alex_petrov")
ELENA = _p(2005, "Елена Орлова")
SERGEY = _p(2006, "Сергей Волков", "svolkov")
WEATHER_BOT = _p(2100, "Погода Бот", "demo_weather_bot", bot=True)
ME_P = _p(ME.id, "Демо Пользователь", ME.username)

PRIVATE_SCRIPTS: dict[int, list[tuple[bool, str]]] = {
    ANNA.id: [
        (False, "Привет! Ты сегодня будешь на созвоне в 15:00?"),
        (True, "Привет, да, буду. Подготовлю короткий отчёт по задачам."),
        (False, "Отлично. Захвати, пожалуйста, цифры по релизу."),
        (True, "Хорошо, пришлю таблицу заранее."),
        (False, "Спасибо! И ещё вопрос: дизайн новой страницы уже согласовали?"),
        (True, "Почти. Остались правки по мобильной версии."),
        (False, "Понятно, тогда обсудим на встрече 👍"),
        (False, "Кстати, перенесли созвон на 15:30"),
    ],
    DMITRY.id: [
        (False, "Скинь, пожалуйста, ссылку на документацию по API"),
        (True, "Держи: https://core.telegram.org/api"),
        (False, "Спасибо, посмотрю вечером"),
        (True, "Если будут вопросы по авторизации — пиши"),
        (False, "Обязательно. Там же есть про двухэтапную проверку?"),
        (True, "Да, раздел про SRP и пароль 2FA"),
    ],
    MARIA.id: [
        (True, "Мария, добрый день! Получили ваши документы."),
        (False, "Добрый день! Отлично, а когда будет ответ?"),
        (True, "Обычно в течение двух рабочих дней."),
        (False, "Хорошо, буду ждать. Спасибо!"),
    ],
    ALEXEY.id: [
        (False, "Го в субботу на велопрогулку?"),
        (True, "Давай! Во сколько?"),
        (False, "В 10 у парка. Возьми воду, будет жарко ☀️"),
        (True, "Договорились"),
        (False, "Если пойдёт дождь — перенесём на воскресенье"),
    ],
    ELENA.id: [
        (False, "Спасибо за помощь с презентацией!"),
        (True, "Пожалуйста! Рад, что пригодилось."),
    ],
    SERGEY.id: [
        (False, "Ты не видел мою зарядку? Кажется, оставил в переговорке"),
        (True, "Видел, она у администратора на ресепшене"),
        (False, "Ты лучший 🙏"),
    ],
    WEATHER_BOT.id: [
        (True, "/start"),
        (False, "Здравствуйте! Я демо-бот погоды. Напишите название города."),
        (True, "Ташкент"),
        (False, "Ташкент: +24°C, ясно, ветер 3 м/с."),
    ],
}

TEAM_LINES = [
    "Доброе утро! Напоминаю про стендап в 10:00",
    "Выкатил фикс для экрана авторизации, проверьте на стейдже",
    "Нашёл баг: при медленном интернете не показывается скелетон",
    "Завёл задачу в трекере",
    "Кто может посмотреть ревью до обеда?",
    "Могу я, скинь ссылку",
    "Метрики за неделю выглядят хорошо, конверсия +4%",
    "Обновил макеты в Figma",
    "Давайте обсудим приоритеты на следующий спринт",
    "Релиз переносим на четверг",
    "Тесты зелёные ✅",
    "Добавил описание в README",
    "Кто дежурит на выходных?",
    "Я дежурю",
    "Спасибо всем за спринт! 🎉",
]

COMMUNITY_LINES = [
    "Подскажите, какой ORM сейчас лучше для async?",
    "SQLAlchemy 2.0 отлично работает с asyncio",
    "А кто пробовал uv вместо pip?",
    "Перешли на uv всей командой, установка в разы быстрее",
    "Митап в эту пятницу, регистрация по ссылке в закрепе",
    "Будет ли запись докладов?",
    "Да, выложим на канал через неделю",
    "Кто-нибудь использует pytest-asyncio 1.x?",
    "Да, режим auto очень удобен",
    "Ищем Python-разработчика в команду, пишите в личку",
    "Напоминаю правила чата: без рекламы и спама",
    "Отличный доклад был про типизацию!",
]

FAMILY_LINES = [
    "Кто заберёт хлеб по дороге домой?",
    "Я заберу",
    "Ужин в 19:00, не опаздывайте 🙂",
    "Бабушка просила позвонить вечером",
    "Позвоню после работы",
    "Купите, пожалуйста, молоко",
]

BLOG_POSTS = [
    "Почему я перешёл на асинхронный Python и что из этого вышло. Делюсь опытом и граблями.",
    "Пять привычек, которые помогают писать чистый код без фанатизма.",
    "Как устроена авторизация в Telegram: коротко о MTProto, сессиях и 2FA.",
    "SQLite — недооценённая база данных для локальных приложений. Разбираемся почему.",
    "Заметки с конференции: что запомнилось и что стоит попробовать.",
    "Тестирование без боли: моки, фейки и где проходит граница.",
]

NEWS_POSTS = [
    "Вышла новая версия Python с улучшениями производительности интерпретатора.",
    "Исследование: 68% разработчиков используют ИИ-ассистентов в ежедневной работе.",
    "Крупное обновление популярного фреймворка добавляет поддержку серверных компонентов.",
    "Эксперты обсуждают будущее локальных приложений и приватности данных.",
    "Новый стандарт веб-доступности опубликован в финальной редакции.",
    "Рынок облачных сервисов вырос на 18% за год.",
    "Как изменились требования к Backend-разработчикам: обзор вакансий.",
    "Открытый проект набрал 100 тысяч звёзд на GitHub.",
]

NOTES_POSTS = [
    "Мысль дня: простое решение, которое работает, лучше сложного, которое когда-нибудь заработает.",
    "Список книг на осень: архитектура, тестирование, немного художественной литературы.",
    "Короткое напоминание себе: делать перерывы каждые 90 минут.",
]


def build_demo_chats(now: datetime | None = None) -> dict[int, DemoChat]:
    now = (now or datetime.now(UTC)).replace(microsecond=0)
    rng = random.Random(42)
    chats: list[DemoChat] = []

    def private(person: Participant, *, minutes_ago: int, unread: int = 0, pinned: bool = False) -> DemoChat:
        chat = DemoChat(
            id=person.id,
            title=person.name,
            kind="bot" if person.is_bot else "user",
            username=person.username,
            about="Демо-бот погоды" if person.is_bot else None,
            pinned=pinned,
            unread=unread,
            peer_is_bot=person.is_bot,
            members=[person, ME_P],
        )
        script = PRIVATE_SCRIPTS[person.id]
        start = now - timedelta(minutes=minutes_ago + 7 * (len(script) - 1))
        for i, (out, text) in enumerate(script):
            sender = ME_P if out else person
            chat.messages.append(_msg(chat.id, i + 1, start + timedelta(minutes=7 * i), text, out, sender))
        return chat

    chats += [
        private(ANNA, minutes_ago=4, unread=2, pinned=True),
        private(DMITRY, minutes_ago=55),
        private(MARIA, minutes_ago=60 * 5),
        private(ALEXEY, minutes_ago=60 * 26, unread=1),
        private(ELENA, minutes_ago=60 * 50),
        private(SERGEY, minutes_ago=60 * 24 * 4),
        private(WEATHER_BOT, minutes_ago=60 * 8),
    ]

    def group(
        chat_id: int,
        title: str,
        kind: ChatKind,
        members: list[Participant],
        lines: list[str],
        count: int,
        *,
        minutes_ago: int,
        step_minutes: int,
        **kwargs: object,
    ) -> DemoChat:
        chat = DemoChat(id=chat_id, title=title, kind=kind, members=members, **kwargs)  # type: ignore[arg-type]
        start = now - timedelta(minutes=minutes_ago + step_minutes * (count - 1))
        for i in range(count):
            sender = rng.choice(members)
            text = lines[i % len(lines)]
            chat.messages.append(
                _msg(
                    chat.id,
                    i + 1,
                    start + timedelta(minutes=step_minutes * i),
                    text,
                    sender.id == ME.id,
                    sender,
                )
            )
        return chat

    team_members = [
        _p(ME.id, ME_P.name, ME.username, role="admin"),
        _p(ANNA.id, ANNA.name, ANNA.username, role="creator"),
        DMITRY,
        ELENA,
        SERGEY,
        *[
            _p(3000 + i, name)
            for i, name in enumerate(
                [
                    "Ольга Новикова",
                    "Игорь Морозов",
                    "Наталья Белова",
                    "Павел Соколов",
                    "Ирина Лебедева",
                    "Артём Зайцев",
                    "Виктория Павлова",
                    "Никита Семёнов",
                    "Юлия Голубева",
                    "Роман Виноградов",
                    "Ксения Богданова",
                    "Максим Воробьёв",
                    "Татьяна Фёдорова",
                    "Кирилл Михайлов",
                    "Алина Беляева",
                    "Георгий Тарасов",
                    "Светлана Белоусова",
                    "Олег Комаров",
                    "Дарья Орехова",
                ]
            )
        ],
    ]
    chats.append(
        group(
            -1001500000001,
            "Команда продукта",
            "supergroup",
            team_members,
            TEAM_LINES,
            140,
            minutes_ago=12,
            step_minutes=37,
            about="Рабочий чат продуктовой команды. Демо-данные.",
            members_count=len(team_members),
            is_admin=True,
            unread=5,
        )
    )
    community_members = [
        ANNA,
        DMITRY,
        ALEXEY,
        SERGEY,
        ME_P,
        *[_p(4000 + i, f"Участник {i + 1}") for i in range(10)],
    ]
    chats.append(
        group(
            -1001500000002,
            "Python Ташкент",
            "supergroup",
            community_members,
            COMMUNITY_LINES,
            90,
            minutes_ago=90,
            step_minutes=53,
            username="python_tashkent_demo",
            about="Сообщество Python-разработчиков (демо). Список участников скрыт администраторами.",
            members_count=1842,
            members_hidden=True,
            unread=17,
        )
    )
    family_members = [
        _p(ME.id, ME_P.name, ME.username, role="creator"),
        MARIA,
        ELENA,
        _p(5001, "Мама"),
        _p(5002, "Папа"),
    ]
    chats.append(
        group(
            -5000001,
            "Семья",
            "group",
            family_members,
            FAMILY_LINES,
            24,
            minutes_ago=60 * 3,
            step_minutes=180,
            members_count=5,
            is_creator=True,
            is_admin=True,
        )
    )

    def channel(
        chat_id: int,
        title: str,
        posts: list[str],
        *,
        minutes_ago: int,
        step_hours: int,
        base_views: int,
        **kwargs: object,
    ) -> DemoChat:
        chat = DemoChat(id=chat_id, title=title, kind="channel", **kwargs)  # type: ignore[arg-type]
        chat.can_send = chat.can_post
        count = len(posts) * 3
        start = now - timedelta(minutes=minutes_ago) - timedelta(hours=step_hours * (count - 1))
        for i in range(count):
            text = posts[i % len(posts)]
            views = base_views + rng.randint(0, base_views // 2) + i * 13
            chat.messages.append(
                Message(
                    id=i + 1,
                    chat_id=chat.id,
                    date=start + timedelta(hours=step_hours * i),
                    text=text,
                    outgoing=chat.can_post,
                    sender_id=chat.id,
                    sender_name=title,
                    views=views,
                    forwards=rng.randint(0, max(1, views // 40)),
                )
            )
        return chat

    chats.append(
        channel(
            -1002500000001,
            "Мой блог о разработке",
            BLOG_POSTS,
            minutes_ago=60 * 20,
            step_hours=40,
            base_views=820,
            username="demo_dev_blog",
            about="Пишу о Python, архитектуре и инструментах. Демо-канал.",
            members_count=1264,
            is_creator=True,
            is_admin=True,
            can_post=True,
        )
    )
    chats.append(
        channel(
            -1002500000002,
            "Новости технологий",
            NEWS_POSTS,
            minutes_ago=35,
            step_hours=6,
            base_views=21000,
            username="tech_news_demo",
            about="Главные новости технологий. Демо-канал.",
            members_count=48210,
            unread=9,
            can_post=False,
        )
    )
    chats.append(
        channel(
            -1002500000003,
            "Заметки на полях",
            NOTES_POSTS,
            minutes_ago=60 * 72,
            step_hours=96,
            base_views=140,
            about="Небольшой личный канал с заметками. Демо-канал.",
            members_count=212,
            is_admin=True,
            can_post=True,
        )
    )
    return {c.id: c for c in chats}


def _msg(chat_id: int, mid: int, date: datetime, text: str, out: bool, sender: Participant) -> Message:
    return Message(
        id=mid,
        chat_id=chat_id,
        date=date,
        text=text,
        outgoing=out,
        sender_id=sender.id,
        sender_name=sender.name,
    )


def media_for(file_name: str, size: int) -> Media:
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    kind = {
        "jpg": "photo",
        "jpeg": "photo",
        "png": "photo",
        "webp": "photo",
        "mp4": "video",
        "mov": "video",
        "gif": "gif",
        "mp3": "audio",
        "m4a": "audio",
        "ogg": "voice",
    }.get(ext, "document")
    return Media(kind=kind, file_name=file_name, size=size)
