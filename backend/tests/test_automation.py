from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from tpam.automation.engine import LIMITS, AutomationEngine
from tpam.core.errors import RateLimited
from tpam.models import ChatKind, IncomingMessage, Message, RuleInput
from tpam.storage.db import Database
from tpam.storage.repositories import AuditRepository, RuleRepository, SettingsRepository


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 11, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


class Sender:
    def __init__(self) -> None:
        self.sent: list[tuple[int, str, int | None]] = []
        self.error: Exception | None = None

    async def __call__(self, chat_id: int, text: str, reply_to: int | None) -> Message:
        if self.error:
            raise self.error
        self.sent.append((chat_id, text, reply_to))
        return Message(id=999, chat_id=chat_id, date=datetime.now(UTC), text=text, outgoing=True)


class Env:
    def __init__(self, db: Database, clock: Clock) -> None:
        self.clock = clock
        self.sender = Sender()
        self.audit = AuditRepository(db, clock=clock)
        self.rules = RuleRepository(db)
        self.engine = AutomationEngine(
            self.audit, self.rules, SettingsRepository(db), self.sender, clock=clock
        )
        self._next_id = 1

    def incoming(
        self,
        text: str = "привет",
        *,
        chat_id: int = 2001,
        kind: ChatKind = "user",
        bot: bool = False,
        age_seconds: float = 0,
        outgoing: bool = False,
    ) -> IncomingMessage:
        self._next_id += 1
        msg = Message(
            id=self._next_id,
            chat_id=chat_id,
            date=self.clock() - timedelta(seconds=age_seconds),
            text=text,
            outgoing=outgoing,
            sender_id=chat_id,
        )
        return IncomingMessage(message=msg, chat_kind=kind, chat_title="Чат", sender_is_bot=bot)

    async def rule(self, **overrides: Any) -> None:
        data = {
            "name": "Привет",
            "enabled": True,
            "dry_run": False,
            "keywords": ["привет"],
            "reply_text": "Скоро отвечу",
        }
        await self.rules.create(RuleInput(**(data | overrides)))


@pytest.fixture
async def env(tmp_path: Path) -> AsyncIterator[Env]:
    db = Database(tmp_path / "t.db")
    await db.init()
    environment = Env(db, Clock())
    await environment.engine.set_enabled(True)
    yield environment
    await db.dispose()


async def test_kill_switch_blocks_everything(env: Env) -> None:
    await env.rule()
    await env.engine.set_enabled(False)
    assert await env.engine.handle(env.incoming()) is None
    assert env.sender.sent == []


async def test_disabled_by_default(tmp_path: Path) -> None:
    db = Database(tmp_path / "fresh.db")
    await db.init()
    engine = AutomationEngine(AuditRepository(db), RuleRepository(db), SettingsRepository(db), Sender())
    assert await engine.is_enabled() is False
    await db.dispose()


async def test_reply_sent_and_audited(env: Env) -> None:
    await env.rule()
    record = await env.engine.handle(env.incoming("Привет, как дела?"))
    assert record is not None and record.status == "success"
    assert env.sender.sent == [(2001, "Скоро отвечу", record and env.sender.sent[0][2])]
    assert env.sender.sent[0][2] is not None  # replies to the triggering message


async def test_dry_run_does_not_send(env: Env) -> None:
    await env.rule(dry_run=True)
    record = await env.engine.handle(env.incoming())
    assert record is not None and record.status == "dry_run"
    assert env.sender.sent == []


async def test_non_matching_text_ignored(env: Env) -> None:
    await env.rule()
    assert await env.engine.handle(env.incoming("добрый вечер")) is None


async def test_outgoing_ignored(env: Env) -> None:
    await env.rule()
    assert await env.engine.handle(env.incoming(outgoing=True)) is None


async def test_bots_never_answered(env: Env) -> None:
    await env.rule()
    record = await env.engine.handle(env.incoming(bot=True))
    assert record is not None and record.status == "skipped" and "бот" in (record.detail or "")
    assert env.sender.sent == []


async def test_stale_messages_skipped(env: Env) -> None:
    await env.rule()
    record = await env.engine.handle(env.incoming(age_seconds=LIMITS.max_message_age_seconds + 5))
    assert record is not None and record.status == "skipped"


async def test_echo_of_own_reply_skipped(env: Env) -> None:
    await env.rule(match_mode="any", keywords=[])
    record = await env.engine.handle(env.incoming("Скоро отвечу"))
    assert record is not None and record.status == "skipped" and "цикл" in (record.detail or "")


async def test_cooldown_per_chat(env: Env) -> None:
    await env.rule(cooldown_minutes=30)
    assert (await env.engine.handle(env.incoming())).status == "success"  # type: ignore[union-attr]
    second = await env.engine.handle(env.incoming())
    assert second is not None and second.status == "skipped"
    other_chat = await env.engine.handle(env.incoming(chat_id=2002))
    assert other_chat is not None and other_chat.status == "success"
    env.clock.advance(minutes=31)
    assert (await env.engine.handle(env.incoming())).status == "success"  # type: ignore[union-attr]
    assert len(env.sender.sent) == 3


async def test_rule_daily_limit(env: Env) -> None:
    await env.rule(cooldown_minutes=5, daily_limit=2)
    statuses = []
    for i in range(3):
        statuses.append((await env.engine.handle(env.incoming(chat_id=3000 + i))).status)  # type: ignore[union-attr]
    assert statuses == ["success", "success", "skipped"]


