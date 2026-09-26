import { ContractEventConsumer } from "./consumer.js";
import type {
  PromptCreatedEvent,
  PromptPurchasedEvent,
  PromptPriceUpdatedEvent,
  PromptSaleStatusUpdatedEvent,
  LicenseTransferredEvent,
} from "./types.js";

const RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID =
  process.env.PROMPT_MINT_CONTRACT_ID || "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const START_LEDGER = process.env.START_LEDGER ? parseInt(process.env.START_LEDGER, 10) : undefined;
const CHECKPOINT_FILE = process.env.CHECKPOINT_FILE || "./.consumer-checkpoint.json";
const POLL_INTERVAL = process.env.POLL_INTERVAL_MS
  ? parseInt(process.env.POLL_INTERVAL_MS, 10)
  : 3000;

console.log("==================================================");
console.log(" PromptMint Contract Event Consumer Service");
console.log("==================================================");
console.log(`RPC URL:         ${RPC_URL}`);
console.log(`Contract ID:     ${CONTRACT_ID}`);
console.log(`Checkpoint Path: ${CHECKPOINT_FILE}`);
console.log(`Poll Interval:   ${POLL_INTERVAL}ms`);
console.log("==================================================\n");

const consumer = new ContractEventConsumer({
  rpcUrl: RPC_URL,
  contractId: CONTRACT_ID,
  startLedger: START_LEDGER,
  checkpointFile: CHECKPOINT_FILE,
  pollIntervalMs: POLL_INTERVAL,
});

// Event Handler: PromptCreated
consumer.on("PromptCreated", async (event: PromptCreatedEvent) => {
  console.log(`[EVENT] PromptCreated | Ledger ${event.ledger}`);
  console.log(`  - Prompt ID:     ${event.promptId}`);
  console.log(`  - Creator:       ${event.creator}`);
  console.log(`  - Price:         ${Number(event.priceStroops) / 1e7} XLM (${event.priceStroops} stroops)`);
  console.log(`  - Asset:         ${event.asset || "Native"}`);
  console.log(`  - Tx:            ${event.txHash}\n`);
});

// Event Handler: PromptPurchased
consumer.on("PromptPurchased", async (event: PromptPurchasedEvent) => {
  console.log(`[EVENT] PromptPurchased | Ledger ${event.ledger}`);
  console.log(`  - Prompt ID:     ${event.promptId}`);
  console.log(`  - Buyer:         ${event.buyer}`);
  console.log(`  - Creator:       ${event.creator}`);
  console.log(`  - Creator Pay:   ${Number(event.creatorAmount) / 1e7} XLM`);
  console.log(`  - Platform Fee:  ${Number(event.platformAmount) / 1e7} XLM`);
  if (event.referrer) {
    console.log(`  - Referrer:      ${event.referrer} (${Number(event.referrerAmount) / 1e7} XLM)`);
  }
  console.log(`  - Tx:            ${event.txHash}\n`);
});

// Event Handler: PromptPriceUpdated
consumer.on("PromptPriceUpdated", async (event: PromptPriceUpdatedEvent) => {
  console.log(`[EVENT] PromptPriceUpdated | Ledger ${event.ledger}`);
  console.log(`  - Prompt ID:     ${event.promptId}`);
  console.log(`  - Old Price:     ${Number(event.previousPrice) / 1e7} XLM`);
  console.log(`  - New Price:     ${Number(event.priceStroops) / 1e7} XLM\n`);
});

// Event Handler: PromptSaleStatusUpdated
consumer.on("PromptSaleStatusUpdated", async (event: PromptSaleStatusUpdatedEvent) => {
  console.log(`[EVENT] PromptSaleStatusUpdated | Ledger ${event.ledger}`);
  console.log(`  - Prompt ID:     ${event.promptId}`);
  console.log(`  - Active:        ${event.active ? "YES (Listed)" : "NO (Delisted)"}\n`);
});

// Event Handler: LicenseTransferred
consumer.on("LicenseTransferred", async (event: LicenseTransferredEvent) => {
  console.log(`[EVENT] LicenseTransferred | Ledger ${event.ledger}`);
  console.log(`  - Prompt ID:     ${event.promptId}`);
  console.log(`  - Seller:        ${event.seller}`);
  console.log(`  - Buyer:         ${event.buyer}`);
  console.log(`  - Resale Price:  ${Number(event.resalePrice) / 1e7} XLM`);
  console.log(`  - Creator Royalty: ${Number(event.royaltyAmount) / 1e7} XLM\n`);
});

// Error handling
consumer.onError((err: Error) => {
  console.error(`[CONSUMER ERROR] ${err.message}`);
});

// Start consumer
async function main() {
  await consumer.start();
  console.log(`Consumer started at ledger: ${consumer.getCurrentLedger()}. Waiting for events...`);
}

// Graceful termination
const shutdown = () => {
  console.log("\nReceived shutdown signal. Stopping event consumer...");
  consumer.stop();
  console.log("Consumer stopped cleanly.");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("Fatal consumer initialization error:", err);
  process.exit(1);
});
