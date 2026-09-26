"""Webhook delivery verification.

Deliveries are signed with HMAC-SHA256 over the **raw request body** and sent
as ``X-PromptHash-Signature: sha256=<hex>``. The signature covers the whole
JSON envelope, including ``timestamp`` and ``deliveryId``, so verifying it is
enough to trust those fields.

Always verify against the raw body — never a re-serialised object, because
whitespace and key order change the digest.

Mirrors ``signWebhookPayload`` / ``verifyWebhookSignature`` in
``server/src/services/webhookDispatcher.ts``.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Optional

SIGNATURE_HEADER = "X-PromptHash-Signature"
DELIVERY_HEADER = "X-PromptHash-Delivery"
EVENT_HEADER = "X-PromptHash-Event"
TIMESTAMP_HEADER = "X-PromptHash-Timestamp"
SCHEMA_VERSION_HEADER = "X-PromptHash-Schema-Version"
SIGNATURE_PREFIX = "sha256="

#: Default replay window in seconds.
DEFAULT_TOLERANCE_SECONDS = 300


class WebhookVerificationError(Exception):
    """Raised by :func:`verify_webhook`; ``reason`` is safe to log and branch on."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


def sign_webhook_body(secret: str, body: str) -> str:
    """Compute the ``sha256=<hex>`` signature for a raw body."""
    if not secret:
        raise WebhookVerificationError("missing_secret", "Webhook secret is required.")
    digest = hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256)
    return SIGNATURE_PREFIX + digest.hexdigest()


def verify_webhook_signature(
    secret: str, body: str, signature: Optional[str]
) -> bool:
    """Constant-time signature check. Returns ``False`` instead of raising."""
    if not secret or not signature:
        return False
    return hmac.compare_digest(sign_webhook_body(secret, body), signature.strip())


def verify_webhook(
    secret: str,
    body: str,
    headers: Any,
    *,
    tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
    now: Optional[float] = None,
    replay_guard: Optional["WebhookReplayGuard"] = None,
) -> dict:
    """Verify a delivery and return its parsed envelope.

    :raises WebhookVerificationError: when anything fails to check out
    """
    if not secret:
        raise WebhookVerificationError("missing_secret", "Webhook secret is required.")

    signature = _read_header(headers, SIGNATURE_HEADER)
    if not signature:
        raise WebhookVerificationError(
            "missing_signature", f"{SIGNATURE_HEADER} header is missing."
        )
    if not signature.startswith(SIGNATURE_PREFIX):
        raise WebhookVerificationError(
            "malformed_signature",
            f"{SIGNATURE_HEADER} must start with {SIGNATURE_PREFIX}.",
        )
    if not verify_webhook_signature(secret, body, signature):
        raise WebhookVerificationError(
            "signature_mismatch",
            "Webhook signature does not match the request body.",
        )

    try:
        envelope = json.loads(body)
    except ValueError as exc:
        raise WebhookVerificationError(
            "invalid_payload", "Webhook body is not valid JSON."
        ) from exc
    if not isinstance(envelope, dict):
        raise WebhookVerificationError("invalid_payload", "Webhook body is not an object.")
    if not isinstance(envelope.get("event"), str) or not envelope["event"]:
        raise WebhookVerificationError(
            "invalid_payload", "Webhook envelope is missing `event`."
        )
    if not isinstance(envelope.get("deliveryId"), str) or not envelope["deliveryId"]:
        raise WebhookVerificationError(
            "invalid_payload", "Webhook envelope is missing `deliveryId`."
        )

    timestamp = _read_header(headers, TIMESTAMP_HEADER) or envelope.get("timestamp")
    _assert_freshness(
        timestamp,
        tolerance_seconds,
        now if now is not None else _now_ms(),
    )

    if replay_guard is not None and not replay_guard.accept(envelope["deliveryId"]):
        raise WebhookVerificationError(
            "duplicate_delivery",
            f"Delivery {envelope['deliveryId']} has already been processed.",
        )

    return envelope


class WebhookReplayGuard:
    """Bounded set of recently accepted delivery ids.

    Entries expire with the replay window and the oldest are evicted once
    ``max_entries`` is reached.
    """

    def __init__(
        self,
        *,
        tolerance_seconds: int = DEFAULT_TOLERANCE_SECONDS,
        max_entries: int = 10_000,
    ) -> None:
        self._ttl_ms = tolerance_seconds * 1000.0
        self._max_entries = max(1, int(max_entries))
        self._seen: dict[str, float] = {}

    def accept(self, delivery_id: str, now: Optional[float] = None) -> bool:
        """Record ``delivery_id``; ``False`` when it was seen inside the window."""
        current = now if now is not None else _now_ms()
        self._prune(current)
        if delivery_id in self._seen:
            return False
        self._seen[delivery_id] = current
        while len(self._seen) > self._max_entries:
            self._seen.pop(next(iter(self._seen)))
        return True

    @property
    def size(self) -> int:
        return len(self._seen)

    def _prune(self, now: float) -> None:
        expired = [key for key, at in self._seen.items() if now - at > self._ttl_ms]
        for key in expired:
            del self._seen[key]


def _now_ms() -> float:
    import time

    return time.time() * 1000.0


def _read_header(headers: Any, name: str) -> Optional[str]:
    if headers is None:
        return None

    getter = getattr(headers, "get", None)
    if callable(getter):
        value = getter(name)
        if isinstance(value, str):
            return value

    if isinstance(headers, Mapping):
        lowered = name.lower()
        for key, value in headers.items():
            if str(key).lower() == lowered and isinstance(value, str):
                return value
    return None


def _parse_timestamp(raw: Any) -> Optional[float]:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
        return value * 1000.0 if value < 10_000_000_000 else value

    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    if text.isdigit():
        value = float(text)
        # Accept epoch seconds or epoch milliseconds.
        return value * 1000.0 if len(text) <= 10 else value

    iso = text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text
    try:
        parsed = datetime.fromisoformat(iso)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp() * 1000.0


def _assert_freshness(
    raw: Any, tolerance_seconds: int, now_ms: float
) -> None:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        raise WebhookVerificationError(
            "missing_timestamp", "Webhook timestamp is missing."
        )

    epoch_ms = _parse_timestamp(raw)
    if epoch_ms is None:
        raise WebhookVerificationError(
            "invalid_payload", f"Webhook timestamp is not parseable: {raw}"
        )

    skew_ms = now_ms - epoch_ms
    tolerance_ms = tolerance_seconds * 1000.0
    if skew_ms > tolerance_ms:
        raise WebhookVerificationError(
            "stale_timestamp",
            "Webhook timestamp is outside the accepted replay window.",
        )
    if -skew_ms > tolerance_ms:
        raise WebhookVerificationError(
            "future_timestamp", "Webhook timestamp is too far in the future."
        )
