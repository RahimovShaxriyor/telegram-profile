"""OS-level secret storage (Windows Credential Manager via keyring) and file hardening."""

from __future__ import annotations

import contextlib
import getpass
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

from tpam.core.errors import InvalidState

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ApiCredentials:
    api_id: int
    api_hash: str

    def __repr__(self) -> str:  # never print the hash
        return f"ApiCredentials(api_id={self.api_id}, api_hash=***)"


class CredentialStore:
    """Telegram API credentials live in the OS keychain, never in files or logs."""

    def __init__(self, service: str = "tpam") -> None:
        self._service = service

    def load(self) -> ApiCredentials | None:
        try:
            api_id = keyring.get_password(self._service, "api_id")
            api_hash = keyring.get_password(self._service, "api_hash")
        except KeyringError as exc:
            log.warning("Системное хранилище секретов недоступно: %s", type(exc).__name__)
            return None
        if not api_id or not api_hash:
            return None
        return ApiCredentials(int(api_id), api_hash)

    def save(self, credentials: ApiCredentials) -> None:
        try:
            keyring.set_password(self._service, "api_id", str(credentials.api_id))
            keyring.set_password(self._service, "api_hash", credentials.api_hash)
        except KeyringError as exc:
            raise InvalidState(
                "Не удалось сохранить ключи в системное хранилище (Windows Credential Manager)"
            ) from exc

    def clear(self) -> None:
        for key in ("api_id", "api_hash"):
            with contextlib.suppress(PasswordDeleteError, KeyringError):
                keyring.delete_password(self._service, key)


def _icacls() -> str:
    return str(Path(os.environ.get("SYSTEMROOT", r"C:Windows")) / "System32" / "icacls.exe")


def harden_path(path: Path) -> None:
    """Restrict a file/directory to the current OS user (best effort, logged on failure)."""
    try:
        if sys.platform == "win32":
            user = os.environ.get("USERNAME") or getpass.getuser()
            domain = os.environ.get("USERDOMAIN")
            principal = f"{domain}\\{user}" if domain else user
            grant = f"{principal}:(OI)(CI)F" if path.is_dir() else f"{principal}:F"
            # Fixed executable path and arguments; only the path we created is passed.
            result = subprocess.run(  # noqa: S603
                [_icacls(), str(path), "/inheritance:r", "/grant:r", grant],
                capture_output=True,
                text=True,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode != 0:
                log.warning(
                    "Не удалось ограничить доступ к %s (icacls код %s)",
                    path,
                    result.returncode,
                )
        else:
            path.chmod(0o700 if path.is_dir() else 0o600)
    except OSError as exc:
        log.warning("Не удалось ограничить доступ к %s: %s", path, exc)


class AiKeyStore:
    """Anthropic API key in the OS keychain (shared by both modes)."""

    _NAME = "anthropic_api_key"

    def __init__(self, service: str = "tpam") -> None:
        self._service = service

    def load(self) -> str | None:
        try:
            return keyring.get_password(self._service, self._NAME) or None
        except KeyringError:
            return None

    def save(self, api_key: str) -> None:
        try:
            keyring.set_password(self._service, self._NAME, api_key)
        except KeyringError as exc:
            raise InvalidState("Не удалось сохранить ключ в системное хранилище") from exc

    def clear(self) -> None:
        with contextlib.suppress(PasswordDeleteError, KeyringError):
            keyring.delete_password(self._service, self._NAME)
