"""Shared test doubles. Not a test module (``test*.py`` pattern)."""

from __future__ import annotations

import json
from typing import Any, List, Mapping, Optional

from prompthash_server_sdk.client import TransportResponse

STATUS_TEXT = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    429: "Too Many Requests",
    500: "Internal Server Error",
    503: "Service Unavailable",
}


def json_response(
    status: int, payload: Any, headers: Optional[Mapping[str, str]] = None
) -> TransportResponse:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return TransportResponse(
        status=status,
        status_text=STATUS_TEXT.get(status, ""),
        headers=dict(headers or {}),
        text=text,
    )


class StubTransport:
    """Replays canned responses in order and records every call."""

    def __init__(self, *responses: Any) -> None:
        self.responses: List[Any] = list(responses)
        self.calls: List[dict] = []

    def __call__(
        self,
        url: str,
        *,
        method: str,
        headers: Mapping[str, str],
        body: Optional[str],
        timeout: float,
    ) -> TransportResponse:
        index = len(self.calls)
        self.calls.append(
            {
                "url": url,
                "method": method,
                "headers": dict(headers),
                "body": body,
                "timeout": timeout,
            }
        )
        item = self.responses[min(index, len(self.responses) - 1)]
        if item is None:
            raise AssertionError(f"No canned response for call #{index}")
        if isinstance(item, BaseException):
            raise item
        return item


class RecordingSleep:
    """Sleep stub that records requested delays (milliseconds) instantly."""

    def __init__(self) -> None:
        self.delays: List[float] = []

    def __call__(self, ms: float) -> None:
        self.delays.append(ms)


def assert_raises_reason(exception_type, reason: str, fn, *args, **kwargs) -> None:
    try:
        fn(*args, **kwargs)
    except exception_type as exc:  # noqa: PERF203
        assert getattr(exc, "reason", None) == reason, (
            f"expected reason {reason!r}, got {getattr(exc, 'reason', None)!r}"
        )
        return
    raise AssertionError(f"expected {exception_type.__name__} with reason {reason!r}")


__all__ = [
    "STATUS_TEXT",
    "RecordingSleep",
    "StubTransport",
    "assert_raises_reason",
    "json_response",
]
