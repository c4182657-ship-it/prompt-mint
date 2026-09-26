# PromptHash Developer Integration Guide

This guide shows third-party developers how to integrate with PromptHash Stellar using the SDK and REST API. It covers reading prompts, verifying access, purchasing licenses, and monitoring events in production environments.

---

## Installation

```bash
npm install @prompthash/sdk @stellar/stellar-sdk
# or
yarn add @prompthash/sdk @stellar/stellar-sdk
```

---

## Quick Start

```typescript
import { PromptHashClient } from "@prompthash/sdk";

const client = new PromptHashClient({
  apiUrl: "https://api.prompthash.io",
  network: "mainnet", // or "testnet"
});
```

---

## Fetching Prompts

### List prompts (with community ranking)

```typescript
// Sorted by upvotes (community governance rank)
const prompts = await client.listPrompts({ sort: "upvotes", limit: 20 });

console.log(prompts);
// [{ id, title, image, rating, upvotes, owner, priceUSDC }, ...]
```

### Get a single prompt

```typescript
const prompt = await client.getPrompt("64abc123def456");
console.log(prompt.title, prompt.priceUSDC);
```

---

## Buying a License

PromptHash uses a two-step flow: the buyer submits a Stellar transaction on-chain, then records it with the backend to claim their license.

```typescript
import {
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const server = new Server("https://soroban-testnet.stellar.org");
const buyerKeypair = Keypair.fromSecret("S...");

// 1. Build and submit the on-chain purchase transaction
// (Exact call depends on the PromptHash contract ABI — see contracts/prompt_hash)
const txHash = await submitOnChainPurchase(promptId, buyerKeypair);

// 2. Record the purchase with the backend
const result = await client.recordPurchase(promptId, buyerKeypair.publicKey(), txHash);
if (result.success) {
  console.log("License granted!");
}
```

---

## Verifying License Ownership

Before showing a buyer the decrypted prompt content, verify they hold a license:

```typescript
const licensed = await client.hasLicense(promptId, buyerWallet);
if (!licensed) {
  throw new Error("Unlicensed access");
}
// Proceed with unlock flow
```

---

## License Verification Flow (Unlock Service)

The full license verification challenge-response flow:

```
1. Client calls GET /api/unlock/:promptId?wallet=G... → receives { nonce }
2. Client signs the nonce with Freighter wallet
3. Client calls POST /api/unlock/:promptId → { signature, wallet }
4. Server verifies signature against on-chain purchase record
5. Server returns the decryption key (valid for 60 seconds)
6. Client decrypts prompt content in-browser
```

---

## Community Voting (Governance)

```typescript
// Cast an upvote (buyer wallets only)
const voteResult = await client.upvote(promptId, buyerWallet);
console.log("Total upvotes:", voteResult.upvotes);

// Get top-ranked prompts
const top = await client.getTopPrompts(10);
console.log(top); // [{ promptId, upvotes }, ...]
```

---

## REST API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompts` | List prompts (`?page=1&limit=20&sort=upvotes`) |
| `GET` | `/api/prompts/:id` | Get prompt by ID |
| `POST` | `/api/prompts/:id/purchase` | Record a purchase |
| `GET` | `/api/prompts/:id/license` | Check license (`?wallet=G...`) |
| `GET` | `/api/unlock/:id` | Get challenge nonce |
| `POST` | `/api/unlock/:id` | Submit signed challenge, receive key |
| `POST` | `/api/governance/vote/:id` | Cast upvote |
| `DELETE` | `/api/governance/vote/:id` | Remove upvote |
| `GET` | `/api/governance/votes/:id` | Get vote count |
| `GET` | `/api/governance/top` | Top-ranked prompts |

Full OpenAPI spec: [docs/api-reference.md](./api-reference.md)

For concise gotcha-focused guidance on rate limits, error recovery, the unlock
flow, idempotency, and webhook verification, see the
[Public API Survival Guide](./public-api-survival-guide.md).

---

## Testing your integration with mock responses

`@prompthash/sdk` ships a `Mocks` namespace with pre-built fixture factories
for every public API response shape. Use them to unit-test your integration
code without a live server or real network calls.

```bash
npm install @prompthash/sdk
```

```typescript
import { Mocks } from "@prompthash/sdk";

// Build individual fixtures
const p = Mocks.prompt({ id: "7", priceXlm: 5 });
const challenge = Mocks.challengeResponse();
const unlock = Mocks.unlockResponse();
const err = Mocks.apiError("RATE_LIMIT_IP", { reset: Date.now() + 60_000 });
const headers = Mocks.rateLimitHeaders(0); // remaining = 0

// Build a list response
const page = Mocks.listPromptsResponse({ prompts: [{ id: "1" }, { id: "2" }] });

// Build webhook payloads for handler testing
const purchased = Mocks.promptPurchasedWebhook();
const created = Mocks.promptCreatedWebhook({ deliveryId: "d-test-1" });
```

