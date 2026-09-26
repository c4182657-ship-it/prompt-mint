/**
 * Client for the API key management endpoints (#287).
 *
 * The backend keys records by `ownerWallet`; the connected wallet address is
 * passed through. Requests target the same-origin `/api-keys` mount (see
 * server/src/routes/apiKeyRoutes.ts).
 */

export type ApiScope =
  | "read"
  | "write"
  | "admin"
  | "prompts:read"
  | "prompts:write"
  | "licenses:read"
  | "licenses:write"
  | "webhooks:manage"
  | "analytics:read";

export interface ScopeDefinition {
  scope: ApiScope;
  category: "prompts" | "licenses" | "integrations" | "admin";
  label: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
}

export const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  {
    scope: "prompts:read",
    category: "prompts",
    label: "Read Prompts",
    description: "Search and query catalog listings, prompt metadata, and active pricing.",
    riskLevel: "low",
  },
  {
    scope: "prompts:write",
    category: "prompts",
    label: "Write Prompts",
    description: "Create, mint, update, or unlist prompts on the marketplace.",
    riskLevel: "medium",
  },
  {
    scope: "licenses:read",
    category: "licenses",
    label: "Read Licenses",
    description: "Inspect on-chain license verification and purchase history.",
    riskLevel: "low",
  },
  {
    scope: "licenses:write",
    category: "licenses",
    label: "Execute Purchases",
    description: "Trigger contract purchase calls and transfer prompt licenses.",
    riskLevel: "high",
  },
  {
    scope: "webhooks:manage",
    category: "integrations",
    label: "Manage Webhooks",
    description: "Register, pause, and configure event delivery endpoints.",
    riskLevel: "medium",
  },
  {
    scope: "analytics:read",
    category: "integrations",
    label: "Read Analytics",
    description: "Query developer usage metrics, rate limit counters, and sales telemetry.",
    riskLevel: "low",
  },
  {
    scope: "read",
    category: "prompts",
    label: "Global Read (Legacy)",
    description: "Broad read access across all public endpoints.",
    riskLevel: "low",
  },
  {
    scope: "write",
    category: "prompts",
    label: "Global Write (Legacy)",
    description: "Broad mutation access across prompt listings and licenses.",
    riskLevel: "medium",
  },
  {
    scope: "admin",
    category: "admin",
    label: "Full Administrator",
    description: "Unrestricted operational access across all API endpoints and resources.",
    riskLevel: "high",
  },
];

export interface ScopingPreset {
  id: string;
  name: string;
  description: string;
  scopes: ApiScope[];
}

export const SCOPING_PRESETS: ScopingPreset[] = [
  {
    id: "read-only",
    name: "Marketplace Reader",
    description: "Ideal for search engines, indexers, and public catalog mirrors.",
    scopes: ["prompts:read", "licenses:read"],
  },
  {
    id: "agent-creator",
    name: "Autonomous Creator",
    description: "Allows an AI agent to publish prompts and review sales analytics.",
    scopes: ["prompts:read", "prompts:write", "analytics:read"],
  },
  {
    id: "checkout-integrator",
    name: "Commerce Integrator",
    description: "Allows external checkout platforms to query listings and purchase licenses.",
    scopes: ["prompts:read", "licenses:read", "licenses:write"],
  },
  {
    id: "webhook-consumer",
    name: "Webhook Consumer",
    description: "Read analytics and manage event notification webhooks.",
    scopes: ["webhooks:manage", "analytics:read"],
  },
  {
    id: "full-admin",
    name: "Full Admin",
    description: "Unrestricted root-level access across all developer capabilities.",
    scopes: ["admin"],
  },
];

export type RateLimitTier = "free" | "pro" | "enterprise";

export interface ApiKeySummary {
  id: string;
  label: string;
  maskedKey: string;
  scopes: ApiScope[];
  rateLimitTier: RateLimitTier;
  rateLimit: number;
  requestCount: number;
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt?: string;
}

export interface CreatedApiKey {
  key: ApiKeySummary;
  /** Full key, shown to the user exactly once. */
  plaintext: string;
}

const BASE = "/api-keys";

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export function listApiKeys(ownerWallet: string): Promise<{ keys: ApiKeySummary[] }> {
  return json(`${BASE}?ownerWallet=${encodeURIComponent(ownerWallet)}`);
}

export function createApiKey(input: {
  ownerWallet: string;
  label: string;
  scopes: ApiScope[];
  rateLimitTier: RateLimitTier;
}): Promise<CreatedApiKey> {
  return json(BASE, { method: "POST", body: JSON.stringify(input) });
}

export function rotateApiKey(
  id: string,
  ownerWallet: string,
): Promise<CreatedApiKey> {
  return json(`${BASE}/${encodeURIComponent(id)}/rotate`, {
    method: "POST",
    body: JSON.stringify({ ownerWallet }),
  });
}

export function revokeApiKey(
  id: string,
  ownerWallet: string,
): Promise<{ key: ApiKeySummary }> {
  return json(`${BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: JSON.stringify({ ownerWallet }),
  });
}

export function updateApiKeyScopes(
  id: string,
  ownerWallet: string,
  scopes: ApiScope[],
): Promise<{ key: ApiKeySummary }> {
  return json(`${BASE}/${encodeURIComponent(id)}/scopes`, {
    method: "PATCH",
    body: JSON.stringify({ ownerWallet, scopes }),
  });
}
