"""Domain exceptions. The API layer turns them into {"error": {...}} JSON responses."""

from __future__ import annotations


class TpamError(Exception):
    status_code = 400
    code = "error"

    def __init__(self, message: str, *, code: str | None = None, retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        self.retry_after = retry_after


class ValidationFailed(TpamError):
    status_code = 422
    code = "validation_failed"


class NotFound(TpamError):
    status_code = 404
    code = "not_found"


class PermissionDenied(TpamError):
    status_code = 403
    code = "permission_denied"


class InvalidState(TpamError):
    status_code = 409
    code = "invalid_state"


class NotAuthorized(TpamError):
    """Telegram account is not connected (distinct from the local API token check)."""

    status_code = 409
    code = "telegram_not_authorized"


class AuthFailed(TpamError):
    status_code = 400
    code = "auth_failed"


class RateLimited(TpamError):
    status_code = 429
    code = "rate_limited"


class TelegramUnavailable(TpamError):
    status_code = 503
    code = "telegram_unavailable"


class AiError(TpamError):
    """The AI provider failed or is not configured."""

    status_code = 502
    code = "ai_error"


class NotSignedIn(TpamError):
    """No valid browser session: the UI shows the sign-in screen."""

    status_code = 401
    code = "not_signed_in"
