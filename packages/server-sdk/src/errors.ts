/**
 * Typed errors and the machine-readable error codes the Prompt Mint API can
 * return. The serverless codes mirror `src/lib/api/errorCodes.ts`; the Express
 * codes mirror the `AppError` throw sites under `server/src`.
 *
 * See `docs/sdk-error-codes.md` for the full reference card.
 */

export const ERROR_CODES = {
  // ── Request errors (4xx) ────────────────────────────────────────────────
  MISSING_FIELDS: "MISSING_FIELDS",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_VERSION: "INVALID_VERSION",
  INVALID_WALLET: "INVALID_WALLET",
  CHALLENGE_MALFORMED: "CHALLENGE_MALFORMED",

  // ── Auth / access errors (4xx) ──────────────────────────────────────────
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",
  CHALLENGE_INVALID: "CHALLENGE_INVALID",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  CHALLENGE_INVALID_SIGNATURE: "CHALLENGE_INVALID_SIGNATURE",
  CHALLENGE_MISMATCH: "CHALLENGE_MISMATCH",
  ACCESS_NOT_PURCHASED: "ACCESS_NOT_PURCHASED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  KEY_NOT_FOUND: "KEY_NOT_FOUND",
  NOT_FOUND: "NOT_FOUND",

  // ── Rate limiting (429) ─────────────────────────────────────────────────
  RATE_LIMIT_IP: "RATE_LIMIT_IP",
  RATE_LIMIT_WALLET: "RATE_LIMIT_WALLET",
  RATE_LIMITED: "RATE_LIMITED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
  CAPTCHA_INVALID: "CAPTCHA_INVALID",

  // ── Concurrency / idempotency (409) ─────────────────────────────────────
  CONCURRENT_VERSION_CONFLICT: "CONCURRENT_VERSION_CONFLICT",

  // ── Analytics errors (4xx) ──────────────────────────────────────────────
  UNKNOWN_EVENT: "UNKNOWN_EVENT",
  INVALID_EVENT_PAYLOAD: "INVALID_EVENT_PAYLOAD",

  // ── Expiry (410) ────────────────────────────────────────────────────────
  EXPORT_EXPIRED: "EXPORT_EXPIRED",

  // ── Server errors (5xx) ─────────────────────────────────────────────────
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  INTEGRITY_FAILURE: "INTEGRITY_FAILURE",
  TEMPORARY_FAILURE: "TEMPORARY_FAILURE",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  WALLET_NOT_FUNDED: "WALLET_NOT_FUNDED",
} as const;

export type KnownErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Error codes the API may emit. Open on purpose: the server adds codes over
 * time, so callers should be able to compare against any string.
 */
export type ErrorCode = KnownErrorCode | (string & {});

/** HTTP statuses that are always safe to retry with backoff. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Codes that must never be retried, even when the status would otherwise be
 * retryable (e.g. `INTEGRITY_FAILURE` is returned with 500 but replaying it
 * can never succeed).
 */
const NON_RETRYABLE_CODES = new Set<string>([
  ERROR_CODES.INTEGRITY_FAILURE,
  ERROR_CODES.ACCESS_NOT_PURCHASED,
  ERROR_CODES.INVALID_INPUT,
  ERROR_CODES.MISSING_FIELDS,
  ERROR_CODES.METHOD_NOT_ALLOWED,
  ERROR_CODES.UNSUPPORTED_VERSION,
  ERROR_CODES.UNKNOWN_EVENT,
  ERROR_CODES.INVALID_EVENT_PAYLOAD,
  ERROR_CODES.CHALLENGE_EXPIRED,
  ERROR_CODES.CHALLENGE_INVALID,
  ERROR_CODES.INVALID_SIGNATURE,
]);

/** Matches the in-flight `Idempotency-Key` lock response (409). */
const IDEMPOTENCY_IN_FLIGHT = /still being processed/i;

export interface PromptHashApiErrorInit {
  status: number;
  message: string;
  code?: ErrorCode | undefined;
  apiVersion?: string | undefined;
  /** Unix epoch milliseconds at which a 429 resets. */
  reset?: number | undefined;
  /** Duration parsed from a `Retry-After` header, in milliseconds. */
  retryAfterHeaderMs?: number | undefined;
  method?: string | undefined;
  url?: string | undefined;
  /** Parsed response body, when the server returned JSON. */
  body?: unknown;
}

