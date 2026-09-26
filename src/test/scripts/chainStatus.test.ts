import { describe, expect, it, vi } from "vitest";
import {
  parseArgs,
  resolveConfig,
  isValidContractId,
  checkRpcHealth,
  checkHorizonHealth,
  checkLatestLedger,
  checkContractDeployed,
  runAllChecks,
  summarize,
  DEFAULT_TIMEOUT_MS,
} from "../../../scripts/chain-status.mjs";

function mockFetch(responses: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const method = body.method;
    // Horizon check is GET to horizonUrl/
    if (init?.method === "GET" || url.includes("horizon")) {
      const key = "horizon";
      const resp = responses[key] ?? { status: 200, body: { horizon_version: "22.0.0", _links: {} } };
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        statusText: "OK",
        text: async () => JSON.stringify(resp.body),
        headers: { get: () => null },
      } as any;
    }
    const resp = responses[method] ?? { status: 200, body: { result: { status: "healthy" } } };
    // For getNetwork, return passphrase; for getLatestLedger, return sequence
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: "OK",
      text: async () => JSON.stringify(resp.body),
      headers: { get: () => null },
    } as any;
  });
}

describe("chain-status CLI", () => {
  it("parses flags and rejects unknown ones", () => {
    expect(parseArgs(["--network", "testnet", "--json"])).toMatchObject({ network: "testnet", json: true });
    expect(() => parseArgs(["--yolo"])).toThrow();
    expect(() => parseArgs(["--network"])).toThrow("Missing value");
  });

  it("validates contract ids", () => {
    expect(isValidContractId("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(isValidContractId("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(isValidContractId("bad")).toBe(false);
  });

  it("resolves config from flags and env", () => {
    const cfg = resolveConfig({ network: "local", rpcUrl: "http://localhost:8000", contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, {}, {});
    expect(cfg.network).toBe("local");
    expect(cfg.rpcUrl).toBe("http://localhost:8000");
    expect(cfg.timeout).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("checks RPC health — healthy", async () => {
    const fetch = mockFetch({ getHealth: { status: 200, body: { result: { status: "healthy" } } } });
    const res = await checkRpcHealth("https://rpc.example.com", fetch, 2000);
    expect(res.status).toBe("ok");
    expect(res.name).toBe("rpc_health");
  });

  it("checks RPC health — unreachable", async () => {
    const fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const res = await checkRpcHealth("https://rpc.example.com", fetch, 2000);
    expect(res.status).toBe("fail");
    expect(res.detail).toContain("unreachable");
  });

  it("checks Horizon health", async () => {
    const fetch = mockFetch({ horizon: { status: 200, body: { horizon_version: "22.0.0", _links: {} } } });
    const res = await checkHorizonHealth("https://horizon.example.com", fetch, 2000);
    expect(res.status).toBe("ok");
  });

  it("checks contract deployed — placeholder warns", async () => {
    const fetch = mockFetch({});
    const res = await checkContractDeployed("CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", "https://rpc.example.com", fetch, 2000);
    expect(res.status).toBe("warn");
  });

  it("checks contract deployed — invalid fails", async () => {
    const fetch = mockFetch({});
    const res = await checkContractDeployed("BAD", "https://rpc.example.com", fetch, 2000);
    expect(res.status).toBe("fail");
  });

  it("runs all checks and summarizes", async () => {
    const fetch = mockFetch({
      getHealth: { status: 200, body: { result: { status: "healthy" } } },
      getNetwork: { status: 200, body: { result: { passphrase: "Test SDF Network ; September 2015" } } },
      getLatestLedger: { status: 200, body: { result: { sequence: 12345 } } },
      getLedgerEntries: { status: 200, body: { result: { entries: [] } } },
      horizon: { status: 200, body: { horizon_version: "22", _links: {} } },
    });
    const cfg = {
      network: "testnet",
      rpcUrl: "https://rpc.example.com",
      horizonUrl: "https://horizon.example.com",
      passphrase: "Test SDF Network ; September 2015",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      timeout: 2000,
    };
    const checks = await runAllChecks(cfg, fetch);
    const summary = summarize(checks);
    expect(checks.length).toBeGreaterThan(3);
    expect(summary.total).toBe(checks.length);
  });
});
