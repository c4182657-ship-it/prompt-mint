import { describe, expect, it } from "vitest";
import {
  SIGNATURE_HEADER,
  WebhookReplayGuard,
  WebhookVerificationError,
  signWebhookBody,
  verifyWebhook,
  verifyWebhookSignature,
} from "../src/webhooks.js";

const SECRET = "d1a4f0c6b2e84a1f9c7d3e5b6a8f0c2d";
const NOW = Date.parse("2026-09-24T12:00:00.000Z");

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    schemaVersion: "2025-01-01",
    event: "PromptPurchased",
    deliveryId: "9d1c0d3e-0000-4000-8000-000000000001",
    timestamp: new Date(NOW).toISOString(),
    data: { promptId: "p1", buyer: "GABC" },
    ...overrides,
  });
}

function signedHeaders(body: string, extra: Record<string, string> = {}) {
  return {
    "x-prompthash-signature": signWebhookBody(SECRET, body),
    ...extra,
  } as Record<string, string>;
}

function expectReason(fn: () => unknown, reason: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WebhookVerificationError);
    expect((err as WebhookVerificationError).reason).toBe(reason);
    return;
  }
  throw new Error(`expected WebhookVerificationError "${reason}"`);
}

describe("webhook signing", () => {
  it("produces a sha256= hex digest", () => {
    const signature = signWebhookBody(SECRET, envelope());

    expect(signature.startsWith("sha256=")).toBe(true);
    expect(signature.slice(7)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same secret and body", () => {
    const body = envelope();
    expect(signWebhookBody(SECRET, body)).toBe(signWebhookBody(SECRET, body));
  });

  it("changes when either the secret or the body changes", () => {
    const body = envelope();
    const base = signWebhookBody(SECRET, body);

    expect(signWebhookBody(`${SECRET}x`, body)).not.toBe(base);
    expect(signWebhookBody(SECRET, `${body} `)).not.toBe(base);
  });

  it("rejects an empty secret at signing time", () => {
    expect(() => signWebhookBody("", "{}")).toThrow(WebhookVerificationError);
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts the matching signature", () => {
    const body = envelope();
    expect(
      verifyWebhookSignature(SECRET, body, signWebhookBody(SECRET, body)),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = envelope();
    const signature = signWebhookBody(SECRET, body);
    const tampered = envelope({ data: { promptId: "p2" } });

    expect(verifyWebhookSignature(SECRET, tampered, signature)).toBe(false);
  });

  it("rejects a different secret, a missing signature, and a short digest", () => {
    const body = envelope();
    const signature = signWebhookBody(SECRET, body);

    expect(verifyWebhookSignature(`${SECRET}x`, body, signature)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, "sha256=deadbeef")).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, "not-a-signature")).toBe(false);
  });
});

