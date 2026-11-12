"""In-memory sliding-window limits (single process). Protects login codes and the app's API ID."""

from __future__ import annotations

import time
from collections import deque

from tpam.core.errors import RateLimited


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float, message: str) -> None:
        self.limit = limit
        self.window = window_seconds
        self.message = message
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> None:
        """Counts one attempt; raises RateLimited once the key is over its limit."""
        now = time.monotonic()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            retry = int(self.window - (now - hits[0])) + 1
            raise RateLimited(self.message, code="too_many_attempts", retry_after=retry)
        hits.append(now)
        if len(self._hits) > 10_000:  # keep memory bounded under abuse
            self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] <= self.window}
