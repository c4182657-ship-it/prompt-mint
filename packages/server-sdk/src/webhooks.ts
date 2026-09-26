/**
 * Webhook delivery verification.
 *
 * Outbound deliveries are signed with HMAC-SHA256 over the **raw request
 * body** and sent as `X-PromptHash-Signature: sha256=<hex>`. The signature
 * covers the whole JSON envelope, including `timestamp` and `deliveryId`, so
 * verifying the signature is enough to trust those fields.
 *
 * Always verify against the raw body — never a re-serialised object, because
 * whitespace and key order change the digest.
 *
 * Mirrors `signWebhookPayload` / `verifyWebhookSignature` in
 * `server/src/services/webhookDispatcher.ts`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "X-PromptHash-Signature";
export const DELIVERY_HEADER = "X-PromptHash-Delivery";
export const EVENT_HEADER = "X-PromptHash-Event";
export const TIMESTAMP_HEADER = "X-PromptHash-Timestamp";
export const SCHEMA_VERSION_HEADER = "X-PromptHash-Schema-Version";
export const SIGNATURE_PREFIX = "sha256=";

/** Default replay window in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Shape of the outbound webhook body. */
export interface WebhookEnvelope {
  /** Numeric envelope version. */
  version?: number;
  /** Stable date-string identifying the payload schema. */
  schemaVersion?: string;
  event: string;
  deliveryId: string;
  /** ISO-8601 UTC timestamp of dispatch. */
  timestamp: string;
  data: Record<string, unknown>;
}

export type WebhookFailureReason =
  | "missing_secret"
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_signature"
  | "signature_mismatch"
  | "stale_timestamp"
  | "future_timestamp"
  | "invalid_payload"
  | "duplicate_delivery";

/** Raised by {@link verifyWebhook}; `reason` is safe to log and branch on. */
export class WebhookVerificationError extends Error {
  readonly reason: WebhookFailureReason;

