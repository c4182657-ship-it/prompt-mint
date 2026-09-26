# Mock Responses Library

`@prompthash/sdk` ships a `Mocks` namespace (`packages/sdk/src/mocks.ts`) with
pre-built fixture factories for every public API response shape. The library
has no external dependencies and works in browser (jsdom) and Node environments.

Use it in unit tests to drive integration code without a live server:

```typescript
import { Mocks } from "@prompthash/sdk";
// or import individual factories:
import { prompt, apiError, challengeResponse } from "@prompthash/sdk";
```

---

## Factory reference

### Prompts

| Factory | Returns | Notes |
|---|---|---|
| `Mocks.prompt(overrides?)` | `MockPrompt` | Single prompt with default values |
| `Mocks.promptList(count?, base?)` | `MockPrompt[]` | Sequential ids and titles |
| `Mocks.listPromptsResponse(overrides?)` | `ListPromptsResponse` | Paginated list envelope |

```typescript
Mocks.prompt()
// { id: "42", title: "Marketing Email Generator", priceXlm: 2.5, forSale: true, ... }

Mocks.prompt({ id: "7", priceXlm: 10, forSale: false })

Mocks.promptList(5)
// [{ id: "1", title: "Test Prompt 1" }, ..., { id: "5", title: "Test Prompt 5" }]

Mocks.listPromptsResponse({ prompts: [{ id: "1" }, { id: "2" }], page: 2, total: 50 })
// { apiVersion: "2025-01-01", prompts: [...], page: 2, total: 50 }
```

### Challenge and unlock

| Factory | Returns | Notes |
|---|---|---|
| `Mocks.challengeResponse(overrides?)` | `MockChallengeResponse` | `POST /api/auth/challenge` success |
| `Mocks.unlockResponse(overrides?)` | `MockUnlockResponse` | `POST /api/prompts/unlock` success |
| `Mocks.unlockIntegrityFailure()` | `MockUnlockResponse` | `integrityVerified: false` — content must be withheld |

```typescript
Mocks.challengeResponse()
// { apiVersion: "2025-01-01", token: "...", message: "PromptHash unlock: promptId=42 ...", expiresAt: "..." }

Mocks.unlockResponse({ plaintext: "Custom prompt text." })
// { apiVersion: "2025-01-01", plaintext: "Custom prompt text.", integrityVerified: true }

Mocks.unlockIntegrityFailure()
// { apiVersion: "2025-01-01", plaintext: "...", integrityVerified: false }
// ⚠ Callers must NOT expose plaintext when integrityVerified is false
```

### Purchase and governance

| Factory | Returns | Notes |
|---|---|---|
| `Mocks.purchaseResult(overrides?)` | `MockPurchaseResult` | `POST /api/prompts/:id/purchase` |
| `Mocks.voteResult(overrides?)` | `MockVoteResult` | `POST /api/governance/vote/:id` |
| `Mocks.topPromptsResponse(overrides?)` | `MockTopPromptsResponse` | `GET /api/governance/top` |

### Webhooks

| Factory | Returns | Notes |
|---|---|---|
| `Mocks.webhookRegistration(overrides?)` | `MockWebhookRegistration` | `POST /api/webhooks` response with `secret` |
| `Mocks.webhookEnvelope(event, data?, overrides?)` | `MockWebhookEnvelope` | Generic outbound delivery body |
| `Mocks.promptPurchasedWebhook(overrides?)` | `MockWebhookEnvelope` | Pre-built `PromptPurchased` event |
| `Mocks.promptCreatedWebhook(overrides?)` | `MockWebhookEnvelope` | Pre-built `PromptCreated` event |

```typescript
// Build a delivery body, serialise it, then pass to your handler:
const body = JSON.stringify(Mocks.promptPurchasedWebhook({ deliveryId: "d-1" }));
```

### Error responses

| Factory | Returns | Notes |
|---|---|---|
| `Mocks.apiError(code, overrides?)` | `MockApiError` | Standard error envelope |
| `Mocks.httpStatusFor(code)` | `number` | HTTP status for a given error code |

