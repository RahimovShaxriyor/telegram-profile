"""Contract every Telegram data source implements (demo data or real Telethon client)."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Protocol

from tpam.models import (
    ChatDetails,
    ChatKind,
    DeletedMessages,
    DialogList,
    IncomingMessage,
    Message,
    MessagePage,
    Mode,
    Participant,
    ProviderStatus,
    SearchHit,
)

MessageHandler = Callable[[IncomingMessage], Awaitable[None]]
DeleteHandler = Callable[[DeletedMessages], Awaitable[None]]

MAX_TEXT_LENGTH = 4096
MAX_CAPTION_LENGTH = 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


class TelegramProvider(Protocol):
    mode: Mode

    async def start(self) -> None: ...

    async def stop(self) -> None: ...

    def set_message_handler(self, handler: MessageHandler | None) -> None: ...

    def cached_title(self, chat_id: int) -> str | None:
        """Chat title from local cache only (never hits the network); used for audit records."""
        ...

    def cached_kind(self, chat_id: int) -> ChatKind | None:
        """Chat kind from local cache only (never hits the network)."""
        ...

    def set_change_handlers(self, on_edit: MessageHandler | None, on_delete: DeleteHandler | None) -> None:
        """Edits arrive as IncomingMessage with the new text; deletions as message ids."""
        ...

    async def download_media(
        self, chat_id: int, message_id: int, *, dest_dir: Path, max_bytes: int
    ) -> Path | None:
        """Saves the message media to dest_dir (skips view-once media and files over max_bytes)."""
        ...

    async def status(self) -> ProviderStatus: ...

    async def list_dialogs(self, limit: int) -> DialogList: ...

    async def get_chat(self, chat_id: int) -> ChatDetails: ...

    async def get_history(self, chat_id: int, *, limit: int, before_id: int | None) -> MessagePage: ...

    async def send_message(self, chat_id: int, text: str, *, reply_to: int | None) -> Message: ...

    async def send_file(
        self,
        chat_id: int,
        *,
        file_name: str,
        data: bytes,
        caption: str,
        reply_to: int | None,
    ) -> Message: ...

    async def mark_read(self, chat_id: int) -> None: ...

    async def search(self, query: str, *, chat_id: int | None, limit: int) -> list[SearchHit]: ...

    async def get_participants(self, chat_id: int, *, query: str, limit: int) -> list[Participant]: ...

    async def publish(self, chat_id: int, text: str, *, schedule_at: datetime | None) -> Message: ...

    async def list_scheduled(self, chat_id: int) -> list[Message]: ...

    async def cancel_scheduled(self, chat_id: int, message_id: int) -> None: ...
