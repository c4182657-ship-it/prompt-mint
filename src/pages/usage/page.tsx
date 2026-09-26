import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import {
  Key,
  Activity,
  Clock,
  BarChart3,
  AlertCircle,
  Search,
  RefreshCw,
} from "lucide-react";

interface KeyUsage {
  key: string;
  totalCalls: number;
  callsToday: number;
  callsThisWeek: number;
  lastCallAt: string | null;
  endpoints: Record<string, number>;
}

interface UsageSummary {
  totalKeys: number;
  totalCalls: number;
  keys: Array<{
    key: string;
    totalCalls: number;
    callsToday: number;
    lastCallAt: string | null;
  }>;
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-xl bg-white/5">{icon}</div>
        <p className="text-xs uppercase tracking-wider text-slate-400">{title}</p>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function EndpointBar({ endpoint, count, max }: { endpoint: string; count: number; max: number }) {
  const width = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <code className="text-xs text-slate-300 w-48 truncate">{endpoint}</code>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500/60 rounded-full"
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 w-12 text-right">{count}</span>
    </div>
  );
}

export default function UsageDashboardPage() {
  const [apiKey, setApiKey] = useState("");
  const [searchKey, setSearchKey] = useState("");

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery({
    queryKey: ["usage-summary"],
    queryFn: async (): Promise<UsageSummary> => {
      const res = await fetch("/api/usage");
      if (!res.ok) throw new Error("Failed to fetch usage summary");
      return res.json();
    },
  });

  const { data: keyUsage, isLoading: keyLoading, refetch: refetchKey } = useQuery({
    queryKey: ["usage-key", searchKey],
    queryFn: async (): Promise<KeyUsage> => {
      const res = await fetch(`/api/usage?key=${encodeURIComponent(searchKey)}`);
      if (!res.ok) throw new Error("Failed to fetch key usage");
      return res.json();
    },
    enabled: Boolean(searchKey),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchKey(apiKey.trim());
  }

  const endpoints = keyUsage?.endpoints
    ? Object.entries(keyUsage.endpoints).sort((a, b) => b[1] - a[1])
    : [];
  const maxEndpointCount = endpoints.length > 0 ? endpoints[0][1] : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Developer Usage Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">
            Monitor your API key usage, call counts, and endpoint breakdown
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            title="Total API Keys"
            value={summary?.totalKeys ?? (summaryLoading ? "..." : 0)}
            icon={<Key className="h-5 w-5 text-blue-400" />}
          />
          <StatCard
            title="Total Calls"
            value={summary?.totalCalls ?? (summaryLoading ? "..." : 0)}
            icon={<Activity className="h-5 w-5 text-emerald-400" />}
          />
          <StatCard
            title="Calls Today"
            value={
              summary?.keys.reduce((sum, k) => sum + k.callsToday, 0) ??
              (summaryLoading ? "..." : 0)
            }
            icon={<BarChart3 className="h-5 w-5 text-purple-400" />}
          />
        </div>

        {/* Key Lookup */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Look up API key</h2>
            <button
              onClick={() => { refetchSummary(); if (searchKey) refetchKey(); }}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4 text-slate-400" />
            </button>
          </div>
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-medium transition-colors"
            >
              Search
            </button>
          </form>
        </div>

        {/* Key Details */}
        {searchKey && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 mb-8">
            {keyLoading ? (
              <div className="text-center py-8 text-slate-400">Loading...</div>
            ) : keyUsage ? (
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <Key className="h-5 w-5 text-emerald-400" />
                  <h2 className="text-lg font-semibold">
                    {keyUsage.key.slice(0, 16)}...
                  </h2>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                  <div className="rounded-xl bg-white/5 p-4 text-center">
                    <p className="text-2xl font-bold text-white">{keyUsage.totalCalls}</p>
                    <p className="text-xs text-slate-400 mt-1">Total Calls</p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-4 text-center">
                    <p className="text-2xl font-bold text-white">{keyUsage.callsToday}</p>
                    <p className="text-xs text-slate-400 mt-1">Today</p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-4 text-center">
                    <p className="text-2xl font-bold text-white">{keyUsage.callsThisWeek}</p>
                    <p className="text-xs text-slate-400 mt-1">This Week</p>
                  </div>
                  <div className="rounded-xl bg-white/5 p-4 text-center">
                    <p className="text-sm font-medium text-white">
                      {keyUsage.lastCallAt
                        ? new Date(keyUsage.lastCallAt).toLocaleString()
                        : "Never"}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Last Call</p>
                  </div>
                </div>

                {endpoints.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-300 mb-3">
                      Calls by Endpoint
                    </h3>
                    <div className="space-y-2">
                      {endpoints.map(([endpoint, count]) => (
                        <EndpointBar
                          key={endpoint}
                          endpoint={endpoint}
                          count={count}
                          max={maxEndpointCount}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <AlertCircle className="h-8 w-8 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-400">No usage data found for this key</p>
              </div>
            )}
          </div>
        )}

        {/* All Keys Table */}
        {!searchKey && summary && summary.keys.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-lg font-semibold mb-4">All API Keys</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-xs uppercase tracking-wider text-slate-400">Key</th>
                    <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-slate-400">Total</th>
                    <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-slate-400">Today</th>
                    <th className="text-right py-3 px-4 text-xs uppercase tracking-wider text-slate-400">Last Call</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.keys.map((k) => (
                    <tr key={k.key} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="py-3 px-4">
                        <code className="text-xs text-slate-300">{k.key}</code>
                      </td>
                      <td className="py-3 px-4 text-right text-white">{k.totalCalls}</td>
                      <td className="py-3 px-4 text-right text-white">{k.callsToday}</td>
                      <td className="py-3 px-4 text-right text-slate-400">
                        {k.lastCallAt ? new Date(k.lastCallAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!searchKey && summary && summary.keys.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <Clock className="h-8 w-8 text-slate-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No usage data yet</h3>
            <p className="text-sm text-slate-400">
              API usage will appear here once requests are made with API keys.
            </p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
