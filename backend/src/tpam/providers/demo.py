"""In-memory demo provider: the full provider contract over fictional data, no network."""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import UTC, datetime
from pathlib import Path

from tpam.core.errors import InvalidState, NotFound, PermissionDenied, ValidationFailed
from tpam.models import (
    ChatDetails,
    ChatKind,
    DeletedMessages,
    Dialog,
    DialogList,
    IncomingMessage,
    Message,
    MessagePage,
    Mode,
    Participant,
    ProviderStatus,
    SearchHit,
)
from tpam.providers.base import DeleteHandler, MessageHandler
from tpam.providers.demo_data import ME, DemoChat, build_demo_chats, media_for

log = logging.getLogger(__name__)


class DemoProvider:
    mode: Mode = "demo"

    def __init__(self, latency_ms: int = 0) -> None:
        self._latency = latency_ms / 1000
        self._chats: dict[int, DemoChat] = build_demo_chats()
        self._handler: MessageHandler | None = None
        self._on_edit: MessageHandler | None = None
        self._on_delete: DeleteHandler | None = None
        self._rng = random.Random()

    async def start(self) -> None:
        log.info("Demo provider started (%d fictional chats)", len(self._chats))

    async def stop(self) -> None:
        self._handler = self._on_edit = self._on_delete = None

    def set_message_handler(self, handler: MessageHandler | None) -> None:
        self._handler = handler

    def cached_title(self, chat_id: int) -> str | None:
        chat = self._chats.get(chat_id)
        return chat.title if chat else None

    def cached_kind(self, chat_id: int) -> ChatKind | None:
        chat = self._chats.get(chat_id)
        return chat.kind if chat else None

    def set_change_handlers(self, on_edit: MessageHandler | None, on_delete: DeleteHandler | None) -> None:
        self._on_edit, self._on_delete = on_edit, on_delete

    async def download_media(
        self, chat_id: int, message_id: int, *, dest_dir: Path, max_bytes: int
    ) -> Path | None:
        return None  # demo messages carry no real files

    async def _delay(self) -> None:
        if self._latency:
            await asyncio.sleep(self._latency)

    def _chat(self, chat_id: int) -> DemoChat:
        self._publish_due(chat_id)
        try:
            return self._chats[chat_id]
        except KeyError:
            raise NotFound("Чат не найден") from None

    def _publish_due(self, chat_id: int | None = None) -> None:
        """Scheduled posts become regular messages once their time comes (as Telegram does)."""
        now = datetime.now(UTC)
        chats = (
            [self._chats[chat_id]] if chat_id in self._chats else ([] if chat_id else self._chats.values())
        )
        for chat in chats:
            due = [m for m in chat.scheduled if m.date <= now]
            for msg in due:
                chat.scheduled.remove(msg)
                chat.messages.append(msg.model_copy(update={"id": self._next_id(chat)}))

    @staticmethod
    def _next_id(chat: DemoChat) -> int:
        return max((m.id for m in chat.messages), default=0) + 1

    async def status(self) -> ProviderStatus:
        return ProviderStatus(
            mode="demo",
            state="connected",
            account=ME,
            dc_id=2,
            device_model="Демо-режим",
        )

    async def list_dialogs(self, limit: int) -> DialogList:
        await self._delay()
        self._publish_due()
        dialogs = [self._to_dialog(c) for c in self._chats.values()]
        far_past = datetime.min.replace(tzinfo=UTC)
        dialogs.sort(key=lambda d: (d.pinned, d.last_message_date or far_past), reverse=True)
        return DialogList(items=dialogs[:limit], total=len(dialogs))

    @staticmethod
    def _to_dialog(chat: DemoChat) -> Dialog:
        last = chat.messages[-1] if chat.messages else None
        preview = None
        if last:
            preview = last.text or (
                f"[{last.media.kind}] {last.media.file_name or ''}".strip() if last.media else None
            )
        return Dialog(
            id=chat.id,
            title=chat.title,
            kind=chat.kind,
            username=chat.username,
            unread_count=chat.unread,
            pinned=chat.pinned,
            last_message_text=preview,
            last_message_date=last.date if last else None,
            last_message_outgoing=last.outgoing if last else False,
            can_post=chat.can_post,
        )

    async def get_chat(self, chat_id: int) -> ChatDetails:
        await self._delay()
        c = self._chat(chat_id)
        is_group = c.kind in ("group", "supergroup")
        return ChatDetails(
            id=c.id,
            title=c.title,
            kind=c.kind,
            username=c.username,
            about=c.about,
            participants_count=c.members_count if c.kind != "user" else None,
            is_admin=c.is_admin,
            is_creator=c.is_creator,
            can_send=c.can_send,
            can_post=c.can_post,
            can_view_participants=is_group and (not c.members_hidden or c.is_admin),
        )

    async def get_history(self, chat_id: int, *, limit: int, before_id: int | None) -> MessagePage:
        await self._delay()
        msgs = self._chat(chat_id).messages
        older = [m for m in msgs if before_id is None or m.id < before_id]
        page = older[-limit:]
        has_more = len(older) > len(page)
        return MessagePage(items=page, next_before_id=page[0].id if page and has_more else None)

    def _check_can_send(self, chat: DemoChat) -> None:
        if not chat.can_send:
            raise PermissionDenied(
                "В этом канале у вас нет права публиковать сообщения"
                if chat.kind == "channel"
                else "В этом чате вам запрещено отправлять сообщения"
            )

    def _check_reply(self, chat: DemoChat, reply_to: int | None) -> None:
        if reply_to is not None and not any(m.id == reply_to for m in chat.messages):
            raise NotFound("Сообщение для ответа не найдено")

    def _append_outgoing(self, chat: DemoChat, **fields: object) -> Message:
        msg = Message(
            id=self._next_id(chat),
            chat_id=chat.id,
            date=datetime.now(UTC).replace(microsecond=0),
            outgoing=True,
            sender_id=chat.id if chat.kind == "channel" else ME.id,
            sender_name=chat.title if chat.kind == "channel" else "Демо Пользователь",
            views=1 if chat.kind == "channel" else None,
            forwards=0 if chat.kind == "channel" else None,
            **fields,
        )
        chat.messages.append(msg)
        chat.unread = 0
        return msg

    async def send_message(self, chat_id: int, text: str, *, reply_to: int | None) -> Message:
        await self._delay()
        chat = self._chat(chat_id)
        self._check_can_send(chat)
        self._check_reply(chat, reply_to)
        return self._append_outgoing(chat, text=text, reply_to_id=reply_to)

    async def send_file(
        self,
        chat_id: int,
        *,
        file_name: str,
        data: bytes,
        caption: str,
        reply_to: int | None,
    ) -> Message:
        await self._delay()
        chat = self._chat(chat_id)
        self._check_can_send(chat)
        self._check_reply(chat, reply_to)
        return self._append_outgoing(
            chat,
            text=caption,
            reply_to_id=reply_to,
            media=media_for(file_name, len(data)),
        )

    async def mark_read(self, chat_id: int) -> None:
        self._chat(chat_id).unread = 0

    async def search(self, query: str, *, chat_id: int | None, limit: int) -> list[SearchHit]:
        await self._delay()
        needle = query.casefold()
        chats = [self._chat(chat_id)] if chat_id is not None else list(self._chats.values())
        hits = [
            SearchHit(chat_id=c.id, chat_title=c.title, message=m)
            for c in chats
            for m in c.messages
            if needle in m.text.casefold()
        ]
        hits.sort(key=lambda h: h.message.date, reverse=True)
        return hits[:limit]

    async def get_participants(self, chat_id: int, *, query: str, limit: int) -> list[Participant]:
        await self._delay()
        chat = self._chat(chat_id)
        if chat.kind not in ("group", "supergroup"):
            if chat.kind == "channel" and not chat.is_admin:
                raise PermissionDenied("Подписчиков канала видят только администраторы")
            if chat.kind != "channel":
                raise InvalidState("Список участников есть только у групп и каналов")
        if chat.members_hidden and not chat.is_admin:
            raise PermissionDenied("Администраторы группы скрыли список участников")
        needle = query.casefold()
        found = [
            p
            for p in chat.members
            if not needle or needle in p.name.casefold() or needle in (p.username or "").casefold()
        ]
        return found[:limit]

    async def publish(self, chat_id: int, text: str, *, schedule_at: datetime | None) -> Message:
        await self._delay()
        chat = self._chat(chat_id)
        if chat.kind != "channel":
            raise InvalidState("Публикация доступна только в каналах")
        if not chat.can_post:
            raise PermissionDenied("У вас нет права публиковать в этом канале")
        if schedule_at is None:
            return self._append_outgoing(chat, text=text)
        if len(chat.scheduled) >= 100:
            raise ValidationFailed("В Telegram можно запланировать не более 100 сообщений на чат")
        scheduled_id = max((m.id for m in chat.scheduled), default=10_000) + 1
        msg = Message(
            id=scheduled_id,
            chat_id=chat.id,
            date=schedule_at,
            text=text,
            outgoing=True,
            sender_id=chat.id,
            sender_name=chat.title,
        )
        chat.scheduled.append(msg)
        chat.scheduled.sort(key=lambda m: m.date)
        return msg

    async def list_scheduled(self, chat_id: int) -> list[Message]:
        await self._delay()
        return list(self._chat(chat_id).scheduled)

    async def cancel_scheduled(self, chat_id: int, message_id: int) -> None:
        await self._delay()
        chat = self._chat(chat_id)
        before = len(chat.scheduled)
        chat.scheduled = [m for m in chat.scheduled if m.id != message_id]
        if len(chat.scheduled) == before:
            raise NotFound("Отложенная публикация не найдена (возможно, уже опубликована)")

    # ---- demo-only helpers -------------------------------------------------

    async def simulate_incoming(self, chat_id: int, text: str) -> Message:
        """Inject an incoming message as if another person wrote it (to try automation rules)."""
        chat = self._chat(chat_id)
        if chat.kind == "channel":
            raise InvalidState("В канал нельзя «получить» входящее сообщение от собеседника")
        senders = [p for p in chat.members if p.id != ME.id] or chat.members
        sender = senders[0] if chat.kind in ("user", "bot") else self._rng.choice(senders)
        msg = Message(
            id=self._next_id(chat),
            chat_id=chat.id,
            date=datetime.now(UTC).replace(microsecond=0),
            text=text,
            outgoing=False,
            sender_id=sender.id,
            sender_name=sender.name,
        )
        chat.messages.append(msg)
        chat.unread += 1
        if self._handler:
            await self._handler(
                IncomingMessage(
                    message=msg,
                    chat_kind=chat.kind,
                    chat_title=chat.title,
                    sender_is_bot=sender.is_bot,
                )
            )
        return msg

    def _incoming_for(self, chat: DemoChat, msg: Message) -> IncomingMessage:
        sender = next((p for p in chat.members if p.id == msg.sender_id), None)
        return IncomingMessage(
            message=msg,
            chat_kind=chat.kind,
            chat_title=chat.title,
            sender_is_bot=bool(sender and sender.is_bot),
        )

    async def simulate_edit(self, chat_id: int, message_id: int, text: str) -> Message:
        """The other person edits their message (demo)."""
        chat = self._chat(chat_id)
        index = next((i for i, m in enumerate(chat.messages) if m.id == message_id), None)
        if index is None:
            raise NotFound("Сообщение не найдено")
        if chat.messages[index].outgoing:
            raise InvalidState("Изменить можно только сообщение собеседника")
        edited = chat.messages[index].model_copy(update={"text": text, "edited": True})
        chat.messages[index] = edited
        if self._on_edit:
            await self._on_edit(self._incoming_for(chat, edited))
        return edited

    async def simulate_delete(self, chat_id: int, message_id: int) -> None:
        """The other person deletes a message for everyone (demo)."""
        chat = self._chat(chat_id)
        before = len(chat.messages)
        chat.messages = [m for m in chat.messages if m.id != message_id]
        if len(chat.messages) == before:
            raise NotFound("Сообщение не найдено")
        if self._on_delete:
            # Demo ids are unique per chat only, so the chat id is always given here
            # (real Telegram omits it for private chats; the archive handles both).
            await self._on_delete(DeletedMessages(chat_id=chat.id, message_ids=[message_id]))
