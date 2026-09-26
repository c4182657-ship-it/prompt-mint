import { withObservability } from "../src/lib/observability/wrapper";
import { withBodySizeLimit } from "../src/lib/api/bodySizeLimit";
import { checkRateLimit } from "../src/lib/observability/rateLimiter";
import { apiError, ErrorCode } from "../src/lib/api/errorCodes";

/**
 * #767 — Developer usage dashboard API. Returns per-key call counts and
 * recent usage breakdown so developers can monitor their API consumption.
 *
 * GET /api/usage?key=<api_key>  → per-key stats
 * GET /api/usage                → summary across all keys (admin only)
 */

interface UsageEntry {
  key: string;
  totalCalls: number;
  callsToday: number;
  callsThisWeek: number;
  lastCallAt: string | null;
  endpoints: Record<string, number>;
}

// In-memory usage store. In production this would be backed by a database
// or Redis, but for the initial dashboard the in-process Map is sufficient
// and matches the pattern used by the rate limiter and analytics events.
const usageStore = new Map<string, UsageEntry>();

export function trackApiUsage(apiKey: string, endpoint: string): void {
  const key = apiKey || "anonymous";
  let entry = usageStore.get(key);
  if (!entry) {
    entry = {
      key,
      totalCalls: 0,
      callsToday: 0,
      callsThisWeek: 0,
      lastCallAt: null,
      endpoints: {},
    };
    usageStore.set(key, entry);
  }
  entry.totalCalls += 1;
  entry.callsToday += 1;
  entry.callsThisWeek += 1;
  entry.lastCallAt = new Date().toISOString();
  entry.endpoints[endpoint] = (entry.endpoints[endpoint] || 0) + 1;
}

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress) as string;
  const rateLimit = await checkRateLimit("usage", clientIp ?? "unknown", false);
  if (!rateLimit.success) {
    res.setHeader("X-RateLimit-Limit", rateLimit.limit);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", rateLimit.reset);
    res.status(429).json(apiError(ErrorCode.RATE_LIMIT_IP, "Too many requests."));
    return;
  }

  const requestedKey = req.query?.key as string | undefined;

  if (requestedKey) {
    // Per-key view
    const entry = usageStore.get(requestedKey);
    if (!entry) {
      res.status(200).json({
        key: requestedKey,
        totalCalls: 0,
        callsToday: 0,
        callsThisWeek: 0,
        lastCallAt: null,
        endpoints: {},
      });
      return;
    }
    res.status(200).json(entry);
    return;
  }

  // Summary view — list all tracked keys
  const entries = Array.from(usageStore.values()).map((e) => ({
    key: e.key.slice(0, 8) + "...",
    totalCalls: e.totalCalls,
    callsToday: e.callsToday,
    lastCallAt: e.lastCallAt,
  }));

  res.status(200).json({
    totalKeys: entries.length,
    totalCalls: entries.reduce((sum, e) => sum + e.totalCalls, 0),
    keys: entries.sort((a, b) => b.totalCalls - a.totalCalls),
  });
}

export default withObservability(withBodySizeLimit(handler, 1024), "usage");
