"""Start TPAM with Windows: a small .cmd in the user's Startup folder (no admin rights, easy to remove)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from tpam.core.config import REPO_ROOT
from tpam.core.errors import InvalidState

SCRIPT_NAME = "TPAM.cmd"


def startup_script() -> Path:
    if sys.platform != "win32":
        raise InvalidState("Автозапуск настраивается только в Windows")
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise InvalidState("Не найдена папка автозагрузки Windows")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / SCRIPT_NAME


def is_enabled() -> bool:
    try:
        return startup_script().is_file()
    except InvalidState:
        return False


def set_enabled(enabled: bool) -> None:
    script = startup_script()
    if not enabled:
        script.unlink(missing_ok=True)
        return
    launcher = REPO_ROOT / "start.cmd"
    if not launcher.is_file():
        raise InvalidState(f"Не найден {launcher}")
    script.parent.mkdir(parents=True, exist_ok=True)
    script.write_text(
        "@echo off\r\n"
        "rem Created by TPAM (Settings -> Archive -> Start with Windows). Delete this file to disable.\r\n"
        "set TPAM_OPEN_BROWSER=0\r\n"
        f'start "TPAM" /min cmd /c "cd /d "{REPO_ROOT}" && start.cmd"\r\n',
        encoding="utf-8",
    )
