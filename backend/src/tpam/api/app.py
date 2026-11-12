"""FastAPI application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from tpam import __version__
from tpam.api.routes import activity, admin, ai, archive, automation, chats, login, system
from tpam.api.security import SecurityGuard
from tpam.core.config import Settings
from tpam.core.errors import TpamError
from tpam.runtime import Runtime

log = logging.getLogger(__name__)


def _error(status: int, code: str, message: str, **extra: object) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, **extra}},
    )


def create_app(settings: Settings, runtime: Runtime | None = None) -> FastAPI:
    runtime = runtime or Runtime(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await runtime.start()
        try:
            yield
        finally:
            await runtime.stop()

    app = FastAPI(
        title="TPAM",
        version=__version__,
        lifespan=lifespan,
        # Interactive docs would need inline scripts (blocked by CSP) and widen the surface.
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.dev else None,
    )
    app.state.runtime = runtime

    @app.exception_handler(TpamError)
    async def _tpam_error(_: Request, exc: TpamError) -> JSONResponse:
        extra = {"retry_after": exc.retry_after} if exc.retry_after else {}
        return _error(exc.status_code, exc.code, exc.message, **extra)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Never echo submitted values back (they can be secrets such as api_hash or a code).
        fields = [
            {
                "field": ".".join(str(p) for p in err.get("loc", [])[1:]),
                "message": _clean(err.get("msg", "")),
            }
            for err in exc.errors()
        ]
        message = fields[0]["message"] if fields else "Проверьте введённые данные"
        return _error(422, "validation_failed", message, fields=fields)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error: %s", type(exc).__name__)
        return _error(
            500,
            "internal_error",
            "Внутренняя ошибка приложения. Подробности в окне запуска TPAM.",
        )

    for module in (system, login, admin, chats, automation, activity, ai, archive):
        app.include_router(module.router)

    _mount_frontend(app, settings.frontend_dist)
    app.add_middleware(SecurityGuard, settings=settings)
    return app


def _clean(message: str) -> str:
    return message.removeprefix("Value error, ")


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    if not index.exists():
        log.warning("Frontend build not found at %s — run `npm run build` in frontend/", dist)
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:  # sync: runs in the threadpool (blocking Path calls)
        if path.startswith("api/"):
            raise _NotFoundApi()
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
            return FileResponse(candidate)
        return FileResponse(index, headers={"cache-control": "no-cache"})


class _NotFoundApi(TpamError):
    status_code = 404
    code = "not_found"

    def __init__(self) -> None:
        super().__init__("Неизвестный адрес API")
