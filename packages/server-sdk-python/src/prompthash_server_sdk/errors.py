"""Machine-readable error codes and typed exceptions for the Prompt Mint API.

The serverless codes mirror ``src/lib/api/errorCodes.ts``; the Express codes
mirror the ``AppError`` throw sites under ``server/src``. See
``docs/sdk-error-codes.md`` for the reference card.
"""

from __future__ import annotations

import time
from typing import Any, Mapping, Optional

ERROR_CODES = {
    # Request errors (4xx)
    "MISSING_FIELDS": "MISSING_FIELDS",
    "METHOD_NOT_ALLOWED": "METHOD_NOT_ALLOWED",
    "INVALID_INPUT": "INVALID_INPUT",
    "INVALID_VERSION": "INVALID_VERSION",
    "INVALID_WALLET": "INVALID_WALLET",
    "CHALLENGE_MALFORMED": "CHALLENGE_MALFORMED",
    # Auth / access errors (4xx)
    "CHALLENGE_EXPIRED": "CHALLENGE_EXPIRED",
    "CHALLENGE_INVALID": "CHALLENGE_INVALID",
    "INVALID_SIGNATURE": "INVALID_SIGNATURE",
    "CHALLENGE_INVALID_SIGNATURE": "CHALLENGE_INVALID_SIGNATURE",
    "CHALLENGE_MISMATCH": "CHALLENGE_MISMATCH",
    "ACCESS_NOT_PURCHASED": "ACCESS_NOT_PURCHASED",
    "UNAUTHENTICATED": "UNAUTHENTICATED",
    "FORBIDDEN": "FORBIDDEN",
    "KEY_NOT_FOUND": "KEY_NOT_FOUND",
    "NOT_FOUND": "NOT_FOUND",
    # Rate limiting (429)
    "RATE_LIMIT_IP": "RATE_LIMIT_IP",
    "RATE_LIMIT_WALLET": "RATE_LIMIT_WALLET",
    "RATE_LIMITED": "RATE_LIMITED",
    "ACCOUNT_LOCKED": "ACCOUNT_LOCKED",
    "CAPTCHA_REQUIRED": "CAPTCHA_REQUIRED",
    "CAPTCHA_INVALID": "CAPTCHA_INVALID",
    # Concurrency / idempotency (409)
    "CONCURRENT_VERSION_CONFLICT": "CONCURRENT_VERSION_CONFLICT",
    # Analytics errors (4xx)
    "UNKNOWN_EVENT": "UNKNOWN_EVENT",
    "INVALID_EVENT_PAYLOAD": "INVALID_EVENT_PAYLOAD",
    # Expiry (410)
    "EXPORT_EXPIRED": "EXPORT_EXPIRED",
    # Server errors (5xx)
    "CONFIGURATION_ERROR": "CONFIGURATION_ERROR",
    "INTEGRITY_FAILURE": "INTEGRITY_FAILURE",
    "TEMPORARY_FAILURE": "TEMPORARY_FAILURE",
    "UNSUPPORTED_VERSION": "UNSUPPORTED_VERSION",
    "PAYLOAD_TOO_LARGE": "PAYLOAD_TOO_LARGE",
    "WALLET_NOT_FUNDED": "WALLET_NOT_FUNDED",
}

#: HTTP statuses that are always safe to retry with backoff.
RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})

#: Codes that must never be retried, even on a retryable status.
NON_RETRYABLE_CODES = frozenset(
    {
        ERROR_CODES["INTEGRITY_FAILURE"],
        ERROR_CODES["ACCESS_NOT_PURCHASED"],
        ERROR_CODES["INVALID_INPUT"],
        ERROR_CODES["MISSING_FIELDS"],
        ERROR_CODES["METHOD_NOT_ALLOWED"],
        ERROR_CODES["UNSUPPORTED_VERSION"],
        ERROR_CODES["UNKNOWN_EVENT"],
        ERROR_CODES["INVALID_EVENT_PAYLOAD"],
        ERROR_CODES["CHALLENGE_EXPIRED"],
        ERROR_CODES["CHALLENGE_INVALID"],
        ERROR_CODES["INVALID_SIGNATURE"],
    }
)

_IDEMPOTENCY_IN_FLIGHT = "still being processed"


