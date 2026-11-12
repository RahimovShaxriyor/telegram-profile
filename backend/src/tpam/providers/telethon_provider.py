"""Real Telegram provider on top of Telethon (MTProto): one connected client per signed-in user."""

from __future__ import annotations

import asyncio
import io
import logging
import platform
import re
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from telethon import TelegramClient, errors, events, functions, types, utils
from telethon.sessions import StringSession

from tpam import __version__
from tpam.core.errors import (
    NotAuthorized,
    NotFound,
    PermissionDenied,
    RateLimited,
    TelegramUnavailable,
    TpamError,
    ValidationFailed,
)
from tpam.core.keystore import ApiCredentials
from tpam.core.logging import register_secret
from tpam.models import (
    Account,
    ChatDetails,
    ChatKind,
    ConnectionState,
    DeletedMessages,
    Dialog,
    DialogList,
    IncomingMessage,
    Media,
    Message,
    MessagePage,
    Mode,
    Participant,
    ProviderStatus,
    SearchHit,
)
from tpam.providers.base import DeleteHandler, MessageHandler

log = logging.getLogger(__name__)

DEVICE_MODEL = "TPAM (веб-клиент)"
DIALOG_CACHE_TTL = 30.0
RECENT_CACHE = 300
CONNECT_TIMEOUT = 30.0
# Telethon sleeps through short FloodWaits itself (this is waiting, not bypassing);
# longer waits are surfaced to the user as RateLimited.
FLOOD_SLEEP_THRESHOLD = 10

ClientFactory = Callable[..., Any]

_SERVICE_ACTIONS = {
    "MessageActionChatCreate": "Группа создана",
    "MessageActionChannelCreate": "Канал создан",
    "MessageActionChatAddUser": "Добавлен участник",
    "MessageActionChatDeleteUser": "Участник покинул чат",
    "MessageActionChatJoinedByLink": "Участник вступил по ссылке",
    "MessageActionChatEditTitle": "Название изменено",
    "MessageActionChatEditPhoto": "Фото чата изменено",
    "MessageActionPinMessage": "Сообщение закреплено",
    "MessageActionPhoneCall": "Звонок",
}


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 6:
        return "***"
    return f"+{digits[:3]} *** *** {digits[-2:]}"


def chat_kind(entity: Any) -> ChatKind:
    if isinstance(entity, types.User):
        return "bot" if entity.bot else "user"
    if isinstance(entity, (types.Chat, types.ChatForbidden)):
        return "group"
    if isinstance(entity, types.Channel):
        return "supergroup" if entity.megagroup else "channel"
    if isinstance(entity, types.ChannelForbidden):
        return "supergroup" if entity.megagroup else "channel"
    return "user"


def media_of(msg: Any) -> Media | None:
    if not getattr(msg, "media", None) or isinstance(msg.media, types.MessageMediaWebPage):
        return None
    kind: str
    if msg.photo:
        kind = "photo"
    elif msg.sticker:
        kind = "sticker"
    elif msg.gif:
        kind = "gif"
    elif msg.video:
        kind = "video"
    elif msg.voice:
        kind = "voice"
    elif msg.audio:
        kind = "audio"
    elif msg.document:
        kind = "document"
    else:
        kind = "other"
    file = msg.file
    return Media(
        kind=kind,
        file_name=getattr(file, "name", None),
        size=getattr(file, "size", None),
        ttl=bool(getattr(msg.media, "ttl_seconds", None)),
    )


def to_message(msg: Any, *, fallback_sender: str | None = None) -> Message:
    action = getattr(msg, "action", None)
    text = getattr(msg, "message", None) or ""
    if action is not None:
        text = _SERVICE_ACTIONS.get(type(action).__name__, "Служебное событие")
    sender = getattr(msg, "sender", None)
    return Message(
        id=msg.id,
        chat_id=msg.chat_id,
        date=msg.date,
        text=text,
        outgoing=bool(msg.out),
        sender_id=msg.sender_id,
        sender_name=utils.get_display_name(sender) if sender else fallback_sender,
        reply_to_id=msg.reply_to_msg_id,
        media=None if action is not None else media_of(msg),
        views=getattr(msg, "views", None),
        forwards=getattr(msg, "forwards", None),
        edited=bool(getattr(msg, "edit_date", None)),
        service=action is not None,
    )


def _can_post(entity: Any) -> bool:
    if not isinstance(entity, types.Channel) or not entity.broadcast:
        return False
    rights = entity.admin_rights
    return bool(entity.creator or (rights and rights.post_messages))


