import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSandboxKeypair,
  buildFriendbotUrlForNetwork,
  requestFriendbotFunds,
  SANDBOX_PRESETS,
  DEFAULT_SANDBOX_CONFIGS,
  loadSandboxState,
  saveSandboxState,
  resetSandboxState,
} from "@/lib/stellar/sandbox";

describe("Developer Sandbox Utilities", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateSandboxKeypair", () => {
    it("generates a Stellar public key starting with G and secret key starting with S", () => {
      const keypair = generateSandboxKeypair();
      expect(keypair).toBeDefined();
      expect(keypair.publicKey).toMatch(/^G[A-Z0-9]{55}$/);
      expect(keypair.secretKey).toMatch(/^S[A-Z0-9]{55}$/);
    });

    it("generates distinct keypairs on subsequent invocations", () => {
      const kp1 = generateSandboxKeypair();
      const kp2 = generateSandboxKeypair();
      expect(kp1.publicKey).not.toEqual(kp2.publicKey);
      expect(kp1.secretKey).not.toEqual(kp2.secretKey);
    });
  });

  describe("buildFriendbotUrlForNetwork", () => {
    it("builds the TESTNET Friendbot URL correctly", () => {
      const addr = "GBB476V4G35E34N54U7VAMNQQC2OYYA2KOFB3XU2HHGCYSC";
      const url = buildFriendbotUrlForNetwork(addr, "TESTNET");
      expect(url).toBe(`https://friendbot.stellar.org/?addr=${addr}`);
    });

    it("builds the FUTURENET Friendbot URL correctly", () => {
      const addr = "GBB476V4G35E34N54U7VAMNQQC2OYYA2KOFB3XU2HHGCYSC";
      const url = buildFriendbotUrlForNetwork(addr, "FUTURENET");
      expect(url).toBe(`https://friendbot-futurenet.stellar.org/?addr=${addr}`);
    });

    it("builds the LOCAL Friendbot proxy URL correctly", () => {
      const addr = "GBB476V4G35E34N54U7VAMNQQC2OYYA2KOFB3XU2HHGCYSC";
      const url = buildFriendbotUrlForNetwork(addr, "LOCAL");
      expect(url).toBe(`/friendbot?addr=${addr}`);
    });
  });

  describe("requestFriendbotFunds", () => {
    it("throws an error if address is empty", async () => {
      await expect(requestFriendbotFunds("")).rejects.toThrow(
        "Stellar address is required for testnet funding."
      );
    });

    it("successfully requests funds when Friendbot returns 200 OK", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({ hash: "abc123testnethash" }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      const result = await requestFriendbotFunds(
        "GBB476V4G35E34N54U7VAMNQQC2OYYA2KOFB3XU2HHGCYSC",
        "TESTNET"
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe("abc123testnethash");
      expect(result.message).toContain("Successfully funded");
    });

    it("throws a descriptive error when Friendbot returns an error status", async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        json: async () => ({ detail: "Account already funded or invalid address" }),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse as any);

      await expect(
        requestFriendbotFunds(
          "GBB476V4G35E34N54U7VAMNQQC2OYYA2KOFB3XU2HHGCYSC",
          "TESTNET"
        )
      ).rejects.toThrow("Friendbot funding failed: Account already funded or invalid address");
    });
  });

  describe("SANDBOX_PRESETS & Configurations", () => {
    it("provides the expected default presets", () => {
      expect(SANDBOX_PRESETS.length).toBeGreaterThanOrEqual(3);
      const ids = SANDBOX_PRESETS.map((p) => p.id);
      expect(ids).toContain("fresh-buyer");
      expect(ids).toContain("funded-creator");
      expect(ids).toContain("api-integrator");
    });

    it("provides network parameters for all supported environments", () => {
      expect(DEFAULT_SANDBOX_CONFIGS.TESTNET.networkPassphrase).toContain("Test SDF Network");
      expect(DEFAULT_SANDBOX_CONFIGS.FUTURENET.networkPassphrase).toContain("Test SDF Future Network");
      expect(DEFAULT_SANDBOX_CONFIGS.LOCAL.rpcUrl).toContain("localhost");
    });
  });

  describe("Sandbox State Lifecycle", () => {
    it("loads default state when localStorage is clean", () => {
      const state = loadSandboxState();
      expect(state.wallet).toBeNull();
      expect(state.config.network).toBe("TESTNET");
      expect(state.transactions).toEqual([]);
    });

    it("persists and reloads sandbox state from localStorage", () => {
      const mockState = {
        wallet: {
          publicKey: "GTEST123",
          secretKey: "STEST123",
          balanceXlm: "10000.00",
          sequence: "1",
          status: "funded" as const,
          lastFundedAt: "2026-09-26T00:00:00Z",
        },
        config: DEFAULT_SANDBOX_CONFIGS.TESTNET,
        transactions: [],
        selectedPresetId: "funded-creator",
      };

      saveSandboxState(mockState);
      const reloaded = loadSandboxState();
      expect(reloaded.wallet?.publicKey).toBe("GTEST123");
      expect(reloaded.wallet?.balanceXlm).toBe("10000.00");
      expect(reloaded.selectedPresetId).toBe("funded-creator");
    });

    it("resets sandbox state and clears localStorage", () => {
      const mockState = {
        wallet: {
          publicKey: "GTEST123",
          secretKey: "STEST123",
          balanceXlm: "10000.00",
          sequence: "1",
          status: "funded" as const,
          lastFundedAt: "2026-09-26T00:00:00Z",
        },
        config: DEFAULT_SANDBOX_CONFIGS.TESTNET,
        transactions: [],
        selectedPresetId: "funded-creator",
      };

      saveSandboxState(mockState);
      const reset = resetSandboxState();
      expect(reset.wallet).toBeNull();
      expect(loadSandboxState().wallet).toBeNull();
    });
  });
});
