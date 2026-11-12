"""Phone + code sign-in for many users, against a fake Telegram (no network)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
from pydantic import SecretStr
from telethon import errors

from tests.conftest import sign_in
from tests.fakes import FakeTelegram, FakeTelegramClient, FakeUser
from tpam.core.config import Settings
from tpam.runtime import Runtime

PHONE = "+998 90 777 66 55"


async def _phone(http: httpx.AsyncClient, phone: str = PHONE) -> httpx.Response:
    return await http.post("/api/login/phone", json={"phone": phone, "accept_terms": True})


async def test_login_with_code_and_2fa(anon: httpx.AsyncClient, telegram: FakeTelegram) -> None:
    telegram.password = "облако-42"
    step = await _phone(anon)
    assert step.json() == {"step": "code", "phone_masked": "+998 *** *** 55", "password_hint": None}
    assert "tpam_login" in step.headers["set-cookie"]

    wrong = await anon.post("/api/login/code", json={"code": "00000"})
    assert wrong.status_code == 422 and "Неверный код" in wrong.json()["error"]["message"]

    step = (await anon.post("/api/login/code", json={"code": "12-345"})).json()
    assert step["step"] == "password" and step["password_hint"] == "любимый город"
    assert (await anon.get("/api/session")).json()["login"]["step"] == "password"  # survives a page reload

    assert (await anon.post("/api/login/password", json={"password": "nope"})).status_code == 422
    done = await anon.post("/api/login/password", json={"password": "облако-42"})
    assert done.json()["step"] == "done"

    session = (await anon.get("/api/session")).json()
    assert session["signed_in"] is True and session["kind"] == "user"
    assert session["user"]["name"] == "Иван Тестов" and session["user"]["is_owner"] is True
    status = (await anon.get("/api/status")).json()
    assert status["mode"] == "telegram" and status["connection"]["state"] == "connected"


async def test_terms_and_phone_are_validated(anon: httpx.AsyncClient) -> None:
    no_terms = await anon.post("/api/login/phone", json={"phone": PHONE, "accept_terms": False})
    assert no_terms.status_code == 422
    assert (await _phone(anon, "12")).status_code == 422
    assert (await _phone(anon, "+0 000")).status_code == 422


async def test_code_requests_are_rate_limited_per_phone(anon: httpx.AsyncClient) -> None:
    for _ in range(3):
        assert (await _phone(anon)).status_code == 200
    limited = await _phone(anon)
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "too_many_attempts"


async def test_wrong_codes_end_the_attempt(anon: httpx.AsyncClient) -> None:
    await _phone(anon)
    for _ in range(5):
        assert (await anon.post("/api/login/code", json={"code": "00000"})).status_code == 422
    blocked = await anon.post("/api/login/code", json={"code": "00000"})
    assert blocked.status_code == 429
    expired = await anon.post("/api/login/code", json={"code": "12345"})
    assert expired.status_code == 409 and expired.json()["error"]["code"] == "login_expired"


async def test_code_without_flow(anon: httpx.AsyncClient) -> None:
    response = await anon.post("/api/login/code", json={"code": "12345"})
    assert response.status_code == 409 and response.json()["error"]["code"] == "login_expired"


async def test_telegram_flood_wait(anon: httpx.AsyncClient, telegram: FakeTelegram) -> None:
    telegram.send_code_error = errors.FloodWaitError(request=None, capture=120)
    response = await _phone(anon)
    assert response.status_code == 429 and response.json()["error"]["retry_after"] == 120


async def test_second_user_is_not_owner_and_closed_registration(browser: Any, telegram: FakeTelegram) -> None:
    async with browser() as owner, browser() as second, browser() as third:
        await sign_in(owner, telegram, FakeUser(id=1, first_name="Владелец"))
        info = await sign_in(second, telegram, FakeUser(id=2, first_name="Гость"))
        assert info["user"]["is_owner"] is False

        admin = (await owner.put("/api/admin/registration", json={"open": False})).json()
        assert admin["registration_open"] is False and len(admin["users"]) == 2
        closed = await third.post(
            "/api/login/phone", json={"phone": "+998 91 000 00 99", "accept_terms": True}
        )
        assert closed.status_code == 403 and closed.json()["error"]["code"] == "registration_closed"
        # known users can still sign in when registration is closed
        assert (await second.post("/api/logout")).status_code == 204
        await sign_in(second, telegram, FakeUser(id=2, first_name="Гость"))


async def test_relogin_revokes_previous_tpam_session(
    browser: Any, telegram: FakeTelegram, fake_clients: list[FakeTelegramClient]
) -> None:
    async with browser() as first, browser() as again:
        await sign_in(first, telegram)
        old_sessions = set(telegram.valid_sessions)
        await sign_in(again, telegram)
        assert not old_sessions & set(telegram.valid_sessions)  # the earlier authorization was ended
        assert any("log_out" in c.calls for c in fake_clients)
        assert len(telegram.valid_sessions) == 1


async def test_sessions_restored_after_restart(
    user_client: httpx.AsyncClient, settings: Settings, runtime: Runtime, telegram: FakeTelegram
) -> None:
    rule = {"name": "Переживёт перезапуск", "match_mode": "any", "reply_text": "ok"}
    await user_client.post("/api/rules", json=rule)
    await runtime.stop()
    restarted = Runtime(settings, client_factory=FakeTelegramClient)
    await restarted.start()
    try:
        space = next(iter(restarted.users.values()))
        assert (await space.provider.status()).state == "connected"
        assert [r.name for r in await space.session.rules.list()] == ["Переживёт перезапуск"]
    finally:
        await restarted.stop()


async def test_session_revoked_in_telegram(
    user_client: httpx.AsyncClient, settings: Settings, runtime: Runtime, telegram: FakeTelegram
) -> None:
    await runtime.stop()
    telegram.valid_sessions.clear()  # e.g. the user ended "TPAM" in Telegram → Devices
    restarted = Runtime(settings, client_factory=FakeTelegramClient)
    await restarted.start()
    try:
        status = await next(iter(restarted.users.values())).provider.status()
        assert status.state == "unauthorized" and "Войдите заново" in (status.error or "")
    finally:
        await restarted.stop()


async def test_disconnect_and_delete_data(
    user_client: httpx.AsyncClient, settings: Settings, telegram: FakeTelegram
) -> None:
    user_dir = settings.data_dir / "users" / "42"
    assert user_dir.exists()
    assert (await user_client.post("/api/account/disconnect", json={"delete_data": True})).status_code == 204
    assert not user_dir.exists()
    assert telegram.valid_sessions == {}  # ended in Telegram as well
    assert (await user_client.get("/api/status")).status_code == 401


async def test_logout_everywhere(browser: Any, telegram: FakeTelegram) -> None:
    async with browser() as laptop, browser() as phone:
        await sign_in(laptop, telegram)
        await sign_in(phone, telegram)
        assert (await phone.post("/api/logout/all")).json()["removed"] >= 1
        assert (await laptop.get("/api/status")).status_code == 401


async def test_first_run_setup_from_this_computer(tmp_path: Path, telegram: FakeTelegram) -> None:
    from tpam.api.app import create_app

    settings = Settings(
        data_dir=tmp_path / "d", frontend_dist=tmp_path / "x", demo_latency_ms=0, _env_file=None
    )  # type: ignore[call-arg]
    runtime = Runtime(settings, client_factory=FakeTelegramClient)
    app = create_app(settings, runtime)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 1))
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:8765", headers={"X-TPAM-Request": "1"}
        ) as http:
            info = (await http.get("/api/session")).json()
            assert info["server_configured"] is False and info["setup_allowed"] is True
            assert (await _phone(http)).json()["error"]["code"] == "server_not_configured"
            assert (
                await http.post("/api/setup", json={"api_id": 7, "api_hash": "a" * 32})
            ).status_code == 204
            assert (await http.get("/api/session")).json()["server_configured"] is True
            await sign_in(http, telegram)
        remote = httpx.ASGITransport(app=app, client=("203.0.113.5", 1))
        async with httpx.AsyncClient(
            transport=remote, base_url="http://127.0.0.1:8765", headers={"X-TPAM-Request": "1"}
        ) as http:
            assert (await http.get("/api/session")).json()["setup_allowed"] is False


async def test_legacy_single_user_data_becomes_owner(
    tmp_path: Path, telegram: FakeTelegram, memory_keyring: Any
) -> None:
    from telethon.sessions import SQLiteSession

    data = tmp_path / "data"
    data.mkdir()
    SQLiteSession(str(data / "telegram")).close()  # creates telegram.session like the old version did
    (data / "telegram.db").write_bytes(b"")
    memory_keyring.store[("tpam", "anthropic_api_key")] = "sk-ant-legacy-key-000000000000"
    telegram.valid_sessions[""] = FakeUser(id=777, first_name="Старый", phone="998901112233")
    settings = Settings(
        data_dir=data,
        frontend_dist=tmp_path / "x",
        demo_latency_ms=0,
        api_id=1,
        api_hash=SecretStr("b" * 32),
        _env_file=None,  # type: ignore[call-arg]
    )
    runtime = Runtime(settings, client_factory=FakeTelegramClient)
    await runtime.start()
    try:
        users = await runtime.accounts.list_users()
        assert [(u.id, u.is_owner) for u in users] == [(777, True)]
        assert users[0].ai_key_enc and runtime.users[777].ai.key_source() == "account"
        assert (data / "users" / "777" / "telegram.db").exists()
        assert (data / "telegram.session").exists()  # originals kept
        assert (data / "legacy-migrated").exists()
    finally:
        await runtime.stop()


async def test_reconnect(user_client: httpx.AsyncClient) -> None:
    response = await user_client.post("/api/connection/reconnect")
    assert response.status_code == 200 and response.json()["state"] == "connected"
