"""Sign-in by phone + code (+ 2FA), browser sessions, demo guests, one-time server setup.

Codes, passwords and phone numbers are passed straight to Telegram and never stored; only an
encrypted session string and a keyed hash of the phone (for closed registration) are kept.
"""

from __future__ import annotations

import re
import secrets
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field, SecretStr

from tpam.accounts.login import LoginResult, normalize_phone
from tpam.api.deps import (
    LOGIN_COOKIE,
    SESSION_COOKIE,
    PrincipalDep,
    RuntimeDep,
    TelethonDep,
    client_ip,
    get_principal,
    is_loopback,
)
from tpam.core.crypto import token_hash
from tpam.core.errors import InvalidState, NotSignedIn, PermissionDenied, ValidationFailed
from tpam.models import ProviderStatus
from tpam.runtime import Runtime

router = APIRouter(prefix="/api", tags=["login"])

LOGIN_TTL_SECONDS = 600


class SessionUser(BaseModel):
    id: int
    name: str
    username: str | None
    phone_masked: str | None
    is_owner: bool


class SessionInfo(BaseModel):
    signed_in: bool
    kind: Literal["user", "guest"] | None = None
    user: SessionUser | None = None
    registration_open: bool
    server_configured: bool
    setup_allowed: bool = False
    login: LoginStepOut | None = None


class LoginStepOut(BaseModel):
    step: Literal["code", "password", "done"]
    phone_masked: str | None = None
    password_hint: str | None = None


class PhoneIn(BaseModel):
    phone: SecretStr = Field(min_length=6, max_length=24)
    accept_terms: bool


class CodeIn(BaseModel):
    code: SecretStr = Field(min_length=3, max_length=12)


class PasswordIn(BaseModel):
    password: SecretStr = Field(min_length=1, max_length=256)


class DisconnectIn(BaseModel):
    delete_data: bool = False


class SetupIn(BaseModel):
    api_id: int = Field(gt=0, lt=2**31)
    api_hash: SecretStr = Field(min_length=32, max_length=32)


def _cookie(response: Response, runtime: Runtime, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=runtime.settings.secure_cookies,
        path="/",
    )