All factories accept a partial override object — supply only the fields your
test cares about and the rest are filled with safe, deterministic defaults.
The `integrityVerified` flag on `unlockResponse` and `unlockIntegrityFailure`
lets you test the path where content delivery must be blocked:

```typescript
// Test the integrity-failure path
const badUnlock = Mocks.unlockIntegrityFailure();
expect(badUnlock.integrityVerified).toBe(false);
// Your handler must NOT expose badUnlock.plaintext to the user
```

See the [Mock Responses Library reference](./mock-responses-library.md) for
the complete factory list and the `MockErrorCode` table.

---

## Server-Side SDKs

Backend integrations (API-key auth, idempotent writes, webhook verification) use the server SDKs instead of the browser SDK above:

| Language | Package | Location |
|---|---|---|
| TypeScript | `@prompthash/server-sdk` | [`packages/server-sdk`](../packages/server-sdk) |
| Python | `prompthash-server-sdk` | [`packages/server-sdk-python`](../packages/server-sdk-python) |
| Go | `github.com/PromptMintLabs/prompt-mint/packages/server-sdk-go` | [`packages/server-sdk-go`](../packages/server-sdk-go) |
| Rust | `prompthash-server-sdk` | [`packages/server-sdk-rust`](../packages/server-sdk-rust) |

All four share the same surface: `Authorization: Bearer pm_<prefix>_<secret>` (or `X-Api-Key`), `Accept-Version` negotiation, `Idempotency-Key` on state-changing calls, typed errors with a `code`, bounded retry with backoff on `429`/`5xx`, and constant-time HMAC-SHA256 verification of the `X-PromptHash-Signature` webhook header.

```typescript
import { PromptHashServerClient } from "@prompthash/server-sdk";

const client = new PromptHashServerClient({
  baseUrl: "https://api.promptmint.io",
  apiKey: process.env.PROMPTMINT_API_KEY,
});

const page = await client.listPrompts({ page: 1, limit: 20 });
const registration = await client.registerWebhook({
  walletAddress: "GB7...XYZ",
  url: "https://example.com/hooks/prompthash",
  events: ["PromptPurchased"],
});
// registration.secret is shown once — store it for verification.
```

```python
from prompthash_server_sdk import PromptHashClient

client = PromptHashClient(base_url="https://api.promptmint.io", api_key="pm_...")
page = client.list_prompts(page=1, limit=20)
registration = client.register_webhook(
    wallet_address="GB7...XYZ",
    url="https://example.com/hooks/prompthash",
    events=["PromptPurchased"],
)
```

```go
client, err := prompthash.NewClient(prompthash.Config{
    BaseURL: "https://api.promptmint.io",
    APIKey:  os.Getenv("PROMPTMINT_API_KEY"),
})
if err != nil {
    log.Fatal(err)
}

page, err := client.ListPrompts(ctx, prompthash.ListPromptsParams{Page: 1, Limit: 20})
registration, err := client.RegisterWebhook(ctx, prompthash.RegisterWebhookParams{
    WalletAddress: "GB7...XYZ",
    URL:           "https://example.com/hooks/prompthash",
    Events:        []string{"PromptPurchased"},
})
```

```rust
use prompthash_server_sdk::{Client, ClientConfig, RegisterWebhookParams};

let client = Client::new(ClientConfig {
    base_url: "https://api.promptmint.io".to_string(),
    api_key: Some(std::env::var("PROMPTMINT_API_KEY").unwrap_or_default()),
    ..Default::default()
})?;

let page = client.list_prompts(Default::default())?;
let registration = client.register_webhook(RegisterWebhookParams {
    wallet_address: "GB7...XYZ".to_string(),
    url: "https://example.com/hooks/prompthash".to_string(),
    events: Some(vec!["PromptPurchased".to_string()]),
})?;
// registration.secret is shown once — store it for verification.
```

---

## Error Handling

All SDK methods throw typed errors carrying the machine-readable `code` the server returned. The REST API returns `{ error: string }` (plus `code` when available) with the appropriate HTTP status:

- `400` — Missing or invalid parameters (`MISSING_FIELDS`, `INVALID_INPUT`, `UNSUPPORTED_VERSION`)
- `401` — Authentication failed (`INVALID_SIGNATURE`, invalid API key)
- `403` — Not authorised (e.g. non-buyer attempting to vote, `ACCESS_NOT_PURCHASED`)
- `404` — Resource not found (`NOT_FOUND`)
- `409` — Conflict (e.g. duplicate vote, idempotency replay)
- `429` — Rate limited (`RATE_LIMIT_IP`, `RATE_LIMIT_WALLET`); honour `reset`
- `5xx` — Transient or configuration failure; retry with backoff unless the code is `INTEGRITY_FAILURE`

