"""HTTP client for the Prompt Mint API.

Adds API-key authentication, ``Accept-Version`` negotiation, idempotent
writes, typed errors, and bounded retry with backoff on top of the standard
library so the package has zero runtime dependencies.
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional, Sequence
from urllib.parse import urlencode

from .errors import (
    PromptHashApiError,
    PromptHashNetworkError,
    api_error_from_parts,
)

DEFAULT_API_VERSION = "latest"
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_RETRIES = 2
DEFAULT_RETRY_BASE_DELAY_MS = 250.0
DEFAULT_RETRY_MAX_DELAY_MS = 10_000.0
DEFAULT_USER_AGENT = "prompthash-server-sdk/0.1.0"


@dataclass(frozen=True)
class TransportResponse:
    """Normalised response returned by a transport callable."""

    status: int
    status_text: str
    headers: Mapping[str, str]
    text: str


#: ``transport(url, *, method, headers, body, timeout) -> TransportResponse``
Transport = Callable[..., TransportResponse]

#: Injected sleep hook. Receives **milliseconds**.
SleepHook = Callable[[float], None]


def urllib_transport(
    url: str,
    *,
    method: str,
    headers: Mapping[str, str],
    body: Optional[str],
    timeout: float,
) -> TransportResponse:
    """Default transport built on :mod:`urllib.request` (no dependencies)."""
    data = body.encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        url, data=data, headers=dict(headers), method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return TransportResponse(
                status=response.status,
                status_text=getattr(response, "reason", "") or "",
                headers=dict(response.headers.items()),
                text=raw,
            )
    except urllib.error.HTTPError as exc:
        # Non-2xx is a normal outcome, not a transport failure.
        raw = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        return TransportResponse(
            status=exc.code,
            status_text=exc.reason or "",
            headers=dict(exc.headers.items()) if exc.headers else {},
            text=raw,
        )


class PromptHashClient:
    """Server-side client for the Prompt Mint API.

    Example::

        client = PromptHashClient(
            base_url="https://api.promptmint.io",
            api_key="pm_<prefix>_<secret>",
        )
        page = client.list_prompts(page=1, limit=20)
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: Optional[str] = None,
        api_version: str = DEFAULT_API_VERSION,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_base_delay: float = DEFAULT_RETRY_BASE_DELAY_MS / 1000.0,
        retry_max_delay: float = DEFAULT_RETRY_MAX_DELAY_MS / 1000.0,
        transport: Optional[Transport] = None,
        sleep: Optional[SleepHook] = None,
        default_headers: Optional[Mapping[str, str]] = None,
        user_agent: str = DEFAULT_USER_AGENT,
    ) -> None:
        if not isinstance(base_url, str) or not base_url.strip():
            raise ValueError("PromptHashClient requires a base_url.")

        self.base_url = base_url.strip().rstrip("/")
        self.api_key = (api_key or "").strip() or None
        self.api_version = (api_version or "").strip() or DEFAULT_API_VERSION
        self.timeout = timeout
        self.max_retries = max(0, int(max_retries))
        self.retry_base_delay_ms = max(1.0, retry_base_delay * 1000.0)
        self.retry_max_delay_ms = max(self.retry_base_delay_ms, retry_max_delay * 1000.0)
        self.transport = transport or urllib_transport
        self.sleep = sleep or (lambda ms: time.sleep(ms / 1000.0))
        self.default_headers = dict(default_headers or {})
        self.user_agent = user_agent

    # ── Core request pipeline ─────────────────────────────────────────────

    def request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
        json_body: Any = None,
        has_body: bool = False,
        idempotency_key: Optional[str] = None,
        retry: Any = True,
    ) -> Any:
        """Perform a request and return the parsed JSON body (or raw text).

        Raises :class:`PromptHashApiError` for any non-2xx status and
        :class:`PromptHashNetworkError` when no response was received.
        """
        method = method.upper()
        url = self._build_url(path, query)
        attempts_allowed = self._attempt_budget(retry)
        payload = json.dumps(json_body) if has_body else None
        request_headers = self._build_headers(
            has_body=has_body, headers=headers, idempotency_key=idempotency_key
        )

        attempt = 0
        while True:
            try:
                response = self.transport(
                    url,
                    method=method,
                    headers=request_headers,
                    body=payload,
                    timeout=self.timeout,
                )
            except (PromptHashApiError, PromptHashNetworkError):
                raise
            except Exception as exc:  # noqa: BLE001 - transport failures are opaque
                if attempt < attempts_allowed:
                    self.sleep(self._backoff_ms(attempt, None))
                    attempt += 1
                    continue
                raise PromptHashNetworkError(
                    str(exc) or "Network request failed.", method, url
                ) from exc

            if 200 <= response.status < 300:
                return _read_body(response)

            error = api_error_from_parts(
                response.status,
                response.status_text,
                response.text,
                response.headers,
                method=method,
                url=url,
            )
            if error.retryable and attempt < attempts_allowed:
                self.sleep(self._backoff_ms(attempt, error))
                attempt += 1
                continue
            raise error

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> Any:
        return self.request("PUT", path, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Any:
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self.request("DELETE", path, **kwargs)

    # ── Marketplace ───────────────────────────────────────────────────────

    def list_prompts(self, **params: Any) -> Mapping[str, Any]:
        """``GET /api/prompts`` — paginated marketplace listing."""
        return self.get("/api/prompts", query=params)

    def get_prompt(self, prompt_id: str) -> Mapping[str, Any]:
        """``GET /api/prompts/:id`` — a single prompt record."""
        from urllib.parse import quote

        return self.get(f"/api/prompts/{quote(str(prompt_id), safe='')}")

    # ── Webhooks ──────────────────────────────────────────────────────────

    def register_webhook(
        self, wallet_address: str, url: str, events: Optional[Sequence[str]] = None
    ) -> Mapping[str, Any]:
        """``POST /api/webhooks`` — register or update a subscription.

        The returned ``secret`` is shown once; store it to verify deliveries.
        """
        body: dict[str, Any] = {"walletAddress": wallet_address, "url": url}
        if events is not None:
            body["events"] = list(events)
        return self.post("/api/webhooks", json_body=body, has_body=True)

    def get_webhook(self, wallet_address: str) -> Mapping[str, Any]:
        return self.get("/api/webhooks", query={"walletAddress": wallet_address})

    def delete_webhook(self, wallet_address: str) -> Mapping[str, Any]:
        return self.delete(
            "/api/webhooks", json_body={"walletAddress": wallet_address}, has_body=True
        )

    def rotate_webhook_secret(self, wallet_address: str) -> Mapping[str, Any]:
        return self.post(
            "/api/webhooks/rotate-secret",
            json_body={"walletAddress": wallet_address},
            has_body=True,
        )

    def test_webhook(self, wallet_address: str) -> Mapping[str, Any]:
        return self.post(
            "/api/webhooks/test",
            json_body={"walletAddress": wallet_address},
            has_body=True,
        )

    def list_webhook_deliveries(self, wallet_address: str) -> Any:
        return self.get(
            "/api/webhooks/deliveries", query={"walletAddress": wallet_address}
        )

    def list_webhook_dead_letters(
        self,
        wallet_address: str,
        *,
        resolved: Optional[bool] = None,
        limit: Optional[int] = None,
    ) -> Any:
        query: dict[str, Any] = {"walletAddress": wallet_address}
        if resolved is not None:
            query["resolved"] = "true" if resolved else "false"
        if limit is not None:
            query["limit"] = limit
        return self.get("/api/webhooks/dead-letters", query=query)

    # ── Internals ─────────────────────────────────────────────────────────

    def _build_url(
        self, path: str, query: Optional[Mapping[str, Any]] = None
    ) -> str:
        normalized = path if path.startswith("/") else f"/{path}"
        url = f"{self.base_url}{normalized}"
        pairs = [
            (key, str(value))
            for key, value in (query or {}).items()
            if value is not None
        ]
        if pairs:
            url = f"{url}?{urlencode(pairs)}"
        return url

    def _build_headers(
        self,
        *,
        has_body: bool,
        headers: Optional[Mapping[str, str]],
        idempotency_key: Optional[str],
    ) -> dict[str, str]:
        result = {
            "Accept": "application/json",
            "Accept-Version": self.api_version,
            "User-Agent": self.user_agent,
        }
        if has_body:
            result["Content-Type"] = "application/json"
        if self.api_key:
            result["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key:
            result["Idempotency-Key"] = idempotency_key
        result.update(self.default_headers)
        if headers:
            result.update(headers)
        return result

    def _attempt_budget(self, retry: Any) -> int:
        if retry is False:
            return 0
        if isinstance(retry, bool):
            return self.max_retries
        if isinstance(retry, int):
            return max(0, retry)
        return self.max_retries

    def _backoff_ms(self, attempt: int, error: Optional[PromptHashApiError]) -> float:
        if error is not None:
            hinted = error.retry_after_ms()
            if hinted is not None:
                return float(min(hinted, self.retry_max_delay_ms))
        base = min(self.retry_base_delay_ms * (2**attempt), self.retry_max_delay_ms)
        return base + random.uniform(0, base * 0.25)


def _read_body(response: TransportResponse) -> Any:
    text = response.text or ""
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text
