# `prompthash-server-sdk` (Rust)

Server-side Rust SDK for the Prompt Mint API. Minimal dependencies, blocking HTTP via `ureq`.

The browser TypeScript SDK lives in [`packages/sdk`](../sdk); the server-side TypeScript, Python, and Go SDKs are in [`packages/server-sdk`](../server-sdk), [`packages/server-sdk-python`](../server-sdk-python), and [`packages/server-sdk-go`](../server-sdk-go). This crate gives Rust services the same surface:

- **API-key auth** — sends `Authorization: Bearer pm_<prefix>_<secret>` (the server also accepts `X-Api-Key`)
- **Version negotiation** — `Accept-Version` on every call, defaulting to `latest`
- **Idempotent writes** — `Idempotency-Key` on POST/PUT/PATCH/DELETE
- **Typed errors** — `ApiError` with `status`, `code`, `retryable()`, and `retry_after()`
- **Bounded retry** — exponential backoff with jitter on `408`/`425`/`429`/`5xx`, honouring `reset` and `Retry-After`
- **Webhook verification** — constant-time HMAC-SHA256 check of `X-PromptHash-Signature`, timestamp window, replay guard

Requires Rust 1.70+.

## Install

```toml
[dependencies]
prompthash-server-sdk = { path = "../server-sdk-rust" }
# once published:
# prompthash-server-sdk = "0.1.0"
```

## Quick start

```rust
use prompthash_server_sdk::{Client, ClientConfig};

let client = Client::new(ClientConfig {
    base_url: "https://api.promptmint.io".to_string(),
    api_key: Some(std::env::var("PROMPTMINT_API_KEY").unwrap_or_default()),
    ..Default::default()
})?;

let page = client.list_prompts(ListPromptsParams { page: Some(1), limit: Some(20), ..Default::default() })?;
println!("total={}, len={}", page.total, page.prompts.len());
```

### Retries and error codes

```rust
use prompthash_server_sdk::{ApiError, errors::ERROR_CODES};

match client.register_webhook(params) {
    Ok(reg) => println!("secret={}", reg.secret),
    Err(e) if e.is_api_error() => {
        let api = e.as_api_error().unwrap();
        if api.code.as_deref() == Some(ERROR_CODES::RATE_LIMIT_IP) {
            if let Some(wait) = api.retry_after(std::time::SystemTime::now()) {
                std::thread::sleep(wait);
            }
        } else if !api.retryable() {
            return Err(e);
        }
    }
    Err(e) => return Err(e),
}
```

Tune the budget with `max_retries` (default `2`), `retry_base_delay` (default `250ms`), and `retry_max_delay` (default `10s`); set `RequestOptions.retry` to `Some(0)` to disable retries for one call.

### Webhook verification

```rust
use prompthash_server_sdk::webhooks::{verify_webhook, WebhookReplayGuard, VerifyOptions};
use std::collections::HashMap;

let guard = WebhookReplayGuard::new(300, 10_000);

fn handler(headers: HashMap<String,String>, raw_body: &str, secret: &str, guard: &WebhookReplayGuard) -> anyhow::Result<()> {
    let mut h = std::collections::HashMap::new();
    for (k,v) in headers { h.insert(k, v); }
    let envelope = verify_webhook(secret, raw_body, &h, VerifyOptions { replay_guard: Some(guard), ..Default::default() })?;
    println!("{} {}", envelope.event, envelope.delivery_id);
    Ok(())
}
```

`verify_webhook` returns `WebhookVerificationError` whose `reason` is one of `missing_secret`, `missing_signature`, `missing_timestamp`, `malformed_signature`, `signature_mismatch`, `stale_timestamp`, `future_timestamp`, `invalid_payload`, or `duplicate_delivery`.

## Resource helpers

| Method | Route |
|---|---|
| `list_prompts(params)` | `GET /api/prompts` |
| `get_prompt(id)` | `GET /api/prompts/:id` |
| `register_webhook(params)` | `POST /api/webhooks` |
| `get_webhook(wallet)` | `GET /api/webhooks?walletAddress=` |
| `delete_webhook(wallet)` | `DELETE /api/webhooks` |
| `rotate_webhook_secret(wallet)` | `POST /api/webhooks/rotate-secret` |
| `test_webhook(wallet)` | `POST /api/webhooks/test` |
| `list_webhook_deliveries(wallet)` | `GET /api/webhooks/deliveries` |
| `list_webhook_dead_letters(wallet)` | `GET /api/webhooks/dead-letters` |
| `list_api_keys(owner)` | `GET /api-keys?ownerWallet=` |
| `create_api_key(params)` | `POST /api-keys` |
| `rotate_api_key(id, owner)` | `POST /api-keys/:id/rotate` |
| `revoke_api_key(id, owner)` | `DELETE /api-keys/:id` |

Anything else goes through `client.get/post/put/patch/delete(path, opts)`.

## Testing

```bash
cargo test -p prompthash-server-sdk
# or from the crate directory:
cargo test
```

Tests use a stubbed `ureq`-like transport via dependency injection — no network access required.

## Error codes

The full table of codes, statuses, retry guidance, and envelope shapes is in [docs/sdk-error-codes.md](../../docs/sdk-error-codes.md).

## Related Documentation

- [docs/integration-guide.md](../../docs/integration-guide.md)
- [docs/api-reference.md](../../docs/api-reference.md)
- [docs/payload-versioning.md](../../docs/payload-versioning.md)
- [docs/monorepo-map.md](../../docs/monorepo-map.md)
