"""Owner-only administration: users list, registration switch, removing accounts."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel

from tpam.api.deps import OwnerDep, RuntimeDep
from tpam.core.errors import InvalidState, NotFound

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminUser(BaseModel):
    id: int
    name: str
    username: str | None
    phone_masked: str | None
    is_owner: bool
    online: bool
    created_at: datetime
    last_login_at: datetime


class AdminSummary(BaseModel):
    users: list[AdminUser]
    registration_open: bool
    max_users: int
    guests_active: int


class RegistrationIn(BaseModel):
    open: bool


@router.get("")
async def summary(_owner: OwnerDep, runtime: RuntimeDep) -> AdminSummary:
    users = []
    for user in await runtime.accounts.list_users():
        space = runtime.users.get(user.id)
        online = False
        if space is not None:
            online = (await space.provider.status()).state == "connected"
        users.append(
            AdminUser(
                id=user.id,
                name=user.display_name,
                username=user.username,
                phone_masked=user.phone_masked,
                is_owner=user.is_owner,
                online=online,
                created_at=user.created_at,
                last_login_at=user.last_login_at,
            )
        )
    return AdminSummary(
        users=users,
        registration_open=await runtime.registration_open(),
        max_users=runtime.settings.max_users,
        guests_active=len(runtime.guests),
    )


@router.put("/registration")
async def set_registration(body: RegistrationIn, _owner: OwnerDep, runtime: RuntimeDep) -> AdminSummary:
    await runtime.set_registration_open(body.open)
    return await summary(_owner, runtime)


@router.delete("/users/{user_id}", status_code=204)
async def remove_user(user_id: int, owner: OwnerDep, runtime: RuntimeDep) -> None:
    if user_id == owner.space.user_id:
        raise InvalidState("Себя можно отключить в разделе «Аккаунт»")
    if await runtime.accounts.get_user(user_id) is None:
        raise NotFound("Пользователь не найден")
    await runtime.disconnect_user(user_id, delete_data=True)