def to_account(user: Any) -> Account:
    return Account(
        id=user.id,
        first_name=user.first_name or "",
        last_name=user.last_name,
        username=user.username,
        phone_masked=mask_phone(user.phone),
        is_premium=bool(getattr(user, "premium", False)),
    )


def client_options() -> dict[str, Any]:
    """Honest device info (shown in Telegram → Devices) and reconnect behaviour, shared with the login flow."""
    return {
        "device_model": DEVICE_MODEL,
        "system_version": f"{platform.system()} {platform.release()}",
        "app_version": __version__,
        "flood_sleep_threshold": FLOOD_SLEEP_THRESHOLD,
        "connection_retries": 5,
        "retry_delay": 2,
        "auto_reconnect": True,
    }


def default_client_factory(session: str, api_id: int, api_hash: str, **kwargs: Any) -> TelegramClient:
    return TelegramClient(StringSession(session), api_id, api_hash, **kwargs)


SessionSaver = Callable[[str], Awaitable[None]]


class TelethonProvider:
    """One user's Telegram connection, restored from that user's encrypted session string."""

    mode: Mode = "telegram"

    def __init__(
        self,
        session: str,
        app: ApiCredentials,
        client_factory: ClientFactory = default_client_factory,
        on_session_saved: SessionSaver | None = None,
    ) -> None:
        self._session = session
        self._app = app
        self._factory = client_factory
        self._save_session = on_session_saved
        self._client: Any | None = None
        self._state: ConnectionState = "connecting"
        self._error: str | None = None
        self._me: Account | None = None
        self._handler: MessageHandler | None = None
        self._handler_registered = False
        self._dialogs: tuple[float, int, DialogList] | None = None
        self._titles: dict[int, str] = {}
        self._kinds: dict[int, ChatKind] = {}
        self._recent: dict[tuple[int, int], Any] = {}
        self._on_edit: MessageHandler | None = None
        self._on_delete: DeleteHandler | None = None
        self._lock = asyncio.Lock()

    # ---- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        register_secret(self._app.api_hash)
        self._client = self._factory(self._session, self._app.api_id, self._app.api_hash, **client_options())
        self._state, self._error = "connecting", None
        try:
            await asyncio.wait_for(self._client.connect(), CONNECT_TIMEOUT)
            authorized = await self._client.is_user_authorized()
        except (OSError, TimeoutError) as exc:
            self._state = "disconnected"
            self._error = "Не удалось подключиться к Telegram. Проверьте интернет и нажмите «Переподключить»."
            log.warning("Telegram connect failed: %s", type(exc).__name__)
            return
        except errors.RPCError as exc:
            self._state = "disconnected"
            self._error = f"Telegram отклонил подключение ({type(exc).__name__})"
            return
        if authorized:
            await self._on_authorized()
        else:
            self._state = "unauthorized"
            self._error = "Сессия Telegram завершена (например, в «Устройствах»). Войдите заново."

    async def stop(self) -> None:
        if self._client is not None:
            await self._persist_session()
            await self._client.disconnect()
        self._client = None
        self._handler_registered = False

    async def reconnect(self) -> None:
        async with self._lock:
            await self.stop()
            await self.start()

    async def _persist_session(self) -> None:
        """Telethon may move the account to another DC; keep the stored session current."""
        if self._client is None or self._save_session is None or self._state != "connected":
            return
        current = self._client.session.save()
        if current and current != self._session:
            self._session = current
            await self._save_session(current)

    async def _on_authorized(self) -> None:
        assert self._client is not None
        self._me = to_account(await self._client.get_me())
        self._state, self._error = "connected", None
        if not self._handler_registered:
            self._client.add_event_handler(self._on_new_message, events.NewMessage())
            self._client.add_event_handler(self._on_edited, events.MessageEdited())
            self._client.add_event_handler(self._on_deleted, events.MessageDeleted())
            self._handler_registered = True
        await self._persist_session()

    @property
    def account(self) -> Account | None:
        return self._me

    def set_message_handler(self, handler: MessageHandler | None) -> None:
        self._handler = handler

    def cached_title(self, chat_id: int) -> str | None:
        return self._titles.get(chat_id)

    def cached_kind(self, chat_id: int) -> ChatKind | None:
        return self._kinds.get(chat_id)

    def set_change_handlers(self, on_edit: MessageHandler | None, on_delete: DeleteHandler | None) -> None:
        self._on_edit, self._on_delete = on_edit, on_delete

    async def download_media(
        self, chat_id: int, message_id: int, *, dest_dir: Path, max_bytes: int
    ) -> Path | None:
        msg = self._recent.get((chat_id, message_id))
        async with self._rpc() as client:
            if msg is None:
                msg = await client.get_messages(await self._entity(client, chat_id), ids=message_id)
            media = media_of(msg) if msg is not None else None
            if media is None or media.ttl or (media.size or 0) > max_bytes:
                return None
            await asyncio.to_thread(dest_dir.mkdir, parents=True, exist_ok=True)
            # Telethon appends the proper extension to this stem.
            saved = await client.download_media(msg, file=str(dest_dir / str(message_id)))
        return Path(saved) if saved else None

    async def status(self) -> ProviderStatus:
        state = self._state
        if state == "connected" and self._client is not None and not self._client.is_connected():
            state = "connecting"  # Telethon is auto-reconnecting
        dc_id = None
        if self._client is not None and state == "connected":
            dc_id = getattr(self._client.session, "dc_id", None)
        return ProviderStatus(
            mode="telegram",
            state=state,
            account=self._me if state in ("connected", "connecting") else None,
            dc_id=dc_id,
            session_path=None,
            device_model=DEVICE_MODEL,
            error=self._error,
        )

    async def log_out(self) -> None:
        """Ends this TPAM session in Telegram (it disappears from Settings → Devices)."""
        async with self._lock:
            if self._client is not None and self._state == "connected":
                try:
                    await self._client.log_out()
                except (errors.RPCError, OSError) as exc:
                    log.warning("log_out failed: %s", type(exc).__name__)
            self._save_session = None
            await self.stop()
            self._me, self._state = None, "unauthorized"

    # ---- data operations ----------------------------------------------------

    def _authorized_client(self) -> Any:
        if self._client is None or self._state not in ("connected", "connecting"):
            raise NotAuthorized("Telegram-сессия не активна. Выйдите и войдите заново по номеру телефона.")
        return self._client

    @asynccontextmanager
    async def _rpc(self) -> AsyncIterator[Any]:
        client = self._authorized_client()
        try:
            yield client
        except TpamError:
            raise
        except (errors.FloodWaitError, errors.SlowModeWaitError) as exc:
            raise RateLimited(f"Telegram просит подождать {exc.seconds} с", retry_after=exc.seconds) from None
        except errors.PeerFloodError:
            raise RateLimited(
                "Telegram временно ограничил отправку сообщений с этого аккаунта (подозрение на спам). Сделайте паузу.",
                code="peer_flood",
            ) from None
        except errors.ChatAdminRequiredError:
            raise PermissionDenied("Для этого действия нужны права администратора") from None
        except errors.ChatWriteForbiddenError:
            raise PermissionDenied("Вам запрещено писать в этот чат") from None
        except errors.UserPrivacyRestrictedError:
            raise PermissionDenied("Настройки приватности пользователя не позволяют это действие") from None
        except errors.ChannelPrivateError:
            raise PermissionDenied("Чат недоступен: он приватный или вы исключены") from None
        except (errors.UserIsBlockedError, errors.YouBlockedUserError):
            raise PermissionDenied("Переписка заблокирована одной из сторон") from None
        except (
            errors.AuthKeyUnregisteredError,
            errors.SessionRevokedError,
            errors.AuthKeyDuplicatedError,
            errors.UserDeactivatedError,
            errors.UserDeactivatedBanError,
        ) as exc:
            log.warning("Telegram session invalidated: %s", type(exc).__name__)
            self._state, self._auth_step, self._me = "unauthorized", "phone", None
            raise NotAuthorized(
                "Сессия Telegram больше не действительна. Подключите аккаунт заново."
            ) from None
        except (errors.MessageTooLongError, errors.MessageEmptyError):
            raise ValidationFailed("Сообщение пустое или слишком длинное") from None
        except (errors.ScheduleDateTooLateError, errors.ScheduleDateInvalidError):
            raise ValidationFailed("Недопустимое время публикации") from None
        except errors.ScheduleTooMuchError:
            raise ValidationFailed(
                "Слишком много отложенных сообщений в этом чате (лимит Telegram — 100)"
            ) from None
        except errors.RPCError as exc:
            log.warning("Unhandled Telegram RPC error: %s", type(exc).__name__)
            raise TpamError(f"Telegram вернул ошибку {type(exc).__name__}", code="telegram_error") from None
        except (OSError, TimeoutError):
            raise TelegramUnavailable("Нет соединения с Telegram. Повторите попытку чуть позже.") from None

    async def _entity(self, client: Any, chat_id: int) -> Any:
        try:
            return await client.get_input_entity(chat_id)
        except ValueError:
            # Entity not in the session cache yet: one dialogs fetch fills it.
            await client.get_dialogs(limit=200)
            try:
                return await client.get_input_entity(chat_id)
            except ValueError:
                raise NotFound("Чат не найден среди ваших диалогов") from None

    def _sender_fallback(self) -> str | None:
        return f"{self._me.first_name} {self._me.last_name or ''}".strip() if self._me else None

    async def list_dialogs(self, limit: int) -> DialogList:
        cached = self._dialogs
        if cached and cached[1] >= limit and time.monotonic() - cached[0] < DIALOG_CACHE_TTL:
            return DialogList(items=cached[2].items[:limit], total=cached[2].total)
        async with self._rpc() as client:
            dialogs = await client.get_dialogs(limit=limit)
        items = [self._to_dialog(d) for d in dialogs]
        self._titles.update({d.id: d.title for d in items})
        self._kinds.update({d.id: d.kind for d in items})
        result = DialogList(items=items, total=getattr(dialogs, "total", len(items)) or len(items))
        self._dialogs = (time.monotonic(), limit, result)
        return result

    @staticmethod
    def _to_dialog(d: Any) -> Dialog:
        msg = d.message
        preview = None
        if msg is not None:
            converted = to_message(msg)
            preview = converted.text or (f"[{converted.media.kind}]" if converted.media else None)
        return Dialog(
            id=d.id,
            title=d.name or "Удалённый аккаунт",
            kind=chat_kind(d.entity),
            username=getattr(d.entity, "username", None),
            unread_count=d.unread_count,
            pinned=bool(d.pinned),
            last_message_text=preview,
            last_message_date=d.date,
            last_message_outgoing=bool(msg.out) if msg is not None else False,
            can_post=_can_post(d.entity),
        )

    async def get_chat(self, chat_id: int) -> ChatDetails:
        async with self._rpc() as client:
            entity = await client.get_entity(await self._entity(client, chat_id))
            kind = chat_kind(entity)
            base: dict[str, Any] = {
                "id": chat_id,
                "title": utils.get_display_name(entity) or "Без названия",
                "kind": kind,
                "username": getattr(entity, "username", None),
            }
            self._titles[chat_id] = base["title"]
            if isinstance(entity, types.User):
                full = await client(functions.users.GetFullUserRequest(entity))
                return ChatDetails(**base, about=full.full_user.about, can_send=not entity.deleted)
            if isinstance(entity, types.Chat):
                full = await client(functions.messages.GetFullChatRequest(entity.id))
                is_admin = bool(entity.creator or entity.admin_rights)
                banned = entity.default_banned_rights
                return ChatDetails(
                    **base,
                    about=full.full_chat.about,
                    participants_count=entity.participants_count,
                    is_admin=is_admin,
                    is_creator=bool(entity.creator),
                    can_send=is_admin or not (banned and banned.send_messages),
                    can_view_participants=True,
                )
            if isinstance(entity, types.Channel):
                full = await client(functions.channels.GetFullChannelRequest(entity))
                fc = full.full_chat
                rights = entity.admin_rights
                is_admin = bool(entity.creator or rights)
                if entity.broadcast:
                    can_post = _can_post(entity)
                    can_send = can_post
                    can_view = is_admin and bool(fc.can_view_participants)
                else:
                    can_post = False
                    default_ban = entity.default_banned_rights
                    own_ban = entity.banned_rights
                    can_send = is_admin or not (
                        (default_ban and default_ban.send_messages) or (own_ban and own_ban.send_messages)
                    )
                    can_view = bool(fc.can_view_participants)
                return ChatDetails(
                    **base,
                    about=fc.about,
                    participants_count=fc.participants_count,
                    is_admin=is_admin,
                    is_creator=bool(entity.creator),
                    can_send=can_send,
                    can_post=can_post,
                    can_view_participants=can_view,
                )
        raise NotFound("Неизвестный тип чата")

    async def get_history(self, chat_id: int, *, limit: int, before_id: int | None) -> MessagePage:
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id)
            msgs = await client.get_messages(entity, limit=limit, offset_id=before_id or 0)
        items = [
            to_message(m, fallback_sender=self._sender_fallback() if m.out else None) for m in reversed(msgs)
        ]
        return MessagePage(items=items, next_before_id=items[0].id if len(items) == limit else None)

    async def send_message(self, chat_id: int, text: str, *, reply_to: int | None) -> Message:
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id)
            sent = await client.send_message(entity, text, reply_to=reply_to)
        self._dialogs = None
        return to_message(sent, fallback_sender=self._sender_fallback())

    async def send_file(
        self,
        chat_id: int,
        *,
        file_name: str,
        data: bytes,
        caption: str,
        reply_to: int | None,
    ) -> Message:
        buffer = io.BytesIO(data)
        buffer.name = file_name
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id)
            sent = await client.send_file(entity, buffer, caption=caption or None, reply_to=reply_to)
        self._dialogs = None
        return to_message(sent, fallback_sender=self._sender_fallback())

    async def mark_read(self, chat_id: int) -> None:
        async with self._rpc() as client:
            await client.send_read_acknowledge(await self._entity(client, chat_id))
        self._dialogs = None

    async def search(self, query: str, *, chat_id: int | None, limit: int) -> list[SearchHit]:
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id) if chat_id is not None else None
            msgs = await client.get_messages(entity, search=query, limit=limit)
        return [
            SearchHit(
                chat_id=m.chat_id,
                chat_title=utils.get_display_name(m.chat) if m.chat else "Чат",
                message=to_message(m, fallback_sender=self._sender_fallback() if m.out else None),
            )
            for m in msgs
        ]

    async def get_participants(self, chat_id: int, *, query: str, limit: int) -> list[Participant]:
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id)
            users = await client.get_participants(entity, limit=limit, search=query)
        result = []
        for user in users:
            participant = getattr(user, "participant", None)
            role = "member"
            if isinstance(
                participant,
                (types.ChannelParticipantCreator, types.ChatParticipantCreator),
            ):
                role = "creator"
            elif isinstance(participant, (types.ChannelParticipantAdmin, types.ChatParticipantAdmin)):
                role = "admin"
            result.append(
                Participant(
                    id=user.id,
                    name=utils.get_display_name(user) or "Удалённый аккаунт",
                    username=user.username,
                    is_bot=bool(user.bot),
                    role=role,
                )
            )
        return result

    async def publish(self, chat_id: int, text: str, *, schedule_at: datetime | None) -> Message:
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id)
            sent = await client.send_message(entity, text, schedule=schedule_at)
        self._dialogs = None
        return to_message(sent)

    async def list_scheduled(self, chat_id: int) -> list[Message]:
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id)
            result = await client(functions.messages.GetScheduledHistoryRequest(peer=entity, hash=0))
        msgs = [to_message(m) for m in getattr(result, "messages", []) if isinstance(m, types.Message)]
        return sorted(msgs, key=lambda m: m.date)

    async def cancel_scheduled(self, chat_id: int, message_id: int) -> None:
        async with self._rpc() as client:
            entity = await self._entity(client, chat_id)
            await client(functions.messages.DeleteScheduledMessagesRequest(peer=entity, id=[message_id]))

    # ---- updates ------------------------------------------------------------

    async def _on_new_message(self, event: Any) -> None:
        self._dialogs = None
        if self._handler is None:
            return
        try:
            incoming = await self._to_incoming(event)
            self._remember(event.message, incoming)
            await self._handler(incoming)
        except Exception:  # an update handler must never kill the client's update loop
            log.exception("Failed to process incoming update")

    def _remember(self, raw: Any, incoming: IncomingMessage) -> None:
        chat_id = incoming.message.chat_id
        self._titles[chat_id] = incoming.chat_title
        self._kinds[chat_id] = incoming.chat_kind
        self._recent[(chat_id, incoming.message.id)] = (
            raw  # lets the archive download media without a refetch
        )
        while len(self._recent) > RECENT_CACHE:
            self._recent.pop(next(iter(self._recent)))

    async def _to_incoming(self, event: Any) -> IncomingMessage:
        chat = await event.get_chat()
        sender = await event.get_sender()
        return IncomingMessage(
            message=to_message(event.message, fallback_sender=self._sender_fallback() if event.out else None),
            chat_kind=chat_kind(chat),
            chat_title=utils.get_display_name(chat) or "Чат",
            sender_is_bot=bool(getattr(sender, "bot", False)),
        )

    async def _on_edited(self, event: Any) -> None:
        if self._on_edit is None:
            return
        try:
            incoming = await self._to_incoming(event)
            self._remember(event.message, incoming)
            await self._on_edit(incoming)
        except Exception:
            log.exception("Failed to process edit update")

    async def _on_deleted(self, event: Any) -> None:
        self._dialogs = None
        if self._on_delete is None:
            return
        try:
            # chat_id is None for private chats and basic groups (ids are unique per account there).
            await self._on_delete(DeletedMessages(chat_id=event.chat_id, message_ids=list(event.deleted_ids)))
        except Exception:
            log.exception("Failed to process delete update")
