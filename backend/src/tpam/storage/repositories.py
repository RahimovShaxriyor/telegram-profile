"""Data access for audit log, automation rules and per-mode settings."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable, Collection
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select

from tpam.core.errors import NotFound, TpamError
from tpam.models import (
    AuditPage,
    AuditRecord,
    AuditSource,
    AuditStatus,
    Rule,
    RuleInput,
)
from tpam.storage.db import AuditRow, Database, RuleRow, SettingRow, utcnow

DETAIL_MAX = 300


def _audit_dto(row: AuditRow) -> AuditRecord:
    return AuditRecord.model_validate(row, from_attributes=True)


def _rule_dto(row: RuleRow) -> Rule:
    return Rule.model_validate(row, from_attributes=True)


@dataclass
class Tracked:
    """Mutable holder that `AuditRepository.track` fills while the action runs."""

    detail: str | None = None
    chat_title: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class AuditRepository:
    def __init__(self, db: Database, clock: Callable[[], datetime] = utcnow) -> None:
        self._db = db
        self._clock = clock

    async def add(
        self,
        *,
        source: AuditSource,
        action: str,
        status: AuditStatus,
        chat_id: int | None = None,
        chat_title: str | None = None,
        rule_id: int | None = None,
        rule_name: str | None = None,
        detail: str | None = None,
        error_code: str | None = None,
        duration_ms: int | None = None,
    ) -> AuditRecord:
        row = AuditRow(
            ts=self._clock(),
            source=source,
            action=action,
            status=status,
            chat_id=chat_id,
            chat_title=chat_title,
            rule_id=rule_id,
            rule_name=rule_name,
            detail=detail[:DETAIL_MAX] if detail else None,
            error_code=error_code,
            duration_ms=duration_ms,
        )
        async with self._db.sessions() as session, session.begin():
            session.add(row)
        return _audit_dto(row)

    @asynccontextmanager
    async def track(
        self,
        action: str,
        *,
        chat_id: int | None = None,
        chat_title: str | None = None,
        detail: str | None = None,
    ) -> AsyncIterator[Tracked]:
        """Audit a manual action: success with duration, or failure with the error code (re-raised)."""
        tracked = Tracked(detail=detail, chat_title=chat_title)
        started = time.perf_counter()
        try:
            yield tracked
        except TpamError as exc:
            await self.add(
                source="manual",
                action=action,
                status="failed",
                chat_id=chat_id,
                chat_title=tracked.chat_title,
                detail=exc.message,
                error_code=exc.code,
                duration_ms=_elapsed(started),
            )
            raise
        await self.add(
            source="manual",
            action=action,
            status="success",
            chat_id=chat_id,
            chat_title=tracked.chat_title,
            detail=tracked.detail,
            duration_ms=_elapsed(started),
        )

    async def list(
        self,
        *,
        source: str | None = None,
        status: str | None = None,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AuditPage:
        stmt = select(AuditRow)
        if source:
            stmt = stmt.where(AuditRow.source == source)
        if status:
            stmt = stmt.where(AuditRow.status == status)
        if query:
            like = f"%{query}%"
            stmt = stmt.where(
                AuditRow.detail.ilike(like)
                | AuditRow.chat_title.ilike(like)
                | AuditRow.action.ilike(like)
                | AuditRow.rule_name.ilike(like)
            )
        async with self._db.sessions() as session:
            total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
            rows = await session.scalars(stmt.order_by(AuditRow.id.desc()).limit(limit).offset(offset))
            return AuditPage(items=[_audit_dto(r) for r in rows], total=total)

    async def count(
        self,
        *,
        since: datetime,
        statuses: Collection[str],
        source: str | None = None,
        rule_id: int | None = None,
        chat_id: int | None = None,
    ) -> int:
        stmt = (
            select(func.count())
            .select_from(AuditRow)
            .where(AuditRow.ts >= since, AuditRow.status.in_(statuses))
        )
        if source:
            stmt = stmt.where(AuditRow.source == source)
        if rule_id is not None:
            stmt = stmt.where(AuditRow.rule_id == rule_id)
        if chat_id is not None:
            stmt = stmt.where(AuditRow.chat_id == chat_id)
        async with self._db.sessions() as session:
            return await session.scalar(stmt) or 0

    async def total(self) -> int:
        async with self._db.sessions() as session:
            return await session.scalar(select(func.count()).select_from(AuditRow)) or 0

    async def clear(self) -> int:
        async with self._db.sessions() as session, session.begin():
            result = await session.execute(delete(AuditRow))
            return result.rowcount or 0  # type: ignore[attr-defined]


def _elapsed(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


class RuleRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def list(self, *, enabled_only: bool = False) -> list[Rule]:
        stmt = select(RuleRow).order_by(RuleRow.id)
        if enabled_only:
            stmt = stmt.where(RuleRow.enabled.is_(True))
        async with self._db.sessions() as session:
            return [_rule_dto(r) for r in await session.scalars(stmt)]

    async def get(self, rule_id: int) -> Rule:
        async with self._db.sessions() as session:
            row = await session.get(RuleRow, rule_id)
            if row is None:
                raise NotFound("Правило не найдено")
            return _rule_dto(row)

    async def create(self, data: RuleInput) -> Rule:
        row = RuleRow(**data.model_dump())
        async with self._db.sessions() as session, session.begin():
            session.add(row)
        return _rule_dto(row)

    async def update(self, rule_id: int, data: RuleInput) -> Rule:
        async with self._db.sessions() as session, session.begin():
            row = await session.get(RuleRow, rule_id)
            if row is None:
                raise NotFound("Правило не найдено")
            for key, value in data.model_dump().items():
                setattr(row, key, value)
            row.updated_at = utcnow()
        return _rule_dto(row)

    async def delete(self, rule_id: int) -> None:
        async with self._db.sessions() as session, session.begin():
            row = await session.get(RuleRow, rule_id)
            if row is None:
                raise NotFound("Правило не найдено")
            await session.delete(row)

    async def count(self) -> tuple[int, int]:
        """(total, enabled)"""
        async with self._db.sessions() as session:
            total = await session.scalar(select(func.count()).select_from(RuleRow)) or 0
            enabled = (
                await session.scalar(
                    select(func.count()).select_from(RuleRow).where(RuleRow.enabled.is_(True))
                )
                or 0
            )
            return total, enabled


class SettingsRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def get(self, key: str, default: Any = None) -> Any:
        async with self._db.sessions() as session:
            row = await session.get(SettingRow, key)
            return default if row is None else row.value

    async def set(self, key: str, value: Any) -> None:
        async with self._db.sessions() as session, session.begin():
            await session.merge(SettingRow(key=key, value=value))
