/**
 * PromptHash Stellar — deploy manifest generator / verifier
 *
 * Records what was deployed (contract ID, network, admin + fee addresses) next
 * to the SHA-256 of every artifact that produced it, so anyone can later check
 * that a live contract and a release build came from the same bytes.
 *
 * A Soroban contract's on-chain Wasm hash is the SHA-256 of the uploaded Wasm,
 * so `contracts.<name>.wasm.sha256` can be compared directly with
 * `stellar contract info` / `stellar contract fetch` output.
 *
 * Usage:
 *   node scripts/deploy-manifest.mjs generate --network testnet \
 *     --contract-id C... --wasm target/.../prompt_hash.optimized.wasm \
 *     [--admin G... --admin-two G... --admin-three G... --fee-wallet G... \
 *      --xlm-sac C... --rpc-url URL --passphrase "..." \
 *      --artifact path ... --out deployments/testnet.json]
 *   node scripts/deploy-manifest.mjs verify --manifest deployments/testnet.json [--root DIR]
 *   node scripts/deploy-manifest.mjs badge  --manifest deployments/testnet.json [--root DIR] [--out FILE]
 *
 * Every flag also falls back to the env var deploy.sh already exports
 * (CONTRACT_ID, ADMIN_ADDRESS, FEE_WALLET_ADDRESS, XLM_SAC, RPC_URL, ...).
 * See docs/deploy-manifest.md.
 */

import { createHash } from "crypto";
import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import { pathToFileURL } from "url";

export const MANIFEST_SCHEMA_VERSION = 1;

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const ACCOUNT_ID = /^G[A-Z2-7]{55}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;

const ADDRESS_FIELDS = {
  admin: ACCOUNT_ID,
  adminTwo: ACCOUNT_ID,
  adminThree: ACCOUNT_ID,
  feeWallet: ACCOUNT_ID,
  xlmSac: CONTRACT_ID,
};

// ─── pure helpers (exported for tests) ──────────────────────────────────────

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash a file on disk into a manifest artifact entry. */
export function describeArtifact(filePath, root = process.cwd()) {
  const bytes = readFileSync(filePath);
  return {
    path: relative(root, resolve(filePath)).split("\\").join("/"),
    sha256: sha256Hex(bytes),
    sizeBytes: bytes.length,
  };
}

/**
 * Build a manifest object. Artifact entries must already be hashed
 * (see describeArtifact) so this stays deterministic and testable.
 */
export function buildManifest({
  network,
  contractName = "prompt_hash",
  contractId = null,
  wasm,
  addresses = {},
  artifacts = [],
  source = {},
  generatedAt = new Date().toISOString(),
}) {
  const cleanAddresses = Object.fromEntries(
    Object.entries(addresses).filter(([, value]) => Boolean(value)),
  );

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt,
    network: {
      name: network.name,
      passphrase: network.passphrase ?? null,
      rpcUrl: network.rpcUrl ?? null,
    },
    source: {
      repository: source.repository ?? null,
      commit: source.commit ?? null,
      ref: source.ref ?? null,
      workflowRunId: source.workflowRunId ?? null,
    },
    contracts: {
      [contractName]: {
        contractId,
        wasm,
      },
    },
    addresses: cleanAddresses,
    artifacts,
  };
}

/** Returns a list of human-readable problems; empty means the manifest is well formed. */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object")
    return ["manifest is not an object"];

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (!manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) {
    errors.push("generatedAt must be an ISO-8601 timestamp");
  }
  if (!manifest.network?.name) errors.push("network.name is required");

  const commit = manifest.source?.commit;
  if (commit !== null && commit !== undefined && !GIT_SHA.test(commit)) {
    errors.push("source.commit must be a full 40-character git SHA");
  }

  const contracts = Object.entries(manifest.contracts ?? {});
  if (contracts.length === 0)
    errors.push("at least one contract entry is required");
  for (const [name, entry] of contracts) {
    if (
      entry.contractId !== null &&
      entry.contractId !== undefined &&
      !CONTRACT_ID.test(entry.contractId)
    ) {
      errors.push(
        `contracts.${name}.contractId is not a valid Stellar contract ID`,
      );
    }
    errors.push(...validateArtifact(entry.wasm, `contracts.${name}.wasm`));
  }

  for (const [field, value] of Object.entries(manifest.addresses ?? {})) {
    const pattern = ADDRESS_FIELDS[field];
    if (!pattern) {
      errors.push(`addresses.${field} is not a recognised address field`);
    } else if (!pattern.test(value)) {
      errors.push(
        `addresses.${field} is not a valid Stellar ${pattern === CONTRACT_ID ? "contract" : "account"} ID`,
      );
    }
  }

  (manifest.artifacts ?? []).forEach((artifact, index) => {
    errors.push(...validateArtifact(artifact, `artifacts[${index}]`));
  });

  return errors;
}

function validateArtifact(artifact, label) {
  if (!artifact) return [`${label} is required`];
  const errors = [];
  if (!artifact.path) errors.push(`${label}.path is required`);
  if (!SHA256_HEX.test(artifact.sha256 ?? ""))
    errors.push(`${label}.sha256 must be a lowercase hex SHA-256`);
  if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
    errors.push(`${label}.sizeBytes must be a non-negative integer`);
  }
  return errors;
}

/** Every artifact entry (contract Wasm first) in a manifest. */
export function listArtifacts(manifest) {
  const wasm = Object.values(manifest.contracts ?? {})
    .map((entry) => entry.wasm)
    .filter(Boolean);
  return [...wasm, ...(manifest.artifacts ?? [])];
}

