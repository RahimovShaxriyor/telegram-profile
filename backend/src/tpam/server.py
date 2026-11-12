"""`tpam` command: start the server (local by default) and open the site in the browser."""

from __future__ import annotations

import io
import sys
import threading
import webbrowser
from collections.abc import Callable

import uvicorn

from tpam import __version__
from tpam.api.app import create_app
from tpam.core.config import Settings, get_settings
from tpam.core.logging import setup_logging
from tpam.runtime import Runtime


def _announce(settings: Settings) -> Callable[[Runtime], None]:
    def announce(runtime: Runtime) -> None:
        url = settings.base_url
        print(f"\n  TPAM {__version__} запущен: {url}")
        print(f"  Пользователей: {len(runtime.users)}. Вход — по номеру телефона и коду из Telegram.")
        if runtime.app_credentials() is None:
            print("  Внимание: не заданы API ID и API HASH приложения — откройте сайт на этом компьютере.")
        if settings.dev:
            print("  Dev-режим (Vite): http://localhost:5173")
        print("  Остановить: Ctrl+C\n", flush=True)
        if settings.open_browser:
            threading.Timer(0.8, webbrowser.open, args=(url,)).start()

    return announce


def run() -> None:
    # Redirected output on Windows defaults to cp1252, which cannot print Cyrillic.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8", errors="replace")
    settings = get_settings()
    setup_logging(settings.log_level)
    runtime = Runtime(settings, on_started=_announce(settings))
    uvicorn.run(
        create_app(settings, runtime),
        host=settings.host,
        port=settings.port,
        log_config=None,
        access_log=False,
    )
