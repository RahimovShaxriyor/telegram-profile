"""Phone + code (+ 2FA password) sign-in with the app's own API credentials.

Each pending sign-in owns a fresh Telethon client with an empty in-memory session, keyed by
a random cookie. On success the session string is handed over (and then encrypted) — nothing
about a half-finished login is ever written to disk.
"""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Literal

from telethon import errors, functions

from tpam.core.errors import AuthFailed, InvalidState, RateLimited, TelegramUnavailable, ValidationFailed
from tpam.core.keystore import ApiCredentials
from tpam.core.logging import register_secret
from tpam.core.ratelimit import RateLimiter
from tpam.providers.telethon_provider import ClientFactory, client_options, default_client_factory, mask_phone

log = logging.getLogger(__name__)

PHONE_RE = re.compile(r"^\+?[1-9]\d{7,14}$")
FLOW_TTL_SECONDS = 600
MAX_PENDING_FLOWS = 200
MAX_CODE_ATTEMPTS = 5
MAX_PASSWORD_ATTEMPTS = 5

LoginStep = Literal["code", "password"]


@dataclass
class LoginResult:
    user_id: int
    first_name: str
    last_name: str | None
    username: str | None
    phone: str
    session: str


@dataclass
class _Flow:
    client: Any
    phone: str
    phone_code_hash: str
    created: float = field(default_factory=time.monotonic)
    step: LoginStep = "code"
    password_hint: str | None = None
    code_attempts: int = 0
    password_attempts: int = 0


@dataclass(frozen=True)
class FlowState:
    step: LoginStep
    phone_masked: str | None
    password_hint: str | None = None


def normalize_phone(raw: str) -> str:
    phone = re.sub(r"[\s\-()]", "", raw)
    if not PHONE_RE.match(phone):
        raise ValidationFailed("Введите номер в международном формате, например +998 90 123 45 67")
    return phone if phone.startswith("+") else f"+{phone}"


