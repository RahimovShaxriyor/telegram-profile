from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import keyring
import pytest
from fastapi import FastAPI
from keyring.backend import KeyringBackend
from pydantic import SecretStr

from tests.fakes import FakeAnthropic, FakeTelegram, FakeTelegramClient, FakeUser
from tpam.api.app import create_app
from tpam.core.config import Settings
from tpam.runtime import Runtime

HOST = "127.0.0.1:8765"
API_HASH = "0123456789abcdef0123456789abcdef"
HEADERS = {"X-TPAM-Request": "1"}


class MemoryKeyring(KeyringBackend):
    priority = 1  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self.store: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.store.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.store[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        self.store.pop((service, username), None)


@pytest.fixture(autouse=True)
def memory_keyring() -> Iterator[MemoryKeyring]:
    previous = keyring.get_keyring()
    backend = MemoryKeyring()
    keyring.set_keyring(backend)
    yield backend
    keyring.set_keyring(previous)


@pytest.fixture(autouse=True)
def telegram() -> FakeTelegram:
    """A fresh fake Telegram 'server' per test."""
    FakeTelegramClient.server = FakeTelegram()
    return FakeTelegramClient.server


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        frontend_dist=tmp_path / "no-frontend",
        demo_latency_ms=0,
        open_browser=False,
        api_id=1,
        api_hash=SecretStr(API_HASH),
        _env_file=None,  # type: ignore[call-arg]
    )


@pytest.fixture
def fake_clients() -> list[FakeTelegramClient]:
    return []


@pytest.fixture
def fake_anthropic() -> FakeAnthropic:
    return FakeAnthropic()


@pytest.fixture
def runtime(
    settings: Settings, fake_clients: list[FakeTelegramClient], fake_anthropic: FakeAnthropic
) -> Runtime:
    def factory(*args: Any, **kwargs: Any) -> FakeTelegramClient:
        client = FakeTelegramClient(*args, **kwargs)
        fake_clients.append(client)
        return client

    return Runtime(settings, client_factory=factory, ai_client_factory=lambda _key: fake_anthropic)


@pytest.fixture
async def app(settings: Settings, runtime: Runtime) -> AsyncIterator[FastAPI]:
    application = create_app(settings, runtime)
    async with application.router.lifespan_context(application):
        yield application


Browser = Callable[[], Any]


@pytest.fixture
def browser(app: FastAPI) -> Callable[[], Any]:
    """Factory of independent browsers (own cookie jars) talking to the same server."""

    @asynccontextmanager
    async def open_browser() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 5555)),
            base_url=f"http://{HOST}",
            headers=HEADERS,
        ) as http:
            yield http

    return open_browser


@pytest.fixture
async def anon(browser: Browser) -> AsyncIterator[httpx.AsyncClient]:
    async with browser() as http:
        yield http


@pytest.fixture
async def client(anon: httpx.AsyncClient) -> httpx.AsyncClient:
    """A demo guest (fictional data) — most feature tests run here."""
    assert (await anon.post("/api/guest")).status_code == 204
    return anon


async def sign_in(
    http: httpx.AsyncClient, telegram: FakeTelegram, user: FakeUser | None = None
) -> dict[str, Any]:
    if user is not None:
        telegram.next_user = user
    phone = f"+99890{telegram.next_user.id % 10_000_000:07d}"
    step = await http.post("/api/login/phone", json={"phone": phone, "accept_terms": True})
    assert step.status_code == 200, step.text
    done = await http.post("/api/login/code", json={"code": "12345"})
    assert done.status_code == 200, done.text
    assert done.json()["step"] == "done"
    return (await http.get("/api/session")).json()


@pytest.fixture
async def user_client(browser: Browser, telegram: FakeTelegram) -> AsyncIterator[httpx.AsyncClient]:
    """The first signed-in Telegram user (becomes the owner)."""
    async with browser() as http:
        await sign_in(http, telegram)
        yield http
