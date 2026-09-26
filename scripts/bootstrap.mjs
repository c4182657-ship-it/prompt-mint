/**
 * PromptHash Stellar — one-command bootstrap for new contributors
 *
 * Run with:  node scripts/bootstrap.mjs [--dry-run] [--skip-server] [--skip-rust] [--skip-env]
 * Or via:    yarn bootstrap   (once Yarn is available)
 *
 * Idempotent: safe to re-run. It never overwrites an existing .env and never
 * installs system toolchains (Node, Rust, Stellar CLI) — it tells you how.
 * Finishes by running scripts/check-local-setup.mjs --warn-only.
 */

import { execSync, spawnSync } from "child_process";
import { copyFileSync, existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";

export const MIN_NODE_MAJOR = 22;
export const MIN_YARN_MAJOR = 4;

const FLAGS = {
  "--dry-run": "dryRun",
  "--skip-server": "skipServer",
  "--skip-rust": "skipRust",
  "--skip-env": "skipEnv",
  "--help": "help",
  "-h": "help",
};

export function parseArgs(argv) {
  const options = {
    dryRun: false,
    skipServer: false,
    skipRust: false,
    skipEnv: false,
    help: false,
  };
  for (const arg of argv) {
    const key = FLAGS[arg];
    if (!key) throw new Error(`Unknown option: ${arg}`);
    options[key] = true;
  }
  return options;
}

export function majorVersion(raw) {
  const match = raw && String(raw).match(/(\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Decide which steps to run from a snapshot of the machine (`probe`).
 * Pure so it can be unit-tested without touching the filesystem or network.
 *
 * Step kinds:
 *   run   — shell command (`cmd`, optional `cwd`)
 *   copy  — copy `from` → `to`
 *   skip  — nothing to do (`reason`)
 *   warn  — manual action needed, bootstrap continues (`hint`)
 *   fail  — hard prerequisite missing, bootstrap stops (`hint`)
 */
export function planBootstrap(options, probe) {
  const steps = [];
  const nodeMajor = majorVersion(probe.nodeVersion);

  if (nodeMajor === null || nodeMajor < MIN_NODE_MAJOR) {
    steps.push({
      id: "node",
      kind: "fail",
      title: `Node.js ${MIN_NODE_MAJOR}+ is required (found ${probe.nodeVersion ?? "none"})`,
      hint: `nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}`,
    });
    return steps;
  }
  steps.push({
    id: "node",
    kind: "skip",
    title: `Node.js ${probe.nodeVersion}`,
    reason: "already installed",
  });

  const yarnMajor = majorVersion(probe.yarnVersion);
  if (yarnMajor === null || yarnMajor < MIN_YARN_MAJOR) {
    steps.push({
      id: "corepack",
      kind: "run",
      title: "Enable Corepack (provides the pinned Yarn 4)",
      cmd: "corepack enable",
    });
  } else {
    steps.push({
      id: "corepack",
      kind: "skip",
      title: `Yarn ${probe.yarnVersion}`,
      reason: "already enabled",
    });
  }

  steps.push({
    id: "yarn-install",
    kind: "run",
    title: "Install frontend dependencies",
    cmd: "yarn install",
  });

  if (options.skipServer) {
    steps.push({
      id: "server-install",
      kind: "skip",
      title: "Install server dependencies",
      reason: "--skip-server",
    });
  } else {
    steps.push({
      id: "server-install",
      kind: "run",
      title: "Install server dependencies",
      cmd: probe.hasServerLockfile ? "npm ci" : "npm install",
      cwd: "server",
    });
  }

  if (options.skipEnv) {
    steps.push({
      id: "env",
      kind: "skip",
      title: "Create .env",
      reason: "--skip-env",
    });
  } else if (probe.hasEnv) {
    steps.push({
      id: "env",
      kind: "skip",
      title: "Create .env",
      reason: ".env already exists (left untouched)",
    });
  } else if (!probe.hasEnvExample) {
    steps.push({
      id: "env",
      kind: "warn",
      title: "Create .env",
      hint: ".env.example is missing; create .env by hand",
    });
  } else {
    steps.push({
      id: "env",
      kind: "copy",
      title: "Create .env from .env.example",
      from: ".env.example",
      to: ".env",
    });
  }

  if (options.skipRust) {
    steps.push({
      id: "rust",
      kind: "skip",
      title: "Rust wasm32 target",
      reason: "--skip-rust",
    });
  } else if (!probe.hasRustup) {
    steps.push({
      id: "rust",
      kind: "warn",
      title: "Rust toolchain not found (needed for contract work)",
      hint: "Install from https://rustup.rs, then re-run bootstrap",
    });
  } else if (probe.hasWasmTarget) {
    steps.push({
      id: "rust",
      kind: "skip",
      title: "Rust wasm32-unknown-unknown target",
      reason: "already installed",
    });
  } else {
    steps.push({
      id: "rust",
      kind: "run",
      title: "Add Rust wasm32-unknown-unknown target",
      cmd: "rustup target add wasm32-unknown-unknown",
    });
  }

  if (!options.skipRust && !probe.hasStellarCli) {
    steps.push({
      id: "stellar-cli",
      kind: "warn",
      title: "Stellar CLI not found (needed to deploy contracts)",
      hint: "cargo install --locked stellar-cli --features opt",
    });
  }

  steps.push({
    id: "check-setup",
    kind: "run",
    title: "Validate local setup",
    cmd: "node scripts/check-local-setup.mjs --warn-only",
  });

  return steps;
}

// ─── execution ──────────────────────────────────────────────────────────────

function capture(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function probeMachine(options, root = process.cwd()) {
  // rustup may auto-install the pinned toolchain on first call, so don't touch it when skipped.
  const installedTargets = options.skipRust
    ? null
    : capture("rustup target list --installed");
  return {
    nodeVersion: process.versions.node,
    yarnVersion: capture("yarn --version"),
    hasRustup: installedTargets !== null,
    hasWasmTarget: Boolean(
      installedTargets?.includes("wasm32-unknown-unknown"),
    ),
    hasStellarCli: !options.skipRust && capture("stellar --version") !== null,
    hasEnv: existsSync(resolve(root, ".env")),
    hasEnvExample: existsSync(resolve(root, ".env.example")),
    hasServerLockfile: existsSync(resolve(root, "server/package-lock.json")),
  };
}

const COLORS = {
  run: "\x1b[36m",
  copy: "\x1b[36m",
  skip: "\x1b[32m",
  warn: "\x1b[33m",
  fail: "\x1b[31m",
};
const ICONS = { run: "→", copy: "→", skip: "✔", warn: "⚠", fail: "✖" };
const RESET = "\x1b[0m";

function describe(step) {
  const color = COLORS[step.kind];
  const detail =
    step.kind === "run"
      ? `  $ ${step.cwd ? `(cd ${step.cwd} && ${step.cmd})` : step.cmd}`
      : step.kind === "copy"
        ? `  cp ${step.from} ${step.to}`
        : step.kind === "skip"
          ? `  (${step.reason})`
          : `\n       → ${step.hint}`;
  return `  ${color}${ICONS[step.kind]}${RESET}  ${step.title}${color}${detail}${RESET}`;
}

export function runBootstrap(
  options,
  probe = probeMachine(options),
  root = process.cwd(),
) {
  const steps = planBootstrap(options, probe);
  console.log(
    `\n\x1b[1mPromptHash Stellar bootstrap${options.dryRun ? " (dry run)" : ""}\x1b[0m\n`,
  );

  for (const step of steps) {
    console.log(describe(step));
    if (step.kind === "fail") return 1;
    if (options.dryRun) continue;

    if (step.kind === "copy") {
      copyFileSync(resolve(root, step.from), resolve(root, step.to));
    } else if (step.kind === "run") {
      const result = spawnSync(step.cmd, {
        cwd: resolve(root, step.cwd ?? "."),
        stdio: "inherit",
        shell: true,
      });
      if (result.status !== 0) {
        console.log(
          `\n  \x1b[31mStep "${step.id}" failed.\x1b[0m Fix the error above and re-run: node scripts/bootstrap.mjs\n`,
        );
        return result.status ?? 1;
      }
    }
  }

  console.log("\n  Next steps:");
  console.log(
    "    1. Fill in the placeholder values in .env (see docs/environment-variables.md)",
  );
  console.log("    2. yarn dev                   — start the frontend");
  console.log("    3. yarn test:frontend         — run frontend tests");
  console.log("    4. cargo test -p prompt-hash  — run contract tests\n");
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        "Usage: node scripts/bootstrap.mjs [--dry-run] [--skip-server] [--skip-rust] [--skip-env]",
      );
      console.log("See docs/contributor-onboarding-quickstart.md for details.");
    } else {
      process.exitCode = runBootstrap(options);
    }
  } catch (error) {
    console.error(`bootstrap: ${error.message}`);
    process.exitCode = 1;
  }
}
