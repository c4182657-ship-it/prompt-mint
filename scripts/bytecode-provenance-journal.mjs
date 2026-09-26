#!/usr/bin/env node
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const artifact = flag("artifact", null);
if (!artifact) {
  console.error("bytecode-provenance-journal: --artifact is required");
  process.exitCode = 1;
} else {
  const fullArtifactPath = resolve(repoRoot, artifact);
  if (!existsSync(fullArtifactPath)) {
    console.error(`bytecode-provenance-journal: ${artifact} does not exist`);
    process.exitCode = 1;
  } else {
    const out = resolve(repoRoot, flag("out", "deployments/bytecode-provenance.ndjson"));
    const recordedAt = new Date().toISOString();
    const entry = {
      schemaVersion: 1,
      recordedAt,
      contract: flag("contract", "prompt_hash"),
      environment: flag("env", "local"),
      artifact: relative(repoRoot, fullArtifactPath).split("\\").join("/"),
      sha256: sha256File(fullArtifactPath),
      sizeBytes: statSync(fullArtifactPath).size,
      source: flag("source", process.env.GITHUB_SHA ?? "local"),
      workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    };
    mkdirSync(dirname(out), { recursive: true });
    const existing = existsSync(out) ? readFileSync(out, "utf8") : "";
    writeFileSync(out, `${existing}${JSON.stringify(entry)}\n`);
    console.log(`Bytecode provenance appended to ${relative(repoRoot, out)}`);
  }
}