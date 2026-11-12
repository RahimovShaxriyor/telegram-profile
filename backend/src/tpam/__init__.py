"""TPAM — Telegram Personal Account Manager (local web app)."""

__version__ = "0.1.0"


def main() -> None:
    from tpam.server import run

    run()
