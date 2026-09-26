import { describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import {
  parseArgs,
  validateWasmHash,
  isValidContractId,
  sha256Hex,
  resolveConfig,
  runDryRunChecks,
} from "../../../scripts/upgrade-dry-run.mjs";

describe("upgrade-dry-run CLI", () => {
  it("parses flags", () => {
    expect(parseArgs(["--network", "testnet", "--skip-build"])).toMatchObject({ network: "testnet", skipBuild: true });
    expect(parseArgs(["--contract-id", "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"])).toMatchObject({ contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(() => parseArgs(["--unknown"])).toThrow();
  });

  it("validates wasm hash", () => {
    expect(validateWasmHash("0".repeat(64)).ok).toBe(false);
    expect(validateWasmHash("bad").ok).toBe(false);
    const good = createHash("sha256").update("hello").digest("hex");
    expect(validateWasmHash(good).ok).toBe(true);
  });

  it("hashes bytes deterministically", () => {
    expect(sha256Hex(Buffer.from("hello"))).toBe(createHash("sha256").update("hello").digest("hex"));
  });

  it("validates contract ids", () => {
    expect(isValidContractId("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(isValidContractId("BAD")).toBe(false);
  });

  it("resolves config from flags", () => {
    const cfg = resolveConfig({ network: "testnet", contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", wasm: "/tmp/wasm.wasm" }, {}, {});
    expect(cfg.network).toBe("testnet");
    expect(cfg.contractId).toBe("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("runs dry-run checks — healthy path (stubbed wasm + RPC)", async () => {
    const goodHash = "a".repeat(64);
    const cfg = {
      network: "testnet",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      wasm: "/tmp/fake.wasm",
      admin: "admin",
      rpcUrl: "https://rpc.example.com",
      passphrase: "Test SDF Network ; September 2015",
    };
    const result = await runDryRunChecks(cfg, {
      readWasm: () => ({ path: cfg.wasm, sizeBytes: 1234, sha256: goodHash }),
      fetch: vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ result: { entries: [] } }) } as any)),
      simulate: async () => ({ ok: true, method: "get_all_prompts", detail: "ok", raw: {} }),
    });
    expect(result.healthy).toBe(true);
    expect(result.checks.some(c => c.name === "wasm_hash" && c.status === "ok")).toBe(true);
  });

  it("fails when wasm is zero hash", async () => {
    const cfg = {
      network: "testnet",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      wasm: "/tmp/fake.wasm",
      admin: "admin",
      rpcUrl: "https://rpc.example.com",
      passphrase: "Test SDF Network ; September 2015",
    };
    const result = await runDryRunChecks(cfg, {
      readWasm: () => ({ path: cfg.wasm, sizeBytes: 0, sha256: "0".repeat(64) }),
      fetch: null,
      simulate: async () => ({ ok: false, method: "x", detail: "fail", raw: null }),
    });
    expect(result.healthy).toBe(false);
    expect(result.failures).toContain("wasm_hash");
  });

  it("fails when contract id is placeholder", async () => {
    const cfg = {
      network: "testnet",
      contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      wasm: "/tmp/fake.wasm",
      admin: "admin",
      rpcUrl: "https://rpc.example.com",
      passphrase: "pass",
    };
    const result = await runDryRunChecks(cfg, {
      readWasm: () => ({ path: "/tmp/fake.wasm", sizeBytes: 100, sha256: "b".repeat(64) }),
      fetch: null,
      simulate: async () => ({ ok: true, method: "x", detail: "ok", raw: {} }),
    });
    expect(result.healthy).toBe(false);
    expect(result.failures).toContain("contract_id");
  });
});