describe("verifyWebhook", () => {
  it("parses a valid delivery", () => {
    const body = envelope();

    const result = verifyWebhook(SECRET, body, signedHeaders(body), { now: NOW });

    expect(result.event).toBe("PromptPurchased");
    expect(result.schemaVersion).toBe("2025-01-01");
    expect(result.deliveryId).toContain("-");
    expect(result.data).toEqual({ promptId: "p1", buyer: "GABC" });
  });

  it("accepts a Headers-like object with a get() method", () => {
    const body = envelope();
    const headers = {
      get: (name: string) =>
        name.toLowerCase() === SIGNATURE_HEADER.toLowerCase()
          ? signWebhookBody(SECRET, body)
          : null,
    };

    const result = verifyWebhook(SECRET, body, headers, { now: NOW });
    expect(result.event).toBe("PromptPurchased");
  });

  it("rejects a missing signature header", () => {
    const body = envelope();
    expectReason(
      () => verifyWebhook(SECRET, body, {}, { now: NOW }),
      "missing_signature",
    );
  });

  it("rejects a signature without the sha256= prefix", () => {
    const body = envelope();
    const headers = {
      [SIGNATURE_HEADER]: signWebhookBody(SECRET, body).slice(7),
    };

    expectReason(
      () => verifyWebhook(SECRET, body, headers, { now: NOW }),
      "malformed_signature",
    );
  });

  it("rejects a body that does not match the signature", () => {
    const body = envelope();
    const headers = signedHeaders(body);
    const tampered = envelope({ event: "DisputeOpened" });

    expectReason(
      () => verifyWebhook(SECRET, tampered, headers, { now: NOW }),
      "signature_mismatch",
    );
  });

  it("rejects a validly signed body that is not JSON", () => {
    const body = "<html>nope</html>";
    expectReason(
      () => verifyWebhook(SECRET, body, signedHeaders(body), { now: NOW }),
      "invalid_payload",
    );
  });

  it("rejects a JSON body without an event", () => {
    const body = JSON.stringify({ deliveryId: "d", timestamp: new Date(NOW).toISOString() });
    expectReason(
      () => verifyWebhook(SECRET, body, signedHeaders(body), { now: NOW }),
      "invalid_payload",
    );
  });

  it("rejects a delivery older than the replay window", () => {
    const body = envelope({ timestamp: new Date(NOW - 400_000).toISOString() });

    expectReason(
      () => verifyWebhook(SECRET, body, signedHeaders(body), { now: NOW }),
      "stale_timestamp",
    );
  });

  it("rejects a delivery timestamped too far in the future", () => {
    const body = envelope({ timestamp: new Date(NOW + 400_000).toISOString() });

    expectReason(
      () => verifyWebhook(SECRET, body, signedHeaders(body), { now: NOW }),
      "future_timestamp",
    );
  });

  it("lets the header timestamp win over the envelope", () => {
    const body = envelope();
    const headers = signedHeaders(body, {
      "X-PromptHash-Timestamp": new Date(NOW - 400_000).toISOString(),
    });

    expectReason(
      () => verifyWebhook(SECRET, body, headers, { now: NOW }),
      "stale_timestamp",
    );
  });

  it("accepts epoch-second timestamps", () => {
    const body = envelope({ timestamp: String(Math.floor(NOW / 1000)) });

    expect(verifyWebhook(SECRET, body, signedHeaders(body), { now: NOW }).event).toBe(
      "PromptPurchased",
    );
  });

  it("honours a custom tolerance", () => {
    const body = envelope({ timestamp: new Date(NOW - 120_000).toISOString() });

    expectReason(
      () =>
        verifyWebhook(SECRET, body, signedHeaders(body), {
          now: NOW,
          toleranceSeconds: 60,
        }),
      "stale_timestamp",
    );
  });

  it("rejects a replayed delivery when a guard is supplied", () => {
    const body = envelope();
    const headers = signedHeaders(body);
    const replayGuard = new WebhookReplayGuard({ toleranceSeconds: 600 });

    expect(
      verifyWebhook(SECRET, body, headers, { now: NOW, replayGuard }).event,
    ).toBe("PromptPurchased");
    expectReason(
      () => verifyWebhook(SECRET, body, headers, { now: NOW, replayGuard }),
      "duplicate_delivery",
    );
  });

  it("requires a secret", () => {
    expectReason(
      () => verifyWebhook("", "{}", {}, { now: NOW }),
      "missing_secret",
    );
  });
});

describe("WebhookReplayGuard", () => {
  it("remembers ids inside the window", () => {
    const guard = new WebhookReplayGuard();

    expect(guard.accept("a", NOW)).toBe(true);
    expect(guard.accept("a", NOW + 1000)).toBe(false);
    expect(guard.accept("b", NOW)).toBe(true);
    expect(guard.size).toBe(2);
  });

  it("forgets ids once the window has elapsed", () => {
    const guard = new WebhookReplayGuard({ toleranceSeconds: 60 });

    expect(guard.accept("a", NOW)).toBe(true);
    expect(guard.accept("a", NOW + 120_000)).toBe(true);
  });

  it("evicts the oldest ids once maxEntries is reached", () => {
    const guard = new WebhookReplayGuard({ maxEntries: 2 });

    guard.accept("a", NOW);
    guard.accept("b", NOW);
    guard.accept("c", NOW);

    expect(guard.size).toBe(2);
    expect(guard.accept("a", NOW)).toBe(true);
  });
});