class LoginManager:
    def __init__(
        self, app: ApiCredentials | None, client_factory: ClientFactory = default_client_factory
    ) -> None:
        self.app = app
        self._factory = client_factory
        self._flows: dict[str, _Flow] = {}
        self._lock = asyncio.Lock()
        # Telegram itself limits code requests; ours keep abuse from burning the app's API ID.
        self.per_phone = RateLimiter(
            3, 3600, "С этого номера слишком много запросов кода. Попробуйте через час"
        )
        self.per_ip = RateLimiter(10, 3600, "Слишком много попыток входа с вашего адреса. Попробуйте позже")
        self.global_limit = RateLimiter(120, 3600, "Сервис временно ограничил вход. Попробуйте позже")

    def _require_app(self) -> ApiCredentials:
        if self.app is None:
            raise InvalidState(
                "Сервер ещё не настроен: администратор должен указать API ID и API HASH приложения",
                code="server_not_configured",
            )
        return self.app

    async def start(self, phone_raw: str, ip: str) -> tuple[str, FlowState]:
        app = self._require_app()
        phone = normalize_phone(phone_raw)
        register_secret(phone)
        self.per_ip.hit(ip)
        self.per_phone.hit(phone)
        self.global_limit.hit("all")
        await self.expire()
        if len(self._flows) >= MAX_PENDING_FLOWS:
            raise RateLimited(
                "Слишком много одновременных входов. Попробуйте через пару минут", retry_after=60
            )

        client = self._factory("", app.api_id, app.api_hash, **client_options())
        try:
            await asyncio.wait_for(client.connect(), 30)
            async with _auth_errors():
                sent = await client.send_code_request(phone)
        except BaseException:
            await _quiet_disconnect(client)
            raise
        flow_id = secrets.token_urlsafe(24)
        async with self._lock:
            self._flows[flow_id] = _Flow(client=client, phone=phone, phone_code_hash=sent.phone_code_hash)
        return flow_id, FlowState(step="code", phone_masked=mask_phone(phone))

    def state(self, flow_id: str | None) -> FlowState | None:
        flow = self._flows.get(flow_id or "")
        if flow is None or time.monotonic() - flow.created > FLOW_TTL_SECONDS:
            return None
        return FlowState(
            step=flow.step, phone_masked=mask_phone(flow.phone), password_hint=flow.password_hint
        )

    def _flow(self, flow_id: str | None) -> _Flow:
        flow = self._flows.get(flow_id or "")
        if flow is None or time.monotonic() - flow.created > FLOW_TTL_SECONDS:
            raise InvalidState("Время на вход истекло. Введите номер ещё раз", code="login_expired")
        return flow

    async def submit_code(self, flow_id: str | None, code_raw: str) -> FlowState | LoginResult:
        flow = self._flow(flow_id)
        if flow.step != "code":
            raise InvalidState("Код уже подтверждён — введите пароль")
        code = re.sub(r"\D", "", code_raw)
        if not code:
            raise ValidationFailed("Введите код из Telegram")
        register_secret(code)
        flow.code_attempts += 1
        if flow.code_attempts > MAX_CODE_ATTEMPTS:
            await self.cancel(flow_id)
            raise RateLimited("Слишком много неверных кодов. Запросите новый код", code="too_many_attempts")
        try:
            async with _auth_errors():
                await flow.client.sign_in(phone=flow.phone, code=code, phone_code_hash=flow.phone_code_hash)
        except errors.SessionPasswordNeededError:
            password = await flow.client(functions.account.GetPasswordRequest())
            flow.step, flow.password_hint = "password", (password.hint or None)
            return FlowState(
                step="password", phone_masked=mask_phone(flow.phone), password_hint=flow.password_hint
            )
        except AuthFailed:
            await self.cancel(flow_id)  # expired code: start again
            raise
        return await self._finish(flow_id, flow)

    async def submit_password(self, flow_id: str | None, password: str) -> LoginResult:
        flow = self._flow(flow_id)
        if flow.step != "password":
            raise InvalidState("Сначала введите код из Telegram")
        if not password:
            raise ValidationFailed("Введите облачный пароль Telegram")
        register_secret(password)
        flow.password_attempts += 1
        if flow.password_attempts > MAX_PASSWORD_ATTEMPTS:
            await self.cancel(flow_id)
            raise RateLimited("Слишком много неверных паролей. Начните вход заново", code="too_many_attempts")
        async with _auth_errors():
            await flow.client.sign_in(password=password)
        return await self._finish(flow_id, flow)

    async def _finish(self, flow_id: str | None, flow: _Flow) -> LoginResult:
        me = await flow.client.get_me()
        session = flow.client.session.save()
        async with self._lock:
            self._flows.pop(flow_id or "", None)
        await _quiet_disconnect(flow.client)  # the user's long-lived client is started separately
        return LoginResult(
            user_id=me.id,
            first_name=me.first_name or "",
            last_name=me.last_name,
            username=me.username,
            phone=flow.phone,
            session=session,
        )

    async def cancel(self, flow_id: str | None) -> None:
        async with self._lock:
            flow = self._flows.pop(flow_id or "", None)
        if flow is not None:
            await _quiet_disconnect(flow.client)

    async def expire(self) -> None:
        now = time.monotonic()
        stale = [fid for fid, f in self._flows.items() if now - f.created > FLOW_TTL_SECONDS]
        for flow_id in stale:
            await self.cancel(flow_id)

    async def close(self) -> None:
        for flow_id in list(self._flows):
            await self.cancel(flow_id)


async def _quiet_disconnect(client: Any) -> None:
    try:
        await client.disconnect()
    except Exception:  # cleanup must never mask the real error
        log.debug("disconnect failed", exc_info=True)


@asynccontextmanager
async def _auth_errors() -> AsyncIterator[None]:
    try:
        yield
    except errors.SessionPasswordNeededError:
        raise
    except errors.ApiIdInvalidError:
        log.error("Telegram rejected the app API ID / API HASH")
        raise InvalidState(
            "Сервер настроен неверно (API ID). Сообщите администратору.", code="server_not_configured"
        ) from None
    except errors.PhoneNumberInvalidError:
        raise ValidationFailed("Telegram не распознал номер телефона") from None
    except errors.PhoneNumberUnoccupiedError:
        raise AuthFailed("Этот номер не зарегистрирован в Telegram") from None
    except errors.PhoneNumberBannedError:
        raise AuthFailed("Этот номер заблокирован в Telegram") from None
    except errors.PhoneCodeInvalidError:
        raise ValidationFailed("Неверный код. Проверьте сообщение от Telegram и попробуйте ещё раз") from None
    except errors.PhoneCodeExpiredError:
        raise AuthFailed("Срок действия кода истёк. Запросите новый код", code="code_expired") from None
    except errors.PasswordHashInvalidError:
        raise ValidationFailed("Неверный облачный пароль") from None
    except errors.PhoneNumberFloodError:
        raise RateLimited("Telegram ограничил вход для этого номера. Попробуйте позже") from None
    except errors.FloodWaitError as exc:
        raise RateLimited(
            f"Telegram просит подождать {exc.seconds} с перед новой попыткой", retry_after=exc.seconds
        ) from None
    except (OSError, TimeoutError):
        raise TelegramUnavailable("Нет соединения с Telegram") from None
