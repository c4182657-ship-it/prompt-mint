import { randomBytes, createHash, timingSafeEqual } from "crypto";

/**
 * API key management for third-party integrations (#287).
 *
 * This module is intentionally free of database/Express concerns so the
 * security-sensitive logic (generation, hashing, verification, scope checks and
 * rate-limit accounting) is unit testable in isolation — mirroring the
 * `adminAuth` service pattern in this codebase.
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

export const API_SCOPES: readonly ApiScope[] = [
  "read",
  "write",
  "admin",
  "prompts:read",
  "prompts:write",
  "licenses:read",
  "licenses:write",
  "webhooks:manage",
  "analytics:read",
];

export type RateLimitTier = "free" | "pro" | "enterprise";

/** Requests allowed per rolling window (see RATE_LIMIT_WINDOW_MS). */
export const RATE_LIMIT_TIERS: Record<RateLimitTier, number> = {
  free: 60,
  pro: 600,
  enterprise: 6000,
};

export const RATE_LIMIT_WINDOW_MS = 60_000;

const KEY_PREFIX = "pm";
/** Bytes of public prefix (identifies the key without revealing the secret). */
const PREFIX_BYTES = 6;
/** Bytes of secret material. */
const SECRET_BYTES = 24;

export interface GeneratedApiKey {
  /** Full plaintext key, shown to the user exactly once. */
  plaintext: string;
  /** Public, non-secret identifier stored/displayed (masked list). */
  prefix: string;
  /** SHA-256 hash of the plaintext, safe to persist. */
  hash: string;
}

/**
 * Generates a cryptographically random API key. Format:
 *   pm_<prefix>_<secret>
 * Only the hash and prefix should ever be persisted.
 */
export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(PREFIX_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const plaintext = `${KEY_PREFIX}_${prefix}_${secret}`;
  return { plaintext, prefix, hash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a presented key against a stored hash.
 */
export function verifyApiKey(plaintext: string, storedHash: string): boolean {
  if (!plaintext || !storedHash) return false;
  const candidate = Buffer.from(hashApiKey(plaintext), "utf8");
  const expected = Buffer.from(storedHash, "utf8");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * Extracts the public prefix from a plaintext key, or null if malformed.
 */
export function parseKeyPrefix(plaintext: string): string | null {
  const parts = (plaintext ?? "").split("_");
  if (parts.length < 3 || parts[0] !== KEY_PREFIX) return null;
  return parts[1] || null;
}

/**
 * Masks a key for display: keeps the prefix, hides the secret.
 */
export function maskKey(prefix: string): string {
  return `${KEY_PREFIX}_${prefix}_${"•".repeat(8)}`;
}

export function hasScope(
  granted: readonly ApiScope[],
  required: ApiScope,
): boolean {
  if (granted.includes("admin")) return true;
  if (granted.includes(required)) return true;

  // Legacy/hierarchical mapping:
  if (required === "read") {
    return granted.some((s) => s === "read" || s === "write" || s.endsWith(":read"));
  }
  if (required === "write") {
    return granted.some((s) => s === "write" || s.endsWith(":write"));
  }

  // Broad granted scopes imply specific ones:
  if (granted.includes("write") && (required === "prompts:write" || required === "licenses:write")) {
    return true;
  }
  if ((granted.includes("read") || granted.includes("write")) && (required === "prompts:read" || required === "licenses:read" || required === "analytics:read")) {
    return true;
  }

  return false;
}

export const API_KEY_MAX_AGE_DAYS = 90;
export const API_KEY_ROTATION_GRACE_DAYS = 7;

/**
 * Checks whether an API key document is currently valid, considering revocation,
 * natural 90-day expiration, and overlapping grace period validity windows.
 */
export function isKeyValid(
  keyDoc: {
    revoked?: boolean;
    expiresAt?: Date | null;
    gracePeriodUntil?: Date | null;
  },
  now: Date = new Date(),
): boolean {
  // If the key has an expiration date that has passed, it is invalid
  if (keyDoc.expiresAt && keyDoc.expiresAt.getTime() < now.getTime()) {
    return false;
  }

  // If the key is not revoked, it is valid
  if (!keyDoc.revoked) {
    return true;
  }

  // If revoked/rotated but has an active overlapping grace period window, it is still valid
  if (keyDoc.gracePeriodUntil && keyDoc.gracePeriodUntil.getTime() >= now.getTime()) {
    return true;
  }

  return false;
}

export function computeExpirationDate(
  fromDate: Date = new Date(),
  maxAgeDays: number = API_KEY_MAX_AGE_DAYS,
): Date {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + maxAgeDays);
  return d;
}

export function computeGracePeriodDate(
  fromDate: Date = new Date(),
  graceDays: number = API_KEY_ROTATION_GRACE_DAYS,
): Date {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + graceDays);
  return d;
}

export function isValidScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export function rateLimitForTier(tier: RateLimitTier): number {
  return RATE_LIMIT_TIERS[tier] ?? RATE_LIMIT_TIERS.free;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * In-memory fixed-window rate limiter. Chosen over Redis because rate limiting
 * infrastructure is not otherwise present in this codebase; the accounting is
 * behind a small interface so a shared store can replace it later.
 */
export class InMemoryRateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  check(keyId: string, limit: number): RateLimitResult {
    const current = this.now();
    const existing = this.windows.get(keyId);

    if (!existing || current >= existing.resetAt) {
      this.windows.set(keyId, { count: 1, resetAt: current + this.windowMs });
      return { allowed: true, remaining: limit - 1, limit };
    }

    if (existing.count >= limit) {
      return { allowed: false, remaining: 0, limit };
    }

    existing.count += 1;
    return { allowed: true, remaining: limit - existing.count, limit };
  }

  reset(keyId?: string): void {
    if (keyId) this.windows.delete(keyId);
    else this.windows.clear();
  }
}
