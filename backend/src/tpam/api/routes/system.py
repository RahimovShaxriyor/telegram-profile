"""Status, overview, system info, demo helpers and (owner-only) server autostart."""

from __future__ import annotations

import platform
from typing import Literal

import telethon
from fastapi import APIRouter
from pydantic import BaseModel, Field

from tpam import __version__
from tpam.api.deps import DemoDep, OwnerDep, PrincipalDep, RuntimeDep, SessionDep, SpaceDep
from tpam.core import autostart
from tpam.models import AuditRecord, AutomationState, Message, Mode, ProviderStatus
from tpam.providers.base import MAX_TEXT_LENGTH

router = APIRouter(prefix="/api", tags=["system"])


class StatusOut(BaseModel):
    version: str
    mode: Mode
    connection: ProviderStatus
    automation_enabled: bool
    updates_version: int
    is_owner: bool


class KindCounts(BaseModel):
    user: int = 0
    bot: int = 0
    group: int = 0
    supergroup: int = 0
    channel: int = 0


class OverviewOut(BaseModel):
    dialogs_total: int
    dialogs_loaded: int
    kinds: KindCounts
    unread_chats: int
    rules_total: int
    rules_enabled: int
    automation: AutomationState
    recent_activity: list[AuditRecord]


class SystemOut(BaseModel):
    version: str
    python_version: str
    telethon_version: str
    platform: str
    database_size_bytes: int
    audit_entries: int
    data_location: str
    """Server path for the owner; a plain description for everyone else."""
    secure_connection: bool
    users_total: int | None = None


class DemoIncomingIn(BaseModel):
    chat_id: int
    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)


class DemoChangeIn(BaseModel):
    chat_id: int
    message_id: int
    text: str = Field(default="", max_length=MAX_TEXT_LENGTH)


class AutostartIn(BaseModel):
    enabled: bool


@router.get("/health")
async def health() -> dict[str, Literal["ok"]]:
    return {"status": "ok"}


@router.get("/status")
async def status(space: SpaceDep, session: SessionDep) -> StatusOut:
    return StatusOut(
        version=__version__,
        mode=session.mode,
        connection=await session.provider.status(),
        automation_enabled=await session.engine.is_enabled(),
        updates_version=space.updates_version,
        is_owner=space.is_owner,
    )


@router.get("/updates")
async def updates(space: SpaceDep) -> dict[str, int]:
    """Cheap poll target: the UI refetches Telegram data only when this number changes."""
    return {"version": space.updates_version}


@router.get("/overview")
async def overview(session: SessionDep) -> OverviewOut:
    dialogs = await session.provider.list_dialogs(limit=500)
    kinds = KindCounts()
    for d in dialogs.items:
        setattr(kinds, d.kind, getattr(kinds, d.kind) + 1)
    rules_total, rules_enabled = await session.rules.count()
    recent = await session.audit.list(limit=6)
    return OverviewOut(
        dialogs_total=dialogs.total,
        dialogs_loaded=len(dialogs.items),
        kinds=kinds,
        unread_chats=sum(1 for d in dialogs.items if d.unread_count),
        rules_total=rules_total,
        rules_enabled=rules_enabled,
        automation=await session.engine.state(),
        recent_activity=recent.items,
    )


@router.get("/system")
async def system_info(principal: PrincipalDep, runtime: RuntimeDep, session: SessionDep) -> SystemOut:
    owner = principal.is_owner
    return SystemOut(
        version=__version__,
        python_version=platform.python_version(),
        telethon_version=telethon.__version__,
        platform=f"{platform.system()} {platform.release()}",
        database_size_bytes=session.db.size_bytes(),
        audit_entries=await session.audit.total(),
        data_location=str(principal.space.data_dir)
        if owner
        else "Отдельная папка вашей учётной записи на сервере",
        secure_connection=runtime.settings.secure_cookies,
        users_total=await runtime.accounts.count_users() if owner else None,
    )


@router.post("/demo/reset", status_code=204)
async def demo_reset(space: SpaceDep, runtime: RuntimeDep, _demo: DemoDep) -> None:
    await space.reset_demo(runtime.settings.demo_latency_ms)


@router.post("/demo/incoming")
async def demo_incoming(body: DemoIncomingIn, demo: DemoDep) -> Message:
    return await demo.simulate_incoming(body.chat_id, body.text)


@router.post("/demo/edit")
async def demo_edit(body: DemoChangeIn, demo: DemoDep) -> Message:
    return await demo.simulate_edit(body.chat_id, body.message_id, body.text or "(изменено)")


@router.post("/demo/delete", status_code=204)
async def demo_delete(body: DemoChangeIn, demo: DemoDep) -> None:
    await demo.simulate_delete(body.chat_id, body.message_id)


@router.get("/system/autostart")
async def get_autostart(_owner: OwnerDep) -> dict[str, bool]:
    return {"enabled": autostart.is_enabled(), "supported": platform.system() == "Windows"}


@router.put("/system/autostart")
async def put_autostart(body: AutostartIn, _owner: OwnerDep, session: SessionDep) -> dict[str, bool]:
    autostart.set_enabled(body.enabled)
    await session.audit.add(
        source="system",
        action="system.autostart",
        status="success",
        detail="Автозапуск с Windows включён" if body.enabled else "Автозапуск выключен",
    )
    return {"enabled": autostart.is_enabled(), "supported": True}
