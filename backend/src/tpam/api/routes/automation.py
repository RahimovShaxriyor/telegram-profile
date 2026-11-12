"""Automation kill switch, rule CRUD and rule testing."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field

from tpam.api.deps import SessionDep
from tpam.automation.engine import rule_matches
from tpam.models import (
    AutomationState,
    ChatKind,
    IncomingMessage,
    Message,
    Rule,
    RuleInput,
)

router = APIRouter(prefix="/api", tags=["automation"])


class EnabledIn(BaseModel):
    enabled: bool


class RuleCheckIn(BaseModel):
    rule: RuleInput
    text: str = Field(max_length=4096)
    chat_kind: ChatKind = "user"
    chat_id: int = 0


class RuleCheckOut(BaseModel):
    matches: bool


@router.get("/automation")
async def automation_state(session: SessionDep) -> AutomationState:
    return await session.engine.state()


@router.put("/automation")
async def set_automation(body: EnabledIn, session: SessionDep) -> AutomationState:
    await session.engine.set_enabled(body.enabled)
    return await session.engine.state()


@router.get("/rules")
async def list_rules(session: SessionDep) -> list[Rule]:
    return await session.rules.list()


@router.post("/rules", status_code=201)
async def create_rule(body: RuleInput, session: SessionDep) -> Rule:
    rule = await session.rules.create(body)
    await session.audit.add(
        source="system",
        action="rule.create",
        status="success",
        rule_id=rule.id,
        rule_name=rule.name,
        detail="Правило создано",
    )
    return rule


@router.put("/rules/{rule_id}")
async def update_rule(rule_id: int, body: RuleInput, session: SessionDep) -> Rule:
    rule = await session.rules.update(rule_id, body)
    await session.audit.add(
        source="system",
        action="rule.update",
        status="success",
        rule_id=rule.id,
        rule_name=rule.name,
        detail="Правило изменено",
    )
    return rule


@router.patch("/rules/{rule_id}")
async def toggle_rule(rule_id: int, body: EnabledIn, session: SessionDep) -> Rule:
    current = await session.rules.get(rule_id)
    data = RuleInput.model_validate(
        current.model_dump(include=set(RuleInput.model_fields)) | {"enabled": body.enabled}
    )
    rule = await session.rules.update(rule_id, data)
    await session.audit.add(
        source="system",
        action="rule.toggle",
        status="success",
        rule_id=rule.id,
        rule_name=rule.name,
        detail="Правило включено" if body.enabled else "Правило выключено",
    )
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, session: SessionDep) -> None:
    rule = await session.rules.get(rule_id)
    await session.rules.delete(rule_id)
    await session.audit.add(
        source="system",
        action="rule.delete",
        status="success",
        rule_id=rule.id,
        rule_name=rule.name,
        detail="Правило удалено",
    )


@router.post("/rules/check")
async def check_rule(body: RuleCheckIn) -> RuleCheckOut:
    """Dry check of the text condition and chat scope, without sending or auditing anything."""
    probe = Rule(
        **body.rule.model_dump(),
        id=0,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    chat_id = body.chat_id or (body.rule.chat_ids[0] if body.rule.chat_ids else 1)
    msg = Message(id=1, chat_id=chat_id, date=datetime.now(UTC), text=body.text, outgoing=False)
    incoming = IncomingMessage(message=msg, chat_kind=body.chat_kind, chat_title="Проверка")
    return RuleCheckOut(matches=rule_matches(probe, incoming))
