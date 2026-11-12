from __future__ import annotations

import logging
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from tests.conftest import sign_in
from tests.fakes import FakeTelegram, FakeUser
from tpam.core.config import Settings
from tpam.core.logging import RedactingFilter, redact, register_secret


async def test_api_requires_sign_in(anon: httpx.AsyncClient) -> None:
    response = await anon.get("/api/status")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_signed_in"


async def test_health_and_session_info_are_public(anon: httpx.AsyncClient) -> None:
    assert (await anon.get("/api/health")).status_code == 200
    info = (await anon.get("/api/session")).json()
    assert info["signed_in"] is False and info["server_configured"] is True


async def test_state_changing_requests_need_csrf_header(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/chats/2001/messages", json={"text": "hi"}, headers={"X-TPAM-Request": ""}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf"
    assert (await client.get("/api/status", headers={"X-TPAM-Request": ""})).status_code == 200


async def test_foreign_host_rejected_dns_rebinding(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/status", headers={"Host": "evil.example:8765"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_host"


async def test_foreign_origin_rejected_even_with_session(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/chats/2001/messages", json={"text": "hi"}, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "invalid_origin"


async def test_cross_site_fetch_metadata_rejected(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/status", headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status_code == 403


async def test_security_headers(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/status", headers={"Origin": "http://127.0.0.1:8765"})
    assert response.status_code == 200
    assert response.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert response.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in response.headers  # plain http locally


async def test_session_cookie_flags(anon: httpx.AsyncClient) -> None:
    response = await anon.post("/api/guest")
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/" in cookie


async def test_logout_ends_session(client: httpx.AsyncClient) -> None:
    assert (await client.post("/api/logout")).status_code == 204
    assert (await client.get("/api/status")).status_code == 401


async def test_users_cannot_see_each_others_data(browser: Any, telegram: FakeTelegram) -> None:
    async with browser() as alice, browser() as bob:
        await sign_in(alice, telegram, FakeUser(id=101, first_name="Алиса", phone="998900000101"))
        await sign_in(bob, telegram, FakeUser(id=202, first_name="Боб", phone="998900000202"))
        rule = {"name": "Секрет Алисы", "match_mode": "any", "reply_text": "ok"}
        assert (await alice.post("/api/rules", json=rule)).status_code == 201
        assert (await bob.get("/api/rules")).json() == []
        assert all(
            "Секрет" not in (i["rule_name"] or "") for i in (await bob.get("/api/activity")).json()["items"]
        )
        assert (await bob.get("/api/session")).json()["user"]["name"] == "Боб Тестов"


async def test_non_owner_cannot_use_admin(browser: Any, telegram: FakeTelegram) -> None:
    async with browser() as owner, browser() as other:
        await sign_in(owner, telegram, FakeUser(id=1, phone="998900000001"))
        await sign_in(other, telegram, FakeUser(id=2, phone="998900000002"))
        assert (await other.get("/api/admin")).status_code == 403
        assert (await owner.get("/api/admin")).status_code == 200


async def test_validation_errors_do_not_echo_secrets(anon: httpx.AsyncClient) -> None:
    secret = "my-very-secret-password-" + "x" * 300
    response = await anon.post("/api/login/password", json={"password": secret})
    assert response.status_code == 422
    assert secret not in response.text


def test_remote_listening_requires_https_public_url() -> None:
    with pytest.raises(ValueError, match="TPAM_PUBLIC_URL"):
        Settings(host="0.0.0.0", _env_file=None)  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="HTTPS"):
        Settings(host="0.0.0.0", public_url="http://tpam.example.com", _env_file=None)  # type: ignore[call-arg]
    remote = Settings(host="0.0.0.0", public_url="https://tpam.example.com", _env_file=None)  # type: ignore[call-arg]
    assert remote.secure_cookies is True
    assert "tpam.example.com" in remote.allowed_hosts
    assert "https://tpam.example.com" in remote.allowed_origins


async def test_server_secrets_are_encrypted_at_rest(
    user_client: httpx.AsyncClient, settings: Settings
) -> None:
    raw = b"".join(p.read_bytes() for p in settings.data_dir.glob("server.db*"))
    assert b"fake-session-" not in raw  # Telegram session strings are encrypted
    assert b"998900000042" not in raw  # the phone number used to sign in is not stored in clear


def test_secret_key_from_env_is_used(tmp_path: Any) -> None:
    from cryptography.fernet import Fernet

    from tpam.core.crypto import Vault

    key = Fernet.generate_key().decode()
    vault = Vault.load(key, tmp_path / "unused.key")
    assert vault.decrypt(vault.encrypt("x")) == "x"
    assert not (tmp_path / "unused.key").exists()
    _ = SecretStr(key)


def test_redaction_patterns() -> None:
    text = "phone +998901234567 hash 0123456789abcdef0123456789abcdef token " + "A" * 50
    out = redact(text)
    assert "+998901234567" not in out
    assert "0123456789abcdef0123456789abcdef" not in out
    assert "A" * 50 not in out


def test_registered_secret_redacted_in_log_records() -> None:
    register_secret("71834")
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "code is %s", ("71834",), None)
    RedactingFilter().filter(record)
    assert "71834" not in record.getMessage()
