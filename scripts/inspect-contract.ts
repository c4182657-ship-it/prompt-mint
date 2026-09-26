#!/usr/bin/env tsx
/**
 * PromptHash Contract State Inspection Tool
 *
 * Reads and pretty-prints live on-chain state for the PromptHash Soroban
 * contract. Useful for debugging, incident response, and pre/post-upgrade
 * validation without needing a full frontend environment.
 *
 * Usage:
 *   yarn inspect:contract [command] [options]
 *   npx tsx scripts/inspect-contract.ts [command] [options]
 *
 * Commands:
 *   config          Platform configuration (fees, wallet, pause status)
 *   prompts         All active prompt listings
 *   prompt <id>     Single prompt details
 *   price-history <id>   Price history for a prompt
 *   stake <id>      Stake record for a prompt
 *   upgrade         Pending upgrade state
 *   schema          Contract schema version
 *   full            Complete state snapshot (all of the above)
 *
 * Options:
 *   --network <testnet|mainnet|local>  Default: testnet
 *   --contract <CONTRACT_ID>           Default: from .env
 *   --source <alias>                   Stellar identity alias. Default: admin
 *   --prompt-id <id>                   Prompt ID for single-prompt commands
 *   --json                             Output raw JSON instead of pretty-print
 *
 * Examples:
 *   yarn inspect:contract config
 *   yarn inspect:contract prompts --network testnet
 *   yarn inspect:contract prompt --prompt-id 0
 *   yarn inspect:contract full --json > snapshot-$(date +%s).json
 *   yarn inspect:contract price-history --prompt-id 0
 *   yarn inspect:contract upgrade
 */

import { execSync, type SpawnSyncReturns } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const command = args.find((a) => !a.startsWith("--")) ?? "config";
const network = option("network") ?? "testnet";
const sourceAlias = option("source") ?? "admin";
const promptIdArg = option("prompt-id");
const jsonOutput = flag("json");

// ---------------------------------------------------------------------------
// Contract ID resolution
// ---------------------------------------------------------------------------

function loadEnv(envFile: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(envFile)) return out;
  const lines = readFileSync(envFile, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = value;
  }
  return out;
}

const repoRoot = resolve(import.meta.dirname ?? process.cwd(), "..");
const env = {
  ...loadEnv(resolve(repoRoot, ".env")),
  ...loadEnv(resolve(repoRoot, ".env.local")),
};

const contractId =
  option("contract") ??
  env["PUBLIC_PROMPT_HASH_CONTRACT_ID"] ??
  env["CONTRACT_ID"];

