# Public API Survival Guide for Third Parties

A practical integration reference for external developers building on top of
PromptHash Stellar. This guide focuses on the things most likely to trip you
up: the unlock flow, rate limits, error recovery, API versioning, idempotency,
and webhook verification. Read this alongside the full
[API reference](./api-reference.md), the
[SDK error-code card](./sdk-error-codes.md), and the
[integration guide](./integration-guide.md).

## Table of contents

1. [Base URLs and environments](#1-base-urls-and-environments)
2. [Versioning every request](#2-versioning-every-request)
3. [The unlock flow end-to-end](#3-the-unlock-flow-end-to-end)
4. [Rate limits — read before hitting 429](#4-rate-limits--read-before-hitting-429)
5. [Error envelopes and recovery logic](#5-error-envelopes-and-recovery-logic)
6. [CAPTCHA and account lockout](#6-captcha-and-account-lockout)
7. [Idempotency for state-changing calls](#7-idempotency-for-state-changing-calls)
8. [Webhook verification](#8-webhook-verification)
9. [API key authentication](#9-api-key-authentication)
10. [Common integration failures](#10-common-integration-failures)
11. [Testnet integration checklist](#11-testnet-integration-checklist)

---

## 1. Base URLs and environments

| Environment | Base URL |
|---|---|
| Testnet | `https://testnet.api.promptmint.io` |
| Production | `https://api.promptmint.io` |

Always develop and CI-test against testnet. Never point a CI job at the
production URL. The testnet contract is separate; testnet purchases have no
value.

Use `https://api.promptmint.io` only in production deployments. All requests
must use HTTPS; HTTP is not accepted.

---

## 2. Versioning every request

Every public endpoint accepts an `Accept-Version` header. Omitting it silently
pins you to `CURRENT_API_VERSION` today, but a future promotion of the current
version will shift without notice. **Always pin explicitly.**

```http
POST /api/auth/challenge HTTP/1.1
Content-Type: application/json
Accept-Version: 2025-01-01
```

Supported values:

| Value | Resolved version |
|---|---|
| `2025-01-01` | `2025-01-01` (current) |
| `2024-01-01` | `2024-01-01` (baseline) |
| `latest` or absent | `CURRENT_API_VERSION` — moves on server promotions |
| anything else | `400 UNSUPPORTED_VERSION` |

Every response — success and error — echoes the resolved version in two places:

```http
X-API-Version: 2025-01-01
```

```json
{ "apiVersion": "2025-01-01", ... }
```

Always read `apiVersion` from the body before parsing fields. Additive changes
(new optional fields) do **not** produce a new version. Removals, renames, or
semantic changes do, and they come with at least 90 days' notice in
[payload-versioning.md](./payload-versioning.md).

---

## 3. The unlock flow end-to-end

The full challenge-sign-unlock cycle is the most error-prone part of any
integration. The critical constraint is **the challenge token is valid for
5 minutes** and is single-use. The entire round-trip — request challenge, sign
in wallet, submit unlock — must complete within that window.

### Step 1 — request a challenge

```http
POST /api/auth/challenge HTTP/1.1
Content-Type: application/json
Accept-Version: 2025-01-01

{
  "address": "GBUYER...",
  "promptId": "42"
}
```

Success `200`:

```json
{
  "apiVersion": "2025-01-01",
  "token": "<signed-jwt>",
  "message": "PromptHash unlock: promptId=42 nonce=<uuid> ts=<unix-ms>"
}
```

- `address` must be a valid 56-character Stellar `G…` public key.
- `promptId` must be a non-empty decimal string with no sign or decimal point
  (`"42"`, not `42` or `"42.0"`).
- Present the `message` string verbatim to the wallet for signing. Do not
  modify it. Freighter and other Stellar wallets expect the raw string.

### Step 2 — sign the challenge message

Use the wallet to sign `message` with the Ed25519 key that corresponds to
`address`. The resulting signature must be base64-encoded before submission.

### Step 3 — submit the unlock request

```http
POST /api/prompts/unlock HTTP/1.1
Content-Type: application/json
Accept-Version: 2025-01-01

{
  "token": "<signed-jwt>",
  "promptId": "42",
  "address": "GBUYER...",
  "signedMessage": "<base64-signature>"
}
```

Success `200`:

```json
{
  "apiVersion": "2025-01-01",
  "plaintext": "Your full prompt content here...",
  "integrityVerified": true
}
```

Always check `integrityVerified`. When it is `false` the content hash did not
match what the creator registered on-chain. Stop, do not expose the content to
the user, and report to support with the `promptId`.

### Complete example (TypeScript)

```typescript
async function unlockPrompt(
  promptId: string,
  walletAddress: string,
  signFn: (message: string) => Promise<string>, // base64 signature
  baseUrl = "https://api.promptmint.io",
): Promise<string> {
  const headers = {
    "Content-Type": "application/json",
    "Accept-Version": "2025-01-01",
  };

  // Step 1: challenge
  const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ address: walletAddress, promptId }),
  });
  if (!challengeRes.ok) {
    const err = await challengeRes.json();
    throw new ApiError(err.code, err.error, challengeRes.status);
  }
  const { token, message } = await challengeRes.json();

  // Step 2: sign — this must happen before the 5-minute TTL expires
  const signedMessage = await signFn(message);

  // Step 3: unlock
  const unlockRes = await fetch(`${baseUrl}/api/prompts/unlock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ token, promptId, address: walletAddress, signedMessage }),
  });
  if (!unlockRes.ok) {
    const err = await unlockRes.json();
    throw new ApiError(err.code, err.error, unlockRes.status);
  }
  const { plaintext, integrityVerified } = await unlockRes.json();

  if (!integrityVerified) {
    throw new Error(`Integrity check failed for prompt ${promptId}. Do not use this content.`);
  }
  return plaintext;
}
```

### Flow failure modes

| Error code | HTTP | Cause | Recovery |
|---|---|---|---|
| `CHALLENGE_EXPIRED` | 401 | Token older than 5 minutes | Restart from step 1 |
| `CHALLENGE_INVALID` | 401 | Token tampered, wrong address/promptId | Restart from step 1 |
| `INVALID_SIGNATURE` | 401 | Signed the wrong message, wrong key, or malformed base64 | Sign the exact `message` string returned in step 1 |
| `ACCESS_NOT_PURCHASED` | 403 | Buyer has no on-chain purchase record | Ensure `buy_prompt` transaction was finalized before unlocking |
| `CAPTCHA_REQUIRED` | 403 | Too many failures from this IP/wallet | See [CAPTCHA and lockout](#6-captcha-and-account-lockout) |
| `ACCOUNT_LOCKED` | 423 | 5 consecutive auth failures | Wait until `lockedUntil` ms, then retry |
| `RATE_LIMIT_IP` / `RATE_LIMIT_WALLET` | 429 | Too many requests | Wait until `reset` ms |

---

## 4. Rate limits — read before hitting 429

Rate-limit windows are 60 seconds. Headers are present on every
challenge/unlock response, even successful ones.

| Endpoint | IP limit | Wallet limit |
|---|---|---|
| `POST /api/auth/challenge` | 10/min | 5/min |
| `POST /api/prompts/unlock` | 3/min | 5/min |
| `POST /api/analytics/events` | 60/min (unauthenticated) | 120/min (API key) |

Response headers:

```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1767139260000
```

`X-RateLimit-Reset` is a Unix timestamp in **milliseconds**. When you hit 429,
wait until that timestamp before retrying — do not retry immediately.

```typescript
async function fetchWithRateLimitRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;

    if (attempt === maxRetries) return res;

    const body = await res.clone().json().catch(() => ({}));
    const resetMs = body.reset ?? (Date.now() + 60_000);
    const delayMs = Math.max(0, resetMs - Date.now()) + 100; // small safety margin
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // unreachable
  throw new Error("fetchWithRateLimitRetry: exhausted retries");
}
```

API-key authenticated calls get higher throughput tiers (see
[api-reference.md](./api-reference.md) for the full tier table). If you are
building a backend service that drives many unlock requests, use an API key.

---

## 5. Error envelopes and recovery logic

All endpoints return the same JSON envelope on error:

```json
{
  "apiVersion": "2025-01-01",
  "error": "Human-readable message safe to display.",
  "code": "MACHINE_READABLE_CODE",
  "reset": 1767139260000
}
```

`reset` is only present on 429. `lockedUntil` is only present on 423.
`captchaRequired: true` is added on 403 when CAPTCHA is needed.

Always branch on `code`, not `error`. The `error` string is for users; `code`
is stable across releases.

```typescript
class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function parseApiError(body: Record<string, unknown>, status: number): ApiError {
  return new ApiError(
    String(body.code ?? "UNKNOWN"),
    String(body.error ?? "An unexpected error occurred."),
    status,
    body,
  );
}
```

### Retry policy

| Code | Retry? | Strategy |
|---|---|---|
| `TEMPORARY_FAILURE` | Yes | Exponential backoff, max 3 attempts |
| `RATE_LIMIT_IP` / `RATE_LIMIT_WALLET` | Yes | Wait for `reset`, then once |
| `CHALLENGE_EXPIRED` / `CHALLENGE_INVALID` | Yes | Restart the full challenge flow |
| `INVALID_SIGNATURE` | No — fix input | Check message and base64 encoding |
| `ACCESS_NOT_PURCHASED` | No — check contract | Verify `has_access` on-chain |
| `INTEGRITY_FAILURE` | No — report | Do not expose content; contact support |
| `CONFIGURATION_ERROR` | No | Platform issue; check status page |
| `UNSUPPORTED_VERSION` | No — fix header | Update `Accept-Version` |

---

## 6. CAPTCHA and account lockout

After repeated failed unlock attempts from the same IP or wallet, the server
may require CAPTCHA verification before proceeding:

```json
{
  "apiVersion": "2025-01-01",
  "error": "Additional verification is required. Please complete the CAPTCHA and try again.",
  "code": "CAPTCHA_REQUIRED",
  "captchaRequired": true
}
```

When `captchaRequired` is `true`:

1. Surface the CAPTCHA widget to the user.
2. Obtain a CAPTCHA token.
3. Retry the request with the CAPTCHA token in the body.

After 5 consecutive auth failures the account is locked until `lockedUntil`:

```json
{
  "apiVersion": "2025-01-01",
  "error": "Account is temporarily locked due to 5 consecutive failed authentication attempts. Please wait before trying again.",
  "code": "ACCOUNT_LOCKED",
  "lockedUntil": 1767139260000
}
```

When `ACCOUNT_LOCKED` is received, stop retrying immediately. Display the
lockout expiry to the user and retry only after `lockedUntil` ms has passed.

---

## 7. Idempotency for state-changing calls

All state-changing Express routes accept an `Idempotency-Key` header. Use a
random UUID per logical operation. Matching retries within 24 hours replay the
original response without a second write. A changed body with the same key
returns `409`.

```http
POST /api/prompts HTTP/1.1
Content-Type: application/json
Accept-Version: 2025-01-01
Idempotency-Key: a3b4c5d6-e7f8-4a1b-9c0d-1e2f3a4b5c6d

{
  "title": "My prompt",
  "content": "...",
  "walletAddress": "G...",
  "price": 2.5
}
```

When a request fails with a network error (no response received) or a 5xx,
retry with the **same** `Idempotency-Key`. Do not generate a new key for the
retry; that defeats the purpose.

Do **not** send an `Idempotency-Key` on GET or other read-only requests; it is
ignored and adds noise.

---

## 8. Webhook verification

When you register a webhook subscription the server returns a `secret` once. Store it immediately — it is never shown again. Every delivery includes an `X-PromptHash-Signature` header containing an HMAC-SHA256 hex digest of the raw request body, signed with your secret.

Always verify the signature before acting on a delivery. Use a constant-time comparison to avoid timing attacks.

```typescript
import { createHmac, timingSafeEqual } from "crypto";

function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Both buffers must be the same length for timingSafeEqual
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(signature.replace(/^sha256=/, ""), "hex");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
```

```typescript
// Express handler example
app.post("/hooks/prompthash", express.raw({ type: "*/*" }), (req, res) => {
  const sig = req.headers["x-prompthash-signature"] as string;
  if (!sig || !verifyWebhookSignature(req.body, sig, process.env.WEBHOOK_SECRET!)) {
    res.status(401).send("Invalid signature");
    return;
  }
  const event = JSON.parse(req.body.toString("utf8"));
  // handle event...
  res.status(200).send("ok");
});
```

Key rules:

- Parse the raw body bytes **before** JSON-decoding; the HMAC is over the raw
  wire bytes, not the parsed object.
- Use `express.raw()` or the equivalent in your framework, not `express.json()`,
  at this route.
- Rotate your webhook secret with `POST /api/webhooks/rotate-secret`. The old
  secret stops working immediately — update your environment variables before
  rotating.
- Failed deliveries are retried up to the platform's retry budget. Inspect dead
  letters at `GET /api/webhooks/dead-letters` and replay with
  `POST /api/webhooks/dead-letters/{id}/replay`.

---

## 9. API key authentication

API keys are issued and managed at `/api-keys`. The plaintext is shown **once**
at creation or rotation; store it in a secret manager immediately.

Send the key using either header format:

```http
X-Api-Key: pm_<prefix>_<secret>
```

or

```http
Authorization: Bearer pm_<prefix>_<secret>
```

Keys have a scope hierarchy: `admin` ⊇ `write` ⊇ `read`. Request only the
minimum scope your integration needs. Treat API keys as passwords: never log
them, never commit them to version control, never include them in
client-side bundles.

Rotate keys on a schedule or immediately after any suspected exposure with:

```http
POST /api-keys/{id}/rotate HTTP/1.1
Content-Type: application/json

{ "ownerWallet": "G..." }
```

The old key becomes invalid at rotation. There is no grace period.

---

## 10. Common integration failures

### "INVALID_SIGNATURE" on every unlock attempt

The most common cause is calling `message.trim()` or modifying the challenge
message before signing it. The server signs a specific byte sequence; any
alteration invalidates the signature.

```typescript
// ❌ Wrong — trimming changes the signed bytes
const sig = await wallet.sign(challengeMessage.trim());

// ✅ Correct — use the message exactly as returned
const sig = await wallet.sign(challengeMessage);
```

### "ACCESS_NOT_PURCHASED" immediately after a purchase

On-chain transactions need ledger finality before `has_access` returns `true`.
Wait 5-10 seconds after a successful `buy_prompt` submission before starting
the unlock flow.

```typescript
async function waitForOnChainFinality(delayMs = 8_000): Promise<void> {
  await new Promise((r) => setTimeout(r, delayMs));
}

await submitBuyPromptTransaction(promptId, buyerKeypair);
await waitForOnChainFinality();
await unlockPrompt(promptId, walletAddress, signFn);
```

### Prompt IDs as numbers instead of strings

The API expects `promptId` as a **decimal string**. Passing a JSON number will
fail schema validation with `MISSING_FIELDS`.

```typescript
// ❌ Wrong — JSON number
{ "promptId": 42, "address": "G..." }

// ✅ Correct — decimal string
{ "promptId": "42", "address": "G..." }
```

### UNSUPPORTED_VERSION on an older client

A static `Accept-Version: 2024-01-01` header will stop working if that version
is retired. Subscribe to the changelog or watch `docs/payload-versioning.md`
for deprecation notices. Always pin to `2025-01-01` or newer in new
integrations.

### Body too large (413)

Serverless endpoints accept bodies up to **100 KB**. Express endpoints accept
up to **300 KB**. Large listing content submissions that exceed these limits
return `413` with no JSON body. Trim your content and retry.

### Webhook secret lost after rotation

There is no recovery path. Revoke the subscription and register a new one with
`POST /api/webhooks`. Store the secret in a secret manager before acknowledging
the rotation response.

---

## 11. Testnet integration checklist

Before pointing at production, verify every item on this list against testnet:

- [ ] All requests send `Accept-Version: 2025-01-01`
- [ ] All requests use HTTPS
- [ ] Challenge flow completes in under 5 minutes end-to-end
- [ ] Challenge `message` is passed verbatim to the wallet signer
- [ ] `promptId` is sent as a decimal string, not a number
- [ ] Wallet address is a 56-character `G…` Stellar public key
- [ ] 429 responses are handled by reading `reset` and waiting
- [ ] `ACCOUNT_LOCKED` responses stop retrying until `lockedUntil`
- [ ] `integrityVerified: false` in an unlock response halts content delivery
- [ ] State-changing calls include an `Idempotency-Key` UUID
- [ ] Idempotency keys are reused on network-error retries (not regenerated)
- [ ] Webhook handler reads the raw body bytes before JSON-decoding
- [ ] Webhook signatures are verified with `timingSafeEqual`
- [ ] API keys are stored in environment variables, not in source code
- [ ] `INTEGRITY_FAILURE` triggers a support report, not a retry

---

## Related documentation

- [API reference](./api-reference.md) — complete endpoint catalog and OpenAPI link
- [Integration guide](./integration-guide.md) — SDK installation and advanced patterns
- [SDK error-code reference card](./sdk-error-codes.md) — full code table with retry guidance
- [Mock responses library](./mock-responses-library.md) — pre-built fixtures for unit testing integrations
- [Payload versioning](./payload-versioning.md) — schema version lifecycle and migration policy
- [API request schemas](./api-request-schemas.md) — Zod field rules and validation details
- [Security model](./security-model.md) — encryption, key-wrapping, and threat model
- [Secret rotation](./secret-rotation.md) — credential rotation procedures
