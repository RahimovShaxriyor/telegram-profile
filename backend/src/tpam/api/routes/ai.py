"""AI assistant: API key, persona / knowledge base, and a preview that never sends anything."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field, SecretStr

from tpam.ai.assistant import MODEL
from tpam.ai.settings import load_ai_settings, save_ai_settings
from tpam.api.deps import SessionDep, SpaceDep
from tpam.models import AiResult, AiSettings, AiStatus, ChatKind, Message

router = APIRouter(prefix="/api/ai", tags=["ai"])


class KeyIn(BaseModel):
    api_key: SecretStr = Field(min_length=20, max_length=300)


class PreviewIn(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
    instructions: str = Field(default="", max_length=2000)
    chat_kind: ChatKind = "user"
    sender_name: str = Field(default="Собеседник", max_length=80)


async def _status(space: SpaceDep, session: SessionDep) -> AiStatus:
    source = space.ai.key_source()
    return AiStatus(
        configured=source is not None,
        key_source=source,
        model=MODEL,
        settings=await load_ai_settings(session.settings),
    )


@router.get("")
async def ai_status(space: SpaceDep, session: SessionDep) -> AiStatus:
    return await _status(space, session)


@router.put("/settings")
async def update_settings(body: AiSettings, space: SpaceDep, session: SessionDep) -> AiStatus:
    await save_ai_settings(session.settings, body)
    await session.audit.add(
        source="system", action="ai.settings", status="success", detail="Настройки ИИ обновлены"
    )
    return await _status(space, session)


@router.put("/key")
async def set_key(body: KeyIn, space: SpaceDep, session: SessionDep) -> AiStatus:
    await space.ai.verify_and_save_key(body.api_key.get_secret_value())
    await session.audit.add(
        source="system",
        action="ai.key",
        status="success",
        detail="Ключ Anthropic API сохранён в системном хранилище",
    )
    return await _status(space, session)


@router.delete("/key")
async def delete_key(space: SpaceDep, session: SessionDep) -> AiStatus:
    await space.ai.forget_key()
    await session.audit.add(
        source="system", action="ai.key_delete", status="success", detail="Ключ Anthropic API удалён"
    )
    return await _status(space, session)


@router.post("/preview")
async def preview(body: PreviewIn, space: SpaceDep, session: SessionDep) -> AiResult:
    """Drafts a reply to a sample message. Nothing is sent or written to Telegram."""
    incoming = Message(
        id=1, chat_id=0, date=datetime.now(UTC), text=body.text, outgoing=False, sender_name=body.sender_name
    )
    return await space.ai.generate(
        settings=await load_ai_settings(session.settings),
        instructions=body.instructions,
        chat_title="Проверка ассистента",
        chat_kind=body.chat_kind,
        history=[],
        incoming=incoming,
    )