async def test_global_hourly_limit(env: Env) -> None:
    await env.rule(cooldown_minutes=5, daily_limit=50)
    results = [
        (await env.engine.handle(env.incoming(chat_id=5000 + i))).status  # type: ignore[union-attr]
        for i in range(LIMITS.global_per_hour + 1)
    ]
    assert results.count("success") == LIMITS.global_per_hour
    assert results[-1] == "skipped"


async def test_per_chat_hourly_cap_limits_reply_loops(env: Env) -> None:
    await env.rule(cooldown_minutes=5, daily_limit=50)
    sent = 0
    for _ in range(10):  # another auto-replier keeps answering every 6 minutes
        record = await env.engine.handle(env.incoming())
        sent += record is not None and record.status == "success"
        env.clock.advance(minutes=6)
    assert sent <= LIMITS.per_chat_per_hour + 1  # the window slides; never unbounded
    assert len(env.sender.sent) == sent


async def test_groups_require_explicit_allowlist(env: Env) -> None:
    await env.rule()  # private_only by default
    assert await env.engine.handle(env.incoming(chat_id=-100, kind="supergroup")) is None
    await env.rule(name="Группа", private_only=False, chat_ids=[-200])
    assert await env.engine.handle(env.incoming(chat_id=-100, kind="supergroup")) is None
    record = await env.engine.handle(env.incoming(chat_id=-200, kind="supergroup"))
    assert record is not None and record.status == "success"


async def test_channels_never_trigger(env: Env) -> None:
    await env.rule(private_only=False, chat_ids=[-300], match_mode="any", keywords=[])
    assert await env.engine.handle(env.incoming(chat_id=-300, kind="channel")) is None


async def test_peer_flood_pauses_automation(env: Env) -> None:
    await env.rule()
    env.sender.error = RateLimited("spam", code="peer_flood")
    record = await env.engine.handle(env.incoming())
    assert record is not None and record.status == "failed"
    assert await env.engine.is_enabled() is False


async def test_short_flood_wait_keeps_automation_on(env: Env) -> None:
    await env.rule()
    env.sender.error = RateLimited("wait", retry_after=30)
    await env.engine.handle(env.incoming())
    assert await env.engine.is_enabled() is True


async def test_regex_rule(env: Env) -> None:
    await env.rule(match_mode="regex", keywords=[], pattern=r"(?i)\bзаказ\s*№?\d+")
    assert await env.engine.handle(env.incoming("Где мой заказ №123?")) is not None
    assert await env.engine.handle(env.incoming("заказ без номера", chat_id=2010)) is None


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"private_only": False, "chat_ids": []}, "Укажите хотя бы один чат"),
        ({"keywords": []}, "ключевое слово"),
        ({"match_mode": "regex", "pattern": "(unclosed"}, "регулярное"),
        ({"cooldown_minutes": 1}, "greater than or equal"),
        ({"daily_limit": 500}, "less than or equal"),
        ({"reply_text": "   "}, "Напишите текст автоответа"),
    ],
)
def test_rule_validation(overrides: dict[str, Any], message: str) -> None:
    data = {"name": "r", "keywords": ["a"], "reply_text": "ok"} | overrides
    with pytest.raises(ValidationError, match=message):
        RuleInput(**data)


# ---- through the HTTP API (demo provider) -----------------------------------


async def test_rules_api_and_simulated_incoming(client: httpx.AsyncClient) -> None:
    rule = {
        "name": "Автоответ",
        "enabled": True,
        "dry_run": False,
        "keywords": ["созвон"],
        "reply_text": "Сейчас занят, отвечу позже",
    }
    created = await client.post("/api/rules", json=rule)
    assert created.status_code == 201
    # automation is off by default → nothing happens
    await client.post("/api/demo/incoming", json={"chat_id": 2001, "text": "Есть минутка на созвон?"})
    assert not [
        i for i in (await client.get("/api/activity", params={"source": "automation"})).json()["items"]
    ]

    await client.put("/api/automation", json={"enabled": True})
    await client.post("/api/demo/incoming", json={"chat_id": 2001, "text": "Есть минутка на созвон?"})
    auto = (await client.get("/api/activity", params={"source": "automation"})).json()["items"]
    assert auto[0]["status"] == "success" and auto[0]["rule_name"] == "Автоответ"
    history = (await client.get("/api/chats/2001/messages")).json()["items"]
    assert history[-1]["text"] == "Сейчас занят, отвечу позже" and history[-1]["outgoing"] is True

    state = (await client.get("/api/automation")).json()
    assert state["sent_last_hour"] == 1

    toggled = await client.patch(f"/api/rules/{created.json()['id']}", json={"enabled": False})
    assert toggled.json()["enabled"] is False
    assert (await client.delete(f"/api/rules/{created.json()['id']}")).status_code == 204
    assert (await client.get("/api/rules")).json() == []


async def test_rule_check_endpoint(client: httpx.AsyncClient) -> None:
    rule = {"name": "x", "keywords": ["цена"], "reply_text": "ok"}
    yes = await client.post("/api/rules/check", json={"rule": rule, "text": "Какая цена?"})
    no = await client.post("/api/rules/check", json={"rule": rule, "text": "Привет", "chat_kind": "user"})
    group = await client.post(
        "/api/rules/check", json={"rule": rule, "text": "цена", "chat_kind": "supergroup"}
    )
    assert yes.json()["matches"] is True
    assert no.json()["matches"] is False
    assert group.json()["matches"] is False


async def test_invalid_rule_api_message(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/rules", json={"name": "x", "reply_text": "ok", "keywords": []})
    assert response.status_code == 422
    assert response.json()["error"]["message"] == "Добавьте хотя бы одно ключевое слово"