if (!contractId || contractId.startsWith("C") === false || contractId.length < 56) {
  console.error(
    "❌  CONTRACT_ID is not set or invalid.\n" +
      "    Set PUBLIC_PROMPT_HASH_CONTRACT_ID in .env, pass --contract <id>, or run deploy.sh first."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Stellar CLI invocation helper
// ---------------------------------------------------------------------------

function invoke(fn: string, ...fnArgs: string[]): string {
  const argStr = fnArgs.length > 0 ? " " + fnArgs.join(" ") : "";
  const cmd =
    `stellar contract invoke` +
    ` --id ${contractId}` +
    ` --source ${sourceAlias}` +
    ` --network ${network}` +
    ` -- ${fn}${argStr}`;

  try {
    const result = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return result.trim();
  } catch (err: unknown) {
    const spawnErr = err as SpawnSyncReturns<string>;
    const stderr = spawnErr.stderr?.toString() ?? String(err);
    throw new Error(`Contract call '${fn}' failed:\n${stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const STROOPS = 10_000_000;

function stroopsToXlm(stroops: number | string): string {
  const n = typeof stroops === "string" ? Number(stroops) : stroops;
  if (!Number.isFinite(n)) return String(stroops);
  const xlm = n / STROOPS;
  // Use Intl.NumberFormat with en-US pinned for script output (always ASCII)
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }).format(xlm);
}

function bpsToPercent(bps: number | string): string {
  const n = typeof bps === "string" ? Number(bps) : bps;
  if (!Number.isFinite(n)) return String(bps);
  return `${(n / 100).toFixed(2)}%`;
}

function header(title: string) {
  if (jsonOutput) return;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function kv(label: string, value: string) {
  if (jsonOutput) return;
  console.log(`  ${label.padEnd(28)} ${value}`);
}

function raw(value: unknown) {
  if (jsonOutput) return;
  console.log(JSON.stringify(value, null, 2));
}

// ---------------------------------------------------------------------------
// Individual inspection functions
// ---------------------------------------------------------------------------

function inspectConfig(): Record<string, unknown> {
  const feeBps = invoke("get_fee_percentage");
  const feeWallet = invoke("get_fee_wallet");
  const xlmSac = invoke("get_xlm_sac");
  const paused = invoke("is_paused");
  const referralBps = invoke("get_referral_percentage");
  const priceBounds = invoke("get_price_bounds");
  const schemaVersion = invoke("get_schema_version");

  const data = {
    fee_bps: feeBps,
    fee_percent: bpsToPercent(feeBps),
    fee_wallet: feeWallet,
    xlm_sac: xlmSac,
    is_paused: paused,
    referral_bps: referralBps,
    referral_percent: bpsToPercent(referralBps),
    price_bounds: priceBounds,
    schema_version: schemaVersion,
  };

  if (!jsonOutput) {
    header("Platform Configuration");
    kv("Network:", network);
    kv("Contract ID:", contractId);
    kv("Schema Version:", schemaVersion);
    kv("Fee (BPS):", feeBps);
    kv("Fee (%):", bpsToPercent(feeBps));
    kv("Fee Wallet:", feeWallet);
    kv("XLM SAC:", xlmSac);
    kv("Is Paused:", paused);
    kv("Referral (BPS):", referralBps);
    kv("Referral (%):", bpsToPercent(referralBps));
    kv("Price Bounds:", priceBounds);
  }

  return data;
}

function inspectPrompts(): Record<string, unknown> {
  const raw_ = invoke("get_all_prompts");
  let prompts: unknown[];
  try {
    prompts = JSON.parse(raw_) as unknown[];
  } catch {
    prompts = [{ raw: raw_ }];
  }

  if (!jsonOutput) {
    header(`All Prompts (${prompts.length} total)`);
    for (const p of prompts as Array<Record<string, unknown>>) {
      console.log(`\n  ── Prompt #${p["id"] ?? "?"} ──`);
      kv("Title:", String(p["title"] ?? "-"));
      kv("Category:", String(p["category"] ?? "-"));
      kv("Price (stroops):", String(p["price_stroops"] ?? "-"));
      kv("Price (XLM):", stroopsToXlm(String(p["price_stroops"] ?? 0)));
      kv("Active:", String(p["active"] ?? "-"));
      kv("Sales:", String(p["sales_count"] ?? "0"));
      kv("Max Supply:", String(p["max_supply"] ?? "0 (unlimited)"));
      kv("Creator:", String(p["creator"] ?? "-"));
      kv("Enc. Version:", String(p["encryption_version"] ?? "-"));
      kv("Classification:", String(p["classification"] ?? "-"));
    }
  }

  return { count: prompts.length, prompts };
}

function inspectPrompt(promptId: string): Record<string, unknown> {
  const raw_ = invoke("get_prompt", `--prompt_id ${promptId}`);
  let prompt: Record<string, unknown>;
  try {
    prompt = JSON.parse(raw_) as Record<string, unknown>;
  } catch {
    prompt = { raw: raw_ };
  }

  if (!jsonOutput) {
    header(`Prompt #${promptId}`);
    kv("Title:", String(prompt["title"] ?? "-"));
    kv("Category:", String(prompt["category"] ?? "-"));
    kv("Price (stroops):", String(prompt["price_stroops"] ?? "-"));
    kv("Price (XLM):", stroopsToXlm(String(prompt["price_stroops"] ?? 0)));
    kv("Active:", String(prompt["active"] ?? "-"));
    kv("Sales:", String(prompt["sales_count"] ?? "0"));
    kv("Max Supply:", String(prompt["max_supply"] ?? "0 (unlimited)"));
    kv("Expires At:", String(prompt["expires_at"] ?? "0 (never)"));
    kv("Creator:", String(prompt["creator"] ?? "-"));
    kv("Classification:", String(prompt["classification"] ?? "-"));
    kv("Safety Flags:", JSON.stringify(prompt["safety_flags"] ?? []));
    kv("Enc. Version:", String(prompt["encryption_version"] ?? "-"));
  }

  return prompt;
}

function inspectPriceHistory(promptId: string): Record<string, unknown> {
  const raw_ = invoke("get_price_history", `--prompt_id ${promptId}`);
  let history: unknown[];
  try {
    history = JSON.parse(raw_) as unknown[];
  } catch {
    history = [{ raw: raw_ }];
  }

  if (!jsonOutput) {
    header(`Price History for Prompt #${promptId} (${history.length} entries)`);
    for (const entry of history as Array<Record<string, unknown>>) {
      const seq = entry["seq"] ?? "?";
      const prev = stroopsToXlm(String(entry["previous_price"] ?? 0));
      const next = stroopsToXlm(String(entry["new_price"] ?? 0));
      const ts = new Date(Number(entry["changed_at"] ?? 0) * 1000).toISOString();
      console.log(`  [${seq}] ${prev} XLM → ${next} XLM  at ${ts}`);
    }
  }

  return { prompt_id: promptId, count: history.length, history };
}

function inspectStake(promptId: string): Record<string, unknown> {
  let raw_: string;
  try {
    raw_ = invoke("get_stake", `--prompt_id ${promptId}`);
  } catch {
    if (!jsonOutput) console.log(`  No stake found for prompt #${promptId}`);
    return { prompt_id: promptId, stake: null };
  }

  let stake: Record<string, unknown>;
  try {
    stake = JSON.parse(raw_) as Record<string, unknown>;
  } catch {
    stake = { raw: raw_ };
  }

  if (!jsonOutput) {
    header(`Stake for Prompt #${promptId}`);
    kv("Creator:", String(stake["creator"] ?? "-"));
    kv("Amount (stroops):", String(stake["amount"] ?? "-"));
    kv("Amount (XLM):", stroopsToXlm(String(stake["amount"] ?? 0)));
    kv("Staked At:", new Date(Number(stake["staked_at"] ?? 0) * 1000).toISOString());
  }

  return { prompt_id: promptId, stake };
}

function inspectUpgrade(): Record<string, unknown> {
  const pending = invoke("get_pending_upgrade");

  if (!jsonOutput) {
    header("Pending Upgrade State");
    if (pending === "null" || pending === "" || pending === "None") {
      kv("Pending Upgrade:", "None — no upgrade in progress");
    } else {
      kv("Pending WASM Hash:", pending);
      console.log(
        "\n  ⚠️  An upgrade is pending. Run `confirm_upgrade` or `cancel_upgrade`."
      );
    }
  }

  return { pending_upgrade: pending };
}

function inspectSchema(): Record<string, unknown> {
  const version = invoke("get_schema_version");

  if (!jsonOutput) {
    header("Contract Schema Version");
    kv("Schema Version:", version);
  }

  return { schema_version: version };
}

// ---------------------------------------------------------------------------
// Full snapshot
// ---------------------------------------------------------------------------

async function runFull(): Promise<void> {
  const snapshot: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    network,
    contract_id: contractId,
  };

  try { snapshot["config"] = inspectConfig(); } catch (e) { snapshot["config"] = { error: String(e) }; }
  try { snapshot["prompts"] = inspectPrompts(); } catch (e) { snapshot["prompts"] = { error: String(e) }; }
  try { snapshot["upgrade"] = inspectUpgrade(); } catch (e) { snapshot["upgrade"] = { error: String(e) }; }
  try { snapshot["schema"] = inspectSchema(); } catch (e) { snapshot["schema"] = { error: String(e) }; }

  if (jsonOutput) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log("\n✅  Full snapshot complete.");
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

(async () => {
  console.log(`🔭  PromptHash Contract Inspector`);
  console.log(`    Network: ${network}  |  Contract: ${contractId}`);

  try {
    switch (command) {
      case "config":
        inspectConfig();
        break;

      case "prompts":
        inspectPrompts();
        break;

      case "prompt": {
        const id = promptIdArg ?? "0";
        inspectPrompt(id);
        break;
      }

      case "price-history": {
        const id = promptIdArg ?? "0";
        inspectPriceHistory(id);
        break;
      }

      case "stake": {
        const id = promptIdArg ?? "0";
        inspectStake(id);
        break;
      }

      case "upgrade":
        inspectUpgrade();
        break;

      case "schema":
        inspectSchema();
        break;

      case "full":
        await runFull();
        break;

      default:
        console.error(`❌  Unknown command: ${command}`);
        console.error(
          "    Available: config | prompts | prompt | price-history | stake | upgrade | schema | full"
        );
        process.exit(1);
    }

    if (jsonOutput && command !== "full") {
      // For single commands with --json, we need to re-run and capture output
      // Individual functions already print JSON when jsonOutput is true, so
      // the output is already on stdout.
    }
  } catch (err: unknown) {
    console.error(`\n❌  ${String(err)}`);
    console.error(
      "\n  Troubleshooting:\n" +
        "  • Check that the Stellar CLI is installed: stellar --version\n" +
        "  • Check that the contract is deployed: yarn inspect:contract config\n" +
        `  • Verify the identity alias '${sourceAlias}' exists: stellar keys address ${sourceAlias}\n` +
        "  • See docs/operations/deployment-runbook.md for contract setup steps."
    );
    process.exit(1);
  }
})();
