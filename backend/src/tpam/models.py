"""DTOs shared by providers, services and the HTTP API.

Providers translate library objects (Telethon / demo data) into these models, so the
rest of the application never depends on Telethon types.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Mode = Literal["demo", "telegram"]
ChatKind = Literal["user", "bot", "group", "supergroup", "channel"]
ConnectionState = Literal["connected", "connecting", "disconnected", "not_configured", "unauthorized"]
MediaKind = Literal["photo", "video", "document", "audio", "voice", "sticker", "gif", "other"]
ParticipantRole = Literal["creator", "admin", "member"]


class Dto(BaseModel):
    model_config = ConfigDict(frozen=True)


class Account(Dto):
    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    phone_masked: str | None = None
    is_premium: bool = False


class ProviderStatus(Dto):
    mode: Mode
    state: ConnectionState
    account: Account | None = None
    dc_id: int | None = None
    session_path: str | None = None
    device_model: str | None = None
    error: str | None = None


class Dialog(Dto):
    id: int
    title: str
    kind: ChatKind
    username: str | None = None
    unread_count: int = 0
    pinned: bool = False
    last_message_text: str | None = None
    last_message_date: datetime | None = None
    last_message_outgoing: bool = False
    can_post: bool = False
    """Channel where this account may publish (from cached admin rights, no extra request)."""


class DialogList(Dto):
    items: list[Dialog]
    total: int


class Media(Dto):
    kind: MediaKind
    file_name: str | None = None
    size: int | None = None
    ttl: bool = False
    """Self-destructing (view-once / timer) media: never downloaded or archived."""


class Message(Dto):
    id: int
    chat_id: int
    date: datetime
    text: str
    outgoing: bool
    sender_id: int | None = None
    sender_name: str | None = None
    reply_to_id: int | None = None
    media: Media | None = None
    views: int | None = None
    forwards: int | None = None
    edited: bool = False
    service: bool = False
    deleted: bool = False
    """Shown from the local archive: the message was deleted in Telegram."""


class MessagePage(Dto):
    items: list[Message]
    """Oldest first."""
    next_before_id: int | None
    """Pass as before_id to load older messages; None when history is exhausted."""


class SearchHit(Dto):
    chat_id: int
    chat_title: str
    message: Message


class ChatDetails(Dto):
    id: int
    title: str
    kind: ChatKind
    username: str | None = None
    about: str | None = None
    participants_count: int | None = None
    is_admin: bool = False
    is_creator: bool = False
    can_send: bool = True
    can_post: bool = False
    can_view_participants: bool = False


class Participant(Dto):
    id: int
    name: str
    username: str | None = None
    is_bot: bool = False
    role: ParticipantRole = "member"


class IncomingMessage(Dto):
    """A real-time update pushed by a provider to the automation engine."""

    message: Message
    chat_kind: ChatKind
    chat_title: str
    sender_is_bot: bool = False


# ---- activity & automation --------------------------------------------------

AuditSource = Literal["manual", "automation", "system"]
AuditStatus = Literal["success", "failed", "skipped", "dry_run"]
MatchMode = Literal["any", "keywords", "regex"]
ReplyMode = Literal["template", "ai"]

MIN_COOLDOWN_MINUTES = 5
MAX_RULE_DAILY_LIMIT = 50


class AuditRecord(Dto):
    id: int
    ts: datetime
    source: AuditSource
    action: str
    status: AuditStatus
    chat_id: int | None = None
    chat_title: str | None = None
    rule_id: int | None = None
    rule_name: str | None = None
    detail: str | None = None
    error_code: str | None = None
    duration_ms: int | None = None


class AuditPage(Dto):
    items: list[AuditRecord]
    total: int


class RuleInput(BaseModel):
    """User-editable automation rule. Safety limits are clamped by validation, not trusted."""

    name: str = Field(min_length=1, max_length=80)
    enabled: bool = False
    dry_run: bool = True
    private_only: bool = True
    chat_ids: list[int] = Field(default_factory=list, max_length=50)
    match_mode: MatchMode = "keywords"
    keywords: list[str] = Field(default_factory=list, max_length=30)
    pattern: str = Field(default="", max_length=200)
    reply_mode: ReplyMode = "template"
    reply_text: str = Field(default="", max_length=1000)
    """Fixed reply (template mode)."""
    ai_instructions: str = Field(default="", max_length=2000)
    """Extra guidance for the AI for this rule (ai mode); global persona and knowledge apply too."""
    cooldown_minutes: int = Field(default=60, ge=MIN_COOLDOWN_MINUTES, le=7 * 24 * 60)
    daily_limit: int = Field(default=20, ge=1, le=MAX_RULE_DAILY_LIMIT)

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Поле не может быть пустым")
        return value

    @field_validator("reply_text", "ai_instructions")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()

    @field_validator("keywords")
    @classmethod
    def _clean_keywords(cls, value: list[str]) -> list[str]:
        seen: dict[str, None] = {}
        for word in value:
            word = word.strip()
            if word and len(word) <= 100:
                seen.setdefault(word, None)
        return list(seen)

    @model_validator(mode="after")
    def _check_consistency(self) -> RuleInput:
        if self.reply_mode == "template" and not self.reply_text:
            raise ValueError("Напишите текст автоответа")
        if not self.private_only and not self.chat_ids:
            raise ValueError("Укажите хотя бы один чат или ограничьте правило личными сообщениями")
        if self.match_mode == "keywords" and not self.keywords:
            raise ValueError("Добавьте хотя бы одно ключевое слово")
        if self.match_mode == "regex":
            if not self.pattern:
                raise ValueError("Укажите регулярное выражение")
            try:
                re.compile(self.pattern)
            except re.error as exc:
                raise ValueError(f"Некорректное регулярное выражение: {exc}") from None
        return self


class Rule(RuleInput):
    model_config = ConfigDict(frozen=True)

    id: int
    created_at: datetime
    updated_at: datetime


class AutomationLimits(Dto):
    global_per_hour: int = 20
    global_per_day: int = 100
    per_chat_per_hour: int = 3
    min_cooldown_minutes: int = MIN_COOLDOWN_MINUTES
    max_message_age_seconds: int = 120


class AutomationState(Dto):
    enabled: bool
    limits: AutomationLimits
    sent_last_hour: int
    sent_last_day: int


# ---- AI assistant -----------------------------------------------------------


class AiSettings(BaseModel):
    """Global context for AI replies (per mode). The API key is stored separately in the OS keychain."""

    persona: str = Field(default="", max_length=4000)
    """Who answers and how: name, role, tone, language."""
    knowledge: str = Field(default="", max_length=50_000)
    """Facts the assistant may rely on: prices, hours, FAQ, links."""
    max_reply_chars: int = Field(default=600, ge=100, le=2000)
    history_messages: int = Field(default=12, ge=0, le=40)


AiKeySource = Literal["account"]


class AiStatus(Dto):
    configured: bool
    key_source: AiKeySource | None
    model: str
    settings: AiSettings


class AiResult(Dto):
    should_reply: bool
    reply: str
    reason: str
    input_tokens: int = 0
    output_tokens: int = 0


# ---- archive ------------------------------------------------------------------

ArchiveMediaMode = Literal["none", "photos", "all"]


class ArchiveSettings(BaseModel):
    enabled: bool = True
    private_chats: bool = True
    groups: bool = False
    chat_ids: list[int] = Field(default_factory=list, max_length=500)
    """Extra chats archived regardless of the switches above (e.g. one group or channel)."""
    media: ArchiveMediaMode = "photos"
    max_media_mb: int = Field(default=20, ge=1, le=200)


class ArchivedMessage(Dto):
    id: int
    chat_id: int
    chat_title: str | None
    message_id: int
    date: datetime
    sender_name: str | None
    outgoing: bool
    text: str
    reply_to_id: int | None = None
    media: Media | None = None
    has_file: bool = False
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    edit_count: int = 0
    source: Literal["live", "import"] = "live"


class ArchivePage(Dto):
    items: list[ArchivedMessage]
    total: int
    next_cursor: int | None


class ArchiveChat(Dto):
    id: int
    title: str
    kind: ChatKind
    messages: int
    deleted: int
    edited: int
    last_date: datetime | None


class ArchiveStats(Dto):
    messages: int
    deleted: int
    edited: int
    chats: int
    media_files: int
    media_bytes: int
    database_bytes: int


class ArchiveEdit(Dto):
    old_text: str
    new_text: str
    edited_at: datetime


ImportState = Literal["idle", "running", "done", "failed"]


class ImportStatus(Dto):
    state: ImportState = "idle"
    path: str | None = None
    chats_done: int = 0
    messages_imported: int = 0
    messages_skipped: int = 0
    current_chat: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class DeletedMessages(Dto):
    """Telegram reports deletions without a chat id for private chats and basic groups."""

    chat_id: int | None
    message_ids: list[int]
