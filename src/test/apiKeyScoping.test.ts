import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SCOPE_DEFINITIONS,
  SCOPING_PRESETS,
  updateApiKeyScopes,
  type ApiScope,
} from "@/lib/api/apiKeys";
import { hasScope } from "../../server/src/services/apiKeys";

describe("Developer API Key Scoping", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Scope Taxonomy and Definitions", () => {
    it("defines essential granular resource scopes", () => {
      const scopeKeys = SCOPE_DEFINITIONS.map((d) => d.scope);
      expect(scopeKeys).toContain("prompts:read");
      expect(scopeKeys).toContain("prompts:write");
      expect(scopeKeys).toContain("licenses:read");
      expect(scopeKeys).toContain("licenses:write");
      expect(scopeKeys).toContain("webhooks:manage");
      expect(scopeKeys).toContain("analytics:read");
      expect(scopeKeys).toContain("admin");
    });

    it("assigns valid categories and risk levels to all scopes", () => {
      for (const def of SCOPE_DEFINITIONS) {
        expect(["prompts", "licenses", "integrations", "admin"]).toContain(def.category);
        expect(["low", "medium", "high"]).toContain(def.riskLevel);
        expect(def.label.length).toBeGreaterThan(0);
        expect(def.description.length).toBeGreaterThan(0);
      }
    });

    it("provides complete scoping presets for developers", () => {
      expect(SCOPING_PRESETS.length).toBeGreaterThanOrEqual(4);
      const presetIds = SCOPING_PRESETS.map((p) => p.id);
      expect(presetIds).toContain("read-only");
      expect(presetIds).toContain("agent-creator");
      expect(presetIds).toContain("checkout-integrator");
      expect(presetIds).toContain("full-admin");
    });
  });

  describe("hasScope permissions logic", () => {
    it("grants access to everything when key has admin scope", () => {
      const granted: ApiScope[] = ["admin"];
      expect(hasScope(granted, "prompts:read")).toBe(true);
      expect(hasScope(granted, "prompts:write")).toBe(true);
      expect(hasScope(granted, "licenses:write")).toBe(true);
      expect(hasScope(granted, "webhooks:manage")).toBe(true);
      expect(hasScope(granted, "admin")).toBe(true);
    });

    it("correctly evaluates granular scopes", () => {
      const granted: ApiScope[] = ["prompts:read", "analytics:read"];
      expect(hasScope(granted, "prompts:read")).toBe(true);
      expect(hasScope(granted, "analytics:read")).toBe(true);
      expect(hasScope(granted, "prompts:write")).toBe(false);
      expect(hasScope(granted, "licenses:write")).toBe(false);
    });

    it("honours legacy broad write scope for mutations", () => {
      const granted: ApiScope[] = ["write"];
      expect(hasScope(granted, "prompts:write")).toBe(true);
      expect(hasScope(granted, "licenses:write")).toBe(true);
      expect(hasScope(granted, "prompts:read")).toBe(true);
      expect(hasScope(granted, "admin")).toBe(false);
    });
  });

  describe("updateApiKeyScopes Client API", () => {
    it("issues a PATCH request to /api-keys/:id/scopes with ownerWallet and scopes", async () => {
      const mockResult = {
        key: {
          id: "key_123",
          label: "Test Key",
          maskedKey: "pm_test••••",
          scopes: ["prompts:read", "prompts:write"] as ApiScope[],
          rateLimitTier: "pro" as const,
          rateLimit: 600,
          requestCount: 42,
          lastUsedAt: null,
          revoked: false,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      } as any);

      const res = await updateApiKeyScopes("key_123", "GBB123", ["prompts:read", "prompts:write"]);
      expect(res.key.id).toBe("key_123");
      expect(res.key.scopes).toEqual(["prompts:read", "prompts:write"]);

      expect(global.fetch).toHaveBeenCalledWith(
        "/api-keys/key_123/scopes",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerWallet: "GBB123",
            scopes: ["prompts:read", "prompts:write"],
          }),
        })
      );
    });
  });
});
