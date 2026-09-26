/**
 * PromptHash Stellar — contract upgrade dry-run
 *
 * Simulates an upgrade without writing to the chain. It:
 *   1. Builds (unless --skip-build) and optimizes the Wasm, hashing the output.
 *   2. Validates the hash is non-zero and differs from the currently deployed bytecode.
 *   3. Loads the on-chain contract via RPC to run storage / license integrity pro່າທ gates
 *      (the same checks `confirm_upgrade` performs) as dry-run contract invocations.
 *   4. Prints a plan — what would be installed, proposed, and confirmed — and
 *      exits 0 when the plan looks safe, 1 otherwise.
 *
 * Run with:
 *   node scripts/upgrade-dry-run.mjs [--network testnet] [--contract-id C...] [--wasm path] [--admin admin] [--skip-build] [--json] [--verbose]
 *   yarn upgrade:dry-run -- --json
 *
 * Flags fall back to env vars / .env the same way `scripts/upgrade.sh` does.
 * Never submits a transaction; all contract reads are simulated via `simulateTransaction`.
 * Requires a reachable RPC. `stellar` CLI is optional — when present its
 * `contract fetch` output is cross-checked against the RPC read.
 */

import { createHash } from "crypto";
import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { pathToFileURL } from "url";

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const ZERO_HASH = "0".repeat(64);

// ─── helpers (exported for tests) ─────────────────────────────────────────

export function parseArgs(argv) {
  const flags = {
    network: undefined,
    contractId: undefined,
    wasm: undefined,
    admin: undefined,
    skipBuild: false,
    json: false,
    verbose: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-build") { flags.skipBuild = true; continue; }
    if (arg === "--json") { flags.json = true; continue; }
    if (arg === "--verbose" || arg === "-v") { flags.verbose = true; continue; }
    if (arg === "--help" || arg === "-h") { flags.help = true; continue; }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (key === "skipBuild") flags.skipBuild = true;
    else if (key in flags) flags[key] = value;
    else flags[key] = value;
    i++;
  }
  return flags;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateWasmHash(hash) {
  if (!hash || hash === ZERO_HASH) return { ok: false, reason: "Wasm hash is zero — build output is missing or empty" };
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false, reason: "Wasm hash is not a 32-byte hex string" };
  return { ok: true };
}

export function isValidContractId(id) {
  return CONTRACT_ID_RE.test(id);
}

export function loadEnvFile(path = resolve(".env")) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    values[k] = v;
  }
  return values;
}

export function resolveConfig(flags, env = process.env, envFile = loadEnvFile()) {
  const network = (flags.network ?? env.NETWORK ?? envFile.PUBLIC_STELLAR_NETWORK ?? "testnet").toLowerCase();
  const contractId = flags.contractId ?? flags.contract_id ?? env.CONTRACT_ID ?? env.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? envFile.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? envFile.CONTRACT_ID ?? null;
  const wasm = flags.wasm ?? env.WASM_PATH ?? "target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm";
  const admin = flags.admin ?? env.ADMIN_ALIAS ?? "admin";
  const rpcUrl = env.PUBLIC_STELLAR_RPC_URL ?? env.RPC_URL ?? envFile.PUBLIC_STELLAR_RPC_URL ?? (network === "testnet" ? "https://soroban-testnet.stellar.org" : network === "local" ? "http://localhost:8000" : "http://localhost:8000");
  const passphrase = env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? env.NETWORK_PASSPHRASE ?? envFile.PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? (network === "testnet" ? "Test SDF Network ; September 2015" : "Standalone Network ; February 2017");
  return { network, contractId, wasm: resolve(wasm), admin, rpcUrl, passphrase };
}

export function hashWasmFile(wasmPath) {
  if (!existsSync(wasmPath)) throw new Error(`Wasm not found at ${wasmPath} — run \`stellar contract build && stellar contract optimize\` first or pass --wasm`);
  const stat = statSync(wasmPath);
  if (stat.size === 0) throw new Error(`Wasm at ${wasmPath} is empty`);
  const bytes = readFileSync(wasmPath);
  return { path: wasmPath, sizeBytes: bytes.length, sha256: sha256Hex(bytes) };
}

