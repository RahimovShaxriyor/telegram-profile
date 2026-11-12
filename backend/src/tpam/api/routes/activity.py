"""Audit log browsing and cleanup."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from tpam.api.deps import SessionDep
from tpam.models import AuditPage, AuditSource, AuditStatus

router = APIRouter(prefix="/api", tags=["activity"])


@router.get("/activity")
async def list_activity(
    session: SessionDep,
    source: AuditSource | None = None,
    status: AuditStatus | None = None,
    q: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AuditPage:
    return await session.audit.list(
        source=source,
        status=status,
        query=q.strip() or None,
        limit=limit,
        offset=offset,
    )


@router.delete("/activity")
async def clear_activity(session: SessionDep) -> dict[str, int]:
    removed = await session.audit.clear()
    await session.audit.add(
        source="system",
        action="activity.clear",
        status="success",
        detail=f"Журнал очищен (удалено записей: {removed})",
    )
    return {"removed": removed}
