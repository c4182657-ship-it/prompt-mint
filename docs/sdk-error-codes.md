# SDK Error Code Reference Card

A single card that SDK and integration authors can keep open while handling failures. It lists every machine-readable error code the Prompt Mint HTTP API can return, the HTTP status it is paired with, whether it is safe to retry, and what a client should do next.

The canonical source of truth is [`src/lib/api/errorCodes.ts`](../src/lib/api/errorCodes.ts) for serverless handlers and [`server/src/lib/AppError.ts`](../server/src/lib/AppError.ts) for the Express API. This card is verified against those files by `src/test/docs/sdkErrorCodes.test.ts`, so a new code that is not documented here fails `yarn test:frontend`.

## Table of Contents

- [Response envelopes](#response-envelopes)
- [Retry policy](#retry-policy)
- [Serverless error codes](#serverless-error-codes)
- [Express API error codes](#express-api-error-codes)
- [Moderation appeal codes](#moderation-appeal-codes)
- [API key and scope errors](#api-key-and-scope-errors)
- [Idempotency errors](#idempotency-errors)
- [Validation errors](#validation-errors)
- [Version negotiation errors](#version-negotiation-errors)
- [Contract error codes](#contract-error-codes)
- [Handling errors in the SDKs](#handling-errors-in-the-sdks)
- [Known inconsistencies](#known-inconsistencies)

---

## Response envelopes

Three envelopes exist. Always read `code` first, then `error`, then fall back to the HTTP status.

### Serverless envelope (`api/*`)

Produced by `apiError()` in `src/lib/api/errorCodes.ts`. Every body carries `apiVersion` so the caller always knows which payload schema was served.

```json
{
  "apiVersion": "2025-01-01",
  "error": "Too many requests. Please try again later.",
  "code": "RATE_LIMIT_IP",
  "reset": 1767139200000
}
```

| Field | Type | Present | Meaning |
|---|---|---|---|
| `apiVersion` | string | always | Payload schema version (`2025-01-01`, `2024-01-01`) |
| `error` | string | always | Human-readable copy that is safe to display |
| `code` | string | usually | Stable machine-readable code from the tables below |
| `reset` | number | only on `429` | Unix epoch **milliseconds** at which the limit resets (`unix ms`) |
| `lockedUntil` | number | only on `423` | Unix ms at which the account lock expires |
| `captchaRequired` | boolean | only on `403` | Present and `true` when the caller must solve a CAPTCHA first |

### Express envelope (`server/*`)

`errorHandler` in `server/src/middleware/errorHandler.ts` serialises `AppError` as `{ error }`, plus `code` only when the throw site supplied one.

```json
{ "error": "Prompt not found.", "code": "NOT_FOUND" }
```

Roughly a third of Express throws carry no `code`. When `code` is absent, branch on the HTTP status and the message instead.

### Middleware variants

| Shape | Status | Source |
|---|---:|---|
| `{ error, message, fields }` | 400 | `validateBody` / `sendValidationError` in `server/src/middleware/validateRequest.ts` |
| `{ error, supportedVersions, currentVersion }` | 400 | `server/src/middleware/versioning.ts` |
| `{ error }` | 413 | `server/src/middleware/bodySizeLimit.ts` and `src/lib/api/bodySizeLimit.ts` |
| `{ error, message }` | 403 | CORS rejection, see [docs/cors-configuration.md](./cors-configuration.md) |
| `{ success, applied, errors: [{ index, error }] }` | 207 | `api/moderation/actions.ts` bulk apply |

---

## Retry policy

An SDK should retry only when the same request can be repeated safely.

| Condition | Retry? | Notes |
|---|---|---|
| `429` | yes | Wait for `reset` (body, unix ms), `X-RateLimit-Reset`, or `Retry-After` (seconds) |
| `500`, `502`, `503`, `504` | yes | Bounded exponential backoff with jitter |
| `408`, `425` | yes | Client/upstream timeout |
| `409` with "still being processed" | yes | In-flight `Idempotency-Key` lock; replay with the **same** key |
| Any other `4xx` | no | Fix the request first |
| Network error before a response | yes | Only state-changing calls that sent an `Idempotency-Key` are safe from doubles |

Never retry `INTEGRITY_FAILURE` or `ACCESS_NOT_PURCHASED` — both need a human or a new purchase.

---

## Serverless error codes

Emitted by handlers under `api/` through `apiError(ErrorCode.X, ...)`. Constants live in `src/lib/api/errorCodes.ts`.

| Code | HTTP | Retryable | Meaning | Client action |
|---|---:|---|---|---|
| `MISSING_FIELDS` | 400 | no | One or more required fields are missing or malformed | Add the missing fields and resend |
| `METHOD_NOT_ALLOWED` | 405 | no | Wrong HTTP verb for this route | Check the endpoint, do not retry |
| `INVALID_INPUT` | 400 | no | Input failed validation | Correct the payload |
| `CHALLENGE_EXPIRED` | 400 | no | Unlock challenge token expired | Start a new challenge |
| `CHALLENGE_INVALID` | 400 | no | Challenge signature/address/promptId mismatch | Restart the unlock flow |
| `INVALID_SIGNATURE` | 401 | no | Wallet signature does not verify | Re-sign the message |
| `ACCESS_NOT_PURCHASED` | 403 | no | Wallet has no on-chain license | Prompt the user to purchase |
| `RATE_LIMIT_IP` | 429 | yes | Per-IP limit hit | Wait until `reset`, then retry |
| `RATE_LIMIT_WALLET` | 429 | yes | Per-wallet limit hit | Wait until `reset`, then retry |
| `ACCOUNT_LOCKED` | 423 | no | 5 consecutive failed auth attempts; `lockedUntil` gives the expiry | Wait for `lockedUntil`, do not hammer the endpoint |
| `CAPTCHA_REQUIRED` | 403 | no | `captchaRequired: true`; repeat with a valid CAPTCHA token | Solve the CAPTCHA, then resend |
| `CAPTCHA_INVALID` | 403 | no | CAPTCHA token missing, expired, or wrong | Request a fresh token, then resend |
| `UNKNOWN_EVENT` | 400 | no | Event name outside the analytics taxonomy | Fix the event name |
| `INVALID_EVENT_PAYLOAD` | 400 | no | Event payload failed schema validation | Fix the payload; never send a raw wallet address |
| `CONFIGURATION_ERROR` | 500 | yes | Server is missing required configuration | Retry with backoff, then alert |
| `INTEGRITY_FAILURE` | 500 | no | Prompt content hash mismatch, content withheld | Report the prompt ID to support |
| `TEMPORARY_FAILURE` | 500 | yes | Transient backend failure | Retry with backoff |
| `UNSUPPORTED_VERSION` | 400 | no | `Accept-Version` value not served here | Pin to `latest` or a supported date string |
| `PAYLOAD_TOO_LARGE` | — | no | Encrypted payload exceeds the on-chain limit | Shrink the content; reserved, no handler emits it yet |
| `WALLET_NOT_FUNDED` | — | no | Buyer lacks the balance for the purchase | Fund the wallet; reserved, no handler emits it yet |

`ERROR_MESSAGES` in the same file maps each of these codes to user-facing copy for UI display.

---

## Express API error codes

Thrown as `new AppError(message, status, code)` across `server/src/controllers/*` and `server/src/services/*`.

| Code | HTTP | Retryable | Meaning |
|---|---:|---|---|
| `MISSING_FIELDS` | 400 | no | Required body field missing |
| `INVALID_INPUT` | 400 or 422 | no | Payload failed semantic validation |
| `INVALID_VERSION` | 400 | no | Unsupported payload version |
| `INVALID_WALLET` | 400 | no | Wallet address is not well formed |
| `CHALLENGE_MALFORMED` | 400 | no | Challenge body could not be parsed |
| `UNAUTHENTICATED` | 401 | no | Missing or invalid credential |
| `INVALID_SIGNATURE` | 401 | no | Signature check failed |
| `CHALLENGE_INVALID_SIGNATURE` | 401 | no | Challenge signature did not verify |
| `FORBIDDEN` | 403 | no | Authenticated but not allowed |
| `CHALLENGE_MISMATCH` | 403 | no | Challenge bound to a different wallet/prompt |
| `NOT_FOUND` | 404 | no | Resource does not exist |
| `KEY_NOT_FOUND` | 404 | no | API key record does not exist |
| `CONCURRENT_VERSION_CONFLICT` | 409 | no | Two writers raced on the same version |
| `EXPORT_EXPIRED` | 410 | no | Signed export link expired |
| `CHALLENGE_EXPIRED` | 410 | no | Challenge expired (export flow) |
| `INTEGRITY_FAILURE` | 400 | no | Export integrity check failed |

Without a `code`, fall back to the status: `503` means the circuit breaker is open or the server is draining, `504` means an upstream timed out, and `500` is an unhandled failure.

---

## Moderation appeal codes

Thrown by `server/src/services/appealService.ts` as `AppealError`, which extends `AppError`.

| Code | HTTP | Meaning |
|---|---:|---|
| `DECISION_NOT_FOUND` | 404 | No moderation decision to appeal |
| `NOT_APPEALABLE` | 403 | Decision type cannot be appealed |
| `WINDOW_CLOSED` | 403 | Appeal window has closed |
| `DUPLICATE_APPEAL` | 409 | An appeal already exists for this decision |
| `APPEAL_NOT_FOUND` | 404 | Appeal id is unknown |
| `INVALID_STATUS` | 409 | Appeal is not in a state that allows this transition |
| `REVIEWER_SEPARATION` | 403 | Reviewer may not act on their own decision |
| `NOT_APPELLANT` | 403 | Only the filer may act on the appeal |

---

## API key and scope errors

`server/src/middleware/apiKeyAuth.ts` answers with a bare `{ error }` and no `code`. Keys look like `pm_<prefix>_<secret>` and are accepted on either `Authorization: Bearer <key>` or `X-Api-Key: <key>`.

| HTTP | Message | Cause |
|---:|---|---|
| 401 | `Missing API key.` | Neither header present |
| 401 | `Malformed API key.` | Not shaped like `pm_<prefix>_<secret>` |
| 401 | `Invalid or revoked API key.` | Unknown prefix or revoked key |
| 401 | `Invalid API key.` | Secret does not match the stored hash |
| 403 | `API key lacks required scope: <scope>.` | Scopes are hierarchical: `admin` ⊃ `write` ⊃ `read` |
| 429 | `Rate limit exceeded.` | Tier limit hit: free 60, pro 600, enterprise 6,000 per minute |

---

## Idempotency errors

When a state-changing request carries `Idempotency-Key`, `server/src/middleware/idempotency.ts` answers `409` with a message and no `code`.

| Message | Meaning | Client action |
|---|---|---|
| `This Idempotency-Key was already used with a different request.` | Same key, different method/URL/body | Generate a new key |
| `A request with this Idempotency-Key is still being processed.` | First attempt still in flight | Retry with the **same** key after a short delay |

Successful replays return the original status and body, so treat a replayed response as a first-class result.

---

## Validation errors

`validateBody` in `server/src/middleware/validateRequest.ts` returns `400`:

```json
{
  "error": "Validation failed",
  "message": "title is required; price must be a number",
  "fields": { "title": "title is required", "price": "price must be a number" }
}
```

`fields` is a per-field map, which makes it directly renderable in a form.

---

## Version negotiation errors

Two independent version mechanisms exist:

| Mechanism | Header/param | Unsupported response |
|---|---|---|
| Serverless payload version | `Accept-Version: latest \| 2025-01-01 \| 2024-01-01` | `400` with `code: "UNSUPPORTED_VERSION"` from `src/lib/api/versionGuard.ts` |
| Express route version | `Accept-Version: 1 \| 2`, `?api_version=`, or `/v2/…` | `400` with `{ error, supportedVersions, currentVersion }` and **no** `code` from `server/src/middleware/versioning.ts` |

---

## Contract error codes

On-chain failures never travel through the HTTP envelope. `CONTRACT_ERROR_CODES` in `src/lib/stellar/promptHashClient.ts` classifies raw Soroban error text before it reaches the UI.

| Code | Meaning | User actionable |
|---|---|---|
| `CONTRACT_PAUSED` | Contract is paused for maintenance | no — retry later |
| `PROMPT_NOT_FOUND` | Prompt id does not exist | no |
| `UNAUTHORIZED` | Caller is not the owner | no |
| `INVALID_PRICE` | Price rejected by the contract | yes |
| `ALREADY_PURCHASED` | Wallet already holds a license | yes |
| `LISTING_EXPIRED` | Listing is no longer active | yes |
| `INSUFFICIENT_BALANCE` | Wallet cannot cover the price | yes |
| `PAYLOAD_TOO_LARGE` | Content exceeds the on-chain size limit | yes |
| `UNKNOWN` | Unmatched error text; `raw` carries the original | no |

Numeric contract error codes (`1`–`51`) are tabulated in [docs/troubleshooting.md](./troubleshooting.md).

---

## Handling errors in the SDKs

### TypeScript — `@prompthash/server-sdk`

```typescript
import { PromptHashApiError, ERROR_CODES, PromptHashServerClient } from "@prompthash/server-sdk";

const client = new PromptHashServerClient({
  baseUrl: "https://api.promptmint.io",
  apiKey: process.env.PROMPTMINT_API_KEY,
});

try {
  const prompts = await client.listPrompts({ page: 1, limit: 20 });
} catch (err) {
  if (err instanceof PromptHashApiError) {
    if (err.code === ERROR_CODES.RATE_LIMIT_IP) {
      await new Promise((r) => setTimeout(r, err.retryAfterMs() ?? 1000));
    } else if (!err.retryable) {
      throw err;
    }
  }
}
```

### Python — `prompthash-server-sdk`

```python
from prompthash_server_sdk import PromptHashApiError, PromptHashClient, ERROR_CODES

client = PromptHashClient(base_url="https://api.promptmint.io", api_key="pm_...")
try:
    prompts = client.list_prompts(page=1, limit=20)
except PromptHashApiError as exc:
    if exc.code == ERROR_CODES.RATE_LIMIT_IP:
        time.sleep(exc.retry_after_ms() / 1000)
    elif not exc.retryable:
        raise
```

### Go — `server-sdk-go`

```go
client, err := prompthash.NewClient(prompthash.Config{
    BaseURL: "https://api.promptmint.io",
    APIKey:  os.Getenv("PROMPTMINT_API_KEY"),
})
if err != nil { /* ... */ }

prompts, err := client.ListPrompts(ctx, prompthash.ListPromptsParams{Page: 1, Limit: 20})
var apiErr *prompthash.APIError
if errors.As(err, &apiErr) && apiErr.Code == prompthash.CodeRateLimitIP {
    if wait, ok := apiErr.RetryAfter(time.Now()); ok {
        time.Sleep(wait)
    }
}
```

### Rust — `prompthash-server-sdk`

```rust
use prompthash_server_sdk::{Client, ClientConfig, ERROR_CODES};

let client = Client::new(ClientConfig {
    base_url: "https://api.promptmint.io".to_string(),
    api_key: Some(std::env::var("PROMPTMINT_API_KEY").unwrap_or_default()),
    ..Default::default()
})?;

let page = client.list_prompts(Default::default())?;
if let Err(e) = client.list_prompts(Default::default()) {
    if let Some(api) = e.as_api_error() {
        if api.code.as_deref() == Some(ERROR_CODES::RATE_LIMIT_IP.as_str()) {
            if let Some(wait) = api.retry_after(std::time::SystemTime::now()) {
                std::thread::sleep(wait);
            }
        } else if !api.retryable() {
            return Err(e);
        }
    }
}
```

### Verifying webhooks

All four SDKs expose an HMAC-SHA256 verifier for the `X-PromptHash-Signature` header (`sha256=<hex>` over the raw body). Always compare in constant time and reject deliveries older than your replay window — see [docs/payload-versioning.md](./payload-versioning.md).

---

## Known inconsistencies

Recorded so integrators are not surprised. Fixing them is out of scope for this card.

| Issue | Detail |
|---|---|
| `CHALLENGE_EXPIRED` status | `400` in `api/prompts/unlock.ts`, `410` in `server/src/controllers/exportController.ts`, documented as `401` in `docs/troubleshooting.md` |
| `INTEGRITY_FAILURE` status | `500` in `api/prompts/unlock.ts`, `400` in `server/src/controllers/versioningControllers.ts` |
| `CHALLENGE_INVALID` | Declared and documented but never emitted by a handler today |
| `PAYLOAD_TOO_LARGE` / `WALLET_NOT_FUNDED` | Declared and mapped to UI copy, but no handler emits them; there is no agreed HTTP status yet |
| Bundle unlock rate limits | `api/bundles/unlock.ts` returns `429` with `TEMPORARY_FAILURE` instead of `RATE_LIMIT_IP`/`RATE_LIMIT_WALLET`, and omits `reset` |
| Express version rejection | No `code` field, unlike the serverless `UNSUPPORTED_VERSION` path |
| OpenAPI | `server/spec/openapi.yaml` does not declare `405`, `413`, or `429` responses |

---

## Related Documentation

- [docs/api-reference.md](./api-reference.md) — endpoint catalogue, auth, and rate limits
- [docs/integration-guide.md](./integration-guide.md) — SDK installation and usage
- [docs/payload-versioning.md](./payload-versioning.md) — `Accept-Version` negotiation and webhook envelopes
- [docs/troubleshooting.md](./troubleshooting.md) — contract error codes and common failures
- [`src/lib/api/errorCodes.ts`](../src/lib/api/errorCodes.ts) — serverless code constants
- [`server/src/middleware/errorHandler.ts`](../server/src/middleware/errorHandler.ts) — Express error serialisation
