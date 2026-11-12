"""Local message archive: settings, search, deleted/edited filters, media, import, CSV export."""

from __future__ import annotations

import asyncio
import csv
import io
import secrets
import shutil
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from tpam.api.deps import OwnerDep, SessionDep, SpaceDep
from tpam.core.errors import NotFound, ValidationFailed
from tpam.models import (
    ArchiveChat,
    ArchiveEdit,
    ArchivePage,
    ArchiveSettings,
    ArchiveStats,
    ImportStatus,
)
from tpam.storage.archive import ArchiveFilter

router = APIRouter(prefix="/api/archive", tags=["archive"])


class ImportIn(BaseModel):
    path: str = Field(min_length=3, max_length=1000)


@router.get("/settings")
async def get_settings(session: SessionDep) -> ArchiveSettings:
    return await session.archive.get_settings()


@router.put("/settings")
async def put_settings(body: ArchiveSettings, session: SessionDep) -> ArchiveSettings:
    saved = await session.archive.save_settings(body)
    await session.audit.add(
        source="system",
        action="archive.settings",
        status="success",
        detail="Настройки архива обновлены" + ("" if body.enabled else " (архив выключен)"),
    )
    return saved


@router.get("/stats")
async def stats(session: SessionDep) -> ArchiveStats:
    return await session.archive.repo.stats()


@router.get("/chats")
async def chats(session: SessionDep) -> list[ArchiveChat]:
    return await session.archive.repo.chats()


@router.get("/messages")
async def messages(
    session: SessionDep,
    q: Annotated[str, Query(max_length=200)] = "",
    chat_id: int | None = None,
    only: ArchiveFilter = "all",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ArchivePage:
    return await session.archive.repo.search(query=q, chat_id=chat_id, only=only, offset=offset, limit=limit)


@router.get("/messages/{pk}/edits")
async def edits(pk: int, session: SessionDep) -> list[ArchiveEdit]:
    return await session.archive.repo.edits(pk)


@router.get("/messages/{pk}/media")
async def media(pk: int, session: SessionDep) -> FileResponse:
    path = await session.archive.repo.media_path(pk)
    # Only paths the archive itself recorded (downloaded media or files from the user's export).
    if not path or not await asyncio.to_thread(Path(path).is_file):
        raise NotFound("Файл не сохранён в архиве")
    return FileResponse(path, filename=Path(path).name, content_disposition_type="inline")


@router.get("/export.csv")
async def export_csv(
    session: SessionDep, chat_id: int | None = None, only: ArchiveFilter = "all"
) -> StreamingResponse:
    async def rows() -> AsyncIterator[str]:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "Дата (UTC)",
                "Чат",
                "Отправитель",
                "Исходящее",
                "Текст",
                "Вложение",
                "Изменено",
                "Удалено",
                "ID сообщения",
            ]
        )
        yield "﻿" + buffer.getvalue()  # BOM so Excel opens UTF-8 correctly
        async for m in session.archive.repo.iterate(chat_id=chat_id, only=only):
            buffer.seek(0)
            buffer.truncate()
            writer.writerow(
                [
                    _fmt(m.date),
                    m.chat_title or m.chat_id,
                    m.sender_name or "",
                    "да" if m.outgoing else "",
                    m.text,
                    (m.media.file_name or m.media.kind) if m.media else "",
                    _fmt(m.edited_at),
                    _fmt(m.deleted_at),
                    m.message_id,
                ]
            )
            yield buffer.getvalue()

    return StreamingResponse(
        rows(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="tpam-archive.csv"'},
    )


def _fmt(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S") if value else ""


@router.get("/import")
async def import_status(session: SessionDep) -> ImportStatus:
    return session.archive.import_status()


@router.post("/import", status_code=202)
async def start_import(body: ImportIn, owner: OwnerDep, session: SessionDep) -> ImportStatus:
    """Import from a folder on the server — owner only (other users upload the file instead)."""
    started = session.archive.start_import(body.path, owner.space.user_id)
    await session.audit.add(
        source="system",
        action="archive.import",
        status="success",
        detail=f"Импорт экспорта Telegram из {started.path}",
    )
    return started


@router.delete("")
async def clear(session: SessionDep, chat_id: int | None = None) -> dict[str, bool]:
    await session.archive.clear(chat_id)
    await session.audit.add(
        source="system",
        action="archive.clear",
        status="success",
        detail="Архив очищен" if chat_id is None else f"Архив чата {chat_id} очищен",
    )
    return {"ok": True}


MAX_IMPORT_BYTES = 1024 * 1024 * 1024
CHUNK = 1024 * 1024


@router.post("/import/upload", status_code=202)
async def upload_import(
    file: Annotated[UploadFile, File()], space: SpaceDep, session: SessionDep
) -> ImportStatus:
    """Import from an uploaded result.json (text only: media files stay on the user's computer)."""
    if not (file.filename or "").lower().endswith(".json"):
        raise ValidationFailed("Выберите файл result.json из папки экспорта Telegram")
    folder = space.data_dir / "imports" / secrets.token_hex(8)
    await asyncio.to_thread(folder.mkdir, parents=True, exist_ok=True)
    target = folder / "result.json"
    written = 0
    with target.open("wb") as out:
        while chunk := await file.read(CHUNK):
            written += len(chunk)
            if written > MAX_IMPORT_BYTES:
                out.close()
                await asyncio.to_thread(shutil.rmtree, folder, True)
                raise ValidationFailed("Файл больше 1 ГБ")
            out.write(chunk)
    started = session.archive.start_import(str(folder), space.user_id, cleanup=True)
    await session.audit.add(
        source="system",
        action="archive.import",
        status="success",
        detail="Импорт загруженного экспорта Telegram",
    )
    return started
