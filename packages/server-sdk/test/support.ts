import type {
  FetchLike,
  FetchRequestInit,
  HttpResponseLike,
} from "../src/types.js";

/** Minimal `Response` stand-in so tests never need a real server. */
export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponseLike {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );

  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: STATUS_TEXT[status] ?? "",
    headers: { get: (name) => map.get(name.toLowerCase()) ?? null },
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

export interface RecordedCall {
  url: string;
  init: FetchRequestInit;
}

export interface StubTransport {
  fetch: FetchLike;
  calls: RecordedCall[];
}

/** Transport stub that replays canned responses in order. */
export function stubTransport(
  ...responses: Array<HttpResponseLike | Error>
): StubTransport {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const index = calls.length;
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    if (next instanceof Error) throw next;
    if (!next) throw new Error(`No canned response for call #${index}`);
    return next;
  };
  return { fetch, calls };
}

/** `sleep` stub that records requested delays instead of waiting. */
export function stubSleep(): {
  sleep: (ms: number) => Promise<void>;
  delays: number[];
} {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

export const EMPTY_HEADERS = { get: () => null };