```typescript
Mocks.apiError("CHALLENGE_EXPIRED")
// { apiVersion: "2025-01-01", error: "Your unlock session has expired...", code: "CHALLENGE_EXPIRED" }

Mocks.apiError("RATE_LIMIT_IP", { reset: Date.now() + 60_000 })
// { ..., code: "RATE_LIMIT_IP", reset: <timestamp> }

Mocks.apiError("ACCOUNT_LOCKED", { lockedUntil: Date.now() + 300_000 })
// { ..., code: "ACCOUNT_LOCKED", lockedUntil: <timestamp> }

Mocks.httpStatusFor("RATE_LIMIT_IP")  // 429
Mocks.httpStatusFor("ACCOUNT_LOCKED") // 423
```

### Rate limit headers and health

| Factory | Returns | Notes |
|---|---|---|
| `Mocks.rateLimitHeaders(remaining?, limit?, resetMs?)` | `MockRateLimitHeaders` | `X-RateLimit-*` header map |
| `Mocks.healthResponse(overrides?)` | `MockHealthResponse` | `GET /api/health` |

```typescript
Mocks.rateLimitHeaders(0, 10, Date.now() + 62_000)
// { "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "..." }
```

---

## MockErrorCode table

Every code maps to a canonical HTTP status and a human-readable message via
`Mocks.HTTP_STATUS_FOR` and `Mocks.ERROR_MESSAGES`.

| Code | HTTP | Notes |
|---|---|---|
| `MISSING_FIELDS` | 400 | Required fields absent or malformed |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP verb |
| `INVALID_INPUT` | 400 | Validation failure |
| `CHALLENGE_EXPIRED` | 401 | Token older than 5 minutes — restart flow |
| `CHALLENGE_INVALID` | 401 | Token tampered or mismatched — restart flow |
| `INVALID_SIGNATURE` | 401 | Wallet signature mismatch |
| `ACCESS_NOT_PURCHASED` | 403 | No on-chain purchase record |
| `RATE_LIMIT_IP` | 429 | IP bucket exhausted — check `reset` |
| `RATE_LIMIT_WALLET` | 429 | Wallet bucket exhausted — check `reset` |
| `ACCOUNT_LOCKED` | 423 | 5 consecutive failures — check `lockedUntil` |
| `CAPTCHA_REQUIRED` | 403 | CAPTCHA needed — check `captchaRequired` |
| `CAPTCHA_INVALID` | 403 | CAPTCHA token rejected |
| `UNKNOWN_EVENT` | 400 | Analytics event not in taxonomy |
| `INVALID_EVENT_PAYLOAD` | 400 | Analytics payload schema mismatch |
| `CONFIGURATION_ERROR` | 500 | Server misconfigured — do not retry |
| `INTEGRITY_FAILURE` | 500 | Content hash mismatch — do not retry, report |
| `TEMPORARY_FAILURE` | 503 | Transient — safe to retry with backoff |
| `UNSUPPORTED_VERSION` | 400 | Pin `Accept-Version` to a supported date |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds limit — trim content |
| `WALLET_NOT_FUNDED` | 402 | Insufficient XLM balance |

---

## Constants

| Export | Value |
|---|---|
| `MOCK_API_VERSION` | `"2025-01-01"` |
| `MOCK_WALLET_ADDRESS` | A clearly fake 56-char `G…` public key |
| `MOCK_CREATOR_ADDRESS` | A different clearly fake 56-char `G…` public key |

---

## Example: wiring mocks into a fetch stub

The `Mocks` namespace pairs naturally with a simple fetch stub in tests:

```typescript
import { Mocks } from "@prompthash/sdk";

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return async (_url: string) => {
    const { status, body } = responses[i++ % responses.length];
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

it("handles a rate-limited challenge, then succeeds", async () => {
  const resetMs = Date.now() + 1_000;

  const fetchStub = stubFetch([
    { status: 429, body: Mocks.apiError("RATE_LIMIT_IP", { reset: resetMs }) },
    { status: 200, body: Mocks.challengeResponse() },
  ]);

  // Drive your unlock client through the retry path:
  const result = await myChallengeClient.requestChallenge("42", "G...", fetchStub);
  expect(result.token).toBeTruthy();
});
```

---

## Related

- [Integration guide](./integration-guide.md) — SDK installation and advanced patterns
- [Public API survival guide](./public-api-survival-guide.md) — rate limits, error recovery, unlock flow
- [SDK error-code reference card](./sdk-error-codes.md) — full code table with retry guidance
- Source: [`packages/sdk/src/mocks.ts`](../packages/sdk/src/mocks.ts)
- Tests: [`packages/sdk/test/mocks.test.ts`](../packages/sdk/test/mocks.test.ts)