async def _open_web_session(
    response: Response, request: Request, runtime: Runtime, *, user_id: int | None, guest_id: str | None
) -> None:
    old = request.cookies.get(SESSION_COOKIE)
    if old:
        await runtime.accounts.delete_web_session(token_hash(old))
    token = secrets.token_urlsafe(32)
    await runtime.accounts.create_web_session(
        token_hash(token),
        user_id=user_id,
        guest_id=guest_id,
        days=runtime.settings.session_days,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    _cookie(response, runtime, SESSION_COOKIE, token, runtime.settings.session_days * 86400)


@router.get("/session")
async def session_info(request: Request, runtime: RuntimeDep) -> SessionInfo:
    configured = runtime.app_credentials() is not None
    info = SessionInfo(
        signed_in=False,
        registration_open=await runtime.registration_open(),
        server_configured=configured,
        setup_allowed=not configured and is_loopback(request),
    )
    try:
        principal = await get_principal(request)
    except NotSignedIn:
        flow = runtime.login.state(request.cookies.get(LOGIN_COOKIE))
        if flow:
            info.login = LoginStepOut(
                step=flow.step, phone_masked=flow.phone_masked, password_hint=flow.password_hint
            )
        return info
    space = principal.space
    if space.user_id is None:
        return info.model_copy(update={"signed_in": True, "kind": "guest"})
    user = await runtime.accounts.get_user(space.user_id)
    if user is None:
        return info
    return info.model_copy(
        update={
            "signed_in": True,
            "kind": "user",
            "user": SessionUser(
                id=user.id,
                name=user.display_name,
                username=user.username,
                phone_masked=user.phone_masked,
                is_owner=user.is_owner,
            ),
        }
    )


@router.post("/login/phone")
async def login_phone(
    body: PhoneIn, request: Request, response: Response, runtime: RuntimeDep
) -> LoginStepOut:
    if not body.accept_terms:
        raise ValidationFailed("Подтвердите, что согласны с условиями использования")
    phone = normalize_phone(body.phone.get_secret_value())
    await runtime.check_can_register(phone)
    await runtime.login.cancel(request.cookies.get(LOGIN_COOKIE))
    flow_id, state = await runtime.login.start(phone, client_ip(request))
    _cookie(response, runtime, LOGIN_COOKIE, flow_id, LOGIN_TTL_SECONDS)
    return LoginStepOut(step=state.step, phone_masked=state.phone_masked)


async def _finish(
    result: LoginResult, request: Request, response: Response, runtime: Runtime
) -> LoginStepOut:
    user = await runtime.complete_login(result)
    await _open_web_session(response, request, runtime, user_id=user.id, guest_id=None)
    response.delete_cookie(LOGIN_COOKIE, path="/")
    return LoginStepOut(step="done", phone_masked=user.phone_masked)


@router.post("/login/code")
async def login_code(body: CodeIn, request: Request, response: Response, runtime: RuntimeDep) -> LoginStepOut:
    outcome = await runtime.login.submit_code(request.cookies.get(LOGIN_COOKIE), body.code.get_secret_value())
    if isinstance(outcome, LoginResult):
        return await _finish(outcome, request, response, runtime)
    return LoginStepOut(
        step=outcome.step, phone_masked=outcome.phone_masked, password_hint=outcome.password_hint
    )


@router.post("/login/password")
async def login_password(
    body: PasswordIn, request: Request, response: Response, runtime: RuntimeDep
) -> LoginStepOut:
    result = await runtime.login.submit_password(
        request.cookies.get(LOGIN_COOKIE), body.password.get_secret_value()
    )
    return await _finish(result, request, response, runtime)


@router.post("/login/cancel", status_code=204)
async def login_cancel(request: Request, response: Response, runtime: RuntimeDep) -> None:
    await runtime.login.cancel(request.cookies.get(LOGIN_COOKIE))
    response.delete_cookie(LOGIN_COOKIE, path="/")


@router.post("/guest", status_code=204)
async def start_guest(request: Request, response: Response, runtime: RuntimeDep) -> None:
    guest_id = await runtime.create_guest()
    await _open_web_session(response, request, runtime, user_id=None, guest_id=guest_id)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, runtime: RuntimeDep) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await runtime.accounts.delete_web_session(token_hash(token))
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.post("/logout/all")
async def logout_everywhere(
    principal: PrincipalDep, response: Response, runtime: RuntimeDep
) -> dict[str, int]:
    if principal.space.user_id is None:
        raise InvalidState("Доступно после входа через Telegram")
    removed = await runtime.accounts.delete_user_web_sessions(principal.space.user_id)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"removed": removed}


@router.post("/account/disconnect", status_code=204)
async def disconnect(
    body: DisconnectIn, principal: PrincipalDep, response: Response, runtime: RuntimeDep
) -> None:
    """Ends the TPAM session in Telegram and removes the account (optionally with all its data)."""
    user_id = principal.space.user_id
    if user_id is None:
        raise InvalidState("Доступно после входа через Telegram")
    await runtime.disconnect_user(user_id, delete_data=body.delete_data)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.post("/setup", status_code=204)
async def setup(body: SetupIn, request: Request, runtime: RuntimeDep) -> None:
    """First-run configuration of the app's Telegram API credentials — only from this computer."""
    if runtime.app_credentials() is not None:
        raise InvalidState("Сервер уже настроен")
    if not is_loopback(request):
        raise PermissionDenied("Настройка возможна только с компьютера, где запущен сервер")
    api_hash = body.api_hash.get_secret_value().strip().lower()
    if not re.fullmatch(r"[0-9a-f]{32}", api_hash):
        raise ValidationFailed("API HASH — 32 символа (0-9, a-f)")
    runtime.configure_app(body.api_id, api_hash)


@router.post("/connection/reconnect")
async def reconnect(provider: TelethonDep) -> ProviderStatus:
    await provider.reconnect()
    return await provider.status()


SessionInfo.model_rebuild()
