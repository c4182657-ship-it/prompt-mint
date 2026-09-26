# `@prompthash/server-sdk`

Server-side TypeScript SDK for the Prompt Mint API. Use it from a backend worker, a cron job, or an edge function — not from the browser.

The browser SDK lives in [`packages/sdk`](../sdk). This package adds the things a server integration needs on top of plain `fetch`:

- **API-key auth** — sends `Authorization: Bearer pm_<prefix>_<secret>` (the server also accepts `X-Api-Key`)
- **Version negotiation** — `Accept-Version` on every call, defaulting to `latest`
- **Idempotent writes** — `Idempotency-Key` on POST/PUT/PATCH/DELETE
- **Typed errors** — `PromptHashApiError` with `status`, `code`, `retryable`, and `retryAfterMs()`
- **Bounded retry** — exponential backoff with jitter on `408`/`425`/`429`/`5xx`, honouring `reset` and `Retry-After`
- **Webhook verification** — constant-time HMAC-SHA256 check of `X-PromptHash-Signature`, timestamp window, replay guard

## Install

```bash
npm install @prompthash/server-sdk
# or
yarn add @prompthash/server-sdk
```

Until the package is published, install it from a checkout of this repository:

```bash
npm install /path/to/prompt-mint/packages/server-sdk
```

Requires Node 18+ (a global `fetch` is expected, or inject your own).

## Quick start

```typescript
import {
  PromptHashApiError,
  PromptHashServerClient,
} from "@prompthash/server-sdk";

const client = new PromptHashServerClient({
  baseUrl: "https://api.promptmint.io",
  apiKey: process.env.PROMPTMINT_API_KEY,
});

const page = await client.listPrompts({ page: 1, limit: 20, sort: "upvotes" });
console.log(page.total, page.prompts?.length);
```

### Retries and error codes

```typescript
try {
  await client.post("/api/webhooks", {
    body: { walletAddress, url },
    // Required to make a retry safe after a timeout.
    idempotencyKey: crypto.randomUUID(),
  });
} catch (err) {
  if (err instanceof PromptHashApiError) {
    if (err.code === "RATE_LIMIT_IP" || err.code === "RATE_LIMIT_WALLET") {
      await new Promise((r) => setTimeout(r, err.retryAfterMs() ?? 1000));
    } else if (err.retryable) {
      // worth another shot with your own policy
    } else {
      throw err;
    }
  } else {
    throw err; // PromptHashNetworkError, TypeError, …
  }
}
```

Tune the budget with `maxRetries` (default `2`), `retryBaseDelayMs` (default `250`), and `retryMaxDelayMs` (default `10000`); pass `retry: false` to disable it for a single call.

### Webhook verification

```typescript
import { verifyWebhook, WebhookReplayGuard } from "@prompthash/server-sdk";

const replayGuard = new WebhookReplayGuard({ toleranceSeconds: 300 });

app.post("/hooks/prompthash", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = verifyWebhook(
      process.env.PROMPTMINT_WEBHOOK_SECRET!,
      req.body.toString("utf8"), // raw bytes — never a re-serialised object
      req.headers,
      { replayGuard },
    );
    console.log(event.event, event.deliveryId, event.data);
    res.sendStatus(200);
  } catch (err) {
    console.warn("rejected webhook:", err);
    res.sendStatus(400);
  }
});
```

`verifyWebhook` throws a `WebhookVerificationError` whose `reason` is one of `missing_signature`, `malformed_signature`, `signature_mismatch`, `stale_timestamp`, `future_timestamp`, `invalid_payload`, or `duplicate_delivery`.

## Resource helpers

| Method | Route |
|---|---|
| `listPrompts(params)` | `GET /api/prompts` |
| `getPrompt(id)` | `GET /api/prompts/:id` |
| `registerWebhook(params)` | `POST /api/webhooks` |
| `getWebhook(wallet)` | `GET /api/webhooks?walletAddress=` |
| `deleteWebhook(wallet)` | `DELETE /api/webhooks` |
| `rotateWebhookSecret(wallet)` | `POST /api/webhooks/rotate-secret` |
| `testWebhook(wallet)` | `POST /api/webhooks/test` |
| `listWebhookDeliveries(wallet)` | `GET /api/webhooks/deliveries` |
| `listWebhookDeadLetters(wallet)` | `GET /api/webhooks/dead-letters` |
| `listApiKeys(ownerWallet)` | `GET /api-keys` |
| `createApiKey(params)` | `POST /api-keys` |
| `rotateApiKey(id, owner)` | `POST /api-keys/:id/rotate` |
| `revokeApiKey(id, owner)` | `DELETE /api-keys/:id` |

Anything else goes through `client.get/post/put/patch/delete(path, options)`.

## Testing

```bash
# from the repository root
yarn test:frontend
# or run just this package's tests
npx vitest run packages/server-sdk
```

Tests stub the transport — no network access and no `node_modules` install required beyond the repo root install.

## Error codes

The full table of codes, statuses, retry guidance, and envelope shapes is in [docs/sdk-error-codes.md](../../docs/sdk-error-codes.md).

## Related Documentation

- [docs/integration-guide.md](../../docs/integration-guide.md)
- [docs/api-reference.md](../../docs/api-reference.md)
- [docs/payload-versioning.md](../../docs/payload-versioning.md)
- [docs/monorepo-map.md](../../docs/monorepo-map.md)
