# `prompthash-server-sdk`

Server-side Python SDK for the Prompt Mint API. Zero runtime dependencies — the standard library is enough.

The TypeScript browser SDK lives in [`packages/sdk`](../sdk); the server-side TypeScript SDK lives in [`packages/server-sdk`](../server-sdk). This package gives Python services the same surface:

- **API-key auth** — sends `Authorization: Bearer pm_<prefix>_<secret>` (the server also accepts `X-Api-Key`)
- **Version negotiation** — `Accept-Version` on every call, defaulting to `latest`
- **Idempotent writes** — `Idempotency-Key` on POST/PUT/PATCH/DELETE
- **Typed errors** — `PromptHashApiError` with `status`, `code`, `retryable`, and `retry_after_ms()`
- **Bounded retry** — exponential backoff with jitter on `408`/`425`/`429`/`5xx`, honouring `reset` and `Retry-After`
- **Webhook verification** — constant-time HMAC-SHA256 check of `X-PromptHash-Signature`, timestamp window, replay guard

## Install

```bash
pip install prompthash-server-sdk
```

Until the package is published, install it from a checkout of this repository:

```bash
pip install /path/to/prompt-mint/packages/server-sdk-python
```

Requires Python 3.9+.

## Quick start

```python
from prompthash_server_sdk import PromptHashApiError, PromptHashClient

client = PromptHashClient(
    base_url="https://api.promptmint.io",
    api_key="pm_<prefix>_<secret>",
)

page = client.list_prompts(page=1, limit=20, sort="upvotes")
print(page["total"], len(page.get("prompts", [])))
```

### Retries and error codes

```python
import uuid

try:
    client.post(
        "/api/webhooks",
        json_body={"walletAddress": wallet, "url": url},
        has_body=True,
        # Required to make a retry safe after a timeout.
        idempotency_key=str(uuid.uuid4()),
    )
except PromptHashApiError as exc:
    if exc.code in ("RATE_LIMIT_IP", "RATE_LIMIT_WALLET"):
        time.sleep((exc.retry_after_ms() or 1000) / 1000)
    elif not exc.retryable:
        raise
except PromptHashNetworkError:
    # No response was received; only retry state-changing calls that
    # carried an Idempotency-Key.
    raise
```

Tune the budget with `max_retries` (default `2`), `retry_base_delay` (default `0.25s`), and `retry_max_delay` (default `10s`); pass `retry=False` to disable it for a single call.

### Custom transport

The default transport is `urllib.request`. Inject your own for proxies, retries at a different layer, or tests:

```python
from prompthash_server_sdk import PromptHashClient, TransportResponse

def my_transport(url, *, method, headers, body, timeout):
    ...  # any HTTP library
    return TransportResponse(status=200, status_text="OK", headers={}, text="{}")

client = PromptHashClient("https://api.promptmint.io", transport=my_transport)
```

### Webhook verification

```python
from prompthash_server_sdk import WebhookReplayGuard, verify_webhook

replay_guard = WebhookReplayGuard(tolerance_seconds=300)

def handler(request) -> None:
    try:
        event = verify_webhook(
            os.environ["PROMPTMINT_WEBHOOK_SECRET"],
            request.body,  # raw bytes as str — never a re-serialised object
            request.headers,
            replay_guard=replay_guard,
        )
    except WebhookVerificationError as exc:
        log.warning("rejected webhook: %s", exc.reason)
        return
    handle(event["event"], event["deliveryId"], event["data"])
```

`verify_webhook` raises `WebhookVerificationError` whose `reason` is one of `missing_signature`, `missing_timestamp`, `malformed_signature`, `signature_mismatch`, `stale_timestamp`, `future_timestamp`, `invalid_payload`, or `duplicate_delivery`.

## Resource helpers

| Method | Route |
|---|---|
| `list_prompts(**params)` | `GET /api/prompts` |
| `get_prompt(prompt_id)` | `GET /api/prompts/:id` |
| `register_webhook(wallet, url, events)` | `POST /api/webhooks` |
| `get_webhook(wallet)` | `GET /api/webhooks?walletAddress=` |
| `delete_webhook(wallet)` | `DELETE /api/webhooks` |
| `rotate_webhook_secret(wallet)` | `POST /api/webhooks/rotate-secret` |
| `test_webhook(wallet)` | `POST /api/webhooks/test` |
| `list_webhook_deliveries(wallet)` | `GET /api/webhooks/deliveries` |
| `list_webhook_dead_letters(wallet)` | `GET /api/webhooks/dead-letters` |

Anything else goes through `client.get/post/put/patch/delete(path, ...)`.

## Testing

The suite uses `unittest` from the standard library, so there is nothing to install:

```bash
cd packages/server-sdk-python
python -m unittest discover -v
# or
pytest
```

## Error codes

The full table of codes, statuses, retry guidance, and envelope shapes is in [docs/sdk-error-codes.md](../../docs/sdk-error-codes.md).

## Related Documentation

- [docs/integration-guide.md](../../docs/integration-guide.md)
- [docs/api-reference.md](../../docs/api-reference.md)
- [docs/payload-versioning.md](../../docs/payload-versioning.md)
- [docs/monorepo-map.md](../../docs/monorepo-map.md)
