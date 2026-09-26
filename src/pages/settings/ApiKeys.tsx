import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Shield,
  Sliders,
  AlertTriangle,
  Code2,
  X,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@/hooks/useWallet";
import { copyToClipboard } from "@/lib/clipboard/secureClipboard";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  updateApiKeyScopes,
  type ApiScope,
  type RateLimitTier,
  type ApiKeySummary,
  SCOPE_DEFINITIONS,
  SCOPING_PRESETS,
} from "@/lib/api/apiKeys";

const TIERS: RateLimitTier[] = ["free", "pro", "enterprise"];

const CATEGORY_TITLES: Record<string, string> = {
  prompts: "Catalog & Prompts",
  licenses: "Licenses & Checkout",
  integrations: "Integrations & Telemetry",
  admin: "Root Administration",
};

export default function ApiKeysPage() {
  const { address } = useWallet();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["prompts:read", "licenses:read"]);
  const [tier, setTier] = useState<RateLimitTier>("free");
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit Scopes Modal state
  const [editingKey, setEditingKey] = useState<ApiKeySummary | null>(null);
  const [editScopes, setEditScopes] = useState<ApiScope[]>([]);
  const [isUpdatingScopes, setIsUpdatingScopes] = useState(false);

  const keysQuery = useQuery({
    queryKey: ["api-keys", address],
    queryFn: async () => (address ? listApiKeys(address) : { keys: [] }),
    enabled: Boolean(address),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["api-keys", address] });

  const toggleScope = (scope: ApiScope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const applyPreset = (presetScopes: ApiScope[]) => {
    setScopes([...presetScopes]);
  };

  const handleCreate = async () => {
    if (!address || !label.trim()) {
      setError("A key label is required.");
      return;
    }
    if (scopes.length === 0) {
      setError("Select at least one API scope.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createApiKey({
        ownerWallet: address,
        label: label.trim(),
        scopes,
        rateLimitTier: tier,
      });
      setNewPlaintext(result.plaintext);
      setLabel("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key.");
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async (id: string) => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rotateApiKey(id, address);
      setNewPlaintext(result.plaintext);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate key.");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey(id, address);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key.");
    } finally {
      setBusy(false);
    }
  };

  const openEditScopesModal = (key: ApiKeySummary) => {
    setEditingKey(key);
    setEditScopes([...key.scopes]);
  };

  const toggleEditScope = (scope: ApiScope) => {
    setEditScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleSaveEditedScopes = async () => {
    if (!editingKey || !address) return;
    if (editScopes.length === 0) {
      setError("At least one scope is required.");
      return;
    }

    setIsUpdatingScopes(true);
    setError(null);
    try {
      await updateApiKeyScopes(editingKey.id, address, editScopes);
      setEditingKey(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update scopes.");
    } finally {
      setIsUpdatingScopes(false);
    }
  };

  const copyPlaintext = async () => {
    if (!newPlaintext) return;
    const res = await copyToClipboard(newPlaintext);
    if (res.success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const copyCurlSnippet = async () => {
    const snippet = `curl -H "Authorization: Bearer <your-key>" https://api.promptmint.io/api/prompts`;
    const res = await copyToClipboard(snippet);
    if (res.success) {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2500);
    }
  };

  const keys = keysQuery.data?.keys ?? [];

  // Group scopes by category
  const categories = ["prompts", "licenses", "integrations", "admin"] as const;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-200">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">API Keys & Access Scopes</h1>
            <p className="text-sm text-slate-400">
              Provision fine-grained API credentials with resource-level scoping and rate limits.
            </p>
          </div>
        </header>

        {!address ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">
            Connect your Stellar wallet to manage developer API keys.
          </div>
        ) : (
          <>
            {newPlaintext ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5">
                <p className="text-sm font-medium text-amber-100">
                  Copy your new secret key now — it will not be displayed again.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-xs text-emerald-200">
                    {newPlaintext}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => void copyPlaintext()}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setNewPlaintext(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            {/* Create Key Section with Scoping Matrix */}
            <section className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Provision New API Key</h2>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Shield className="h-4 w-4 text-cyan-400" />
                  <span>Scoped Access Control</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1">
                  <label className="text-xs uppercase tracking-wider text-slate-400">Key Label</label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Production Catalog Bot, Zapier Bridge"
                    className="border-white/10 bg-slate-950/60 text-slate-100 text-sm"
                    aria-label="API key label"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wider text-slate-400">Rate Limit Tier</label>
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value as RateLimitTier)}
                    className="w-full rounded-md border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 h-10"
                    aria-label="Rate limit tier"
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t.toUpperCase()} ({t === "free" ? "60" : t === "pro" ? "600" : "6000"}/min)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Scoping Presets */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-slate-400">
                  Quick Scoping Presets
                </label>
                <div className="flex flex-wrap gap-2">
                  {SCOPING_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset.scopes)}
                      className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-400/50 hover:text-white transition"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scopes Grid by Category */}
              <div className="space-y-4 pt-2">
                <label className="text-xs uppercase tracking-wider text-slate-400">
                  Granular Permissions Matrix
                </label>

                {scopes.includes("admin") && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-rose-400" />
                    <span>
                      <strong>Full Administrator:</strong> This key has elevated permissions and can execute all read, write, and administrative actions.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {categories.map((cat) => {
                    const catDefs = SCOPE_DEFINITIONS.filter((d) => d.category === cat);
                    if (catDefs.length === 0) return null;
                    return (
                      <div
                        key={cat}
                        className="rounded-xl border border-white/5 bg-slate-950/40 p-4 space-y-3"
                      >
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                          {CATEGORY_TITLES[cat] ?? cat}
                        </h3>
                        <div className="space-y-2">
                          {catDefs.map((def) => {
                            const isChecked = scopes.includes(def.scope);
                            return (
                              <label
                                key={def.scope}
                                className={`flex items-start gap-3 p-2 rounded-lg border cursor-pointer transition ${
                                  isChecked
                                    ? "border-cyan-400/30 bg-cyan-400/5"
                                    : "border-transparent hover:bg-white/[0.02]"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 accent-cyan-400"
                                  checked={isChecked}
                                  onChange={() => toggleScope(def.scope)}
                                />
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-white">
                                      {def.label}
                                    </span>
                                    <code className="text-[10px] font-mono text-slate-400">
                                      {def.scope}
                                    </code>
                                    <span
                                      className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-semibold ${
                                        def.riskLevel === "high"
                                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                          : def.riskLevel === "medium"
                                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                          : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                      }`}
                                    >
                                      {def.riskLevel}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-400">{def.description}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2">
                <Button
                  className="bg-cyan-300 text-slate-950 hover:bg-cyan-200 font-semibold"
                  onClick={() => void handleCreate()}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                  Generate Scoped Key
                </Button>
              </div>
            </section>

            {/* Quick Integration Example */}
            <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <Code2 className="h-4 w-4 text-cyan-400" />
                  <span>Authentication Header Example</span>
                </div>
                <button
                  onClick={() => void copyCurlSnippet()}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                >
                  {copiedSnippet ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedSnippet ? "Copied" : "Copy cURL"}
                </button>
              </div>
              <pre className="rounded-xl bg-slate-950 p-3 font-mono text-xs text-slate-300 overflow-x-auto border border-white/5">
                curl -H &quot;Authorization: Bearer pm_your_api_key&quot; https://api.promptmint.io/api/prompts
              </pre>
            </section>

            {/* Existing Keys List */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Active Developer Keys</h2>
              {keysQuery.isLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">
                  Loading keys...
                </div>
              ) : keys.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">
                  No API keys generated yet.
                </div>
              ) : (
                <ul className="space-y-3">
                  {keys.map((key) => (
                    <li
                      key={key.id}
                      className={`rounded-2xl border p-5 ${
                        key.revoked
                          ? "border-white/5 bg-white/[0.02] opacity-60"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2 max-w-xl">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-base">{key.label}</span>
                            {key.revoked && (
                              <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300 border border-rose-500/30">
                                revoked
                              </span>
                            )}
                            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 font-mono">
                              {key.rateLimitTier} ({key.rateLimit}/min)
                            </span>
                          </div>

                          <code className="block font-mono text-xs text-slate-400">
                            {key.maskedKey}
                          </code>

                          {/* Scopes badge list */}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {key.scopes.map((sc) => (
                              <span
                                key={sc}
                                className={`rounded px-2 py-0.5 text-[11px] font-mono ${
                                  sc === "admin"
                                    ? "bg-rose-500/20 text-rose-200 border border-rose-500/30"
                                    : sc.includes("write")
                                    ? "bg-amber-500/20 text-amber-200 border border-amber-500/30"
                                    : "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
                                }`}
                              >
                                {sc}
                              </span>
                            ))}
                          </div>

                          <p className="text-xs text-slate-500 pt-1">
                            Usage: {key.requestCount} requests · Last used:{" "}
                            {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "never"}
                          </p>
                        </div>

                        {!key.revoked ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditScopesModal(key)}
                              disabled={busy}
                              className="border-white/10 hover:bg-white/5 text-xs"
                            >
                              <Sliders className="mr-1.5 h-3.5 w-3.5 text-cyan-300" />
                              Edit Scopes
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleRotate(key.id)}
                              disabled={busy}
                              className="border-white/10 hover:bg-white/5 text-xs"
                            >
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              Rotate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-400/30 text-red-200 hover:bg-red-500/10 text-xs"
                              onClick={() => void handleRevoke(key.id)}
                              disabled={busy}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Revoke
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Edit Scopes Modal */}
            {editingKey && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-slate-900 p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">
                        Edit Access Scopes: {editingKey.label}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Adjust permission boundaries for key <code>{editingKey.maskedKey}</code>.
                      </p>
                    </div>
                    <button
                      onClick={() => setEditingKey(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    {categories.map((cat) => {
                      const catDefs = SCOPE_DEFINITIONS.filter((d) => d.category === cat);
                      if (catDefs.length === 0) return null;
                      return (
                        <div key={cat} className="space-y-2">
                          <h4 className="text-xs font-semibold uppercase text-cyan-300">
                            {CATEGORY_TITLES[cat] ?? cat}
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {catDefs.map((def) => {
                              const checked = editScopes.includes(def.scope);
                              return (
                                <label
                                  key={def.scope}
                                  className={`flex items-start gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition ${
                                    checked
                                      ? "border-cyan-400/40 bg-cyan-400/10 text-white"
                                      : "border-white/5 bg-slate-950/40 text-slate-300 hover:border-white/10"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 accent-cyan-400"
                                    checked={checked}
                                    onChange={() => toggleEditScope(def.scope)}
                                  />
                                  <div>
                                    <div className="font-medium">{def.label}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">
                                      {def.scope}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingKey(null)}
                      disabled={isUpdatingScopes}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleSaveEditedScopes()}
                      disabled={isUpdatingScopes}
                      className="bg-cyan-300 text-slate-950 hover:bg-cyan-200 font-semibold"
                    >
                      {isUpdatingScopes ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      Save Scopes
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
