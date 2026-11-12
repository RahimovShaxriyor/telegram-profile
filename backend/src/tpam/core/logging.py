"""Logging setup with a redaction filter so secrets never reach log output."""

from __future__ import annotations

import logging
import re
import threading

_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # International phone numbers: keep the country prefix and the last two digits.
    # Bare digit runs are not matched (they are usually Telegram ids); entered phone
    # numbers are additionally registered via register_secret().
    (re.compile(r"\+(\d{3})\d{5,10}(\d{2})\b"), r"+\1*****\2"),
    # api_hash: 32 hex chars.
    (re.compile(r"\b[0-9a-fA-F]{32}\b"), "[REDACTED_HASH]"),
    # Long opaque tokens (StringSession, API tokens).
    (re.compile(r"\b[A-Za-z0-9_\-]{40,}={0,2}"), "[REDACTED_TOKEN]"),
)

_secrets: set[str] = set()
_lock = threading.Lock()


def register_secret(value: str | None) -> None:
    """Mask this exact value in every future log record (codes, passwords, tokens)."""
    if value and len(value) >= 4:
        with _lock:
            _secrets.add(value)


def redact(text: str) -> str:
    with _lock:
        secrets = sorted(_secrets, key=len, reverse=True)
    for secret in secrets:
        text = text.replace(secret, "[REDACTED]")
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        record.msg = redact(message)
        record.args = None
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    handler.addFilter(RedactingFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # Telethon logs request internals at INFO/DEBUG; keep it quiet.
    logging.getLogger("telethon").setLevel(logging.WARNING)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers[:] = []
        lg.propagate = True
    # Access log lines contain query strings; not useful for a local app.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
