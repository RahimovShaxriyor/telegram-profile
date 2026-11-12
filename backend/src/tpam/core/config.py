"""Application settings loaded from environment / .env (prefix TPAM_)."""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
REPO_ROOT = Path(__file__).resolve().parents[4]


def default_data_dir() -> Path:
    """Per-user data directory outside the project (and outside OneDrive-synced Desktop)."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / "tpam"
    xdg = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(xdg) / "tpam"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TPAM_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=1024, le=65535)
    public_url: str = ""
    """Address people open, e.g. https://tpam.example.com. Required when listening beyond this computer."""
    trust_proxy: bool = False
    """Take the client IP from X-Forwarded-For (only behind your own reverse proxy)."""
    data_dir: Path = Field(default_factory=default_data_dir)
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"
    dev: bool = False
    """Allows the Vite dev server (http://localhost:5173) as an extra trusted origin."""
    open_browser: bool = True
    log_level: str = "INFO"
    demo_latency_ms: int = Field(default=150, ge=0, le=5000)
    """Artificial delay of demo responses so loading states stay visible; 0 in tests."""

    # Telegram application credentials (my.telegram.org). Users never see them.
    api_id: int | None = None
    api_hash: SecretStr | None = None
    secret_key: SecretStr | None = None
    """Fernet key that encrypts stored Telegram sessions and AI keys. Generated locally if unset."""

    registration_open: bool = True
    max_users: int = Field(default=200, ge=1, le=10_000)
    session_days: int = Field(default=30, ge=1, le=365)
    max_guests: int = Field(default=50, ge=0, le=1000)

    @model_validator(mode="after")
    def _remote_needs_public_url(self) -> Settings:
        if self.host not in LOOPBACK_HOSTS:
            if not self.public_url:
                raise ValueError(
                    "Для работы не только на этом компьютере укажите TPAM_PUBLIC_URL (адрес сайта)."
                )
            if not self.public_url.startswith("https://") and not self.dev:
                raise ValueError("Сайт для других людей должен работать по HTTPS: TPAM_PUBLIC_URL=https://…")
        return self

    @property
    def base_url(self) -> str:
        return (self.public_url or f"http://127.0.0.1:{self.port}").rstrip("/")

    @property
    def secure_cookies(self) -> bool:
        return self.base_url.startswith("https://")

    @property
    def allowed_origins(self) -> frozenset[str]:
        origins = {f"http://127.0.0.1:{self.port}", f"http://localhost:{self.port}", self.base_url}
        if self.dev:
            origins |= {"http://127.0.0.1:5173", "http://localhost:5173"}
        return frozenset(origins)

    @property
    def allowed_hosts(self) -> frozenset[str]:
        hosts = {f"127.0.0.1:{self.port}", f"localhost:{self.port}"}
        public = urlsplit(self.base_url)
        if public.hostname:
            hosts |= {public.netloc, public.hostname}
        if self.dev:
            # Vite proxy keeps the browser's Host unless changeOrigin is set; accept both.
            hosts |= {"127.0.0.1:5173", "localhost:5173"}
        return frozenset(hosts)


@lru_cache
def get_settings() -> Settings:
    return Settings()