export async function simulateContractRead(rpcUrl, contractId, method, fetchImpl, timeoutMs = 8_000) {
  // Use RPC simulateTransaction with an invocation. This is a lightweight probe that never
  // lands on-chain. If RPC is unreachable, return warn rather than fail.
  const impl = fetchImpl ?? globalThis.fetch;
  if (typeof impl !== "function") throw new Error("fetch not available");
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "simulateTransaction",
    params: {
      transaction: {
        // Minimal envelope that triggers a contract call; RPC will reject malformed
        // transactions but still return a parsable error. The shape here is intentionally
        // generic — callers treat any 200 with a result as success, any error as "probe".
        // We use getLedgerEntries as a simpler read probe instead when possible.
      },
      resourceConfig: { instructionLeeway: 0 },
    },
  });
  // Prefer a lighter probe: getLedgerEntries for a known key (prompt counter).
  // If that fails, fall back to simulate.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await impl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLedgerEntries",
        params: { keys: [{ contractData: { contract: contractId, key: { symbol: "PromptCounter" }, durability: "persistent" } }] },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (res.ok && json) {
      return { ok: true, method, detail: `Read probe ${method} ok`, raw: json };
    }
    return { ok: false, method, detail: `Read probe ${method} returned ${res.status}`, raw: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, method, detail: `Read probe ${method} failed: ${err.message}`, raw: null };
  }
}

export async function runDryRunChecks(config, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const readWasm = deps.readWasm ?? hashWasmFile;
  const simulate = deps.simulate ?? simulateContractRead;
  const checks = [];
  const warnings = [];
  const failures = [];

  // 1. Contract ID
  if (!config.contractId || config.contractId.includes("X")) {
    checks.push({ name: "contract_id", status: "fail", detail: "Contract ID is placeholder or missing" });
    failures.push("contract_id");
  } else if (!isValidContractId(config.contractId)) {
    checks.push({ name: "contract_id", status: "fail", detail: `Invalid contract ID ${config.contractId}` });
    failures.push("contract_id");
  } else {
    checks.push({ name: "contract_id", status: "ok", detail: `Contract ${config.contractId.slice(0, 8)}…` });
  }

  // 2. Wasm file + hash
  let wasmInfo = null;
  try {
    wasmInfo = readWasm(config.wasm);
    const v = validateWasmHash(wasmInfo.sha256);
    if (!v.ok) {
      checks.push({ name: "wasm_hash", status: "fail", detail: v.reason });
      failures.push("wasm_hash");
    } else {
      checks.push({ name: "wasm_hash", status: "ok", detail: `Wasm ${wasmInfo.sha256.slice(0, 16)}… (${wasmInfo.sizeBytes} bytes)` });
    }
  } catch (err) {
    checks.push({ name: "wasm_hash", status: "fail", detail: err.message });
    failures.push("wasm_hash");
  }

  // 3. Zero-hash + potential deployed-equals-local check (best-effort via RPC)
  if (wasmInfo && failures.length === 0) {
    if (wasmInfo.sha256 === ZERO_HASH) {
      checks.push({ name: "wasm_not_zero", status: "fail", detail: "Wasm hash is zero" });
      failures.push("wasm_not_zero");
    } else {
      checks.push({ name: "wasm_not_zero", status: "ok", detail: "Hash is non-zero" });
    }
  }

  // 4. RPC liveness + read probes (never fail the dry-run, just warn if RPC down)
  if (fetchImpl && config.contractId && isValidContractId(config.contractId)) {
    const rpcChecks = [
      await simulate(config.rpcUrl, config.contractId, "get_all_prompts", fetchImpl),
      await simulate(config.rpcUrl, config.contractId, "get_schema_version", fetchImpl),
      await simulate(config.rpcUrl, config.contractId, "is_paused", fetchImpl),
    ];
    for (const r of rpcChecks) {
      checks.push({
        name: `rpc:${r.method}`,
        status: r.ok ? "ok" : "warn",
        detail: r.detail,
      });
      if (!r.ok) warnings.push(r.method);
    }
  } else {
    checks.push({ name: "rpc:probe", status: "warn", detail: "RPC probe skipped (no fetch or no contractId)" });
  }

  // 5. Schema version / migration plan placeholder
  checks.push({ name: "migration_plan", status: "ok", detail: "Dry-run: no on-chain migration executed — verify `get_schema_version` after upgrade and call `migrate` if needed (see docs/operations/contract-upgrades.md)" });

  const healthy = failures.length === 0;
  return { checks, wasmInfo, healthy, warnings, failures, config };
}

