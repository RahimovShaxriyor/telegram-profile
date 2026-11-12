"""Dialogs, messages, files, search, participants and channel publishing."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Query, UploadFile
from pydantic import BaseModel, Field, field_validator

from tpam.api.deps import SessionDep
from tpam.core.errors import ValidationFailed
from tpam.models import (
    ChatDetails,
    ChatKind,
    Dialog,
    DialogList,
    IncomingMessage,
    Message,
    MessagePage,
    Participant,
    SearchHit,
)
from tpam.providers.base import MAX_CAPTION_LENGTH, MAX_TEXT_LENGTH, MAX_UPLOAD_BYTES
from tpam.runtime import Session

router = APIRouter(prefix="/api", tags=["chats"])

KindFilter = Literal["all", "private", "groups", "channels"]
_KIND_GROUPS: dict[str, set[ChatKind]] = {
    "private": {"user", "bot"},
    "groups": {"group", "supergroup"},
    "channels": {"channel"},
}
MIN_SCHEDULE_DELAY = timedelta(seconds=30)
MAX_SCHEDULE_AHEAD = timedelta(days=365)
PREVIEW = 120


class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    reply_to: int | None = None

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Сообщение не может быть пустым")
        return value


class PublishIn(SendIn):
    schedule_at: datetime | None = None

    @field_validator("schedule_at")
    @classmethod
    def _aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Укажите время с часовым поясом")
        return value


def _title(session: Session, chat_id: int) -> str | None:
    return session.provider.cached_title(chat_id)


def _preview(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= PREVIEW else text[: PREVIEW - 1] + "…"


@router.get("/dialogs")
async def list_dialogs(
    session: SessionDep,
    kind: KindFilter = "all",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> DialogList:
    result = await session.provider.list_dialogs(limit=limit)
    if kind == "all":
        return result
    allowed = _KIND_GROUPS[kind]
    items: list[Dialog] = [d for d in result.items if d.kind in allowed]
    return DialogList(items=items, total=len(items))


@router.get("/chats/{chat_id}")
async def get_chat(chat_id: int, session: SessionDep) -> ChatDetails:
    return await session.provider.get_chat(chat_id)


@router.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: int,
    session: SessionDep,
    before_id: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 40,
) -> MessagePage:
    page = await session.provider.get_history(chat_id, limit=limit, before_id=before_id)
    return await _with_deleted(session, chat_id, page, before_id)


async def _with_deleted(
    session: Session, chat_id: int, page: MessagePage, before_id: int | None
) -> MessagePage:
    """Adds archived copies of messages that were deleted in Telegram into this page's id range."""
    if not page.items and before_id is not None:
        return page
    low = page.items[0].id if page.items and page.next_before_id is not None else None
    high = before_id - 1 if before_id is not None else None
    deleted = await session.archive.repo.deleted_between(chat_id, low, high)
    if not deleted:
        return page
    live_ids = {m.id for m in page.items}
    merged = sorted([*page.items, *(m for m in deleted if m.id not in live_ids)], key=lambda m: m.id)
    return MessagePage(items=merged, next_before_id=page.next_before_id)


async def _archive_sent(session: Session, message: Message) -> None:
    """Messages sent from TPAM itself may not come back as updates; archive them directly."""
    kind = session.provider.cached_kind(message.chat_id)
    if kind is not None:
        title = session.provider.cached_title(message.chat_id) or ""
        await session.archive.on_message(IncomingMessage(message=message, chat_kind=kind, chat_title=title))


@router.post("/chats/{chat_id}/messages", status_code=201)
async def send_message(chat_id: int, body: SendIn, session: SessionDep) -> Message:
    async with session.audit.track(
        "message.send",
        chat_id=chat_id,
        chat_title=_title(session, chat_id),
        detail=_preview(body.text),
    ):
        sent = await session.provider.send_message(chat_id, body.text, reply_to=body.reply_to)
    await _archive_sent(session, sent)
    return sent


@router.post("/chats/{chat_id}/files", status_code=201)
async def send_file(
    chat_id: int,
    session: SessionDep,
    file: Annotated[UploadFile, File()],
    caption: Annotated[str, Form(max_length=MAX_CAPTION_LENGTH)] = "",
    reply_to: Annotated[int | None, Form()] = None,
) -> Message:
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValidationFailed(f"Файл больше {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ")
    if not data:
        raise ValidationFailed("Файл пустой")
    name = (file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1][:120] or "file"
    async with session.audit.track(
        "file.send",
        chat_id=chat_id,
        chat_title=_title(session, chat_id),
        detail=f"Файл {name}",
    ):
        sent = await session.provider.send_file(
            chat_id, file_name=name, data=data, caption=caption, reply_to=reply_to
        )
    await _archive_sent(session, sent)
    return sent


@router.post("/chats/{chat_id}/read", status_code=204)
async def mark_read(chat_id: int, session: SessionDep) -> None:
    await session.provider.mark_read(chat_id)


@router.get("/chats/{chat_id}/participants")
async def participants(
    chat_id: int,
    session: SessionDep,
    q: Annotated[str, Query(max_length=64)] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[Participant]:
    return await session.provider.get_participants(chat_id, query=q.strip(), limit=limit)


@router.get("/search")
async def search(
    session: SessionDep,
    q: Annotated[str, Query(min_length=2, max_length=128)],
    chat_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[SearchHit]:
    return await session.provider.search(q.strip(), chat_id=chat_id, limit=limit)


@router.post("/chats/{chat_id}/posts", status_code=201)
async def publish(chat_id: int, body: PublishIn, session: SessionDep) -> Message:
    if body.schedule_at is not None:
        now = datetime.now(UTC)
        if body.schedule_at < now + MIN_SCHEDULE_DELAY:
            raise ValidationFailed("Время публикации должно быть хотя бы на минуту позже текущего")
        if body.schedule_at > now + MAX_SCHEDULE_AHEAD:
            raise ValidationFailed("Telegram позволяет планировать публикации не более чем на год вперёд")
    action = "post.schedule" if body.schedule_at else "post.publish"
    detail = _preview(body.text)
    if body.schedule_at:
        detail = f"На {body.schedule_at.astimezone(UTC):%d.%m.%Y %H:%M} UTC: {detail}"
    async with session.audit.track(
        action, chat_id=chat_id, chat_title=_title(session, chat_id), detail=detail
    ):
        return await session.provider.publish(chat_id, body.text, schedule_at=body.schedule_at)


@router.get("/chats/{chat_id}/scheduled")
async def list_scheduled(chat_id: int, session: SessionDep) -> list[Message]:
    return await session.provider.list_scheduled(chat_id)


@router.delete("/chats/{chat_id}/scheduled/{message_id}", status_code=204)
async def cancel_scheduled(chat_id: int, message_id: int, session: SessionDep) -> None:
    async with session.audit.track(
        "post.cancel",
        chat_id=chat_id,
        chat_title=_title(session, chat_id),
        detail=f"Отменена публикация #{message_id}",
    ):
        await session.provider.cancel_scheduled(chat_id, message_id)
