"""Archive: live capture, deletions/edits kept locally, scope, search, Telegram export import, CSV, autostart."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from tests.fakes import FakeTelegramClient, FakeUser
from tpam.archive.importer import marked_chat_id
from tpam.core.keystore import ApiCredentials
from tpam.models import DeletedMessages
from tpam.providers.telethon_provider import TelethonProvider
from tpam.storage.archive import ArchiveRepository, NewArchiveMessage
from tpam.storage.db import Database

ANNA = 2001
TEAM = -1001500000001


async def _incoming(client: httpx.AsyncClient, chat_id: int, text: str) -> dict[str, Any]:
    response = await client.post("/api/demo/incoming", json={"chat_id": chat_id, "text": text})
    assert response.status_code == 200
    return response.json()


async def test_deleted_message_stays_in_chat_and_archive(client: httpx.AsyncClient) -> None:
    msg = await _incoming(client, ANNA, "Секретный план: встречаемся в 18:00")
    assert (
        await client.post("/api/demo/delete", json={"chat_id": ANNA, "message_id": msg["id"]})
    ).status_code == 204

    history = (await client.get(f"/api/chats/{ANNA}/messages")).json()["items"]
    kept = [m for m in history if m["id"] == msg["id"]]
    assert kept and kept[0]["deleted"] is True and kept[0]["text"].startswith("Секретный план")

    deleted = (await client.get("/api/archive/messages", params={"only": "deleted"})).json()
    assert deleted["total"] == 1 and deleted["items"][0]["deleted_at"] is not None
    stats = (await client.get("/api/archive/stats")).json()
    assert stats["deleted"] == 1 and stats["messages"] >= 1


async def test_edit_history_is_kept(client: httpx.AsyncClient) -> None:
    msg = await _incoming(client, ANNA, "Цена 100")
    await client.post("/api/demo/edit", json={"chat_id": ANNA, "message_id": msg["id"], "text": "Цена 150"})
    edited = (await client.get("/api/archive/messages", params={"only": "edited"})).json()["items"]
    assert edited[0]["text"] == "Цена 150" and edited[0]["edit_count"] == 1
    versions = (await client.get(f"/api/archive/messages/{edited[0]['id']}/edits")).json()
    assert versions[0]["old_text"] == "Цена 100" and versions[0]["new_text"] == "Цена 150"


async def test_sent_from_tpam_is_archived(client: httpx.AsyncClient) -> None:
    await client.get("/api/dialogs")  # warms the chat kind cache, as opening the chat list does
    await client.post(f"/api/chats/{ANNA}/messages", json={"text": "Отправлено из TPAM"})
    found = (await client.get("/api/archive/messages", params={"q": "отправлено"})).json()
    assert found["total"] == 1 and found["items"][0]["outgoing"] is True


async def test_scope_groups_off_by_default(client: httpx.AsyncClient) -> None:
    await _incoming(client, TEAM, "Сообщение в группе")
    assert (await client.get("/api/archive/stats")).json()["messages"] == 0
    settings = (await client.get("/api/archive/settings")).json()
    assert settings == {
        "enabled": True,
        "private_chats": True,
        "groups": False,
        "chat_ids": [],
        "media": "photos",
        "max_media_mb": 20,
    }
    await client.put("/api/archive/settings", json=settings | {"groups": True})
    await _incoming(client, TEAM, "Теперь сохраняется")
    assert (await client.get("/api/archive/stats")).json()["messages"] == 1


async def test_archive_disabled_captures_nothing(client: httpx.AsyncClient) -> None:
    settings = (await client.get("/api/archive/settings")).json()
    await client.put("/api/archive/settings", json=settings | {"enabled": False})
    await _incoming(client, ANNA, "не сохранится")
    assert (await client.get("/api/archive/stats")).json()["messages"] == 0


async def test_clear_archive(client: httpx.AsyncClient) -> None:
    await _incoming(client, ANNA, "временное")
    assert (await client.delete("/api/archive")).status_code == 200
    assert (await client.get("/api/archive/stats")).json() | {"database_bytes": 0} == {
        "messages": 0,
        "deleted": 0,
        "edited": 0,
        "chats": 0,
        "media_files": 0,
        "media_bytes": 0,
        "database_bytes": 0,
    }


# ---- repository ------------------------------------------------------------------


def _msg(chat_id: int, message_id: int, text: str) -> NewArchiveMessage:
    return NewArchiveMessage(
        chat_id=chat_id,
        message_id=message_id,
        date=datetime.now(UTC),
        sender_id=1,
        sender_name="A",
        outgoing=False,
        text=text,
        reply_to_id=None,
        media_kind=None,
        media_name=None,
        media_size=None,
        ttl=False,
    )


@pytest.fixture
async def repo(tmp_path: Path) -> Any:
    db = Database(tmp_path / "r.db")
    await db.init()
    yield ArchiveRepository(db)
    await db.dispose()


async def test_deletion_without_chat_id_only_hits_account_scoped_chats(repo: ArchiveRepository) -> None:
    await repo.upsert_chat(10, "Личный", "user")
    await repo.upsert_chat(-10050, "Супергруппа", "supergroup")
    await repo.add(_msg(10, 7, "личное"))
    await repo.add(_msg(-10050, 7, "в канале тот же номер"))
    assert await repo.mark_deleted(None, [7], datetime.now(UTC)) == 1
    deleted = await repo.search(only="deleted")
    assert [m.chat_id for m in deleted.items] == [10]
    assert await repo.mark_deleted(-10050, [7], datetime.now(UTC)) == 1


async def test_full_text_search_cyrillic(repo: ArchiveRepository) -> None:
    await repo.upsert_chat(1, "Чат", "user")
    await repo.add(_msg(1, 1, "Ёлка стоит в ЗАЛЕ"))
    await repo.add(_msg(1, 2, "Совсем другое сообщение"))
    assert (await repo.search(query="елка")).total == 1
    assert (await repo.search(query="зал")).total == 1  # prefix, case-insensitive
    assert (await repo.search(query="ёлка зал")).total == 1
    assert (await repo.search(query='"; DROP TABLE x; --')).total == 0  # query is sanitized
    assert await repo.add(_msg(1, 1, "дубликат")) is None  # idempotent per (chat, message)


# ---- import of Telegram Desktop export ---------------------------------------------


def _export(tmp_path: Path) -> Path:
    folder = tmp_path / "ChatExport"
    (folder / "photos").mkdir(parents=True)
    (folder / "photos" / "photo_1.jpg").write_bytes(b"\xff\xd8\xff demo jpeg")
    data = {
        "personal_information": {"user_id": 42, "first_name": "Я"},
        "chats": {
            "list": [
                {
                    "name": "Анна",
                    "type": "personal_chat",
                    "id": 2001,
                    "messages": [
                        {
                            "id": 1,
                            "type": "message",
                            "date": "2024-05-01T10:00:00",
                            "date_unixtime": "1714557600",
                            "from": "Анна",
                            "from_id": "user2001",
                            "text": "Привет!",
                        },
                        {
                            "id": 2,
                            "type": "message",
                            "date": "2024-05-01T10:01:00",
                            "date_unixtime": "1714557660",
                            "from": "Я",
                            "from_id": "user42",
                            "text": ["Смотри ", {"type": "link", "text": "https://example.com"}],
                            "edited": "2024-05-01T10:05:00",
                            "edited_unixtime": "1714557900",
                        },
                        {
                            "id": 3,
                            "type": "message",
                            "date": "2024-05-01T10:02:00",
                            "date_unixtime": "1714557720",
                            "from": "Анна",
                            "from_id": "user2001",
                            "photo": "photos/photo_1.jpg",
                            "photo_file_size": 15,
                            "text": "",
                        },
                        {
                            "id": 4,
                            "type": "message",
                            "date": "2024-05-01T10:03:00",
                            "date_unixtime": "1714557780",
                            "from": "Анна",
                            "from_id": "user2001",
                            "photo": "photos/photo_1.jpg",
                            "self_destruct_period_seconds": 10,
                            "text": "",
                        },
                        {"id": 5, "type": "service", "date": "2024-05-01T10:04:00", "action": "phone_call"},
                    ],
                },
                {
                    "name": "Команда",
                    "type": "private_supergroup",
                    "id": 1500000001,
                    "messages": [
                        {
                            "id": 9,
                            "type": "message",
                            "date": "2024-05-02T09:00:00",
                            "date_unixtime": "1714640400",
                            "from": "Дмитрий",
                            "from_id": "user2002",
                            "text": "Релиз в четверг",
                            "file": "(File not included. Change data exporting settings to download.)",
                            "file_name": "plan.pdf",
                            "file_size": 1000,
                            "media_type": "document",
                        },
                    ],
                },
            ]
        },
    }
    (folder / "result.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return folder


async def _wait_import(client: httpx.AsyncClient) -> dict[str, Any]:
    for _ in range(100):
        status = (await client.get("/api/archive/import")).json()
        if status["state"] != "running":
            return status
        await asyncio.sleep(0.05)
    raise AssertionError("import did not finish")


async def test_import_telegram_export(user_client: httpx.AsyncClient, tmp_path: Path) -> None:
    client = user_client  # path import is owner-only
    folder = _export(tmp_path)
    started = await client.post(
        "/api/archive/import", json={"path": f'"{folder}"'}
    )  # "Copy as path" adds quotes
    assert started.status_code == 202
    status = await _wait_import(client)
    assert status["state"] == "done" and status["chats_done"] == 2 and status["messages_imported"] == 5

    chats = {c["title"]: c for c in (await client.get("/api/archive/chats")).json()}
    assert chats["Команда"]["id"] == -1001500000001 and chats["Анна"]["messages"] == 4

    page = (await client.get("/api/archive/messages", params={"chat_id": 2001})).json()["items"]
    by_id = {m["message_id"]: m for m in page}
    assert by_id[2]["outgoing"] is True and by_id[2]["text"] == "Смотри https://example.com"
    assert by_id[2]["edited_at"] is not None and by_id[1]["source"] == "import"
    assert by_id[3]["has_file"] is True and by_id[4]["has_file"] is False  # view-once media is not kept
    photo = await client.get(f"/api/archive/messages/{by_id[3]['id']}/media")
    assert photo.status_code == 200 and photo.content.startswith(b"\xff\xd8")
    team = (await client.get("/api/archive/messages", params={"q": "релиз"})).json()["items"][0]
    assert team["media"]["file_name"] == "plan.pdf" and team["has_file"] is False

    again = await client.post("/api/archive/import", json={"path": str(folder)})
    assert again.status_code == 202
    repeat = await _wait_import(client)
    assert repeat["messages_imported"] == 0 and repeat["messages_skipped"] == 5  # idempotent


async def test_import_rejects_wrong_folder(user_client: httpx.AsyncClient, tmp_path: Path) -> None:
    client = user_client
    response = await client.post("/api/archive/import", json={"path": str(tmp_path)})
    assert response.status_code == 422 and "result.json" in response.json()["error"]["message"]


def test_marked_ids() -> None:
    assert marked_chat_id(123, "user") == 123
    assert marked_chat_id(123, "group") == -123
    assert marked_chat_id(123, "channel") == -100123


async def test_csv_export(client: httpx.AsyncClient) -> None:
    await _incoming(client, ANNA, "строка для CSV, с запятой")
    response = await client.get("/api/archive/export.csv")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    text = response.content.decode("utf-8")
    assert text.startswith("﻿Дата (UTC)") and '"строка для CSV, с запятой"' in text


# ---- Telethon provider events ----------------------------------------------------


async def test_telethon_deletion_event_forwarded(tmp_path: Path) -> None:
    FakeTelegramClient.server.valid_sessions["s"] = FakeUser()
    provider = TelethonProvider("s", ApiCredentials(1, "0" * 32), FakeTelegramClient)
    await provider.start()
    received: list[DeletedMessages] = []

    async def on_delete(deleted: DeletedMessages) -> None:
        received.append(deleted)

    provider.set_change_handlers(None, on_delete)
    await provider._on_deleted(SimpleNamespace(chat_id=None, deleted_ids=[5, 6]))
    assert received == [DeletedMessages(chat_id=None, message_ids=[5, 6])]


# ---- autostart -------------------------------------------------------------------


async def test_autostart_toggle(
    user_client: httpx.AsyncClient, client: httpx.AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert (await client.get("/api/system/autostart")).status_code == 403  # guests / non-owners cannot
    client = user_client
    monkeypatch.setenv("APPDATA", str(tmp_path))
    if not (await client.get("/api/system/autostart")).json()["supported"]:
        pytest.skip("Windows only")
    assert (await client.put("/api/system/autostart", json={"enabled": True})).json()["enabled"] is True
    script = next(tmp_path.rglob("TPAM.cmd"))
    assert "start.cmd" in script.read_text(encoding="utf-8") and "TPAM_OPEN_BROWSER=0" in script.read_text(
        encoding="utf-8"
    )
    assert (await client.put("/api/system/autostart", json={"enabled": False})).json()["enabled"] is False
    assert not script.exists()


async def test_upload_import_for_regular_users(client: httpx.AsyncClient, tmp_path: Path) -> None:
    folder = _export(tmp_path)
    assert (await client.post("/api/archive/import", json={"path": str(folder)})).status_code == 403
    with (folder / "result.json").open("rb") as f:
        started = await client.post(
            "/api/archive/import/upload", files={"file": ("result.json", f, "application/json")}
        )
    assert started.status_code == 202
    status = await _wait_import(client)
    assert status["state"] == "done" and status["messages_imported"] == 5
    page = (await client.get("/api/archive/messages", params={"chat_id": 2001})).json()["items"]
    assert all(m["has_file"] is False for m in page)  # uploaded JSON brings no server-side files


async def test_upload_cannot_reference_server_files(client: httpx.AsyncClient, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("top secret")
    export = {
        "chats": {
            "list": [
                {
                    "name": "X",
                    "type": "personal_chat",
                    "id": 5,
                    "messages": [
                        {
                            "id": 1,
                            "type": "message",
                            "date_unixtime": "1714557600",
                            "date": "2024-05-01T10:00:00",
                            "from": "X",
                            "from_id": "user5",
                            "text": "",
                            "file": str(secret),
                            "file_name": "secret.txt",
                        },
                        {
                            "id": 2,
                            "type": "message",
                            "date_unixtime": "1714557600",
                            "date": "2024-05-01T10:00:00",
                            "from": "X",
                            "from_id": "user5",
                            "text": "",
                            "photo": "../../../../secret.txt",
                        },
                    ],
                }
            ]
        }
    }
    payload = json.dumps(export).encode()
    started = await client.post(
        "/api/archive/import/upload", files={"file": ("result.json", payload, "application/json")}
    )
    assert started.status_code == 202
    await _wait_import(client)
    items = (await client.get("/api/archive/messages")).json()["items"]
    assert items and all(m["has_file"] is False for m in items)
