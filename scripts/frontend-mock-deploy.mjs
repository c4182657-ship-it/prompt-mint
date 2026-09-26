#!/usr/bin/env node
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const addressBookPath = resolve(repoRoot, "deployments/address-book.json");
const journalPath = resolve(repoRoot, "deployments/bytecode-provenance.ndjson");

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex");
}

function mockContractId(seed) {
  return `C${hash(seed).toUpperCase()}${hash(`contract:${seed}`).toUpperCase()}`.slice(0, 56);
}

function journalEvent(event) {
  mkdirSync(dirname(journalPath), { recursive: true });
  const existing = existsSync(journalPath) ? readFileSync(journalPath, "utf8") : "";
  writeFileSync(journalPath, `${existing}${JSON.stringify(event)}\n`);
}

const environment = flag("env", "local");
const contract = flag("contract", "prompt_hash");
const seed = flag("seed", `${contract}:${environment}:frontend-mock`);
const deployedAt = new Date().toISOString();
const wasmHash = hash(`${seed}:mock-wasm-bytecode`);
const contractId = mockContractId(seed);

const addressBook = readJson(addressBookPath, {
  $schema: "./address-book.schema.json",
  schemaVersion: 1,
  updatedAt: deployedAt,
  contracts: {},
});

addressBook.contracts ??= {};
addressBook.contracts[contract] ??= {};
addressBook.contracts[contract][environment] = {
  contractId,
  network: environment === "local" ? "standalone" : environment,
  rpcUrl: flag("rpc-url", environment === "local" ? "http://localhost:8000/soroban/rpc" : ""),
  networkPassphrase: flag("passphrase", environment === "local" ? "Standalone Network ; February 2017" : ""),
  wasmHash,
  source: "scripts/frontend-mock-deploy.mjs",
  deployedAt,
};
addressBook.updatedAt = deployedAt;

mkdirSync(dirname(addressBookPath), { recursive: true });
writeFileSync(addressBookPath, `${JSON.stringify(addressBook, null, 2)}\n`);

journalEvent({
  schemaVersion: 1,
  recordedAt: deployedAt,
  contract,
  environment,
  contractId,
  wasmHash,
  source: "frontend-mock-deploy",
  bytecode: {
    kind: "mock",
    seed,
    note: "Frontend-only fixture used before a real Soroban deployment is available.",
  },
});

console.log(`Mock ${contract} deployment recorded for ${environment}`);
console.log(`contractId=${contractId}`);
console.log(`wasmHash=${wasmHash}`);