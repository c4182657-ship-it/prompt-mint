import { describe, expect, it } from "vitest";
import { PromptHashServerClient } from "../src/client.js";
import { PromptHashApiError, PromptHashNetworkError } from "../src/errors.js";
import { jsonResponse, stubSleep, stubTransport } from "./support.js";

function makeClient(
  transport: ReturnType<typeof stubTransport>,
  overrides: Record<string, unknown> = {},
) {
  const { sleep, delays } = stubSleep();
  const client = new PromptHashServerClient({
    baseUrl: "https://api.example.test/",
    apiKey: "pm_abc123_supersecret",
    apiVersion: "2025-01-01",
    fetch: transport.fetch,
    sleep,
    ...overrides,
  });
  return { client, delays };
}

describe("PromptHashServerClient request pipeline", () => {
  it("requires a baseUrl", () => {
    expect(() => new PromptHashServerClient({ baseUrl: "" })).toThrow(TypeError);
  });

  it("normalises the base URL and builds the query string", async () => {
    const transport = stubTransport(jsonResponse(200, { prompts: [], total: 0 }));
    const { client } = makeClient(transport);

    await client.listPrompts({
      page: 2,
      limit: 10,
      sort: "upvotes",
      search: undefined,
    });

    expect(transport.calls[0].url).toBe(
      "https://api.example.test/api/prompts?page=2&limit=10&sort=upvotes",
    );
  });

  it("omits null query values entirely", async () => {
    const transport = stubTransport(jsonResponse(200, {}));
    const { client } = makeClient(transport);

    await client.get("/api/prompts", {
      query: { cursor: null, page: 1 },
    });

    expect(transport.calls[0].url).toBe("https://api.example.test/api/prompts?page=1");
  });

  it("sends auth, versioning, and content headers", async () => {
    const transport = stubTransport(jsonResponse(200, {}));
    const { client } = makeClient(transport);

    await client.post("/api/webhooks", {
      body: { walletAddress: "GABC" },
      idempotencyKey: "idem-1",
    });

    const { init } = transport.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer pm_abc123_supersecret");
    expect(init.headers["Accept-Version"]).toBe("2025-01-01");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Idempotency-Key"]).toBe("idem-1");
    expect(init.body).toBe(JSON.stringify({ walletAddress: "GABC" }));
  });

  it("lets per-call headers win over the defaults", async () => {
    const transport = stubTransport(jsonResponse(200, {}));
    const { client } = makeClient(transport, {
      defaultHeaders: { "X-Trace-Id": "abc", "Accept-Version": "2024-01-01" },
    });

    await client.get("/api/prompts", { headers: { "X-Trace-Id": "def" } });

    const { init } = transport.calls[0];
    expect(init.headers["X-Trace-Id"]).toBe("def");
    expect(init.headers["Accept-Version"]).toBe("2024-01-01");
  });

  it("returns raw text when the response is not JSON", async () => {
    const transport = stubTransport(jsonResponse(200, "pong"));
    const { client } = makeClient(transport);

    await expect(client.get("/health")).resolves.toBe("pong");
  });
});

