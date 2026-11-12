"""Composition root for a multi-user server.

* ``UserSpace`` — everything one signed-in user (or one demo guest) works with: their Telegram
  connection, their SQLite database (rules, audit, archive), automation and AI assistant.
* ``Runtime`` — the application: accounts, sign-in, all live user spaces, demo guests, housekeeping.

Each user's data lives in its own directory (users/<telegram id>/), so data of different people
never shares a database.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tpam.accounts.login import LoginManager, LoginResult
from tpam.accounts.store import AccountStore, StoredUser
from tpam.ai.assistant import AiAssistant
from tpam.ai.assistant import ClientFactory as AiClientFactory
from tpam.ai.assistant import default_client as default_ai_client
from tpam.archive.service import ArchiveService
from tpam.automation.engine import AutomationEngine
from tpam.core.config import Settings
from tpam.core.crypto import Vault
from tpam.core.errors import InvalidState, PermissionDenied
from tpam.core.keystore import AiKeyStore, ApiCredentials, CredentialStore, harden_path
from tpam.models import ArchiveSettings, DeletedMessages, IncomingMessage, Mode
from tpam.providers.base import TelegramProvider
from tpam.providers.demo import DemoProvider
from tpam.providers.telethon_provider import (
    ClientFactory,
    TelethonProvider,
    default_client_factory,
    mask_phone,
)
from tpam.storage.archive import ArchiveRepository
from tpam.storage.db import Database, utcnow
from tpam.storage.repositories import AuditRepository, RuleRepository, SettingsRepository

log = logging.getLogger(__name__)

HOUSEKEEPING_SECONDS = 600
GUEST_IDLE_SECONDS = 24 * 3600
REGISTRATION_KEY = "registration_open"


@dataclass
class Session:
    """Repositories and services of one user space (kept as the routes' main dependency)."""

    mode: Mode
    provider: TelegramProvider
    db: Database
    audit: AuditRepository
    rules: RuleRepository
    settings: SettingsRepository
    engine: AutomationEngine
    archive: ArchiveService


class UserSpace:
    def __init__(
        self,
        *,
        mode: Mode,
        data_dir: Path,
        provider: TelegramProvider,
        ai: AiAssistant,
        user_id: int | None = None,
        guest_id: str | None = None,
        is_owner: bool = False,
    ) -> None:
        self.mode = mode
        self.data_dir = data_dir
        self.provider = provider
        self.ai = ai
        self.user_id = user_id
        self.guest_id = guest_id
        self.is_owner = is_owner
        self.updates_version = 0
        self.last_used = time.monotonic()
        self._session: Session | None = None

    @property
    def session(self) -> Session:
        if self._session is None:
            raise InvalidState("Рабочее пространство ещё запускается")
        return self._session

    async def start(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        db = Database(self.data_dir / f"{self.mode}.db")
        await db.init()
        provider = self.provider
        audit, rules, settings = AuditRepository(db), RuleRepository(db), SettingsRepository(db)
        engine = AutomationEngine(
            audit, rules, settings, send=_sender(provider), ai=self.ai, history=_history(provider)
        )
        archive = ArchiveService(ArchiveRepository(db), settings, provider, media_dir=self.data_dir / "media")
        self._session = Session(self.mode, provider, db, audit, rules, settings, engine, archive)
        provider.set_message_handler(self._on_message)
        provider.set_change_handlers(self._on_edit, self._on_delete)
        await provider.start()

    async def stop(self) -> None:
        if self._session is None:
            return
        session, self._session = self._session, None
        session.provider.set_message_handler(None)
        session.provider.set_change_handlers(None, None)
        await session.archive.stop()
        await session.provider.stop()
        await session.db.dispose()

    async def reset_demo(self, latency_ms: int) -> None:
        if self.mode != "demo":
            raise InvalidState("Сброс доступен только в демо-режиме")
        await self.stop()
        for suffix in ("", "-wal", "-shm"):
            (self.data_dir / f"demo.db{suffix}").unlink(missing_ok=True)
        self.provider = DemoProvider(latency_ms=latency_ms)
        await self.start()

    async def _on_message(self, incoming: IncomingMessage) -> None:
        self.updates_version += 1
        session = self._session
        if session is None:
            return
        # Archive first: a copy must exist before anyone can delete the message.
        try:
            await session.archive.on_message(incoming)
        except Exception:
            log.exception("Archiving failed")
        await session.engine.handle(incoming)

    async def _on_edit(self, incoming: IncomingMessage) -> None:
        self.updates_version += 1
        if self._session is not None:
            await self._session.archive.on_edit(incoming)

    async def _on_delete(self, deleted: DeletedMessages) -> None:
        self.updates_version += 1
        if self._session is not None:
            await self._session.archive.on_delete(deleted)


def _history(provider: TelegramProvider) -> Any:
    async def history(chat_id: int, limit: int) -> list[Any]:
        return (await provider.get_history(chat_id, limit=limit, before_id=None)).items

    return history


def _sender(provider: TelegramProvider) -> Any:
    async def send(chat_id: int, text: str, reply_to: int | None) -> Any:
        return await provider.send_message(chat_id, text, reply_to=reply_to)

    return send


class Runtime:
    def __init__(
        self,
        settings: Settings,
        *,
        credentials: CredentialStore | None = None,
        client_factory: ClientFactory = default_client_factory,
        ai_client_factory: AiClientFactory = default_ai_client,
        on_started: Callable[[Runtime], None] | None = None,
    ) -> None:
        self.settings = settings
        self.data_dir: Path = settings.data_dir
        self.credentials = credentials or CredentialStore()
        self._client_factory = client_factory
        self._ai_client_factory = ai_client_factory
        self._on_started = on_started
        self.accounts = AccountStore(self.data_dir / "server.db")
        self.vault: Vault | None = None
        self.login = LoginManager(None, client_factory)
        self.users: dict[int, UserSpace] = {}
        self.guests: dict[str, UserSpace] = {}
        self._user_locks: dict[int, asyncio.Lock] = {}
        self._housekeeping: asyncio.Task[None] | None = None

    # ---- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        harden_path(self.data_dir)
        secret = self.settings.secret_key.get_secret_value() if self.settings.secret_key else None
        self.vault = Vault.load(secret, self.data_dir / "secret.key")
        await self.accounts.init()
        self.login.app = self.app_credentials()
        await self._migrate_legacy()
        users = [u for u in await self.accounts.list_users() if not u.disabled]
        results = await asyncio.gather(*(self._open_user(u) for u in users), return_exceptions=True)
        for user, result in zip(users, results, strict=True):
            if isinstance(result, BaseException):
                log.error("Could not start user %s: %s", user.id, type(result).__name__)
        self._housekeeping = asyncio.create_task(self._housekeeping_loop())
        log.info("TPAM started: %d user(s)", len(self.users))
        if self._on_started:
            self._on_started(self)

    async def stop(self) -> None:
        if self._housekeeping:
            self._housekeeping.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._housekeeping
        await self.login.close()
        for space in [*self.users.values(), *self.guests.values()]:
            await space.stop()
        self.users.clear()
        self.guests.clear()
        await self.accounts.dispose()

    # ---- application credentials ------------------------------------------

    def app_credentials(self) -> ApiCredentials | None:
        if self.settings.api_id and self.settings.api_hash:
            return ApiCredentials(self.settings.api_id, self.settings.api_hash.get_secret_value())
        return self.credentials.load()

    def configure_app(self, api_id: int, api_hash: str) -> None:
        self.credentials.save(ApiCredentials(api_id, api_hash))
        self.login.app = self.app_credentials()

    async def registration_open(self) -> bool:
        stored = await self.accounts.get_setting(REGISTRATION_KEY)
        return self.settings.registration_open if stored is None else stored == "1"

    async def set_registration_open(self, value: bool) -> None:
        await self.accounts.set_setting(REGISTRATION_KEY, "1" if value else "0")

    # ---- users --------------------------------------------------------------

    @property
    def _vault(self) -> Vault:
        if self.vault is None:
            raise InvalidState("Сервер ещё запускается")
        return self.vault

    def user_dir(self, user_id: int) -> Path:
        return self.data_dir / "users" / str(user_id)

    async def _open_user(self, user: StoredUser, *, fresh: bool = False) -> UserSpace:
        app = self.app_credentials()
        if app is None:
            raise InvalidState("Сервер не настроен: нет API ID", code="server_not_configured")
        vault = self._vault

        async def save_session(value: str) -> None:
            await self.accounts.update_user(user.id, session_enc=vault.encrypt(value))

        async def save_ai_key(value: str | None) -> None:
            await self.accounts.update_user(user.id, ai_key_enc=vault.encrypt(value) if value else None)

        provider = TelethonProvider(
            vault.decrypt(user.session_enc), app, self._client_factory, on_session_saved=save_session
        )
        ai_key = vault.decrypt(user.ai_key_enc) if user.ai_key_enc else None
        space = UserSpace(
            mode="telegram",
            data_dir=self.user_dir(user.id),
            provider=provider,
            ai=AiAssistant(ai_key, on_key_change=save_ai_key, client_factory=self._ai_client_factory),
            user_id=user.id,
            is_owner=user.is_owner,
        )
        await space.start()
        if fresh:
            # Other people's chats are stored on this server only if they opt in.
            await space.session.archive.save_settings(ArchiveSettings(enabled=user.is_owner))
        self.users[user.id] = space
        return space

    def _lock_for(self, user_id: int) -> asyncio.Lock:
        return self._user_locks.setdefault(user_id, asyncio.Lock())

    async def check_can_register(self, phone: str) -> None:
        """Called before a code is sent, so closed registration never spends the app's code quota."""
        if await self.accounts.phone_known(self._vault.lookup_hash(phone)):
            return
        if not await self.registration_open():
            raise PermissionDenied(
                "Регистрация новых пользователей закрыта администратором", code="registration_closed"
            )
        if await self.accounts.count_users() >= self.settings.max_users:
            raise PermissionDenied("Достигнут лимит пользователей сервиса", code="registration_closed")

    async def complete_login(self, result: LoginResult) -> StoredUser:
        vault = self._vault
        async with self._lock_for(result.user_id):
            existing = await self.accounts.get_user(result.user_id)
            if existing is not None and existing.disabled:
                raise PermissionDenied(
                    "Доступ для этого аккаунта отключён администратором", code="account_disabled"
                )
            is_owner = existing.is_owner if existing else await self.accounts.count_users() == 0
            previous = self.users.pop(result.user_id, None)
            if previous is not None:
                # One TPAM session per account: the older one is ended in Telegram.
                await _end_telegram_session(previous)
            user = await self.accounts.upsert_user(
                id=result.user_id,
                first_name=result.first_name,
                last_name=result.last_name,
                username=result.username,
                phone_masked=mask_phone(result.phone),
                phone_hash=vault.lookup_hash(result.phone),
                session_enc=vault.encrypt(result.session),
                is_owner=is_owner,
                last_login_at=utcnow(),
                **({} if existing else {"ai_key_enc": None, "disabled": False, "created_at": utcnow()}),
            )
            await self._open_user(user, fresh=existing is None)
            log.info("User %s signed in%s", user.id, " (new)" if existing is None else "")
            return user

    async def disconnect_user(self, user_id: int, *, delete_data: bool) -> None:
        async with self._lock_for(user_id):
            space = self.users.pop(user_id, None)
            if space is not None:
                await _end_telegram_session(space)
            await self.accounts.delete_user(user_id)
            if delete_data:
                await asyncio.to_thread(shutil.rmtree, self.user_dir(user_id), True)

    # ---- demo guests --------------------------------------------------------

    async def create_guest(self) -> str:
        if self.settings.max_guests == 0:
            raise PermissionDenied("Демо-режим отключён на этом сервере")
        if len(self.guests) >= self.settings.max_guests:
            oldest = min(self.guests, key=lambda gid: self.guests[gid].last_used)
            await self._drop_guest(oldest)
        guest_id = secrets.token_hex(12)
        await self.guest_space(guest_id)
        return guest_id

    async def guest_space(self, guest_id: str) -> UserSpace:
        space = self.guests.get(guest_id)
        if space is None:
            space = UserSpace(
                mode="demo",
                data_dir=self.data_dir / "guests" / guest_id,
                provider=DemoProvider(latency_ms=self.settings.demo_latency_ms),
                ai=AiAssistant(None, client_factory=self._ai_client_factory),
                guest_id=guest_id,
            )
            await space.start()
            self.guests[guest_id] = space
        space.last_used = time.monotonic()
        return space

    async def _drop_guest(self, guest_id: str) -> None:
        space = self.guests.pop(guest_id, None)
        if space is not None:
            await space.stop()
        await asyncio.to_thread(shutil.rmtree, self.data_dir / "guests" / guest_id, True)

    # ---- housekeeping -------------------------------------------------------

    async def housekeeping(self) -> None:
        await self.login.expire()
        for guest_id in await self.accounts.purge_expired():
            await self._drop_guest(guest_id)
        now = time.monotonic()
        for guest_id in [g for g, s in self.guests.items() if now - s.last_used > GUEST_IDLE_SECONDS]:
            await self._drop_guest(guest_id)

    async def _housekeeping_loop(self) -> None:
        while True:
            await asyncio.sleep(HOUSEKEEPING_SECONDS)
            try:
                await self.housekeeping()
            except Exception:
                log.exception("Housekeeping failed")

    # ---- migration from the single-user version ------------------------------

    async def _migrate_legacy(self) -> None:
        """Turns the previous single-user installation into the owner account (originals are kept)."""
        legacy_session = self.data_dir / "telegram.session"
        marker = self.data_dir / "legacy-migrated"
        app = self.app_credentials()
        if marker.exists() or not legacy_session.exists() or app is None or await self.accounts.count_users():
            return
        from telethon.sessions import SQLiteSession, StringSession

        try:
            sqlite_session = SQLiteSession(str(self.data_dir / "telegram"))
            session_string = StringSession.save(sqlite_session)
            sqlite_session.close()
            client = self._client_factory(session_string, app.api_id, app.api_hash)
            await asyncio.wait_for(client.connect(), 30)
            try:
                if not await client.is_user_authorized():
                    return
                me = await client.get_me()
            finally:
                await client.disconnect()
        except Exception as exc:
            log.warning("Legacy session not migrated: %s", type(exc).__name__)
            return
        vault = self._vault
        legacy_ai = AiKeyStore().load()
        await self.accounts.upsert_user(
            id=me.id,
            first_name=me.first_name or "",
            last_name=me.last_name,
            username=me.username,
            phone_masked=mask_phone(me.phone),
            phone_hash=vault.lookup_hash(f"+{me.phone}") if me.phone else None,
            session_enc=vault.encrypt(session_string),
            ai_key_enc=vault.encrypt(legacy_ai) if legacy_ai else None,
            is_owner=True,
            disabled=False,
            created_at=utcnow(),
            last_login_at=utcnow(),
        )
        target = self.user_dir(me.id)
        target.mkdir(parents=True, exist_ok=True)
        for suffix in ("", "-wal", "-shm"):
            source = self.data_dir / f"telegram.db{suffix}"
            if source.exists():
                shutil.copy2(source, target / f"telegram.db{suffix}")
        legacy_media = self.data_dir / "media" / "telegram"
        if legacy_media.is_dir():
            shutil.copytree(legacy_media, target / "media", dirs_exist_ok=True)
        marker.write_text("Migrated to users/ — the original files are kept for safety.\n", encoding="utf-8")
        log.info("Previous single-user data migrated to owner account %s", me.id)


async def _end_telegram_session(space: UserSpace) -> None:
    provider = space.provider
    if isinstance(provider, TelethonProvider):
        await provider.log_out()
    await space.stop()
