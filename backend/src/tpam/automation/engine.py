"""Rule matching + safety guards + execution for automatic replies.

Every decision for a message that matched a rule is written to the audit log
(sent / dry_run / skipped / failed). Hard limits live here, not in user config.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from tpam.ai.assistant import AiAssistant
from tpam.ai.settings import load_ai_settings
from tpam.core.errors import AiError, RateLimited, TpamError
from tpam.models import (
    AiResult,
    AuditRecord,
    AutomationLimits,
    AutomationState,
    IncomingMessage,
    Message,
    Rule,
)
from tpam.storage.db import utcnow
from tpam.storage.repositories import (
    AuditRepository,
    RuleRepository,
    SettingsRepository,
)

log = logging.getLogger(__name__)

AUTOMATION_ENABLED_KEY = "automation_enabled"
LIMITS = AutomationLimits()
# A FloodWait longer than this pauses all automation instead of retrying later.
PAUSE_ON_FLOOD_SECONDS = 300
MAX_MATCH_TEXT = 4096
PREVIEW = 200

SendFn = Callable[[int, str, int | None], Awaitable[Message]]
HistoryFn = Callable[[int, int], Awaitable[list[Message]]]

_SUCCESS = ("success",)
_ATTEMPTED = ("success", "dry_run")


def rule_matches(rule: Rule, incoming: IncomingMessage) -> bool:
    """Scope + text condition only; safety guards are evaluated separately."""
    msg = incoming.message
    if incoming.chat_kind == "channel" or msg.outgoing or msg.service:
        return False
    if rule.private_only and incoming.chat_kind not in ("user", "bot"):
        return False
    if rule.chat_ids and msg.chat_id not in rule.chat_ids:
        return False
    if not rule.private_only and not rule.chat_ids:
        return False  # never "all groups"
    text = msg.text[:MAX_MATCH_TEXT]
    if rule.match_mode == "any":
        return True
    if rule.match_mode == "keywords":
        folded = text.casefold()
        return any(k.casefold() in folded for k in rule.keywords)
    return re.search(rule.pattern, text) is not None


class AutomationEngine:
    def __init__(
        self,
        audit: AuditRepository,
        rules: RuleRepository,
        settings: SettingsRepository,
        send: SendFn,
        clock: Callable[[], datetime] = utcnow,
        *,
        ai: AiAssistant | None = None,
        history: HistoryFn | None = None,
    ) -> None:
        self._ai = ai
        self._history = history
        self._audit = audit
        self._rules = rules
        self._settings = settings
        self._send = send
        self._clock = clock
        self._lock = asyncio.Lock()

    async def is_enabled(self) -> bool:
        return bool(await self._settings.get(AUTOMATION_ENABLED_KEY, False))

    async def set_enabled(self, enabled: bool, *, reason: str | None = None) -> None:
        await self._settings.set(AUTOMATION_ENABLED_KEY, enabled)
        await self._audit.add(
            source="system",
            action="automation.enable" if enabled else "automation.disable",
            status="success",
            detail=reason or ("Автоматизация включена" if enabled else "Автоматизация выключена"),
        )

    async def state(self) -> AutomationState:
        now = self._clock()
        return AutomationState(
            enabled=await self.is_enabled(),
            limits=LIMITS,
            sent_last_hour=await self._audit.count(
                since=now - timedelta(hours=1), statuses=_SUCCESS, source="automation"
            ),
            sent_last_day=await self._audit.count(
                since=now - timedelta(days=1), statuses=_SUCCESS, source="automation"
            ),
        )

    async def handle(self, incoming: IncomingMessage) -> AuditRecord | None:
        """Process one update. Returns the audit record when a rule matched, else None."""
        msg = incoming.message
        if msg.outgoing:
            return None
        async with self._lock:
            if not await self.is_enabled():
                return None
            rule = next(
                (r for r in await self._rules.list(enabled_only=True) if rule_matches(r, incoming)),
                None,
            )
            if rule is None:
                return None
            reason = await self._blocked_reason(rule, incoming)
            if reason:
                return await self._record(rule, incoming, "skipped", reason)
            text, note = rule.reply_text, ""
            if rule.reply_mode == "ai":
                try:
                    result = await self._ai_reply(rule, incoming)
                except TpamError as exc:
                    return await self._record(
                        rule, incoming, "failed", f"ИИ: {exc.message}", error_code=exc.code
                    )
                note = f" · ИИ, токенов: {result.input_tokens} + {result.output_tokens}"
                if not result.should_reply:
                    return await self._record(
                        rule, incoming, "skipped", f"ИИ решил не отвечать: {result.reason}{note}"
                    )
                text = result.reply
                if text.strip() == msg.text.strip():
                    return await self._record(
                        rule, incoming, "skipped", "Ответ ИИ повторяет входящее — возможен цикл"
                    )
            if rule.dry_run:
                return await self._record(rule, incoming, "dry_run", f"Ответил бы: «{text[:PREVIEW]}»{note}")
            try:
                await self._send(msg.chat_id, text, msg.id)
            except TpamError as exc:
                record = await self._record(rule, incoming, "failed", exc.message, error_code=exc.code)
                if isinstance(exc, RateLimited) and (
                    exc.code == "peer_flood" or (exc.retry_after or 0) > PAUSE_ON_FLOOD_SECONDS
                ):
                    await self.set_enabled(
                        False,
                        reason="Автоматизация приостановлена: Telegram ограничил отправку сообщений",
                    )
                return record
            return await self._record(rule, incoming, "success", f"Ответ: «{text[:PREVIEW]}»{note}")

    async def _ai_reply(self, rule: Rule, incoming: IncomingMessage) -> AiResult:
        """Called only after every safety guard passed, so blocked messages cost nothing."""
        if self._ai is None:
            raise AiError("ИИ-ассистент недоступен", code="ai_not_configured")
        settings = await load_ai_settings(self._settings)
        history: list[Message] = []
        if self._history is not None and settings.history_messages:
            try:
                history = await self._history(incoming.message.chat_id, settings.history_messages + 1)
            except TpamError as exc:
                log.warning("History for AI context unavailable: %s", exc.code)
        return await self._ai.generate(
            settings=settings,
            instructions=rule.ai_instructions,
            chat_title=incoming.chat_title,
            chat_kind=incoming.chat_kind,
            history=history,
            incoming=incoming.message,
        )

    async def _blocked_reason(self, rule: Rule, incoming: IncomingMessage) -> str | None:
        msg = incoming.message
        now = self._clock()
        if incoming.sender_is_bot or incoming.chat_kind == "bot":
            return "Отправитель — бот: автоответы ботам запрещены"
        if (now - msg.date).total_seconds() > LIMITS.max_message_age_seconds:
            return "Сообщение слишком старое (получено после простоя)"
        if msg.text.strip() and msg.text.strip() == rule.reply_text.strip():
            return "Входящее совпадает с нашим автоответом — возможен цикл"
        if await self._audit.count(
            since=now - timedelta(minutes=rule.cooldown_minutes),
            statuses=_ATTEMPTED,
            rule_id=rule.id,
            chat_id=msg.chat_id,
        ):
            return f"Пауза между ответами в этом чате ({rule.cooldown_minutes} мин)"
        if (
            await self._audit.count(since=now - timedelta(days=1), statuses=_ATTEMPTED, rule_id=rule.id)
            >= rule.daily_limit
        ):
            return f"Достигнут дневной лимит правила ({rule.daily_limit})"
        if not rule.dry_run:
            if (
                await self._audit.count(
                    since=now - timedelta(hours=1),
                    statuses=_SUCCESS,
                    source="automation",
                    chat_id=msg.chat_id,
                )
                >= LIMITS.per_chat_per_hour
            ):
                return f"Лимит автоответов в одном чате: {LIMITS.per_chat_per_hour} в час"
            if (
                await self._audit.count(
                    since=now - timedelta(hours=1),
                    statuses=_SUCCESS,
                    source="automation",
                )
                >= LIMITS.global_per_hour
            ):
                return f"Общий лимит: {LIMITS.global_per_hour} автоответов в час"
            if (
                await self._audit.count(
                    since=now - timedelta(days=1),
                    statuses=_SUCCESS,
                    source="automation",
                )
                >= LIMITS.global_per_day
            ):
                return f"Общий лимит: {LIMITS.global_per_day} автоответов в сутки"
        return None

    async def _record(
        self,
        rule: Rule,
        incoming: IncomingMessage,
        status: str,
        detail: str,
        *,
        error_code: str | None = None,
    ) -> AuditRecord:
        return await self._audit.add(
            source="automation",
            action="auto.reply",
            status=status,  # type: ignore[arg-type]
            chat_id=incoming.message.chat_id,
            chat_title=incoming.chat_title,
            rule_id=rule.id,
            rule_name=rule.name,
            detail=detail,
            error_code=error_code,
        )