describe("PromptHashServerClient error handling", () => {
  it("throws a typed error carrying the machine-readable code", async () => {
    const transport = stubTransport(
      jsonResponse(403, {
        apiVersion: "2025-01-01",
        error: "Prompt access has not been purchased.",
        code: "ACCESS_NOT_PURCHASED",
      }),
    );
    const { client, delays } = makeClient(transport);

    const failure = client.getPrompt("abc");

    await expect(failure).rejects.toBeInstanceOf(PromptHashApiError);
    await failure.catch((err: PromptHashApiError) => {
      expect(err.status).toBe(403);
      expect(err.code).toBe("ACCESS_NOT_PURCHASED");
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("not been purchased");
    });
    expect(transport.calls).toHaveLength(1);
    expect(delays).toHaveLength(0);
  });

  it("does not retry a validation failure", async () => {
    const transport = stubTransport(
      jsonResponse(400, { error: "Missing fields", code: "MISSING_FIELDS" }),
    );
    const { client } = makeClient(transport);

    await expect(client.post("/api/webhooks", { body: {} })).rejects.toBeInstanceOf(
      PromptHashApiError,
    );
    expect(transport.calls).toHaveLength(1);
  });

  it("retries a 429 using the reset timestamp, then succeeds", async () => {
    const transport = stubTransport(
      jsonResponse(429, {
        error: "Too many requests.",
        code: "RATE_LIMIT_IP",
        reset: Date.now() + 5000,
      }),
      jsonResponse(200, { prompts: [] }),
    );
    const { client, delays } = makeClient(transport);

    await expect(client.listPrompts()).resolves.toEqual({ prompts: [] });

    expect(transport.calls).toHaveLength(2);
    expect(delays).toHaveLength(1);
    expect(delays[0]).toBeGreaterThanOrEqual(4000);
    expect(delays[0]).toBeLessThanOrEqual(5000);
  });

  it("retries transient 5xx failures with exponential backoff", async () => {
    const transport = stubTransport(
      jsonResponse(503, { error: "degraded" }),
      jsonResponse(503, { error: "degraded" }),
      jsonResponse(200, { ok: true }),
    );
    const { client, delays } = makeClient(transport, {
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 1000,
    });

    await expect(client.get("/api/prompts")).resolves.toEqual({ ok: true });

    expect(transport.calls).toHaveLength(3);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[1]).toBeGreaterThanOrEqual(200);
  });

  it("retries an in-flight idempotency lock", async () => {
    const transport = stubTransport(
      jsonResponse(409, {
        error: "A request with this Idempotency-Key is still being processed.",
      }),
      jsonResponse(200, { message: "ok" }),
    );
    const { client } = makeClient(transport);

    await expect(
      client.post("/api/prompts", {
        body: { title: "t" },
        idempotencyKey: "k-1",
        retry: 1,
      }),
    ).resolves.toEqual({ message: "ok" });

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1].init.headers["Idempotency-Key"]).toBe("k-1");
  });

  it("honours `retry: false`", async () => {
    const transport = stubTransport(jsonResponse(503, { error: "degraded" }));
    const { client, delays } = makeClient(transport);

    await expect(
      client.get("/api/prompts", { retry: false }),
    ).rejects.toBeInstanceOf(PromptHashApiError);

    expect(transport.calls).toHaveLength(1);
    expect(delays).toHaveLength(0);
  });

  it("stops after the configured retry budget", async () => {
    const transport = stubTransport(jsonResponse(500, { error: "boom" }));
    const { client, delays } = makeClient(transport, { maxRetries: 3 });

    await expect(client.get("/api/prompts")).rejects.toBeInstanceOf(
      PromptHashApiError,
    );

    expect(transport.calls).toHaveLength(4);
    expect(delays).toHaveLength(3);
  });

  it("wraps transport failures in a network error", async () => {
    const transport = stubTransport(new Error("ECONNRESET"));
    const { client, delays } = makeClient(transport);

    const failure = client.get("/api/prompts");

    await expect(failure).rejects.toBeInstanceOf(PromptHashNetworkError);
    await failure.catch((err: PromptHashNetworkError) => {
      expect(err.message).toBe("ECONNRESET");
      expect(err.method).toBe("GET");
      expect(err.url).toBe("https://api.example.test/api/prompts");
    });
    expect(transport.calls).toHaveLength(3);
    expect(delays).toHaveLength(2);
  });
});

describe("PromptHashServerClient resource helpers", () => {
  it("registers a webhook subscription", async () => {
    const transport = stubTransport(
      jsonResponse(201, { id: "w1", secret: "s3cret" }),
    );
    const { client } = makeClient(transport);

    const result = await client.registerWebhook({
      walletAddress: "GABC",
      url: "https://example.test/hook",
      events: ["PromptPurchased"],
    });

    expect(result.secret).toBe("s3cret");
    expect(transport.calls[0].url).toBe("https://api.example.test/api/webhooks");
    expect(JSON.parse(transport.calls[0].init.body ?? "{}")).toEqual({
      walletAddress: "GABC",
      url: "https://example.test/hook",
      events: ["PromptPurchased"],
    });
  });

  it("scopes webhook reads by wallet", async () => {
    const transport = stubTransport(jsonResponse(200, { url: "https://x" }));
    const { client } = makeClient(transport);

    await client.listWebhookDeliveries("GABC");

    expect(transport.calls[0].url).toBe(
      "https://api.example.test/api/webhooks/deliveries?walletAddress=GABC",
    );
  });

  it("encodes path segments", async () => {
    const transport = stubTransport(jsonResponse(200, { id: "1" }));
    const { client } = makeClient(transport);

    await client.getPrompt("prompt 1/2");

    expect(transport.calls[0].url).toBe(
      "https://api.example.test/api/prompts/prompt%201%2F2",
    );
  });
});
