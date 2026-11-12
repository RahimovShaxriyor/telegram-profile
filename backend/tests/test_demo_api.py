from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

ANNA = 2001
TEAM = -1001500000001
COMMUNITY = -1001500000002
BLOG = -1002500000001
NEWS = -1002500000002


async def test_status_in_demo_mode(client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/status")).json()
    assert body["mode"] == "demo"
    assert body["connection"]["state"] == "connected"
    assert body["connection"]["account"]["username"] == "demo_user"
    assert body["automation_enabled"] is False  # automation is off by default


async def test_overview_counts(client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/overview")).json()
    assert body["dialogs_total"] == 13
    assert body["kinds"]["channel"] == 3
    assert body["kinds"]["supergroup"] + body["kinds"]["group"] == 3
    assert body["automation"]["enabled"] is False


async def test_dialog_filters(client: httpx.AsyncClient) -> None:
    channels = (await client.get("/api/dialogs", params={"kind": "channels"})).json()
    assert {d["kind"] for d in channels["items"]} == {"channel"}
    everything = (await client.get("/api/dialogs")).json()
    assert everything["items"][0]["pinned"] is True


async def test_history_pagination(client: httpx.AsyncClient) -> None:
    first = (await client.get(f"/api/chats/{TEAM}/messages", params={"limit": 40})).json()
    assert len(first["items"]) == 40
    assert first["items"][0]["id"] < first["items"][-1]["id"]  # oldest first
    second = (
        await client.get(
            f"/api/chats/{TEAM}/messages", params={"limit": 40, "before_id": first["next_before_id"]}
        )
    ).json()
    assert second["items"][-1]["id"] == first["items"][0]["id"] - 1
    ids: set[int] = set()
    cursor = None
    while True:
        params = {"limit": 100} | ({"before_id": cursor} if cursor else {})
        page = (await client.get(f"/api/chats/{TEAM}/messages", params=params)).json()
        ids |= {m["id"] for m in page["items"]}
        cursor = page["next_before_id"]
        if cursor is None:
            break
    assert len(ids) == 140


async def test_send_message_and_reply_are_audited(client: httpx.AsyncClient) -> None:
    sent = await client.post(f"/api/chats/{ANNA}/messages", json={"text": "Привет!", "reply_to": 1})
    assert sent.status_code == 201
    assert sent.json()["outgoing"] is True and sent.json()["reply_to_id"] == 1
    activity = (await client.get("/api/activity", params={"source": "manual"})).json()
    assert activity["items"][0]["action"] == "message.send"
    assert activity["items"][0]["status"] == "success"
    assert activity["items"][0]["chat_title"] == "Анна Смирнова"
    assert activity["items"][0]["duration_ms"] is not None


async def test_blank_message_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post(f"/api/chats/{ANNA}/messages", json={"text": "   "})
    assert response.status_code == 422
    assert response.json()["error"]["message"] == "Сообщение не может быть пустым"


async def test_send_without_rights_fails_and_is_audited(client: httpx.AsyncClient) -> None:
    response = await client.post(f"/api/chats/{NEWS}/messages", json={"text": "test"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "permission_denied"
    failed = (await client.get("/api/activity", params={"status": "failed"})).json()
    assert failed["items"][0]["error_code"] == "permission_denied"


async def test_send_file(client: httpx.AsyncClient) -> None:
    response = await client.post(
        f"/api/chats/{ANNA}/files",
        files={"file": ("report.pdf", b"%PDF-1.4 demo", "application/pdf")},
        data={"caption": "Отчёт"},
    )
    assert response.status_code == 201
    media = response.json()["media"]
    assert media == {"kind": "document", "file_name": "report.pdf", "size": 13, "ttl": False}


async def test_search_global_and_in_chat(client: httpx.AsyncClient) -> None:
    hits = (await client.get("/api/search", params={"q": "созвон"})).json()
    assert hits and all("созвон" in h["message"]["text"].lower() for h in hits)
    scoped = (await client.get("/api/search", params={"q": "релиз", "chat_id": TEAM})).json()
    assert scoped and {h["chat_id"] for h in scoped} == {TEAM}


async def test_participants_respect_rights(client: httpx.AsyncClient) -> None:
    team = await client.get(f"/api/chats/{TEAM}/participants")
    assert team.status_code == 200 and len(team.json()) == 24
    hidden = await client.get(f"/api/chats/{COMMUNITY}/participants")
    assert hidden.status_code == 403
    details = (await client.get(f"/api/chats/{COMMUNITY}")).json()
    assert details["can_view_participants"] is False and details["participants_count"] == 1842


async def test_publish_and_schedule_in_channel(client: httpx.AsyncClient) -> None:
    now = (await client.post(f"/api/chats/{BLOG}/posts", json={"text": "Новый пост"})).json()
    assert now["views"] == 1
    at = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    scheduled = await client.post(f"/api/chats/{BLOG}/posts", json={"text": "Позже", "schedule_at": at})
    assert scheduled.status_code == 201
    listed = (await client.get(f"/api/chats/{BLOG}/scheduled")).json()
    assert [m["text"] for m in listed] == ["Позже"]
    cancel = await client.delete(f"/api/chats/{BLOG}/scheduled/{listed[0]['id']}")
    assert cancel.status_code == 204
    assert (await client.get(f"/api/chats/{BLOG}/scheduled")).json() == []


async def test_schedule_in_past_rejected(client: httpx.AsyncClient) -> None:
    at = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    response = await client.post(f"/api/chats/{BLOG}/posts", json={"text": "x", "schedule_at": at})
    assert response.status_code == 422


async def test_publish_without_rights(client: httpx.AsyncClient) -> None:
    response = await client.post(f"/api/chats/{NEWS}/posts", json={"text": "x"})
    assert response.status_code == 403


async def test_unknown_chat_404(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/chats/999/messages")
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Чат не найден"


async def test_guests_are_isolated_from_each_other(client: httpx.AsyncClient, browser: Any) -> None:
    await client.post(f"/api/chats/{ANNA}/messages", json={"text": "только мой гость"})
    async with browser() as other:
        assert (await other.post("/api/guest")).status_code == 204
        history = (await other.get(f"/api/chats/{ANNA}/messages")).json()["items"]
        assert all(m["text"] != "только мой гость" for m in history)
        assert (await other.get("/api/activity")).json()["total"] == 0
    mine = (await client.get("/api/activity", params={"source": "manual"})).json()
    assert mine["items"][0]["detail"] == "только мой гость"


async def test_demo_reset_restores_data(client: httpx.AsyncClient) -> None:
    await client.post(f"/api/chats/{ANNA}/messages", json={"text": "temp"})
    assert (await client.post("/api/demo/reset")).status_code == 204
    assert (await client.get("/api/activity")).json()["total"] == 0
    page = (await client.get(f"/api/chats/{ANNA}/messages")).json()
    assert all(m["text"] != "temp" for m in page["items"])


async def test_system_info(client: httpx.AsyncClient) -> None:
    info = (await client.get("/api/system")).json()
    assert (
        info["data_location"] == "Отдельная папка вашей учётной записи на сервере"
    )  # no server paths for non-owners
    assert info["users_total"] is None


async def test_clear_activity(client: httpx.AsyncClient) -> None:
    await client.post(f"/api/chats/{ANNA}/messages", json={"text": "1"})
    removed = (await client.delete("/api/activity")).json()["removed"]
    assert removed >= 1
    items = (await client.get("/api/activity")).json()["items"]
    assert [i["action"] for i in items] == ["activity.clear"]


async def test_spa_api_unknown_path(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/does-not-exist")).status_code == 404