/**
 * Re-hash every artifact the manifest references. `readFile` is injectable so
 * tests don't need real files; it should return bytes or null when missing.
 */
export function verifyArtifacts(manifest, readFile) {
  return listArtifacts(manifest).map((artifact) => {
    const bytes = readFile(artifact.path);
    if (bytes === null || bytes === undefined) {
      return {
        path: artifact.path,
        status: "missing",
        expected: artifact.sha256,
        actual: null,
      };
    }
    const actual = sha256Hex(bytes);
    return {
      path: artifact.path,
      status: actual === artifact.sha256 ? "ok" : "mismatch",
      expected: artifact.sha256,
      actual,
    };
  });
}

/**
 * Shields.io endpoint-badge JSON (https://shields.io/badges/endpoint-badge)
 * describing whether a manifest's provenance checks out.
 */
export function buildProvenanceBadge(manifest, results) {
  const problems = validateManifest(manifest);
  const verified =
    problems.length === 0 &&
    results.length > 0 &&
    results.every((result) => result.status === "ok");
  const commit = manifest?.source?.commit;
  const suffix = commit ? ` · ${commit.slice(0, 7)}` : "";

  return {
    schemaVersion: 1,
    label: "deploy provenance",
    message: verified ? `verified${suffix}` : "unverified",
    color: verified ? "brightgreen" : "red",
    namedLogo: "sigstore",
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = { artifact: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for ${arg}`);
    if (key === "artifact") flags.artifact.push(value);
    else flags[key] = value;
    i++;
  }
  return { command, flags };
}

function git(cmd) {
  try {
    return (
      execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

function generate(flags, env) {
  const networkName = flags.network ?? env.NETWORK;
  const wasmPath = flags.wasm ?? env.WASM_PATH;
  if (!networkName) throw new Error("--network (or NETWORK) is required");
  if (!wasmPath) throw new Error("--wasm (or WASM_PATH) is required");

  const manifest = buildManifest({
    network: {
      name: networkName,
      passphrase: flags.passphrase ?? env.NETWORK_PASSPHRASE,
      rpcUrl: flags.rpcUrl ?? env.RPC_URL,
    },
    contractId: flags.contractId ?? env.CONTRACT_ID ?? null,
    wasm: describeArtifact(wasmPath),
    addresses: {
      admin: flags.admin ?? env.ADMIN_ADDRESS,
      adminTwo: flags.adminTwo ?? env.ADMIN_TWO_ADDRESS,
      adminThree: flags.adminThree ?? env.ADMIN_THREE_ADDRESS,
      feeWallet: flags.feeWallet ?? env.FEE_WALLET_ADDRESS,
      xlmSac: flags.xlmSac ?? env.XLM_SAC,
    },
    artifacts: flags.artifact.map((path) => describeArtifact(path)),
    source: {
      repository: env.GITHUB_REPOSITORY ?? null,
      commit: env.GITHUB_SHA ?? git("rev-parse HEAD"),
      ref: env.GITHUB_REF ?? git("rev-parse --abbrev-ref HEAD"),
      workflowRunId: env.GITHUB_RUN_ID ?? null,
    },
  });

  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(
      `Refusing to write an invalid manifest:\n  - ${errors.join("\n  - ")}`,
    );
  }

  const out = flags.out ?? `deployments/${networkName}.json`;
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`✅ Deploy manifest written to ${out}`);
  return 0;
}

function loadAndVerify(flags) {
  if (!flags.manifest) throw new Error("--manifest is required");
  const manifest = JSON.parse(readFileSync(flags.manifest, "utf8"));
  const root = resolve(flags.root ?? ".");
  const results = verifyArtifacts(manifest, (path) => {
    const full = resolve(root, path);
    return existsSync(full) && statSync(full).isFile()
      ? readFileSync(full)
      : null;
  });
  return { manifest, results, errors: validateManifest(manifest) };
}

function verify(flags) {
  const { results, errors } = loadAndVerify(flags);
  for (const error of errors) console.log(`  ✖ ${error}`);
  for (const result of results) {
    const mark = result.status === "ok" ? "✔" : "✖";
    const detail =
      result.status === "mismatch"
        ? ` (expected ${result.expected}, got ${result.actual})`
        : "";
    console.log(`  ${mark} ${result.path}: ${result.status}${detail}`);
  }
  const ok =
    errors.length === 0 && results.every((result) => result.status === "ok");
  console.log(
    ok
      ? "\nDeploy manifest verified."
      : "\nDeploy manifest verification FAILED.",
  );
  return ok ? 0 : 1;
}

function badge(flags) {
  const { manifest, results } = loadAndVerify(flags);
  const json = `${JSON.stringify(buildProvenanceBadge(manifest, results), null, 2)}\n`;
  if (flags.out) {
    writeFileSync(flags.out, json);
    console.log(`Badge written to ${flags.out}`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case "generate":
      return generate(flags, env);
    case "verify":
      return verify(flags);
    case "badge":
      return badge(flags);
    default:
      console.log(
        "Usage: node scripts/deploy-manifest.mjs <generate|verify|badge> [flags]",
      );
      console.log("See docs/deploy-manifest.md for details.");
      return command === undefined || command === "--help" ? 0 : 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`deploy-manifest: ${error.message}`);
    process.exitCode = 1;
  }
}