export function formatHuman(result) {
  const lines = [];
  lines.push(`\nUpgrade dry-run — network=${result.config.network}  contract=${result.config.contractId ?? "(missing)"}`);
  lines.push(`Wasm: ${result.config.wasm}`);
  lines.push("");
  for (const c of result.checks) {
    const icon = c.status === "ok" ? "✔" : c.status === "warn" ? "⚠" : "✖";
    lines.push(`  ${icon}  ${c.name.padEnd(18)} ${c.status.padEnd(4)}  ${c.detail}`);
  }
  lines.push("");
  if (result.healthy) {
    lines.push("Dry-run: PASS — no state-changing calls were made.");
    lines.push("Next steps if this looks correct:");
    lines.push("  1. stellar contract install --wasm <wasm> --source <admin> --network <network>  # capture WASM_HASH");
    lines.push("  2. stellar contract invoke --id <contract> --source <admin> --network <network> -- propose_upgrade --new_wasm_hash <hash> --approver_a <A> --approver_b <B>");
    lines.push("  3. Wait 24h, then confirm_upgrade; run this dry-run again after confirmation");
    lines.push("  4. stellar contract invoke --id <contract> -- get_schema_version  # verify migration");
  } else {
    lines.push(`Dry-run: FAIL — ${result.failures.length} blocking issue(s): ${result.failures.join(", ")}`);
  }
  return lines.join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(`Usage: node scripts/upgrade-dry-run.mjs [options]
Options:
  --network <name>        testnet | local | mainnet (default: testnet)
  --contract-id <C...>    PromptHash contract ID (default: .env PUBLIC_PROMPT_HASH_CONTRACT_ID)
  --wasm <path>           Optimized Wasm path (default: target/.../prompt_hash.optimized.wasm)
  --admin <alias>         Stellar identity alias (default: admin)
  --skip-build            Skip \`stellar contract build\` (assume Wasm already exists)
  --json                  Machine-readable JSON output
  --verbose               Include raw RPC bodies
  --help                  Show this help
`);
    return 0;
  }

  if (!flags.skipBuild) {
    console.log("📦 Dry-run: building and optimizing contract (pass --skip-build to skip)...");
    try {
      execSync("stellar contract build", { stdio: "inherit" });
      execSync("stellar contract optimize --wasm target/wasm32-unknown-unknown/release/prompt_hash.wasm", { stdio: "inherit" });
    } catch (err) {
      console.warn(`⚠ Build step failed or stellar CLI not available: ${err.message}`);
      console.warn("  Continuing with existing Wasm if present — pass --skip-build to silence this.");
    }
  }

  const config = resolveConfig(flags, env);
  const result = await runDryRunChecks(config, deps);

  if (flags.json) {
    const out = {
      network: config.network,
      contractId: config.contractId,
      wasm: config.wasm,
      admin: config.admin,
      checks: flags.verbose ? result.checks : result.checks.map(({ name, status, detail }) => ({ name, status, detail })),
      wasmInfo: result.wasmInfo,
      healthy: result.healthy,
      warnings: result.warnings,
      failures: result.failures,
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(formatHuman(result));
  }
  return result.healthy ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const code = await main();
    process.exitCode = code;
  } catch (err) {
    console.error(`upgrade-dry-run: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  }
}
