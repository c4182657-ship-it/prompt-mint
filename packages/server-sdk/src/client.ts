/**
 * PromptHashServerClient — server-side HTTP client for the Prompt Mint API.
 *
 * Adds the things a backend integration needs on top of plain `fetch`:
 * API-key authentication, `Accept-Version` negotiation, `Idempotency-Key`
 * support, typed errors with machine-readable codes, and bounded retry with
 * backoff that honours `Retry-After` and the `reset` field on 429 responses.
 */

import {
  apiErrorFromParts,
  PromptHashApiError,
  PromptHashNetworkError,
} from "./errors.js";
import type {
  ApiKeySummary,
  CreatedApiKey,
  FetchLike,
  FetchRequestInit,
  HttpResponseLike,
  ListPromptsParams,
  PromptSummary,
  RegisterWebhookParams,
  RequestOptions,
  ServerClientConfig,
  WebhookRegistration,
} from "./types.js";

const DEFAULT_API_VERSION = "latest";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_RETRY_MAX_MS = 10_000;

/** `GET /api/prompts` page envelope (indexer-backed read model). */
export type MarketplacePage = Record<string, unknown> & {
  prompts?: PromptSummary[];
  items?: PromptSummary[];
  total?: number;
  page?: number;
};

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class PromptHashServerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly transport: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: ServerClientConfig) {
    if (!config || typeof config.baseUrl !== "string" || !config.baseUrl.trim()) {
      throw new TypeError("PromptHashServerClient requires a baseUrl.");
    }

    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    this.apiKey = config.apiKey?.trim() || undefined;
    this.apiVersion = config.apiVersion?.trim() || DEFAULT_API_VERSION;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, config.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryBaseDelayMs = Math.max(
      1,
      config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS,
    );
    this.retryMaxDelayMs = Math.max(
      this.retryBaseDelayMs,
      config.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_MS,
    );
    this.defaultHeaders = { ...(config.defaultHeaders ?? {}) };
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.transport = config.fetch ?? defaultTransport();
  }

  // ── Core request pipeline ───────────────────────────────────────────────

  /**
   * Perform an API request.
   *
   * Resolves with the parsed JSON body (or the raw text when the response is
   * not JSON). Rejects with {@link PromptHashApiError} for any non-2xx status
   * and {@link PromptHashNetworkError} when no response was received.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const attemptsAllowed = this.attemptBudget(options.retry);
    const headers = this.buildHeaders(options);
    const payload =
      options.body === undefined ? undefined : JSON.stringify(options.body);

    let attempt = 0;
    for (;;) {
      let res: HttpResponseLike;
      let abortedByCaller = false;

      try {
        res = await this.attemptFetch(method, url, headers, payload, options.signal);
      } catch (err) {
        abortedByCaller = Boolean(options.signal?.aborted);
        if (!abortedByCaller && attempt < attemptsAllowed) {
          await this.sleep(this.backoffMs(attempt, undefined));
          attempt += 1;
          continue;
        }
        throw new PromptHashNetworkError(
          err instanceof Error ? err.message : "Network request failed.",
          method,
          url,
          err,
        );
      }

      if (res.ok) {
        return (await readBody<T>(res)) as T;
      }

      const text = await res.text().catch(() => "");
      const error = apiErrorFromParts(res.status, res.statusText, text, res.headers, {
        method,
        url,
      });

      if (error.retryable && attempt < attemptsAllowed && !abortedByCaller) {
        await this.sleep(this.backoffMs(attempt, error));
        attempt += 1;
        continue;
      }

      throw error;
    }
  }

  get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  put<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  patch<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  // ── Marketplace ─────────────────────────────────────────────────────────

  /** `GET /api/prompts` — paginated, indexer-backed marketplace listing. */
  listPrompts(params: ListPromptsParams = {}): Promise<MarketplacePage> {
    return this.get<MarketplacePage>("/api/prompts", { query: { ...params } });
  }

  /** `GET /api/prompts/:id` — a single prompt record. */
  getPrompt(promptId: string): Promise<PromptSummary> {
    return this.get<PromptSummary>(`/api/prompts/${encodeURIComponent(promptId)}`);
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  /**
   * `POST /api/webhooks` — register or update a subscription.
   * The returned `secret` is shown once; store it to verify deliveries.
   */
  registerWebhook(params: RegisterWebhookParams): Promise<WebhookRegistration> {
    return this.post<WebhookRegistration>("/api/webhooks", { body: { ...params } });
  }

  /** `GET /api/webhooks?walletAddress=` — the wallet's subscription (secret withheld). */
  getWebhook(walletAddress: string): Promise<Record<string, unknown>> {
    return this.get("/api/webhooks", { query: { walletAddress } });
  }

  /** `DELETE /api/webhooks` — remove a subscription. */
  deleteWebhook(walletAddress: string): Promise<{ message: string }> {
    return this.delete("/api/webhooks", { body: { walletAddress } });
  }

  /**
   * `POST /api/webhooks/rotate-secret` — issue a new signing secret.
   * The previous secret stops verifying immediately.
   */
  rotateWebhookSecret(walletAddress: string): Promise<WebhookRegistration> {
    return this.post("/api/webhooks/rotate-secret", { body: { walletAddress } });
  }

  /** `POST /api/webhooks/test` — send a synthetic event and report the outcome. */
  testWebhook(walletAddress: string): Promise<Record<string, unknown>> {
    return this.post("/api/webhooks/test", { body: { walletAddress } });
  }

  /** `GET /api/webhooks/deliveries?walletAddress=` — recent delivery attempts. */
  listWebhookDeliveries(walletAddress: string): Promise<unknown[]> {
    return this.get("/api/webhooks/deliveries", { query: { walletAddress } });
  }

  /**
   * `GET /api/webhooks/dead-letters?walletAddress=` — deliveries that exhausted
   * their retry budget.
   */
  listWebhookDeadLetters(
    walletAddress: string,
    options: { resolved?: boolean; limit?: number } = {},
  ): Promise<unknown[]> {
    return this.get("/api/webhooks/dead-letters", {
      query: {
        walletAddress,
        ...(options.resolved === undefined
          ? {}
          : { resolved: options.resolved ? "true" : "false" }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      },
    });
  }

  // ── API keys (routes under /api-keys) ───────────────────────────────────

  /** `GET /api-keys?ownerWallet=` — masked key list for the owner. */
  listApiKeys(ownerWallet: string): Promise<{ keys: ApiKeySummary[] }> {
    return this.get("/api-keys", { query: { ownerWallet } });
  }

  /**
   * `POST /api-keys` — mint a key. `plaintext` is returned exactly once.
   */
  createApiKey(params: {
    ownerWallet: string;
    label: string;
    scopes?: Array<"read" | "write" | "admin">;
    rateLimitTier?: "free" | "pro" | "enterprise";
  }): Promise<CreatedApiKey> {
    return this.post("/api-keys", { body: { ...params } });
  }

  /** `POST /api-keys/:id/rotate` — new secret, overlapping grace period. */
  rotateApiKey(
    keyId: string,
    ownerWallet: string,
  ): Promise<{ key: ApiKeySummary; plaintext: string }> {
    return this.post(`/api-keys/${encodeURIComponent(keyId)}/rotate`, {
      body: { ownerWallet },
    });
  }

  /** `DELETE /api-keys/:id` — revoke a key immediately. */
  revokeApiKey(keyId: string, ownerWallet: string): Promise<{ message: string }> {
    return this.delete(`/api-keys/${encodeURIComponent(keyId)}`, {
      body: { ownerWallet },
    });
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private buildUrl(
    path: string,
    query?: RequestOptions["query"],
  ): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
    const qs = search.toString();
    return qs ? `${this.baseUrl}${normalized}?${qs}` : `${this.baseUrl}${normalized}`;
  }

  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Version": this.apiVersion,
      "User-Agent": "prompthash-server-sdk/0.1.0",
    };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    return { ...headers, ...this.defaultHeaders, ...(options.headers ?? {}) };
  }

  private attemptBudget(retry: RequestOptions["retry"]): number {
    if (retry === false) return 0;
    if (typeof retry === "number") return Math.max(0, retry);
    return this.maxRetries;
  }

  private async attemptFetch(
    method: HttpMethod,
    url: string,
    headers: Record<string, string>,
    payload: string | undefined,
    external?: AbortSignal,
  ): Promise<HttpResponseLike> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => controller.abort();

    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener("abort", onAbort, { once: true });
    }
    if (this.timeoutMs > 0 && !controller.signal.aborted) {
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    }

    const init: FetchRequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (payload !== undefined) init.body = payload;

    try {
      return await this.transport(url, init);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    }
  }

  /** Exponential backoff with a small jitter, capped by `retryMaxDelayMs`. */
  private backoffMs(attempt: number, error: PromptHashApiError | undefined): number {
    const hinted = error?.retryAfterMs();
    if (typeof hinted === "number") {
      return Math.min(hinted, this.retryMaxDelayMs);
    }
    const base = Math.min(
      this.retryBaseDelayMs * 2 ** attempt,
      this.retryMaxDelayMs,
    );
    return base + Math.floor(Math.random() * (base * 0.25 + 1));
  }
}

function defaultTransport(): FetchLike {
  const impl = (globalThis as { fetch?: unknown }).fetch;
  if (typeof impl !== "function") {
    throw new TypeError(
      "No global fetch available. Pass `fetch` in the client config (Node 18+ provides one).",
    );
  }
  return (url, init) =>
    (impl as (u: string, i: FetchRequestInit) => Promise<HttpResponseLike>)(
      url,
      init,
    );
}

async function readBody<T>(res: HttpResponseLike): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
