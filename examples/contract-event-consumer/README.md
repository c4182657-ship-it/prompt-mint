# Soroban Contract Event Consumer Example

This example demonstrates how to build a reliable off-chain event indexing service that consumes events emitted by PromptMint Soroban smart contracts on Stellar.

## Overview

PromptMint contracts emit events for lifecycle actions such as prompt publishing, purchases, secondary sales, fee distributions, and parameter updates. This service:

1. Connects to a Soroban RPC node via JSON-RPC `getEvents`.
2. Decodes XDR-encoded topics and `ScVal` payloads into typed JavaScript objects using `@stellar/stellar-sdk`.
3. Dispatches events to type-safe handlers.
4. Maintains ledger checkpoints to ensure uninterrupted processing across service restarts.
5. Deduplicates events by event ID to prevent double-processing.

## Supported Events

| Event Topic | Description | Payload Attributes |
|-------------|-------------|--------------------|
| `PromptCreated` | Emitted when a new prompt is registered | `promptId`, `creator`, `priceStroops`, `asset` |
| `PromptPurchased` | Emitted when a license is acquired | `promptId`, `buyer`, `creator`, `priceStroops`, `creatorAmount`, `platformAmount`, `referrerAmount` |
| `PromptPriceUpdated` | Emitted when a creator adjusts listing price | `promptId`, `previousPrice`, `priceStroops` |
| `PromptSaleStatusUpdated` | Emitted when a listing is activated or paused | `promptId`, `active` |
| `LicenseTransferred` | Emitted when a license is resold | `promptId`, `seller`, `buyer`, `resalePrice`, `royaltyAmount` |
| `ReferralRewardPaid` | Emitted when an affiliate referral bonus is paid | `promptId`, `referrer`, `buyer`, `rewardAmount` |
| `ContractPausedStateChanged`| Emitted when emergency stop status is toggled | `isPaused` |

## Project Structure

```
examples/contract-event-consumer/
├── package.json        # Dependencies and build scripts
├── tsconfig.json       # TypeScript configuration
├── README.md           # Documentation and usage guide
└── src/
    ├── types.ts        # Event schemas and configuration interfaces
    ├── parser.ts       # XDR decoding and event normalization
    ├── consumer.ts     # Polling engine, checkpointing, and dispatcher
    └── index.ts        # Example CLI service entry point
```

## Getting Started

### 1. Environment Configuration

Copy or set the environment variables:

```bash
# Soroban RPC endpoint
export SOROBAN_RPC_URL="https://soroban-testnet.stellar.org"

# Deployed PromptMint Contract ID
export PROMPT_MINT_CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"

# Optional: Starting ledger sequence (defaults to latest ledger)
export START_LEDGER=123456

# Optional: Checkpoint file path
export CHECKPOINT_FILE="./.consumer-checkpoint.json"

# Optional: Polling frequency in milliseconds
export POLL_INTERVAL_MS=3000
```

### 2. Run the Consumer

From the repository root:

```bash
# Run with tsx
npx tsx examples/contract-event-consumer/src/index.ts
```

Or from the example directory:

```bash
cd examples/contract-event-consumer
yarn build
yarn start
```

## Programmatic Usage

You can embed the consumer directly into your application or microservice:

```typescript
import { ContractEventConsumer } from "./consumer.js";

const consumer = new ContractEventConsumer({
  rpcUrl: "https://soroban-testnet.stellar.org",
  contractId: "C...",
  checkpointFile: "./.consumer-checkpoint.json",
  pollIntervalMs: 2500,
});

// Register typed listeners
consumer.on("PromptCreated", async (event) => {
  await database.prompts.create({
    id: event.promptId,
    creator: event.creator,
    price: event.priceStroops,
  });
});

consumer.on("PromptPurchased", async (event) => {
  await sendPurchaseEmailNotification(event.buyer, event.promptId);
});

// Start processing
await consumer.start();

// Graceful stop
process.on("SIGINT", () => {
  consumer.stop();
});
```

## Testing

Unit tests for the event parser and consumer logic are located in `src/test/eventConsumer.test.ts`. Run them with:

```bash
yarn test:frontend src/test/eventConsumer.test.ts
```
