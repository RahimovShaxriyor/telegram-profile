"""Request → signed-in user (or demo guest) → that person's own space. Nothing is shared between users."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request

from tpam.accounts.store import WebSession
from tpam.core.crypto import token_hash
from tpam.core.errors import InvalidState, NotSignedIn, PermissionDenied
from tpam.providers.demo import DemoProvider
from tpam.providers.telethon_provider import TelethonProvider
from tpam.runtime import Runtime, Session, UserSpace
from tpam.storage.db import utcnow

SESSION_COOKIE = "tpam_session"
LOGIN_COOKIE = "tpam_login"
TOUCH_EVERY = timedelta(minutes=10)


@dataclass
class Principal:
    space: UserSpace
    web: WebSession

    @property
    def is_owner(self) -> bool:
        return self.space.is_owner


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime = request.app.state.runtime
    return runtime


def client_ip(request: Request) -> str:
    runtime = get_runtime(request)
    if runtime.settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def is_loopback(request: Request) -> bool:
    try:
        return ipaddress.ip_address(client_ip(request)).is_loopback
    except ValueError:
        return False


async def get_principal(request: Request) -> Principal:
    runtime = get_runtime(request)
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise NotSignedIn("Войдите, чтобы продолжить")
    web = await runtime.accounts.get_web_session(token_hash(token))
    if web is None:
        raise NotSignedIn("Сеанс истёк. Войдите снова")
    if utcnow() - web.last_seen_at > TOUCH_EVERY:
        await runtime.accounts.touch_web_session(web.token_hash, runtime.settings.session_days)
    if web.user_id is not None:
        space = runtime.users.get(web.user_id)
        if space is None:
            raise NotSignedIn("Аккаунт отключён. Войдите снова")
    elif web.guest_id is not None:
        space = await runtime.guest_space(web.guest_id)
    else:
        raise NotSignedIn("Войдите, чтобы продолжить")
    return Principal(space=space, web=web)


def get_space(principal: Annotated[Principal, Depends(get_principal)]) -> UserSpace:
    return principal.space


def get_session(space: Annotated[UserSpace, Depends(get_space)]) -> Session:
    return space.session


def get_owner(principal: Annotated[Principal, Depends(get_principal)]) -> Principal:
    if not principal.is_owner:
        raise PermissionDenied("Доступно только администратору сервиса")
    return principal


def get_telethon(space: Annotated[UserSpace, Depends(get_space)]) -> TelethonProvider:
    if not isinstance(space.provider, TelethonProvider):
        raise InvalidState("Доступно после входа через Telegram")
    return space.provider


def get_demo(space: Annotated[UserSpace, Depends(get_space)]) -> DemoProvider:
    if not isinstance(space.provider, DemoProvider):
        raise InvalidState("Эта функция доступна только в демо-режиме")
    return space.provider


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
PrincipalDep = Annotated[Principal, Depends(get_principal)]
OwnerDep = Annotated[Principal, Depends(get_owner)]
SpaceDep = Annotated[UserSpace, Depends(get_space)]
SessionDep = Annotated[Session, Depends(get_session)]
TelethonDep = Annotated[TelethonProvider, Depends(get_telethon)]
DemoDep = Annotated[DemoProvider, Depends(get_demo)]