See the [SDK error-code reference card](./sdk-error-codes.md) for the complete table, retry policy, and envelope shapes.

---

## TypeScript Types

```typescript
import type { PromptInfo, PurchaseResult, ClientConfig } from "@prompthash/sdk";
```

---

## Advanced Integration Patterns

### Purchasing Licenses Programmatically

For applications that need to automate license purchases (e.g., batch buying, subscription services):

```typescript
import { PromptHashClient } from "@prompthash/sdk";
import { Keypair, Networks, TransactionBuilder, BASE_FEE, Operation } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const rpc = new Server("https://soroban-testnet.stellar.org");
const client = new PromptHashClient({ 
  apiUrl: "https://api.prompthash.io",
  network: "testnet" 
});

async function purchaseLicense(
  promptId: string,
  buyerSecret: string,
  sourceAccount: string
) {
  const keypair = Keypair.fromSecret(buyerSecret);
  
  // 1. Fetch the prompt to get current price and contract details
  const prompt = await client.getPrompt(promptId);
  console.log(`Purchasing: ${prompt.title} for ${prompt.priceXLM} XLM`);

  // 2. Build the purchase transaction
  const account = await rpc.getAccount(sourceAccount);
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        // Contract call to buy_prompt
        func: /* ... contract ABI ... */,
      })
    )
    .setTimeout(300)
    .build();

  // 3. Sign and submit
  transaction.sign(keypair);
  const result = await rpc.sendTransaction(transaction);
  
  if (result.status === "SUCCESS") {
    console.log(`Purchase successful! Transaction hash: ${result.hash}`);
    return result.hash;
  } else {
    throw new Error(`Transaction failed: ${result.status}`);
  }
}
```

### Reading Prompts with Filters

Query prompts by creator, category, or price range:

```typescript
// Fetch all prompts from a specific creator
const creatorPrompts = await client.getPromptsByCreator("GDEMO123ABC...", {
  limit: 50,
  offset: 0,
});

console.log(`Creator has ${creatorPrompts.total} published prompts`);
creatorPrompts.items.forEach(prompt => {
  console.log(`- ${prompt.title}: ${prompt.priceXLM} XLM`);
});

// Fetch prompts with price filtering
const affordablePrompts = await client.listPrompts({
  filter: { maxPrice: 10 }, // 10 XLM
  sort: "recent",
  limit: 20,
});

// Fetch by category
const businessPrompts = await client.listPrompts({
  filter: { category: "business" },
  sort: "upvotes",
});
```

### Verifying Access

Before allowing a user to access content, always verify on-chain:

```typescript
async function verifyAndUnlockAccess(
  promptId: string,
  buyerWallet: string,
  buyerSignature: string,
  apiKey?: string
) {
  // 1. Verify access on-chain
  const hasAccess = await client.hasLicense(promptId, buyerWallet);
  if (!hasAccess) {
    throw new Error("No license found for this wallet");
  }

  // 2. Request unlock challenge
  const challenge = await client.requestChallenge(promptId, buyerWallet);
  console.log(`Challenge received: ${challenge.nonce}`);

  // 3. Verify the wallet signature
  const isValidSignature = await client.verifySignature(
    promptId,
    buyerWallet,
    buyerSignature,
    challenge.nonce,
    apiKey
  );

  if (!isValidSignature) {
    throw new Error("Invalid wallet signature");
  }

  // 4. Fetch the decryption key from Unlock Service
  const unlockResult = await client.unlock(promptId, {
    wallet: buyerWallet,
    signature: buyerSignature,
    nonce: challenge.nonce,
  });

  console.log(`Decryption key valid until: ${unlockResult.expiresAt}`);
  return unlockResult.decryptionKey;
}
```

---

## Monitoring Events and Analytics

### Event Subscription

Subscribe to events for analytics and business logic:

