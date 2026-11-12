"""Local archive of Telegram messages: stores, edits history, deletions, full-text search."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy import delete as sql_delete
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.sqlite import insert

from tpam.models import (
    ArchiveChat,
    ArchivedMessage,
    ArchiveEdit,
    ArchivePage,
    ArchiveStats,
    ChatKind,
    Media,
    Message,
)
from tpam.storage.db import ArchiveChatRow, ArchiveEditRow, ArchiveMessageRow, Database, utcnow

# Chats where Telegram reports deletions without a chat id (message ids are unique per account there).
_ACCOUNT_SCOPED_KINDS = ("user", "bot", "group")
ArchiveFilter = Literal["all", "deleted", "edited"]


def fold(text: str) -> str:
    return text.replace("ё", "е").replace("Ё", "Е")


def fts_query(query: str) -> str | None:
    """User text → safe FTS5 query: every word must match as a prefix."""
    tokens = re.findall(r"\w+", fold(query))
    return " ".join(f'"{t}"*' for t in tokens[:12]) or None


@dataclass
class NewArchiveMessage:
    chat_id: int
    message_id: int
    date: datetime
    sender_id: int | None
    sender_name: str | None
    outgoing: bool
    text: str
    reply_to_id: int | None
    media_kind: str | None
    media_name: str | None
    media_size: int | None
    ttl: bool
    source: str = "live"
    media_path: str | None = None
    edited_at: datetime | None = None

    def as_row(self) -> dict[str, Any]:
        return {**self.__dict__, "archived_at": utcnow()}


def _to_dto(row: ArchiveMessageRow, chat_title: str | None, edit_count: int) -> ArchivedMessage:
    media = (
        Media(kind=row.media_kind, file_name=row.media_name, size=row.media_size, ttl=row.ttl)
        if row.media_kind
        else None
    )
    return ArchivedMessage(
        id=row.id,
        chat_id=row.chat_id,
        chat_title=chat_title,
        message_id=row.message_id,
        date=row.date,
        sender_name=row.sender_name,
        outgoing=row.outgoing,
        text=row.text,
        reply_to_id=row.reply_to_id,
        media=media,
        has_file=bool(row.media_path),
        edited_at=row.edited_at,
        deleted_at=row.deleted_at,
        edit_count=edit_count,
        source=row.source,
    )


class ArchiveRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    # ---- writes -------------------------------------------------------------

    async def upsert_chat(self, chat_id: int, title: str, kind: ChatKind) -> None:
        stmt = insert(ArchiveChatRow).values(id=chat_id, title=title, kind=kind, updated_at=utcnow())
        stmt = stmt.on_conflict_do_update(
            index_elements=[ArchiveChatRow.id], set_={"title": title, "kind": kind, "updated_at": utcnow()}
        )
        async with self._db.sessions() as session, session.begin():
            await session.execute(stmt)

    async def add(self, message: NewArchiveMessage) -> int | None:
        """Inserts once per (chat, message); returns the row id only when it was new."""
        stmt = (
            insert(ArchiveMessageRow)
            .values(**message.as_row())
            .on_conflict_do_nothing()
            .returning(ArchiveMessageRow.id)
        )
        async with self._db.sessions() as session, session.begin():
            return (await session.execute(stmt)).scalar_one_or_none()

    async def add_many(self, messages: Sequence[NewArchiveMessage]) -> int:
        if not messages:
            return 0
        async with self._db.sessions() as session, session.begin():
            before = await session.scalar(select(func.count()).select_from(ArchiveMessageRow)) or 0
            for start in range(0, len(messages), 500):
                chunk = [m.as_row() for m in messages[start : start + 500]]
                await session.execute(insert(ArchiveMessageRow).values(chunk).on_conflict_do_nothing())
            after = await session.scalar(select(func.count()).select_from(ArchiveMessageRow)) or 0
            return after - before

    async def set_media_path(self, pk: int, path: str) -> None:
        async with self._db.sessions() as session, session.begin():
            await session.execute(
                update(ArchiveMessageRow).where(ArchiveMessageRow.id == pk).values(media_path=path)
            )

    async def record_edit(self, chat_id: int, message_id: int, new_text: str, edited_at: datetime) -> bool:
        async with self._db.sessions() as session, session.begin():
            row = await session.scalar(
                select(ArchiveMessageRow).where(
                    ArchiveMessageRow.chat_id == chat_id, ArchiveMessageRow.message_id == message_id
                )
            )
            if row is None or row.text == new_text:
                return False
            session.add(
                ArchiveEditRow(message_pk=row.id, old_text=row.text, new_text=new_text, edited_at=edited_at)
            )
            row.text = new_text
            row.edited_at = edited_at
            return True

    async def mark_deleted(self, chat_id: int | None, message_ids: Sequence[int], when: datetime) -> int:
        if not message_ids:
            return 0
        condition = and_(
            ArchiveMessageRow.message_id.in_(message_ids), ArchiveMessageRow.deleted_at.is_(None)
        )
        if chat_id is not None:
            condition = and_(condition, ArchiveMessageRow.chat_id == chat_id)
        else:
            scoped = select(ArchiveChatRow.id).where(ArchiveChatRow.kind.in_(_ACCOUNT_SCOPED_KINDS))
            condition = and_(condition, ArchiveMessageRow.chat_id.in_(scoped))
        async with self._db.sessions() as session, session.begin():
            result = await session.execute(update(ArchiveMessageRow).where(condition).values(deleted_at=when))
            return result.rowcount or 0  # type: ignore[attr-defined]

    async def clear(self, chat_id: int | None = None) -> list[str]:
        """Deletes archived messages; returns media paths so the caller can remove the files."""
        where = [ArchiveMessageRow.chat_id == chat_id] if chat_id is not None else []
        async with self._db.sessions() as session, session.begin():
            paths = list(
                await session.scalars(
                    select(ArchiveMessageRow.media_path).where(
                        ArchiveMessageRow.media_path.is_not(None), *where
                    )
                )
            )
            pks = select(ArchiveMessageRow.id).where(*where)
            await session.execute(sql_delete(ArchiveEditRow).where(ArchiveEditRow.message_pk.in_(pks)))
            await session.execute(sql_delete(ArchiveMessageRow).where(*where))
            if chat_id is not None:
                await session.execute(sql_delete(ArchiveChatRow).where(ArchiveChatRow.id == chat_id))
            else:
                await session.execute(sql_delete(ArchiveChatRow))
        return [p for p in paths if p]

    # ---- reads --------------------------------------------------------------

    async def deleted_between(self, chat_id: int, low: int | None, high: int | None) -> list[Message]:
        """Archived copies of messages deleted in Telegram, to show them inside the live chat view."""
        stmt = select(ArchiveMessageRow).where(
            ArchiveMessageRow.chat_id == chat_id, ArchiveMessageRow.deleted_at.is_not(None)
        )
        if low is not None:
            stmt = stmt.where(ArchiveMessageRow.message_id >= low)
        if high is not None:
            stmt = stmt.where(ArchiveMessageRow.message_id <= high)
        async with self._db.sessions() as session:
            rows = await session.scalars(stmt.order_by(ArchiveMessageRow.message_id).limit(500))
            return [
                Message(
                    id=r.message_id,
                    chat_id=r.chat_id,
                    date=r.date,
                    text=r.text,
                    outgoing=r.outgoing,
                    sender_id=r.sender_id,
                    sender_name=r.sender_name,
                    reply_to_id=r.reply_to_id,
                    media=Media(kind=r.media_kind, file_name=r.media_name, size=r.media_size, ttl=r.ttl)
                    if r.media_kind
                    else None,
                    edited=r.edited_at is not None,
                    deleted=True,
                )
                for r in rows
            ]

    async def search(
        self,
        *,
        query: str = "",
        chat_id: int | None = None,
        only: ArchiveFilter = "all",
        offset: int = 0,
        limit: int = 50,
    ) -> ArchivePage:
        edits = (
            select(ArchiveEditRow.message_pk, func.count().label("n"))
            .group_by(ArchiveEditRow.message_pk)
            .subquery()
        )
        stmt = (
            select(ArchiveMessageRow, ArchiveChatRow.title, func.coalesce(edits.c.n, 0))
            .outerjoin(ArchiveChatRow, ArchiveChatRow.id == ArchiveMessageRow.chat_id)
            .outerjoin(edits, edits.c.message_pk == ArchiveMessageRow.id)
        )
        conditions: list[Any] = []
        if chat_id is not None:
            conditions.append(ArchiveMessageRow.chat_id == chat_id)
        if only == "deleted":
            conditions.append(ArchiveMessageRow.deleted_at.is_not(None))
        elif only == "edited":
            conditions.append(ArchiveMessageRow.edited_at.is_not(None))
        match = fts_query(query)
        if match:
            conditions.append(
                ArchiveMessageRow.id.in_(
                    select(sql_text("rowid"))
                    .select_from(sql_text("archive_fts"))
                    .where(sql_text("archive_fts MATCH :q"))
                )
            )
        stmt = stmt.where(*conditions)
        count_stmt = select(func.count()).select_from(ArchiveMessageRow).where(*conditions)
        params = {"q": match} if match else {}
        async with self._db.sessions() as session:
            total = await session.scalar(count_stmt, params) or 0
            result = await session.execute(
                stmt.order_by(ArchiveMessageRow.date.desc(), ArchiveMessageRow.id.desc())
                .offset(offset)
                .limit(limit),
                params,
            )
            items = [_to_dto(row, title, n) for row, title, n in result.all()]
        next_cursor = offset + limit if offset + limit < total else None
        return ArchivePage(items=items, total=total, next_cursor=next_cursor)

    async def iterate(self, *, chat_id: int | None, only: ArchiveFilter) -> AsyncIterator[ArchivedMessage]:
        offset = 0
        while True:
            page = await self.search(chat_id=chat_id, only=only, offset=offset, limit=1000)
            for item in page.items:
                yield item
            if page.next_cursor is None:
                return
            offset = page.next_cursor

    async def edits(self, pk: int) -> list[ArchiveEdit]:
        async with self._db.sessions() as session:
            rows = await session.scalars(
                select(ArchiveEditRow)
                .where(ArchiveEditRow.message_pk == pk)
                .order_by(ArchiveEditRow.edited_at)
            )
            return [
                ArchiveEdit(old_text=r.old_text, new_text=r.new_text, edited_at=r.edited_at) for r in rows
            ]

    async def media_path(self, pk: int) -> str | None:
        async with self._db.sessions() as session:
            return await session.scalar(
                select(ArchiveMessageRow.media_path).where(ArchiveMessageRow.id == pk)
            )

    async def chats(self) -> list[ArchiveChat]:
        stmt = (
            select(
                ArchiveChatRow,
                func.count(ArchiveMessageRow.id),
                func.count(ArchiveMessageRow.deleted_at),
                func.count(ArchiveMessageRow.edited_at),
                func.max(ArchiveMessageRow.date),
            )
            .join(ArchiveMessageRow, ArchiveMessageRow.chat_id == ArchiveChatRow.id)
            .group_by(ArchiveChatRow.id)
            .order_by(func.max(ArchiveMessageRow.date).desc())
        )
        async with self._db.sessions() as session:
            rows = (await session.execute(stmt)).all()
        return [
            ArchiveChat(
                id=chat.id,
                title=chat.title,
                kind=chat.kind,
                messages=n,
                deleted=d,
                edited=e,
                last_date=last.replace(tzinfo=utcnow().tzinfo) if last and last.tzinfo is None else last,
            )
            for chat, n, d, e, last in rows
        ]

    async def stats(self) -> ArchiveStats:
        async with self._db.sessions() as session:
            messages, deleted, edited, media_files, media_bytes = (
                await session.execute(
                    select(
                        func.count(ArchiveMessageRow.id),
                        func.count(ArchiveMessageRow.deleted_at),
                        func.count(ArchiveMessageRow.edited_at),
                        func.count(ArchiveMessageRow.media_path),
                        func.coalesce(
                            func.sum(ArchiveMessageRow.media_size).filter(
                                ArchiveMessageRow.media_path.is_not(None)
                            ),
                            0,
                        ),
                    )
                )
            ).one()
            chats = await session.scalar(select(func.count()).select_from(ArchiveChatRow)) or 0
        return ArchiveStats(
            messages=messages,
            deleted=deleted,
            edited=edited,
            chats=chats,
            media_files=media_files,
            media_bytes=int(media_bytes or 0),
            database_bytes=self._db.size_bytes(),
        )

    async def chat_kinds(self, chat_ids: Sequence[int]) -> dict[int, str]:
        async with self._db.sessions() as session:
            rows = await session.execute(
                select(ArchiveChatRow.id, ArchiveChatRow.kind).where(
                    or_(*(ArchiveChatRow.id == c for c in chat_ids))
                )
            )
            return {cid: kind for cid, kind in rows.all()}