/**
 * Error thrown for every non-2xx API response.
 *
 * `code` is the stable machine-readable value to branch on; `message` is the
 * human-readable copy the server considers safe to display.
 */
export class PromptHashApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly apiVersion: string | undefined;
  readonly reset: number | undefined;
  readonly retryAfterHeaderMs: number | undefined;
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly body: unknown;

  constructor(init: PromptHashApiErrorInit) {
    super(init.message);
    this.name = "PromptHashApiError";
    this.status = init.status;
    this.code = init.code;
    this.apiVersion = init.apiVersion;
    this.reset = init.reset;
    this.retryAfterHeaderMs = init.retryAfterHeaderMs;
    this.method = init.method;
    this.url = init.url;
    this.body = init.body;
  }

  /** Whether replaying the identical request can succeed. */
  get retryable(): boolean {
    return isRetryable(this.status, this.code, this.message);
  }

  /**
   * How long to wait before retrying, in milliseconds, or `undefined` when the
   * server gave no hint. Prefers the `reset` timestamp on 429 responses.
   */
  retryAfterMs(now: number = Date.now()): number | undefined {
    if (typeof this.reset === "number") {
      return Math.max(0, this.reset - now);
    }
    return this.retryAfterHeaderMs;
  }

  /** Compact, log-friendly representation. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      status: this.status,
      code: this.code,
      message: this.message,
      apiVersion: this.apiVersion,
      url: this.url,
    };
  }
}

/**
 * Thrown when no response was ever received (DNS failure, connection reset,
 * timeout). The request may still have reached the server, so it is only safe
 * to retry when the caller supplied an `Idempotency-Key`.
 */
export class PromptHashNetworkError extends Error {
  readonly method: string;
  readonly url: string;

  constructor(message: string, method: string, url: string, cause?: unknown) {
    super(message);
    this.name = "PromptHashNetworkError";
    this.method = method;
    this.url = url;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Decide whether a failed request may be replayed.
 *
 * @param status  HTTP status of the response
 * @param code    Machine-readable `code` field, when present
 * @param message Human-readable `error` field, when present
 */
export function isRetryable(
  status: number,
  code?: ErrorCode | undefined,
  message?: string | undefined,
): boolean {
  if (code && NON_RETRYABLE_CODES.has(code)) return false;
  if (RETRYABLE_STATUSES.has(status)) return true;
  if (status === 409 && message && IDEMPOTENCY_IN_FLIGHT.test(message)) {
    return true;
  }
  return false;
}

/** Body shape returned by every serverless handler. */
interface ServerlessErrorBody {
  apiVersion?: unknown;
  error?: unknown;
  code?: unknown;
  reset?: unknown;
}

/** Normalises a response body into `PromptHashApiError` construction args. */
export function apiErrorFromParts(
  status: number,
  statusText: string,
  text: string,
  headers?: { get(name: string): string | null } | undefined,
  context?: { method?: string; url?: string },
): PromptHashApiError {
  let body: unknown;
  let message = "";
  let code: ErrorCode | undefined;
  let apiVersion: string | undefined;
  let reset: number | undefined;

  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = undefined;
    }
  }

  if (body && typeof body === "object") {
    const parsed = body as ServerlessErrorBody;
    if (typeof parsed.error === "string") message = parsed.error;
    if (typeof parsed.code === "string") code = parsed.code;
    if (typeof parsed.apiVersion === "string") apiVersion = parsed.apiVersion;
    if (typeof parsed.reset === "number") reset = parsed.reset;
  }

  if (!message && text) {
    // Non-JSON error body — keep it, but trim it so logs stay readable.
    message = text.slice(0, 300);
  }
  if (!message) {
    message = `Request failed with HTTP ${status}${statusText ? ` ${statusText}` : ""}.`;
  }

  return new PromptHashApiError({
    status,
    message,
    code,
    apiVersion,
    reset,
    retryAfterHeaderMs: parseRetryAfter(headers?.get("retry-after")),
    method: context?.method,
    url: context?.url,
    body,
  });
}

/**
 * Parses a `Retry-After` header, which is either delta-seconds or an
 * HTTP-date. Returns milliseconds, or `undefined` when absent/unparseable.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}
