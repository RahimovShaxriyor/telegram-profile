"""Encryption at rest for Telegram session strings and per-user AI keys (Fernet: AES-128-CBC + HMAC)."""

from __future__ import annotations

import hashlib
import hmac
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from tpam.core.errors import InvalidState
from tpam.core.keystore import harden_path


class Vault:
    def __init__(self, key: bytes) -> None:
        self._fernet = Fernet(key)
        self._pepper = hashlib.sha256(b"tpam-lookup:" + key).digest()

    @classmethod
    def load(cls, configured: str | None, key_file: Path) -> Vault:
        """Key from TPAM_SECRET_KEY, else a generated file next to the data (owner-only ACL)."""
        if configured:
            return cls(configured.encode())
        if key_file.exists():
            return cls(key_file.read_bytes().strip())
        key = Fernet.generate_key()
        key_file.write_bytes(key)
        harden_path(key_file)
        return cls(key)

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken:
            raise InvalidState("Не удалось расшифровать данные: ключ сервера изменился") from None

    def lookup_hash(self, value: str) -> str:
        """Keyed hash for lookups (phone numbers) without storing the value itself."""
        return hmac.new(self._pepper, value.encode(), hashlib.sha256).hexdigest()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
