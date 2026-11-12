"""HTTP protection: Host allowlist (DNS rebinding), Origin + custom-header CSRF defence, security headers.

Who the user is comes from the HttpOnly session cookie (see api/deps.py). Cookies are SameSite=Lax;
in addition every state-changing /api request must carry ``X-TPAM-Request: 1`` — a header browsers
refuse to send cross-site without a CORS preflight, which this server never grants.

Implemented as pure ASGI middleware so it also covers static files and streaming responses.
"""

from __future__ import annotations

import json

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from tpam.core.config import Settings

CSRF_HEADER = "x-tpam-request"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

BASE_HEADERS: list[tuple[bytes, bytes]] = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"cross-origin-resource-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (
        b"content-security-policy",
        (
            b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            b"font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        ),
    ),
]
HSTS = (b"strict-transport-security", b"max-age=31536000; includeSubDomains")


class SecurityGuard:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.allowed_hosts = settings.allowed_hosts
        self.allowed_origins = settings.allowed_origins
        self.headers = [*BASE_HEADERS, HSTS] if settings.secure_cookies else BASE_HEADERS

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        path: str = scope["path"]
        method: str = scope["method"]

        if headers.get("host", "") not in self.allowed_hosts:
            await self._deny(send, 400, "invalid_host", "Недопустимый адрес сайта.")
            return
        origin = headers.get("origin")
        if origin is not None and origin not in self.allowed_origins:
            await self._deny(send, 403, "invalid_origin", "Запрос с чужого сайта отклонён.")
            return
        if headers.get("sec-fetch-site") == "cross-site":
            await self._deny(send, 403, "invalid_origin", "Запрос с чужого сайта отклонён.")
            return
        if path.startswith("/api/") and method not in SAFE_METHODS and headers.get(CSRF_HEADER) != "1":
            await self._deny(send, 403, "csrf", "Запрос отклонён защитой от подделки запросов.")
            return

        extra = self.headers

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *extra]
                if path.startswith("/api/"):
                    message["headers"].append((b"cache-control", b"no-store"))
            await send(message)

        await self.app(scope, receive, send_with_headers)

    async def _deny(self, send: Send, status: int, code: str, message: str) -> None:
        body = json.dumps({"error": {"code": code, "message": message}}, ensure_ascii=False).encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"application/json; charset=utf-8"), *self.headers],
            }
        )
        await send({"type": "http.response.body", "body": body})
