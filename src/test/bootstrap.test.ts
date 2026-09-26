import { describe, expect, it } from "vitest";
import {
  majorVersion,
  parseArgs,
  planBootstrap,
} from "../../scripts/bootstrap.mjs";

type Step = {
  id: string;
  kind: string;
  cmd?: string;
  cwd?: string;
  reason?: string;
};

const freshMachine = {
  nodeVersion: "22.11.0",
  yarnVersion: null,
  hasRustup: true,
  hasWasmTarget: false,
  hasStellarCli: false,
  hasEnv: false,
  hasEnvExample: true,
  hasServerLockfile: true,
};

const defaults = parseArgs([]);
const byId = (steps: Step[]) =>
  Object.fromEntries(steps.map((step) => [step.id, step]));

describe("bootstrap script", () => {
  it("parses flags and rejects unknown ones", () => {
    expect(parseArgs(["--dry-run", "--skip-rust"])).toMatchObject({
      dryRun: true,
      skipRust: true,
      skipServer: false,
    });
    expect(() => parseArgs(["--yolo"])).toThrow("Unknown option: --yolo");
  });

  it("extracts major versions", () => {
    expect(majorVersion("v22.11.0")).toBe(22);
    expect(majorVersion("4.9.2")).toBe(4);
    expect(majorVersion(null)).toBeNull();
  });

  it("plans a full setup on a fresh machine", () => {
    const steps = planBootstrap(defaults, freshMachine) as Step[];
    const plan = byId(steps);

    expect(steps.map((s) => s.id)).toEqual([
      "node",
      "corepack",
      "yarn-install",
      "server-install",
      "env",
      "rust",
      "stellar-cli",
      "check-setup",
    ]);
    expect(plan.corepack).toMatchObject({
      kind: "run",
      cmd: "corepack enable",
    });
    expect(plan["server-install"]).toMatchObject({
      kind: "run",
      cmd: "npm ci",
      cwd: "server",
    });
    expect(plan.env).toMatchObject({
      kind: "copy",
      from: ".env.example",
      to: ".env",
    });
    expect(plan.rust).toMatchObject({
      kind: "run",
      cmd: "rustup target add wasm32-unknown-unknown",
    });
    expect(plan["stellar-cli"].kind).toBe("warn");
    expect(plan["check-setup"].cmd).toContain(
      "check-local-setup.mjs --warn-only",
    );
  });

  it("is idempotent: never overwrites .env and skips work already done", () => {
    const plan = byId(
      planBootstrap(defaults, {
        ...freshMachine,
        yarnVersion: "4.9.2",
        hasEnv: true,
        hasWasmTarget: true,
        hasStellarCli: true,
      }) as Step[],
    );

    expect(plan.corepack.kind).toBe("skip");
    expect(plan.env).toMatchObject({
      kind: "skip",
      reason: expect.stringContaining("untouched"),
    });
    expect(plan.rust.kind).toBe("skip");
    expect(plan["stellar-cli"]).toBeUndefined();
  });

  it("stops immediately when Node is too old", () => {
    const steps = planBootstrap(defaults, {
      ...freshMachine,
      nodeVersion: "18.20.0",
    }) as Step[];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ id: "node", kind: "fail" });
  });

  it("warns instead of installing Rust when rustup is missing", () => {
    const plan = byId(
      planBootstrap(defaults, { ...freshMachine, hasRustup: false }) as Step[],
    );
    expect(plan.rust).toMatchObject({ kind: "warn" });
  });

  it("honours skip flags", () => {
    const plan = byId(
      planBootstrap(
        parseArgs(["--skip-server", "--skip-rust", "--skip-env"]),
        freshMachine,
      ) as Step[],
    );

    expect(plan["server-install"].kind).toBe("skip");
    expect(plan.env.kind).toBe("skip");
    expect(plan.rust.kind).toBe("skip");
    expect(plan["stellar-cli"]).toBeUndefined();
  });
});
