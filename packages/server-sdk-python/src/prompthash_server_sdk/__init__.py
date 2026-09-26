"""Server-side Python SDK for the Prompt Mint API.

Covers API-key auth, ``Accept-Version`` negotiation, idempotent writes, typed
errors with machine-readable codes, bounded retry, and webhook verification.

Example::

    from prompthash_server_sdk import PromptHashApiError, PromptHashClient

    client = PromptHashClient(
        base_url="https://api.promptmint.io",
        api_key="pm_<prefix>_<secret>",
    )
    page = client.list_prompts(page=1, limit=20)

See ``docs/sdk-error-codes.md`` for the error-code reference card and
``docs/integration-guide.md`` for usage examples.
"""

from .client import (
    DEFAULT_API_VERSION,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT,
    DEFAULT_USER_AGENT,
    PromptHashClient,
    Transport,
    TransportResponse,
    urllib_transport,
)
from .errors import (
    ERROR_CODES,
    NON_RETRYABLE_CODES,
    RETRYABLE_STATUSES,
    PromptHashApiError,
    PromptHashNetworkError,
    api_error_from_parts,
    is_retryable,
    parse_retry_after,
)
from .webhooks import (
    DEFAULT_TOLERANCE_SECONDS,
    DELIVERY_HEADER,
    EVENT_HEADER,
    SCHEMA_VERSION_HEADER,
    SIGNATURE_HEADER,
    SIGNATURE_PREFIX,
    TIMESTAMP_HEADER,
    WebhookReplayGuard,
    WebhookVerificationError,
    sign_webhook_body,
    verify_webhook,
    verify_webhook_signature,
)

__version__ = "0.1.0"

__all__ = [
    "DEFAULT_API_VERSION",
    "DEFAULT_MAX_RETRIES",
    "DEFAULT_TOLERANCE_SECONDS",
    "DEFAULT_TIMEOUT",
    "DEFAULT_USER_AGENT",
    "DELIVERY_HEADER",
    "ERROR_CODES",
    "EVENT_HEADER",
    "NON_RETRYABLE_CODES",
    "PromptHashApiError",
    "PromptHashClient",
    "PromptHashNetworkError",
    "RETRYABLE_STATUSES",
    "SCHEMA_VERSION_HEADER",
    "SIGNATURE_HEADER",
    "SIGNATURE_PREFIX",
    "TIMESTAMP_HEADER",
    "Transport",
    "TransportResponse",
    "WebhookReplayGuard",
    "WebhookVerificationError",
    "api_error_from_parts",
    "is_retryable",
    "parse_retry_after",
    "sign_webhook_body",
    "urllib_transport",
    "verify_webhook",
    "verify_webhook_signature",
]
