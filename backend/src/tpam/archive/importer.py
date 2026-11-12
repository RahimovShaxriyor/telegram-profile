"""Import of the official Telegram Desktop export ("Machine-readable JSON", result.json).

The file can be hundreds of megabytes, so chats are streamed one by one with ijson in a
worker thread; messages are inserted idempotently (re-importing never duplicates).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import ijson

from tpam.models import ChatKind
from tpam.storage.archive import ArchiveRepository, NewArchiveMessage

ProgressFn = Callable[..., None]

_CHAT_KIND: dict[str, ChatKind] = {
    "personal_chat": "user",
    "saved_messages": "user",
    "bot_chat": "bot",
    "private_group": "group",
    "private_supergroup": "supergroup",
    "public_supergroup": "supergroup",
    "private_channel": "channel",
    "public_channel": "channel",
}
_MEDIA_KIND = {
    "voice_message": "voice",
    "video_message": "video",
    "video_file": "video",
    "audio_file": "audio",
    "sticker": "sticker",
    "animation": "gif",
}


def marked_chat_id(raw_id: int, kind: ChatKind) -> int:
    """Export ids are bare; Telegram API ids are -100<id> for channels/supergroups and -<id> for basic groups."""
    if kind in ("channel", "supergroup"):
        return int(f"-100{raw_id}")
    if kind == "group":
        return -raw_id
    return raw_id


def _peer_id(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    digits = value.lstrip("abcdefghijklmnopqrstuvwxyz")
    return int(digits) if digits.isdigit() else None


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(part if isinstance(part, str) else str(part.get("text", "")) for part in value)
    return ""


def _date(message: dict[str, Any]) -> datetime:
    unix = message.get("date_unixtime")
    if unix:
        return datetime.fromtimestamp(int(unix), UTC)
    return datetime.fromisoformat(message["date"]).astimezone(UTC)  # local time in older exports


def _file(base: Path, value: Any) -> str | None:
    if not isinstance(value, str) or value.startswith("("):  # "(File not included ...)"
        return None
    path = (base / value).resolve()
    return str(path) if path.is_file() and path.is_relative_to(base.resolve()) else None


def parse_message(
    raw: dict[str, Any], chat_id: int, base: Path, my_id: int | None
) -> NewArchiveMessage | None:
    if raw.get("type") != "message":
        return None
    ttl = bool(raw.get("self_destruct_period_seconds"))
    media_kind = media_name = media_path = None
    media_size: int | None = None
    if "photo" in raw:
        media_kind, media_path = "photo", _file(base, raw["photo"])
        media_size = raw.get("photo_file_size")
    elif "file" in raw:
        media_kind = _MEDIA_KIND.get(raw.get("media_type", ""), "document")
        media_path = _file(base, raw["file"])
        media_name = raw.get("file_name") or (Path(str(raw["file"])).name if media_path else None)
        media_size = raw.get("file_size")
    sender_id = _peer_id(raw.get("from_id"))
    edited = raw.get("edited_unixtime")
    return NewArchiveMessage(
        chat_id=chat_id,
        message_id=int(raw["id"]),
        date=_date(raw),
        sender_id=sender_id,
        sender_name=raw.get("from"),
        outgoing=my_id is not None and sender_id == my_id,
        text=_text(raw.get("text", "")),
        reply_to_id=int(raw["reply_to_message_id"]) if raw.get("reply_to_message_id") else None,
        media_kind=media_kind,
        media_name=media_name,
        media_size=int(media_size) if media_size else None,
        ttl=ttl,
        source="import",
        media_path=None if ttl else media_path,
        edited_at=datetime.fromtimestamp(int(edited), UTC) if edited else None,
    )


def iter_chats(result_json: Path) -> Iterator[dict[str, Any]]:
    """Full exports keep chats under chats.list / left_chats.list; a single-chat export is one object."""
    found = False
    for prefix in ("chats.list.item", "left_chats.list.item"):
        with result_json.open("rb") as f:
            for chat in ijson.items(f, prefix, use_float=True):
                found = True
                yield chat
    if not found:
        with result_json.open("rb") as f:
            top = next(ijson.items(f, "", use_float=True), None)
        if isinstance(top, dict) and "messages" in top:
            yield top


def personal_user_id(result_json: Path) -> int | None:
    with result_json.open("rb") as f:
        for value in ijson.items(f, "personal_information.user_id"):
            return int(value)
    return None


async def import_export(
    result_json: Path, repo: ArchiveRepository, *, my_id: int | None, progress: ProgressFn
) -> None:
    base = result_json.parent
    my_id = await asyncio.to_thread(personal_user_id, result_json) or my_id
    chats = iter_chats(result_json)
    imported = skipped = done = 0
    while True:
        chat = await asyncio.to_thread(next, chats, None)
        if chat is None:
            break
        kind = _CHAT_KIND.get(chat.get("type", ""), "user")
        raw_id = int(chat.get("id") or 0)
        chat_id = my_id if chat.get("type") == "saved_messages" and my_id else marked_chat_id(raw_id, kind)
        title = chat.get("name") or (
            "Избранное" if chat.get("type") == "saved_messages" else "Удалённый аккаунт"
        )
        progress(current_chat=title)
        messages = [m for raw in chat.get("messages", []) if (m := parse_message(raw, chat_id, base, my_id))]
        await repo.upsert_chat(chat_id, title, kind)
        added = await repo.add_many(messages)
        imported += added
        skipped += len(messages) - added
        done += 1
        progress(chats_done=done, messages_imported=imported, messages_skipped=skipped)
