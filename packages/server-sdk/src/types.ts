/** Shared configuration and wire types for `@prompthash/server-sdk`. */

/** API key scopes, hierarchical: `admin` ⊃ `write` ⊃ `read`. */
export type ApiScope = "read" | "write" | "admin";

/** Per-key rate-limit tiers served by the Express API. */
export type RateLimitTier = "free" | "pro" | "enterprise";

/**
 * Minimal response surface the client needs. Real `fetch` responses satisfy
 * it, and so do the fakes used in tests.
 */
export interface HttpResponseLike {
  status: number;
  ok: boolean;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Request init accepted by the injectable transport. */
export interface FetchRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** Injectable transport — defaults to the global `fetch`. */
export type FetchLike = (
  url: string,
  init: FetchRequestInit,
) => Promise<HttpResponseLike>;

export interface ServerClientConfig {
  /** Base URL of the API, e.g. `https://api.promptmint.io`. */
  baseUrl: string;
  /**
   * Plaintext API key (`pm_<prefix>_<secret>`). Sent as
   * `Authorization: Bearer <key>`; omit for public reads.
   */
  apiKey?: string;
  /**
   * `Accept-Version` value. Defaults to `latest`.
   * Pin to `2025-01-01` or `2024-01-01` for stable payloads.
   */
  apiVersion?: string;
  /** Per-attempt timeout. Defaults to 30 seconds; `0` disables it. */
  timeoutMs?: number;
  /** Extra attempts after the first. Defaults to 2. */
  maxRetries?: number;
  /** First backoff step in milliseconds. Defaults to 250. */
  retryBaseDelayMs?: number;
  /** Backoff ceiling in milliseconds. Defaults to 10 000. */
  retryMaxDelayMs?: number;
  /** Transport override, e.g. a stub in tests. */
  fetch?: FetchLike;
  /** Sleep override, e.g. a fake clock in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Headers merged into every request (caller wins on conflicts). */
  defaultHeaders?: Record<string, string>;
  /** `User-Agent` sent with every request. */
  userAgent?: string;
}

export interface RequestOptions {
  /** Query string values; `undefined`/`null` entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Extra headers merged over the defaults for this call. */
  headers?: Record<string, string>;
  /** JSON body. `undefined` means no body. */
  body?: unknown;
  /**
   * `Idempotency-Key` for state-changing calls. Required to make a retry of a
   * POST/PUT/PATCH/DELETE safe after a timeout.
   */
  idempotencyKey?: string;
  /** `false` disables retries, a number overrides `maxRetries`. */
  retry?: boolean | number;
  /** Abort the in-flight attempt. */
  signal?: AbortSignal;
}

export interface ListPromptsParams {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
}

export interface PromptSummary {
  id: string;
  title?: string;
  owner?: string;
  price?: number;
  [key: string]: unknown;
}

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
  expiresAt?: string | null;
  gracePeriodUntil?: string | null;
  autoRotated?: boolean;
  createdAt?: string;
}

/** `POST /api-keys` response — `plaintext` is returned exactly once. */
export interface CreatedApiKey {
  key: ApiKeySummary;
  plaintext: string;
}

/** Events a webhook subscription may listen for. */
export const WEBHOOK_EVENTS = [
  "PromptCreated",
  "PromptPurchased",
  "PromptPriceUpdated",
  "LicenseTransferred",
  "DisputeOpened",
  "DisputeResolved",
  "EncryptionRotated",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export interface RegisterWebhookParams {
  walletAddress: string;
  url: string;
  /** Defaults to `["PromptPurchased"]` server-side. */
  events?: WebhookEventName[];
}

export interface WebhookRegistration {
  message?: string;
  id?: string;
  /** HMAC secret used to sign deliveries. Store it securely. */
  secret: string;
}

export interface WalletScopedParams {
  walletAddress: string;
}