```typescript
import { EventEmitter } from "events";

class PromptHashEventMonitor extends EventEmitter {
  constructor(private client: PromptHashClient) {
    super();
    this.startPolling();
  }

  private async startPolling() {
    setInterval(async () => {
      try {
        const events = await this.client.getRecentEvents({
          limit: 100,
          types: ["purchase", "unlock", "listing_created"],
        });

        events.forEach(event => {
          this.emit("event", event);
          this.handleEvent(event);
        });
      } catch (error) {
        this.emit("error", error);
      }
    }, 5000); // Poll every 5 seconds
  }

  private handleEvent(event: any) {
    switch (event.type) {
      case "purchase":
        console.log(`New purchase: ${event.buyerId} bought prompt ${event.promptId}`);
        break;
      case "unlock":
        console.log(`Content unlocked: ${event.wallet}`);
        break;
      case "listing_created":
        console.log(`New listing created by ${event.creator}`);
        break;
    }
  }
}

// Usage
const monitor = new PromptHashEventMonitor(client);
monitor.on("event", (event) => {
  // Update your analytics dashboard
  updateAnalytics(event);
});
```

### Query Recent Purchases

Fetch purchase history for a creator:

```typescript
// Get recent sales for a creator
const sales = await client.getCreatorSalesHistory("GCREATOR...", {
  limit: 100,
  since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
});

console.log(`Total sales: ${sales.total}`);
console.log(`Total revenue: ${sales.totalXLM} XLM`);

sales.items.forEach(sale => {
  console.log(`${sale.timestamp}: ${sale.buyerId} paid ${sale.priceXLM} XLM`);
});
```

---

## Security Best Practices for Integrations

### 1. Never Store Private Keys in Code

```typescript
// ❌ WRONG
const keypair = Keypair.fromSecret("S1234567890ABCDEF...");

// ✅ CORRECT
const keypair = Keypair.fromSecret(process.env.BUYER_SECRET_KEY!);
```

### 2. Validate Challenge Nonces

Always verify that a nonce hasn't been used before:

```typescript
const usedNonces = new Set<string>();

async function validateChallenge(nonce: string) {
  if (usedNonces.has(nonce)) {
    throw new Error("Nonce already used");
  }
  usedNonces.add(nonce);

  // Also check expiration
  const ageMs = Date.now() - extractTimestampFromNonce(nonce);
  if (ageMs > 5 * 60 * 1000) {
    throw new Error("Nonce expired");
  }
}
```

### 3. Rate Limit Unlock Requests

Protect your service from abuse:

```typescript
import rateLimit from "express-rate-limit";

const unlockLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  keyGenerator: (req) => req.query.wallet, // Rate limit by wallet
  message: "Too many unlock attempts. Please try again later.",
});

app.post("/unlock/:promptId", unlockLimiter, async (req, res) => {
  // Handle unlock...
});
```

### 4. Verify Content Hashes

Always re-compute and validate the content hash after decryption:

```typescript
import { createHash } from "crypto";

async function verifyDecryptedContent(plaintext: string, storedHash: string) {
  const computedHash = createHash("sha256").update(plaintext).digest("hex");
  
  if (computedHash !== storedHash) {
    throw new Error("Content integrity check failed!");
  }
  
  return true;
}
```

### 5. Use HTTPS for All Requests

```typescript
const client = new PromptHashClient({
  apiUrl: "https://api.prompthash.io", // Always HTTPS
  network: "mainnet",
});
```

---

## Troubleshooting Common Integration Issues

### Issue: "Signature Verification Failed"

**Causes:**
- Nonce has expired (> 5 minutes old)
- Nonce was already used
- Signature was computed with a different nonce
- Wallet address doesn't match the signer

**Solution:**
```typescript
// Request a fresh challenge
const challenge = await client.requestChallenge(promptId, wallet);
const signature = await wallet.signMessage(challenge.nonce);
// Use the fresh signature immediately
```

### Issue: "No License Found"

**Causes:**
- Purchase transaction hasn't been confirmed on-chain yet
- Wrong wallet address
- Purchase was for a different prompt

**Solution:**
```typescript
// Wait for transaction finality (10-15 seconds)
await new Promise(resolve => setTimeout(resolve, 15000));
const hasAccess = await client.hasLicense(promptId, buyerWallet);
```

### Issue: "Decryption Failed"

**Causes:**
- Content hash mismatch (content was tampered with)
- Encrypted payload is corrupted
- Wrong decryption key

**Solution:**
```typescript
try {
  const plaintext = await decryptContent(encryptedPayload, decryptionKey);
  await verifyDecryptedContent(plaintext, storedHash);
} catch (error) {
  console.error("Decryption or hash verification failed:", error);
  // Report to creators
  await client.reportContentIssue(promptId, "hash_mismatch");
}
```

---

## Production Deployment Checklist

- [ ] Use HTTPS for all API calls
- [ ] Store secrets in environment variables
- [ ] Implement rate limiting
- [ ] Add request logging and monitoring
- [ ] Set up error alerting
- [ ] Validate all user input
- [ ] Implement circuit breakers for API calls
- [ ] Use API key authentication where required
- [ ] Test with testnet first
- [ ] Review security audit checklist (docs/security-audit.md)
