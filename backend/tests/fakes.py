"""Minimal stand-in for telethon.TelegramClient covering what TelethonProvider uses."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from telethon import errors, functions


@dataclass
class FakeUser:
    id: int = 42
    first_name: str = "Иван"
    last_name: str | None = "Тестов"
    username: str | None = "ivan_test"
    phone: str | None = "998901234567"
    premium: bool = False
    bot: bool = False


class FakeSession:
    def __init__(self, client: FakeTelegramClient) -> None:
        self._client = client
        self.dc_id = 2

    def save(self) -> str:
        return self._client.session_string if self._client.authorized else ""


@dataclass
class FakeSentCode:
    phone_code_hash: str = "hash-123"


@dataclass
class FakePassword:
    hint: str | None = "любимый город"


class FakeTelegram:
    """Shared fake 'Telegram server': which session strings are valid, who signs in next."""

    def __init__(self) -> None:
        self.valid_sessions: dict[str, FakeUser] = {}
        self.next_user = FakeUser()
        self.password: str | None = None
        self.valid_code = "12345"
        self.send_code_error: Exception | None = None
        self.connect_error: Exception | None = None
        self.counter = 0


class FakeTelegramClient:
    server = FakeTelegram()

    def __init__(self, session: str, api_id: int, api_hash: str, **kwargs: Any) -> None:
        self.session_string = session
        self.api_id = api_id
        self.api_hash = api_hash
        self.kwargs = kwargs
        self.connected = False
        self.handlers: list[Any] = []
        self.calls: list[str] = []
        self.session = FakeSession(self)
        self.rpc_error: Exception | None = None

    @property
    def authorized(self) -> bool:
        return self.session_string in self.server.valid_sessions

    @property
    def valid_code(self) -> str:
        return self.server.valid_code

    @property
    def password(self) -> str | None:
        return self.server.password

    @property
    def connect_error(self) -> Exception | None:
        return self.server.connect_error

    @property
    def send_code_error(self) -> Exception | None:
        return self.server.send_code_error

    async def connect(self) -> None:
        self.calls.append("connect")
        if self.connect_error:
            raise self.connect_error
        self.connected = True

    async def disconnect(self) -> None:
        self.calls.append("disconnect")
        self.connected = False

    def is_connected(self) -> bool:
        return self.connected

    async def is_user_authorized(self) -> bool:
        return self.authorized

    async def send_code_request(self, phone: str) -> FakeSentCode:
        self.calls.append("send_code_request")
        if self.send_code_error:
            raise self.send_code_error
        return FakeSentCode()

    async def sign_in(
        self,
        phone: str | None = None,
        code: str | None = None,
        *,
        password: str | None = None,
        phone_code_hash: str | None = None,
    ) -> FakeUser:
        if password is not None:
            if password != self.password:
                raise errors.PasswordHashInvalidError(request=None)
        else:
            if code != self.valid_code:
                raise errors.PhoneCodeInvalidError(request=None)
            assert phone_code_hash == "hash-123"
            if self.password:
                raise errors.SessionPasswordNeededError(request=None)
        self.server.counter += 1
        user = self.server.next_user
        self.session_string = f"fake-session-{user.id}-{self.server.counter}"
        self.server.valid_sessions[self.session_string] = user
        return user

    async def get_me(self) -> FakeUser:
        return self.server.valid_sessions.get(self.session_string, self.server.next_user)

    def add_event_handler(self, handler: Any, event: Any) -> None:
        self.handlers.append(handler)

    async def log_out(self) -> bool:
        self.calls.append("log_out")
        self.server.valid_sessions.pop(self.session_string, None)
        return True

    async def get_input_entity(self, peer: Any) -> Any:
        if self.rpc_error:
            raise self.rpc_error
        return peer

    async def get_dialogs(self, limit: int | None = None) -> list[Any]:
        if self.rpc_error:
            raise self.rpc_error
        return []

    async def send_message(self, entity: Any, text: str, **kwargs: Any) -> Any:
        if self.rpc_error:
            raise self.rpc_error
        return FakeMessage(id=1, chat_id=entity, message=text)

    async def __call__(self, request: Any) -> Any:
        if isinstance(request, functions.account.GetPasswordRequest):
            return FakePassword()
        raise NotImplementedError(type(request).__name__)


@dataclass
class FakeMessage:
    id: int
    chat_id: int
    message: str
    out: bool = True
    sender_id: int | None = 42
    reply_to_msg_id: int | None = None
    date: datetime = field(default_factory=lambda: datetime.now(UTC))
    media: Any = None
    sender: Any = None


class FakeAnthropic:
    """Stand-in for anthropic.AsyncAnthropic: records parse() kwargs, returns a canned decision."""

    def __init__(self) -> None:
        from types import SimpleNamespace

        self.calls: list[dict[str, Any]] = []
        self.decision: Any = None
        self.stop_reason = "end_turn"
        self.error: Exception | None = None
        self.key_error: Exception | None = None
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))
        self.models = SimpleNamespace(retrieve=self._retrieve)

    def reply(self, text: str, *, should_reply: bool = True, reason: str = "Вопрос по теме") -> None:
        from tpam.ai.assistant import AiDecision

        self.decision = AiDecision(should_reply=should_reply, reply=text, reason=reason)

    async def _parse(self, **kwargs: Any) -> Any:
        from types import SimpleNamespace

        self.calls.append(kwargs)
        if self.error:
            raise self.error
        usage = SimpleNamespace(
            input_tokens=120, output_tokens=30, cache_read_input_tokens=0, cache_creation_input_tokens=0
        )
        return SimpleNamespace(stop_reason=self.stop_reason, parsed_output=self.decision, usage=usage)

    async def _retrieve(self, model: str) -> Any:
        if self.key_error:
            raise self.key_error
        return {"id": model}
