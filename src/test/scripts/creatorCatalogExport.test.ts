import { describe, expect, it, vi } from "vitest";
import {
  parseArgs,
  resolveConfig,
  normalizePrompt,
  filterAndSort,
  toCsv,
  toJson,
  isValidCreator,
  fetchCreatorCatalog,
} from "../../../scripts/creator-catalog-export.mjs";

describe("creator-catalog-export CLI", () => {
  it("parses required --creator and flags", () => {
    expect(parseArgs(["--creator", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"])).toMatchObject({
      creator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      format: "json",
    });
    expect(parseArgs(["--creator", "GB7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "--format", "csv", "--active-only"])).toMatchObject({
      format: "csv",
      activeOnly: true,
    });
    expect(() => parseArgs([])).toThrow("--creator");
    expect(() => parseArgs(["--format", "xml", "--creator", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"])).toThrow("must be json or csv");
  });

  it("validates creator addresses", () => {
    expect(isValidCreator("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(isValidCreator("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(isValidCreator("bad")).toBe(false);
  });

  it("resolves config", () => {
    const cfg = resolveConfig({ creator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", network: "testnet" }, {}, {});
    expect(cfg.network).toBe("testnet");
    expect(cfg.creator).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("normalizes prompts from different shapes", () => {
    const p1 = normalizePrompt({ id: 5, title: "Hello", price_stroops: 1000, active: true, creator: "GABC" });
    expect(p1?.id).toBe("5");
    expect(p1?.price).toBe(1000);
    expect(p1?.active).toBe(true);
    const p2 = normalizePrompt({ promptId: "10", title: "X", price: 2000 });
    expect(p2?.id).toBe("10");
  });

  it("filters and sorts", () => {
    const prompts = [
      { id: "3", active: true },
      { id: "1", active: false },
      { id: "2", active: true },
    ].map(p => ({ ...p, creator: "G", title: "t", category: "c", price: 0, salesCount: 0, contentHash: "", previewText: "", raw: {} }));
    const filtered = filterAndSort(prompts, { activeOnly: true });
    expect(filtered.map(p => p.id)).toEqual(["2", "3"]);
    const limited = filterAndSort(prompts, { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("serializes to CSV", () => {
    const prompts = [
      { id: "1", creator: "GABC", title: "Hello, world", category: "general", price: 100, active: true, salesCount: 2, contentHash: "abc" },
    ];
    const csv = toCsv(prompts as any);
    expect(csv).toContain("id,creator,title");
    expect(csv).toContain('"Hello, world"'); // comma escaped
  });

  it("serializes to JSON", () => {
    const prompts = [{ id: "1", creator: "G", title: "t" }] as any;
    const json = toJson(prompts);
    const parsed = JSON.parse(json);
    expect(parsed.count).toBe(1);
    expect(parsed.prompts[0].id).toBe("1");
  });

  it("fetches via API (stubbed)", async () => {
    const fakePrompts = [{ id: 1, title: "A", creator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", price: 1000 }];
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ prompts: fakePrompts }),
    } as any));
    const cfg = {
      network: "testnet",
      rpcUrl: "https://rpc.example.com",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      apiUrl: "https://api.example.com",
      creator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    const res = await fetchCreatorCatalog(cfg, fetch);
    expect(res.source).toBe("api");
    expect(res.prompts).toHaveLength(1);
  });

  it("fetches via RPC when no API URL (stubbed empty)", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { entries: [] } }),
    } as any));
    const cfg = {
      network: "testnet",
      rpcUrl: "https://rpc.example.com",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      apiUrl: null,
      creator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    };
    const res = await fetchCreatorCatalog(cfg, fetch);
    expect(res.source).toBe("rpc");
    expect(res.prompts).toEqual([]);
  });

  it("throws on invalid creator", async () => {
    const cfg = { network: "testnet", rpcUrl: "https://rpc.example.com", contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", apiUrl: "https://api.example.com", creator: "BAD" };
    await expect(fetchCreatorCatalog(cfg, vi.fn() as any)).rejects.toThrow("Invalid creator");
  });
});
