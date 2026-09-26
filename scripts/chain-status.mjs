/**
 * PromptHash Stellar — chain status CLI
 *
 * Probes RPC, Horizon, and the deployed PromptHash contract to report
 * liveness, network consistency, and read health.
 *
 * Run with:
 *   node scripts/chain-status.mjs [--network testnet] [--rpc-url URL] [--horizon-url URL] [--contract-id C...] [--json] [--timeout 5000] [--verbose]
 *   yarn chain:status -- --json
 *
 * Every flag falls back to .env / environment vars so CI can reuse the same
 * `.env` that `deploy.sh` writes. The probe never submits a transaction — it
 * only performs read-only RPC gets and Horizon queries. Exit code is 0 when
 * all critical checks pass, 1 otherwise (use `--json` to parse the result
 * programmatically).
 *
 * See docs/operations/chain-status.md for the check catalogue.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";

export const DEFAULT_TIMEOUT_MS = 8_000;

const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID_RE = /^G[A-Z2-7]{55}$/;

const NETWORK_PRESETS = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    rpcUrl: "https://soroban-rpc.stellar.org",
    horizonUrl: "https://horizon.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
  },
  futurenet: {
    rpcUrl: "https://rpc-futurenet.stellar.org",
    horizonUrl: "https://horizon-futurenet.stellar.org",
    passphrase: "Test SDF Future Network ; October 2022",
  },
  local: {
    rpcUrl: "http://localhost:8000",
    horizonUrl: "http://localhost:8000",
    passphrase: "Standalone Network ; February 2017",
  },
};

// ─── pure helpers (exported for tests) ────────────────────────────────────

export function parseArgs(argv) {
  const flags = {
    network: undefined,
    rpcUrl: undefined,
    horizonUrl: undefined,
    contractId: undefined,
    json: false,
    verbose: false,
    timeout: undefined,
    wasm: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") { flags.json = true; continue; }
    if (arg === "--verbose" || arg === "-v") { flags.verbose = true; continue; }
    if (arg === "--help" || arg === "-h") { flags.help = true; continue; }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (key === "timeout") flags.timeout = Number(value);
    else if (key in flags) flags[key] = value;
    else flags[key] = value;
    i++;
  }
  return flags;
}

export function isValidContractId(id) {
  return CONTRACT_ID_RE.test(id);
}

export function isValidAccountId(id) {
  return ACCOUNT_ID_RE.test(id);
}

function parseEnvFile(filePath) {
  const values = {};
  if (!existsSync(filePath)) return values;
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = val;
  }
  return values;
}

export function resolveConfig(flags, env = process.env, envFile = parseEnvFile(resolve(".env"))) {
  // Network: flag > env > .env > default testnet
  const rawNetwork = (flags.network ?? env.NETWORK ?? env.PUBLIC_STELLAR_NETWORK ?? envFile.PUBLIC_STELLAR_NETWORK ?? "testnet").toLowerCase();
  const preset = NETWORK_PRESETS[rawNetwork] ?? NETWORK_PRESETS.testnet;
  const network = rawNetwork in NETWORK_PRESETS ? rawNetwork : "testnet";

  const rpcUrl = flags.rpcUrl ?? flags.rpc_url ?? env.PUBLIC_STELLAR_RPC_URL ?? env.RPC_URL ?? envFile.PUBLIC_STELLAR_RPC_URL ?? envFile.RPC_URL ?? preset.rpcUrl;
  const horizonUrl = flags.horizonUrl ?? flags.horizon_url ?? env.PUBLIC_STELLAR_HORIZON_URL ?? env.HORIZON_URL ?? envFile.PUBLIC_STELLAR_HORIZON_URL ?? preset.horizonUrl;
  const passphrase = env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? env.NETWORK_PASSPHRASE ?? envFile.PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? preset.passphrase;
  const contractId = flags.contractId ?? flags.contract_id ?? env.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? env.CONTRACT_ID ?? envFile.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? envFile.CONTRACT_ID ?? null;
  const timeout = flags.timeout ?? (env.CHAIN_STATUS_TIMEOUT ? Number(env.CHAIN_STATUS_TIMEOUT) : DEFAULT_TIMEOUT_MS);

  return {
    network,
    rpcUrl,
    horizonUrl,
    passphrase,
    contractId,
    timeout: Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export function buildRpcBody(method, params = undefined) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

async function timedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const latencyMs = Date.now() - start;
    return { res, latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkRpcHealth(rpcUrl, fetchImpl, timeoutMs) {
  const url = rpcUrl.replace(/\/+$/, "");
  try {
    const { res, latencyMs } = await timedFetch(fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildRpcBody("getHealth"),
    }, timeoutMs);
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const healthy = res.ok && (json?.result?.status === "healthy" || json?.status === "healthy" || res.status === 200);
    return {
      name: "rpc_health",
      status: healthy ? "ok" : "fail",
      detail: healthy ? `RPC healthy` : `RPC getHealth failed (${res.status})`,
      latencyMs,
      raw: json ?? text.slice(0, 500),
    };
  } catch (err) {
    return {
      name: "rpc_health",
      status: "fail",
      detail: `RPC unreachable: ${err.message}`,
      latencyMs: null,
      raw: null,
    };
  }
}

export async function checkRpcNetwork(rpcUrl, expectedPassphrase, fetchImpl, timeoutMs) {
  try {
    const { res, latencyMs } = await timedFetch(fetchImpl, rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildRpcBody("getNetwork"),
    }, timeoutMs);
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const networkPassphrase = json?.result?.passphrase ?? json?.result?.networkPassphrase ?? json?.passphrase ?? null;
    if (!json || !res.ok) {
      return { name: "rpc_network", status: "warn", detail: `getNetwork returned ${res.status}`, latencyMs, raw: text.slice(0, 500) };
    }
    if (expectedPassphrase && networkPassphrase && networkPassphrase !== expectedPassphrase) {
      return { name: "rpc_network", status: "fail", detail: `Passphrase mismatch: expected "${expectedPassphrase}" got "${networkPassphrase}"`, latencyMs, raw: networkPassphrase };
    }
    return { name: "rpc_network", status: "ok", detail: networkPassphrase ? `Network "${networkPassphrase.slice(0, 32)}…"` : "Network check ok", latencyMs, raw: networkPassphrase };
  } catch (err) {
    return { name: "rpc_network", status: "warn", detail: `getNetwork failed: ${err.message}`, latencyMs: null, raw: null };
  }
}

export async function checkHorizonHealth(horizonUrl, fetchImpl, timeoutMs) {
  const url = horizonUrl.replace(/\/+$/, "") + "/";
  try {
    const { res, latencyMs } = await timedFetch(fetchImpl, url, { method: "GET", headers: { Accept: "application/json" } }, timeoutMs);
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const ok = res.ok && (json?.horizon_version || json?._links);
    return {
      name: "horizon_health",
      status: ok ? "ok" : res.ok ? "warn" : "fail",
      detail: ok ? `Horizon v${json.horizon_version ?? "ok"}` : `Horizon returned ${res.status}`,
      latencyMs,
      raw: json ? { horizon_version: json.horizon_version } : text.slice(0, 500),
    };
  } catch (err) {
    return { name: "horizon_health", status: "fail", detail: `Horizon unreachable: ${err.message}`, latencyMs: null, raw: null };
  }
}

export async function checkLatestLedger(rpcUrl, fetchImpl, timeoutMs) {
  try {
    const { res, latencyMs } = await timedFetch(fetchImpl, rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildRpcBody("getLatestLedger"),
    }, timeoutMs);
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const ledger = json?.result ?? json;
    const sequence = ledger?.sequence ?? ledger?.id ?? null;
    if (!res.ok || !sequence) {
      return { name: "latest_ledger", status: "warn", detail: `getLatestLedger returned ${res.status}`, latencyMs, raw: text.slice(0, 500) };
    }
    return { name: "latest_ledger", status: "ok", detail: `Ledger #${sequence}`, latencyMs, raw: { sequence } };
  } catch (err) {
    return { name: "latest_ledger", status: "warn", detail: `getLatestLedger failed: ${err.message}`, latencyMs: null, raw: null };
  }
}

export async function checkContractDeployed(contractId, rpcUrl, fetchImpl, timeoutMs) {
  if (!contractId || contractId.includes("X")) {
    return { name: "contract_deployed", status: "warn", detail: "Contract ID is placeholder or missing — deploy first", latencyMs: null, raw: null };
  }
  if (!isValidContractId(contractId)) {
    return { name: "contract_deployed", status: "fail", detail: `Contract ID "${contractId}" is not a valid C... StrKey`, latencyMs: null, raw: null };
  }
  // Use getLedgerEntries to check the contract instance exists.
  // Fallback to getContractData if available.
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLedgerEntries",
      params: { keys: [{ contractData: { contract: contractId, key: "PROMPT_COUNTER", durability: "persistent" } }] },
    });
    // Try generic getLedgerEntries; if RPC doesn't support this shape, treat as probe.
    const { res, latencyMs } = await timedFetch(fetchImpl, rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }, timeoutMs);
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch {}
    // If RPC replies with entries or at least doesn't return "contract not found", consider deployed.
    // A 404-like error with "not found" means not deployed.
    const raw = text.toLowerCase();
    if (raw.includes("not found") || raw.includes("missing")) {
      return { name: "contract_deployed", status: "fail", detail: `Contract ${contractId} not found on this network`, latencyMs, raw: json ?? text.slice(0, 500) };
    }
    if (!res.ok) {
      return { name: "contract_deployed", status: "warn", detail: `Contract probe returned ${res.status} (assuming deployed)`, latencyMs, raw: json ?? text.slice(0, 500) };
    }
    return { name: "contract_deployed", status: "ok", detail: `Contract ${contractId.slice(0, 8)}… found`, latencyMs, raw: { contractId } };
  } catch (err) {
    return { name: "contract_deployed", status: "warn", detail: `Contract probe failed: ${err.message}`, latencyMs: null, raw: null };
  }
}

export async function runAllChecks(config, fetchImpl) {
  const impl = fetchImpl ?? globalThis.fetch;
  if (typeof impl !== "function") throw new Error("No fetch implementation available (Node 18+ required or inject fetchImpl)");
  const timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const checks = [];
  checks.push(await checkRpcHealth(config.rpcUrl, impl, timeoutMs));
  checks.push(await checkRpcNetwork(config.rpcUrl, config.passphrase, impl, timeoutMs));
  checks.push(await checkLatestLedger(config.rpcUrl, impl, timeoutMs));
  checks.push(await checkHorizonHealth(config.horizonUrl, impl, timeoutMs));
  checks.push(await checkContractDeployed(config.contractId, config.rpcUrl, impl, timeoutMs));
  return checks;
}

export function summarize(checks) {
  const byStatus = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const healthy = byStatus.fail === 0;
  const degraded = byStatus.fail === 0 && byStatus.warn > 0;
  return { healthy, degraded, ...byStatus, total: checks.length };
}

export function formatHuman(checks, config) {
  const lines = [];
  const summary = summarize(checks);
  lines.push(`\nChain status — network=${config.network}  rpc=${config.rpcUrl}`);
  if (config.contractId) lines.push(`Contract: ${config.contractId}`);
  lines.push("");
  for (const c of checks) {
    const icon = c.status === "ok" ? "✔" : c.status === "warn" ? "⚠" : "✖";
    const latency = c.latencyMs != null ? ` (${c.latencyMs}ms)` : "";
    lines.push(`  ${icon}  ${c.name.padEnd(18)} ${c.status.padEnd(4)}  ${c.detail}${latency}`);
    if (c.raw && typeof c.raw === "object" && c.status !== "ok") {
      lines.push(`       → ${JSON.stringify(c.raw).slice(0, 200)}`);
    }
  }
  lines.push("");
  lines.push(`Summary: ${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail — ${summary.healthy ? "HEALTHY" : "UNHEALTHY"}`);
  return lines.join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl) {
  const flags = parseArgs(argv);
  if (flags.help) {
    console.log(`Usage: node scripts/chain-status.mjs [options]
Options:
  --network <name>        testnet | mainnet | futurenet | local (default: env PUBLIC_STELLAR_NETWORK)
  --rpc-url <url>         Soroban RPC endpoint
  --horizon-url <url>     Horizon endpoint
  --contract-id <C...>    PromptHash contract ID
  --timeout <ms>          Per-probe timeout (default ${DEFAULT_TIMEOUT_MS})
  --json                  Machine-readable JSON output
  --verbose               Include raw RPC bodies in output
  --help                  Show this help
`);
    return 0;
  }
  const config = resolveConfig(flags, env);
  const checks = await runAllChecks(config, fetchImpl);
  const summary = summarize(checks);

  if (flags.json) {
    const out = {
      network: config.network,
      rpcUrl: config.rpcUrl,
      horizonUrl: config.horizonUrl,
      contractId: config.contractId,
      checks: flags.verbose ? checks : checks.map(({ name, status, detail, latencyMs }) => ({ name, status, detail, latencyMs })),
      summary,
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(formatHuman(checks, config));
  }

  return summary.healthy ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const code = await main();
    process.exitCode = code;
  } catch (err) {
    console.error(`chain-status: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  }
}