def is_retryable(
    status: int, code: Optional[str] = None, message: Optional[str] = None
) -> bool:
    """Return whether replaying the identical request can succeed."""
    if code and code in NON_RETRYABLE_CODES:
        return False
    if status in RETRYABLE_STATUSES:
        return True
    if status == 409 and message and _IDEMPOTENCY_IN_FLIGHT in message.lower():
        return True
    return False


def parse_retry_after(value: Optional[str], now: Optional[float] = None) -> Optional[int]:
    """Parse a ``Retry-After`` header (delta-seconds or HTTP-date) into milliseconds."""
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if trimmed.isdigit():
        return int(trimmed) * 1000

    from email.utils import parsedate_to_datetime

    try:
        parsed = parsedate_to_datetime(trimmed)
    except (TypeError, ValueError):
        return None
    if parsed is None:
        return None
    reference = (now if now is not None else time.time() * 1000) / 1000.0
    return max(0, int((parsed.timestamp() - reference) * 1000))


class PromptHashApiError(Exception):
    """Raised for every non-2xx API response.

    ``code`` is the stable machine-readable value to branch on; ``message`` is
    the human-readable copy the server considers safe to display.
    """

    def __init__(
        self,
        message: str,
        *,
        status: int,
        code: Optional[str] = None,
        api_version: Optional[str] = None,
        reset: Optional[int] = None,
        retry_after_header_ms: Optional[int] = None,
        method: Optional[str] = None,
        url: Optional[str] = None,
        body: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.api_version = api_version
        self.reset = reset
        self.retry_after_header_ms = retry_after_header_ms
        self.method = method
        self.url = url
        self.body = body

    @property
    def message(self) -> str:
        return str(self.args[0]) if self.args else ""

    @property
    def retryable(self) -> bool:
        return is_retryable(self.status, self.code, self.message)

    def retry_after_ms(self, now: Optional[float] = None) -> Optional[int]:
        """Milliseconds to wait before retrying, or ``None`` when unknown."""
        if self.reset is not None:
            reference = now if now is not None else time.time() * 1000
            return max(0, int(self.reset - reference))
        return self.retry_after_header_ms

    def to_dict(self) -> dict:
        return {
            "name": type(self).__name__,
            "status": self.status,
            "code": self.code,
            "message": self.message,
            "apiVersion": self.api_version,
            "url": self.url,
        }


class PromptHashNetworkError(Exception):
    """No response was received (DNS failure, connection reset, timeout)."""

    def __init__(self, message: str, method: str, url: str) -> None:
        super().__init__(message)
        self.method = method
        self.url = url


def _header(headers: Optional[Mapping[str, str]], name: str) -> Optional[str]:
    if not headers:
        return None
    direct = headers.get(name)
    if isinstance(direct, str):
        return direct
    lowered = name.lower()
    for key, value in headers.items():
        if str(key).lower() == lowered and isinstance(value, str):
            return value
    return None


def api_error_from_parts(
    status: int,
    status_text: str,
    text: str,
    headers: Optional[Mapping[str, str]] = None,
    *,
    method: Optional[str] = None,
    url: Optional[str] = None,
) -> PromptHashApiError:
    """Normalise a response body into a :class:`PromptHashApiError`."""
    body: Any = None
    message = ""
    code: Optional[str] = None
    api_version: Optional[str] = None
    reset: Optional[int] = None

    if text:
        import json

        try:
            body = json.loads(text)
        except ValueError:
            body = None

    if isinstance(body, dict):
        if isinstance(body.get("error"), str):
            message = body["error"]
        if isinstance(body.get("code"), str):
            code = body["code"]
        if isinstance(body.get("apiVersion"), str):
            api_version = body["apiVersion"]
        if isinstance(body.get("reset"), (int, float)):
            reset = int(body["reset"])

    if not message and text:
        message = text[:300]
    if not message:
        suffix = f" {status_text}" if status_text else ""
        message = f"Request failed with HTTP {status}{suffix}."

    return PromptHashApiError(
        message,
        status=status,
        code=code,
        api_version=api_version,
        reset=reset,
        retry_after_header_ms=parse_retry_after(_header(headers, "Retry-After")),
        method=method,
        url=url,
        body=body,
    )
