"""server.db: user accounts (encrypted Telegram sessions) and browser sessions.

Each user's own data (rules, audit, archive) lives in users/<id>/telegram.db, so one user's
data never shares a table with another's.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import BigInteger, Boolean, String, Text, delete, event, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from tpam.storage.db import UtcDateTime, _sqlite_pragmas, utcnow


class AccountsBase(DeclarativeBase):
    pass


class UserRow(AccountsBase):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    """Telegram user id."""
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str | None] = mapped_column(String(128))
    username: Mapped[str | None] = mapped_column(String(64))
    phone_masked: Mapped[str | None] = mapped_column(String(32))
    phone_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    session_enc: Mapped[str] = mapped_column(Text)
    ai_key_enc: Mapped[str | None] = mapped_column(Text)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    last_login_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class WebSessionRow(AccountsBase):
    __tablename__ = "web_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    guest_id: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(256))


class ServerSettingRow(AccountsBase):
    __tablename__ = "server_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


@dataclass(frozen=True)
class StoredUser:
    id: int
    first_name: str
    last_name: str | None
    username: str | None
    phone_masked: str | None
    session_enc: str
    ai_key_enc: str | None
    is_owner: bool
    disabled: bool
    created_at: datetime
    last_login_at: datetime

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name or ''}".strip() or (self.username or str(self.id))


@dataclass(frozen=True)
class WebSession:
    token_hash: str
    user_id: int | None
    guest_id: str | None
    expires_at: datetime
    last_seen_at: datetime


def _user(row: UserRow) -> StoredUser:
    return StoredUser(
        id=row.id,
        first_name=row.first_name,
        last_name=row.last_name,
        username=row.username,
        phone_masked=row.phone_masked,
        session_enc=row.session_enc,
        ai_key_enc=row.ai_key_enc,
        is_owner=row.is_owner,
        disabled=row.disabled,
        created_at=row.created_at,
        last_login_at=row.last_login_at,
    )


class AccountStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{path.as_posix()}")
        event.listen(self.engine.sync_engine, "connect", _sqlite_pragmas)
        self._sessions = async_sessionmaker(self.engine, expire_on_commit=False, class_=AsyncSession)

    async def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        async with self.engine.begin() as conn:
            await conn.run_sync(AccountsBase.metadata.create_all)

    async def dispose(self) -> None:
        await self.engine.dispose()

    # ---- users --------------------------------------------------------------

    async def get_user(self, user_id: int) -> StoredUser | None:
        async with self._sessions() as session:
            row = await session.get(UserRow, user_id)
            return _user(row) if row else None

    async def list_users(self) -> list[StoredUser]:
        async with self._sessions() as session:
            return [_user(r) for r in await session.scalars(select(UserRow).order_by(UserRow.created_at))]

    async def count_users(self) -> int:
        async with self._sessions() as session:
            return await session.scalar(select(func.count()).select_from(UserRow)) or 0

    async def phone_known(self, phone_hash: str) -> bool:
        async with self._sessions() as session:
            return (
                await session.scalar(select(UserRow.id).where(UserRow.phone_hash == phone_hash)) is not None
            )

    async def upsert_user(self, **fields: Any) -> StoredUser:
        async with self._sessions() as session, session.begin():
            row = await session.get(UserRow, fields["id"])
            if row is None:
                row = UserRow(**fields)
                session.add(row)
            else:
                for key, value in fields.items():
                    setattr(row, key, value)
        return _user(row)

    async def update_user(self, user_id: int, **fields: Any) -> None:
        async with self._sessions() as session, session.begin():
            await session.execute(update(UserRow).where(UserRow.id == user_id).values(**fields))

    async def delete_user(self, user_id: int) -> None:
        async with self._sessions() as session, session.begin():
            await session.execute(delete(UserRow).where(UserRow.id == user_id))
            await session.execute(delete(WebSessionRow).where(WebSessionRow.user_id == user_id))

    # ---- browser sessions ---------------------------------------------------

    async def create_web_session(
        self,
        token_hash: str,
        *,
        user_id: int | None,
        guest_id: str | None,
        days: int,
        ip: str | None,
        user_agent: str | None,
    ) -> None:
        now = utcnow()
        async with self._sessions() as session, session.begin():
            session.add(
                WebSessionRow(
                    token_hash=token_hash,
                    user_id=user_id,
                    guest_id=guest_id,
                    created_at=now,
                    last_seen_at=now,
                    expires_at=now + timedelta(days=days),
                    ip=ip,
                    user_agent=(user_agent or "")[:256],
                )
            )

    async def get_web_session(self, token_hash: str) -> WebSession | None:
        async with self._sessions() as session:
            row = await session.get(WebSessionRow, token_hash)
            if row is None or row.expires_at <= utcnow():
                return None
            return WebSession(row.token_hash, row.user_id, row.guest_id, row.expires_at, row.last_seen_at)

    async def touch_web_session(self, token_hash: str, days: int) -> None:
        now = utcnow()
        async with self._sessions() as session, session.begin():
            await session.execute(
                update(WebSessionRow)
                .where(WebSessionRow.token_hash == token_hash)
                .values(last_seen_at=now, expires_at=now + timedelta(days=days))
            )

    async def delete_web_session(self, token_hash: str) -> None:
        async with self._sessions() as session, session.begin():
            await session.execute(delete(WebSessionRow).where(WebSessionRow.token_hash == token_hash))

    async def delete_user_web_sessions(self, user_id: int) -> int:
        async with self._sessions() as session, session.begin():
            result = await session.execute(delete(WebSessionRow).where(WebSessionRow.user_id == user_id))
            return result.rowcount or 0  # type: ignore[attr-defined]

    async def purge_expired(self) -> list[str]:
        """Removes expired browser sessions; returns guest ids whose demo data can be deleted."""
        now = utcnow()
        async with self._sessions() as session, session.begin():
            guests = list(
                await session.scalars(
                    select(WebSessionRow.guest_id).where(
                        WebSessionRow.expires_at <= now, WebSessionRow.guest_id.is_not(None)
                    )
                )
            )
            await session.execute(delete(WebSessionRow).where(WebSessionRow.expires_at <= now))
        return [g for g in guests if g]

    # ---- server settings ----------------------------------------------------

    async def get_setting(self, key: str) -> str | None:
        async with self._sessions() as session:
            row = await session.get(ServerSettingRow, key)
            return row.value if row else None

    async def set_setting(self, key: str, value: str) -> None:
        async with self._sessions() as session, session.begin():
            await session.merge(ServerSettingRow(key=key, value=value))
