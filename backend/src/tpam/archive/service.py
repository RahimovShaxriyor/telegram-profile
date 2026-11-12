"""Keeps a local copy of messages as they arrive, so edits and deletions in Telegram don't erase them."""

from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from tpam.archive.importer import import_export
from tpam.core.errors import InvalidState, TpamError, ValidationFailed
from tpam.models import ArchiveSettings, ChatKind, DeletedMessages, ImportStatus, IncomingMessage
from tpam.providers.base import TelegramProvider
from tpam.storage.archive import ArchiveRepository, NewArchiveMessage
from tpam.storage.repositories import SettingsRepository

log = logging.getLogger(__name__)

ARCHIVE_SETTINGS_KEY = "archive_settings"


def in_scope(settings: ArchiveSettings, chat_id: int, kind: ChatKind) -> bool:
    if not settings.enabled:
        return False
    if chat_id in settings.chat_ids:
        return True
    if kind == "user":
        return settings.private_chats
    if kind in ("group", "supergroup"):
        return settings.groups
    return False  # bots and channels only when picked explicitly


def wants_media(settings: ArchiveSettings, kind: str, size: int | None, ttl: bool) -> bool:
    if ttl or settings.media == "none":
        return False
    if settings.media == "photos" and kind != "photo":
        return False
    return size is None or size <= settings.max_media_mb * 1024 * 1024


class ArchiveService:
    def __init__(
        self,
        repo: ArchiveRepository,
        settings: SettingsRepository,
        provider: TelegramProvider,
        media_dir: Path,
    ) -> None:
        self.repo = repo
        self._settings = settings
        self._provider = provider
        self._media_dir = media_dir
        self._import = ImportStatus()
        self._import_task: asyncio.Task[None] | None = None

    async def get_settings(self) -> ArchiveSettings:
        raw = await self._settings.get(ARCHIVE_SETTINGS_KEY)
        try:
            return ArchiveSettings.model_validate(raw) if raw else ArchiveSettings()
        except ValidationError:
            return ArchiveSettings()

    async def save_settings(self, value: ArchiveSettings) -> ArchiveSettings:
        await self._settings.set(ARCHIVE_SETTINGS_KEY, value.model_dump())
        return value

    # ---- live updates -------------------------------------------------------

    async def on_message(self, incoming: IncomingMessage) -> None:
        msg = incoming.message
        if msg.service:
            return
        settings = await self.get_settings()
        if not in_scope(settings, msg.chat_id, incoming.chat_kind):
            return
        await self.repo.upsert_chat(msg.chat_id, incoming.chat_title, incoming.chat_kind)
        media = msg.media
        pk = await self.repo.add(
            NewArchiveMessage(
                chat_id=msg.chat_id,
                message_id=msg.id,
                date=msg.date,
                sender_id=msg.sender_id,
                sender_name=msg.sender_name,
                outgoing=msg.outgoing,
                text=msg.text,
                reply_to_id=msg.reply_to_id,
                media_kind=media.kind if media else None,
                media_name=media.file_name if media else None,
                media_size=media.size if media else None,
                ttl=bool(media and media.ttl),
            )
        )
        if pk is not None and media and wants_media(settings, media.kind, media.size, media.ttl):
            await self._save_media(pk, msg.chat_id, msg.id, settings.max_media_mb)

    async def _save_media(self, pk: int, chat_id: int, message_id: int, max_mb: int) -> None:
        try:
            path = await self._provider.download_media(
                chat_id, message_id, dest_dir=self._media_dir / str(chat_id), max_bytes=max_mb * 1024 * 1024
            )
        except TpamError as exc:
            log.warning("Media not archived (%s)", exc.code)
            return
        if path is not None:
            await self.repo.set_media_path(pk, str(path))

    async def on_edit(self, incoming: IncomingMessage) -> None:
        msg = incoming.message
        settings = await self.get_settings()
        if not in_scope(settings, msg.chat_id, incoming.chat_kind):
            return
        if not await self.repo.record_edit(msg.chat_id, msg.id, msg.text, datetime.now(UTC)):
            await self.on_message(incoming)  # first time we see it (e.g. sent while TPAM was off)

    async def on_delete(self, deleted: DeletedMessages) -> None:
        count = await self.repo.mark_deleted(deleted.chat_id, deleted.message_ids, datetime.now(UTC))
        if count:
            log.info("Archive: %d message(s) deleted in Telegram kept locally", count)

    async def clear(self, chat_id: int | None) -> None:
        paths = await self.repo.clear(chat_id)
        await asyncio.to_thread(self._remove_files, paths, everything=chat_id is None)

    def _remove_files(self, paths: list[str], *, everything: bool) -> None:
        for path in paths:
            Path(path).unlink(missing_ok=True)
        if everything:
            shutil.rmtree(self._media_dir, ignore_errors=True)

    # ---- import -------------------------------------------------------------

    def import_status(self) -> ImportStatus:
        return self._import

    def start_import(self, folder: str, my_id: int | None, *, cleanup: bool = False) -> ImportStatus:
        """Imports result.json; with cleanup the (uploaded) folder is deleted afterwards."""
        if self._import.state == "running":
            raise InvalidState("Импорт уже идёт")
        path = Path(folder.strip().strip('"'))
        result_json = path / "result.json" if path.is_dir() else path
        if result_json.name != "result.json" or not result_json.is_file():
            raise ValidationFailed(
                "В папке нет файла result.json. Укажите папку экспорта Telegram Desktop (формат JSON)."
            )
        self._import = ImportStatus(
            state="running", path=str(result_json.parent), started_at=datetime.now(UTC)
        )
        self._import_task = asyncio.create_task(self._run_import(result_json, my_id, cleanup))
        return self._import

    async def _run_import(self, result_json: Path, my_id: int | None, cleanup: bool) -> None:
        def progress(**fields: object) -> None:
            self._import = self._import.model_copy(update=fields)

        try:
            await import_export(result_json, self.repo, my_id=my_id, progress=progress)
            progress(state="done", current_chat=None, finished_at=datetime.now(UTC))
        except Exception as exc:  # report any parser failure to the UI instead of dying silently
            log.exception("Archive import failed")
            message = (
                exc.message
                if isinstance(exc, TpamError)
                else f"Не удалось прочитать экспорт ({type(exc).__name__})"
            )
            progress(state="failed", error=message, finished_at=datetime.now(UTC))
        finally:
            if cleanup:
                await asyncio.to_thread(shutil.rmtree, result_json.parent, True)

    async def stop(self) -> None:
        if self._import_task and not self._import_task.done():
            self._import_task.cancel()
