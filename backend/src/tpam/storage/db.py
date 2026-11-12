"""SQLite engine, ORM tables and schema creation."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Connection,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
    inspect,
    text,
)
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class UtcDateTime(TypeDecorator[datetime]):
    """SQLite has no timezone support: store naive UTC, always return aware UTC."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None else None


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class AuditRow(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_rule_chat_ts", "rule_id", "chat_id", "ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, index=True)
    source: Mapped[str] = mapped_column(String(16))
    action: Mapped[str] = mapped_column(String(48))
    status: Mapped[str] = mapped_column(String(16), index=True)
    chat_id: Mapped[int | None] = mapped_column(Integer)
    chat_title: Mapped[str | None] = mapped_column(String(256))
    rule_id: Mapped[int | None] = mapped_column(Integer)
    rule_name: Mapped[str | None] = mapped_column(String(80))
    detail: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(48))
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class RuleRow(Base):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True)
    private_only: Mapped[bool] = mapped_column(Boolean, default=True)
    chat_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    match_mode: Mapped[str] = mapped_column(String(16))
    keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    pattern: Mapped[str] = mapped_column(String(200), default="")
    reply_mode: Mapped[str] = mapped_column(String(16), default="template", server_default="template")
    reply_text: Mapped[str] = mapped_column(Text)
    ai_instructions: Mapped[str] = mapped_column(Text, default="", server_default="")
    cooldown_minutes: Mapped[int] = mapped_column(Integer)
    daily_limit: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)


class ArchiveChatRow(Base):
    __tablename__ = "archive_chats"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    title: Mapped[str] = mapped_column(String(256))
    kind: Mapped[str] = mapped_column(String(16))
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)


class ArchiveMessageRow(Base):
    __tablename__ = "archive_messages"
    __table_args__ = (
        UniqueConstraint("chat_id", "message_id", name="uq_archive_chat_message"),
        Index("ix_archive_message_id", "message_id"),
        Index("ix_archive_chat_date", "chat_id", "date"),
        Index("ix_archive_deleted", "deleted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger)
    message_id: Mapped[int] = mapped_column(BigInteger)
    date: Mapped[datetime] = mapped_column(UtcDateTime)
    sender_id: Mapped[int | None] = mapped_column(BigInteger)
    sender_name: Mapped[str | None] = mapped_column(String(256))
    outgoing: Mapped[bool] = mapped_column(Boolean, default=False)
    text: Mapped[str] = mapped_column(Text, default="")
    reply_to_id: Mapped[int | None] = mapped_column(BigInteger)
    media_kind: Mapped[str | None] = mapped_column(String(16))
    media_name: Mapped[str | None] = mapped_column(String(256))
    media_size: Mapped[int | None] = mapped_column(BigInteger)
    media_path: Mapped[str | None] = mapped_column(Text)
    ttl: Mapped[bool] = mapped_column(Boolean, default=False)
    edited_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    source: Mapped[str] = mapped_column(String(8), default="live")
    archived_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class ArchiveEditRow(Base):
    __tablename__ = "archive_edits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_pk: Mapped[int] = mapped_column(Integer, index=True)
    old_text: Mapped[str] = mapped_column(Text)
    new_text: Mapped[str] = mapped_column(Text)
    edited_at: Mapped[datetime] = mapped_column(UtcDateTime)


class SettingRow(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.engine: AsyncEngine = create_async_engine(f"sqlite+aiosqlite:///{path.as_posix()}")
        event.listen(self.engine.sync_engine, "connect", _sqlite_pragmas)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, class_=AsyncSession)

    async def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(_add_missing_columns)
            for statement in _FTS_DDL:
                await conn.execute(text(statement))

    async def dispose(self) -> None:
        await self.engine.dispose()

    def size_bytes(self) -> int:
        return sum(
            p.stat().st_size for p in (self.path, self.path.with_name(self.path.name + "-wal")) if p.exists()
        )


def _sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def _add_missing_columns(conn: Connection) -> None:
    """Additive schema upgrade for databases created by an older version (new nullable/defaulted columns only)."""
    inspector = inspect(conn)
    for table in Base.metadata.sorted_tables:
        existing = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in existing:
                continue
            default = column.server_default.arg if column.server_default is not None else None  # type: ignore[attr-defined]
            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column.type.compile(conn.dialect)}'
            if default is not None:
                ddl += f" DEFAULT '{default}'"
            conn.execute(text(ddl))


# Full-text index over archived message text (external content, kept in sync by triggers).
# "ё" is folded to "е" on both sides because the unicode61 tokenizer treats them as different letters.
FOLD_YO = "replace(replace({col}, 'ё', 'е'), 'Ё', 'Е')"
_FTS_DDL = (
    "CREATE VIRTUAL TABLE IF NOT EXISTS archive_fts USING fts5("
    "text, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2')",
    "CREATE TRIGGER IF NOT EXISTS archive_fts_ai AFTER INSERT ON archive_messages BEGIN "
    f"INSERT INTO archive_fts(rowid, text) VALUES (new.id, {FOLD_YO.format(col='new.text')}); END",
    "CREATE TRIGGER IF NOT EXISTS archive_fts_ad AFTER DELETE ON archive_messages BEGIN "
    "DELETE FROM archive_fts WHERE rowid = old.id; END",
    "CREATE TRIGGER IF NOT EXISTS archive_fts_au AFTER UPDATE OF text ON archive_messages BEGIN "
    "DELETE FROM archive_fts WHERE rowid = old.id; "
    f"INSERT INTO archive_fts(rowid, text) VALUES (new.id, {FOLD_YO.format(col='new.text')}); END",
)