  constructor(reason: WebhookFailureReason, message: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

/** Case-insensitive header bag — Node's `req.headers` works as-is. */
export type HeaderBag =
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

/** Compute the `sha256=<hex>` signature for a raw body. */
export function signWebhookBody(secret: string, body: string): string {
  if (!secret) throw new WebhookVerificationError("missing_secret", "Webhook secret is required.");
  return SIGNATURE_PREFIX + createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Constant-time signature check. Returns `false` (never throws) for anything
 * that is not exactly the expected digest.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null | undefined,
): boolean {
  if (!secret || !signature) return false;

  const expected = Buffer.from(signWebhookBody(secret, body), "utf8");
  const received = Buffer.from(signature.trim(), "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export interface VerifyWebhookOptions {
  /** Maximum accepted clock skew in seconds. Defaults to 300. */
  toleranceSeconds?: number;
  /** Injected clock for deterministic tests (epoch milliseconds). */
  now?: number;
  /** When supplied, repeated `deliveryId`s are rejected. */
  replayGuard?: WebhookReplayGuard;
}

/**
 * Verify a delivery and return its parsed envelope.
 *
 * @param secret  The subscription secret returned at registration time
 * @param body    The raw request body exactly as received
 * @param headers The request headers (case-insensitive)
 * @throws {WebhookVerificationError} when anything fails to check out
 */
export function verifyWebhook(
  secret: string,
  body: string,
  headers: HeaderBag,
  options: VerifyWebhookOptions = {},
): WebhookEnvelope {
  if (!secret) {
    throw new WebhookVerificationError("missing_secret", "Webhook secret is required.");
  }

  const signature = readHeader(headers, SIGNATURE_HEADER);
  if (!signature) {
    throw new WebhookVerificationError(
      "missing_signature",
      `${SIGNATURE_HEADER} header is missing.`,
    );
  }
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    throw new WebhookVerificationError(
      "malformed_signature",
      `${SIGNATURE_HEADER} must start with ${SIGNATURE_PREFIX}.`,
    );
  }
  if (!verifyWebhookSignature(secret, body, signature)) {
    throw new WebhookVerificationError(
      "signature_mismatch",
      "Webhook signature does not match the request body.",
    );
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = JSON.parse(body) as WebhookEnvelope;
  } catch {
    throw new WebhookVerificationError(
      "invalid_payload",
      "Webhook body is not valid JSON.",
    );
  }
  if (!envelope || typeof envelope !== "object") {
    throw new WebhookVerificationError(
      "invalid_payload",
      "Webhook body is not an object.",
    );
  }
  if (typeof envelope.event !== "string" || !envelope.event) {
    throw new WebhookVerificationError(
      "invalid_payload",
      "Webhook envelope is missing `event`.",
    );
  }
  if (typeof envelope.deliveryId !== "string" || !envelope.deliveryId) {
    throw new WebhookVerificationError(
      "invalid_payload",
      "Webhook envelope is missing `deliveryId`.",
    );
  }

  assertFreshness(
    readHeader(headers, TIMESTAMP_HEADER) ?? envelope.timestamp,
    options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    options.now ?? Date.now(),
  );

  if (options.replayGuard && !options.replayGuard.accept(envelope.deliveryId)) {
    throw new WebhookVerificationError(
      "duplicate_delivery",
      `Delivery ${envelope.deliveryId} has already been processed.`,
    );
  }

  return envelope;
}

/**
 * Bounded set of recently accepted delivery ids, so a replayed (but
 * correctly signed) delivery is rejected. Entries expire with the replay
 * window, and the oldest are evicted once `maxEntries` is reached.
 */
export class WebhookReplayGuard {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly seen = new Map<string, number>();

  constructor(options: { toleranceSeconds?: number; maxEntries?: number } = {}) {
    this.ttlMs = (options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS) * 1000;
    this.maxEntries = Math.max(1, options.maxEntries ?? 10_000);
  }

  /** Records `deliveryId`; returns `false` when it was seen inside the window. */
  accept(deliveryId: string, now: number = Date.now()): boolean {
    this.prune(now);
    if (this.seen.has(deliveryId)) return false;
    this.seen.set(deliveryId, now);
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
    return true;
  }

  /** Number of ids currently retained. */
  get size(): number {
    return this.seen.size;
  }

  private prune(now: number): void {
    for (const [id, at] of this.seen) {
      if (now - at > this.ttlMs) this.seen.delete(id);
    }
  }
}

function assertFreshness(
  raw: string | undefined,
  toleranceSeconds: number,
  now: number,
): void {
  if (!raw) {
    throw new WebhookVerificationError(
      "missing_timestamp",
      "Webhook timestamp is missing.",
    );
  }

  const numeric = /^\d+$/.test(raw);
  const at = numeric ? Number(raw) : Date.parse(raw);
  if (Number.isNaN(at)) {
    throw new WebhookVerificationError(
      "invalid_payload",
      `Webhook timestamp is not parseable: ${raw}`,
    );
  }

  // Accept either epoch milliseconds or epoch seconds.
  const epochMs = numeric && raw.length <= 10 ? at * 1000 : at;
  const skewMs = now - epochMs;
  const toleranceMs = toleranceSeconds * 1000;

  if (skewMs > toleranceMs) {
    throw new WebhookVerificationError(
      "stale_timestamp",
      "Webhook timestamp is outside the accepted replay window.",
    );
  }
  if (-skewMs > toleranceMs) {
    throw new WebhookVerificationError(
      "future_timestamp",
      "Webhook timestamp is too far in the future.",
    );
  }
}

function readHeader(headers: HeaderBag, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get(n: string): string | null }).get(name);
    return value ?? undefined;
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  const direct = bag[name] ?? bag[name.toLowerCase()];
  const value = direct ?? Object.entries(bag).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  if (Array.isArray(value)) return value[0];
  return value;
}
