import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  PromptHashApiError,
  apiErrorFromParts,
  isRetryable,
  parseRetryAfter,
} from "../src/errors.js";
import { EMPTY_HEADERS } from "./support.js";

describe("isRetryable", () => {
  it("retries throttles and transient server failures", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryable(status), `status ${status}`).toBe(true);
    }
  });

  it("never retries client mistakes", () => {
    for (const status of [400, 401, 403, 404, 405, 410, 422]) {
      expect(isRetryable(status), `status ${status}`).toBe(false);
    }
  });

  it("never retries INTEGRITY_FAILURE even though it ships as 500", () => {
    expect(isRetryable(500, ERROR_CODES.INTEGRITY_FAILURE)).toBe(false);
  });

  it("never retries ACCESS_NOT_PURCHASED", () => {
    expect(isRetryable(403, ERROR_CODES.ACCESS_NOT_PURCHASED)).toBe(false);
  });

  it("retries the in-flight Idempotency-Key lock", () => {
    expect(
      isRetryable(
        409,
        undefined,
        "A request with this Idempotency-Key is still being processed.",
      ),
    ).toBe(true);
  });

  it("does not retry an idempotency key reused for a different request", () => {
    expect(
      isRetryable(
        409,
        undefined,
        "This Idempotency-Key was already used with a different request.",
      ),
    ).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(" 12 ")).toBe(12000);
  });

  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  it("ignores absent or junk values", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("apiErrorFromParts", () => {
  it("reads the serverless envelope", () => {
    const error = apiErrorFromParts(
      429,
      "Too Many Requests",
      JSON.stringify({
        apiVersion: "2025-01-01",
        error: "Too many requests. Please try again later.",
        code: "RATE_LIMIT_IP",
        reset: Date.now() + 5000,
      }),
      EMPTY_HEADERS,
      { method: "POST", url: "https://api.example.test/api/prompts" },
    );

    expect(error).toBeInstanceOf(PromptHashApiError);
    expect(error.status).toBe(429);
    expect(error.code).toBe("RATE_LIMIT_IP");
    expect(error.apiVersion).toBe("2025-01-01");
    expect(error.message).toContain("Too many requests");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs()).toBeGreaterThanOrEqual(4000);
    expect(error.method).toBe("POST");
  });

  it("prefers the reset timestamp over the Retry-After header", () => {
    const now = Date.now();
    const error = apiErrorFromParts(
      429,
      "Too Many Requests",
      JSON.stringify({ error: "slow down", reset: now + 7000 }),
      { get: (name) => (name === "retry-after" ? "1" : null) },
    );

    expect(error.retryAfterMs()).toBeGreaterThanOrEqual(6000);
    expect(error.retryAfterHeaderMs).toBe(1000);
  });

  it("falls back to the Retry-After header when reset is absent", () => {
    const error = apiErrorFromParts(
      429,
      "Too Many Requests",
      JSON.stringify({ error: "slow down" }),
      { get: (name) => (name === "retry-after" ? "4" : null) },
    );

    expect(error.retryAfterMs()).toBe(4000);
  });

  it("handles an Express body that has no apiVersion", () => {
    const error = apiErrorFromParts(
      404,
      "Not Found",
      JSON.stringify({ error: "Prompt not found.", code: "NOT_FOUND" }),
      EMPTY_HEADERS,
    );

    expect(error.code).toBe("NOT_FOUND");
    expect(error.apiVersion).toBeUndefined();
    expect(error.retryable).toBe(false);
  });

  it("survives a non-JSON body", () => {
    const error = apiErrorFromParts(502, "Bad Gateway", "<html>bad</html>", EMPTY_HEADERS);

    expect(error.code).toBeUndefined();
    expect(error.message).toContain("bad");
    expect(error.retryable).toBe(true);
  });

  it("synthesises a message when the body is empty", () => {
    const error = apiErrorFromParts(503, "Service Unavailable", "", EMPTY_HEADERS);

    expect(error.message).toContain("503");
    expect(error.retryable).toBe(true);
  });

  it("serialises to a log-friendly shape", () => {
    const error = apiErrorFromParts(
      400,
      "Bad Request",
      JSON.stringify({ error: "bad", code: "INVALID_INPUT" }),
      EMPTY_HEADERS,
      { url: "https://api.example.test/x" },
    );

    expect(error.toJSON()).toMatchObject({
      name: "PromptHashApiError",
      status: 400,
      code: "INVALID_INPUT",
      message: "bad",
    });
  });
});
