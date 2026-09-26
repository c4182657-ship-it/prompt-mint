import { useState, useEffect } from "react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/clipboard/secureClipboard";
import {
  Coins,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  Eye,
  EyeOff,
  Terminal,
  Activity,
  Send,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Play,
} from "lucide-react";
import {
  SandboxConfig,
  SandboxNetwork,
  SandboxPreset,
  SandboxTransaction,
  SandboxWallet,
  DEFAULT_SANDBOX_CONFIGS,
  SANDBOX_PRESETS,
  generateSandboxKeypair,
  requestFriendbotFunds,
  loadSandboxState,
  saveSandboxState,
  resetSandboxState,
} from "@/lib/stellar/sandbox";

export default function DeveloperSandboxPage() {
  const [network, setNetwork] = useState<SandboxNetwork>("TESTNET");
  const [config, setConfig] = useState<SandboxConfig>(DEFAULT_SANDBOX_CONFIGS.TESTNET);
  const [wallet, setWallet] = useState<SandboxWallet | null>(null);
  const [transactions, setTransactions] = useState<SandboxTransaction[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("fresh-buyer");

  const [showSecretKey, setShowSecretKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isFunding, setIsFunding] = useState(false);
  const [fundingMessage, setFundingMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Custom address funding input
  const [customAddress, setCustomAddress] = useState("");
  const [isFundingCustom, setIsFundingCustom] = useState(false);

  // Interactive playground simulation states
  const [simPromptTitle, setSimPromptTitle] = useState("Production Llama-3 System Prompt");
  const [simPromptPrice, setSimPromptPrice] = useState("25");
  const [isSimulating, setIsSimulating] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    const saved = loadSandboxState();
    if (saved.wallet) setWallet(saved.wallet);
    if (saved.config) {
      setConfig(saved.config);
      setNetwork(saved.config.network);
    }
    if (saved.transactions) setTransactions(saved.transactions);
    if (saved.selectedPresetId) setSelectedPresetId(saved.selectedPresetId);
  }, []);

  // Save state on updates
  useEffect(() => {
    saveSandboxState({
      wallet,
      config,
      transactions,
      selectedPresetId,
    });
  }, [wallet, config, transactions, selectedPresetId]);

  const handleNetworkChange = (newNet: SandboxNetwork) => {
    setNetwork(newNet);
    setConfig(DEFAULT_SANDBOX_CONFIGS[newNet]);
  };

  const handleGenerateWallet = () => {
    const kp = generateSandboxKeypair();
    const newWallet: SandboxWallet = {
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      balanceXlm: "0.00",
      sequence: "0",
      status: "unfunded",
      lastFundedAt: null,
    };
    setWallet(newWallet);
    setFundingMessage(null);
    setErrorMessage(null);

    const tx: SandboxTransaction = {
      id: `tx_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: "rpc_inspect",
      status: "success",
      summary: `Generated ephemeral sandbox keypair: ${kp.publicKey.slice(0, 10)}...`,
      details: { publicKey: kp.publicKey },
    };
    setTransactions((prev) => [tx, ...prev]);
  };

  const handleCopy = async (text: string, identifier: string) => {
    const res = await copyToClipboard(text);
    if (res.success) {
      setCopiedKey(identifier);
      setTimeout(() => setCopiedKey(null), 2500);
    }
  };

  const handleFundWallet = async () => {
    if (!wallet) return;
    setIsFunding(true);
    setFundingMessage(null);
    setErrorMessage(null);

    try {
      const result = await requestFriendbotFunds(wallet.publicKey, network);
      setWallet({
        ...wallet,
        balanceXlm: "10000.00",
        sequence: "1",
        status: "funded",
        lastFundedAt: new Date().toISOString(),
      });
      setFundingMessage(result.message);

      const tx: SandboxTransaction = {
        id: `tx_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "faucet_funding",
        status: "success",
        summary: `Funded ${wallet.publicKey.slice(0, 8)}... with 10,000 testnet XLM`,
        explorerUrl: `https://stellar.expert/explorer/testnet/account/${wallet.publicKey}`,
      };
      setTransactions((prev) => [tx, ...prev]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Funding failed.";
      setErrorMessage(msg);
      setWallet({
        ...wallet,
        status: "error",
        errorMessage: msg,
      });

      const tx: SandboxTransaction = {
        id: `tx_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "faucet_funding",
        status: "failed",
        summary: `Funding request failed: ${msg}`,
      };
      setTransactions((prev) => [tx, ...prev]);
    } finally {
      setIsFunding(false);
    }
  };

  const handleFundCustomAddress = async () => {
    if (!customAddress.trim()) return;
    setIsFundingCustom(true);
    setFundingMessage(null);
    setErrorMessage(null);

    try {
      const result = await requestFriendbotFunds(customAddress.trim(), network);
      setFundingMessage(`Successfully funded custom address: ${customAddress.trim().slice(0, 10)}...`);

      const tx: SandboxTransaction = {
        id: `tx_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "faucet_funding",
        status: "success",
        summary: `Funded custom address ${customAddress.trim().slice(0, 8)}... via Friendbot`,
        explorerUrl: `https://stellar.expert/explorer/testnet/account/${customAddress.trim()}`,
      };
      setTransactions((prev) => [tx, ...prev]);
      setCustomAddress("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Funding custom address failed.";
      setErrorMessage(msg);
    } finally {
      setIsFundingCustom(false);
    }
  };

  const handlePresetSelect = (preset: SandboxPreset) => {
    setSelectedPresetId(preset.id);
    if (!wallet) {
      handleGenerateWallet();
    }
  };

  const handleSimulateMint = async () => {
    if (!wallet) {
      setErrorMessage("Generate a sandbox wallet before simulating mint operations.");
      return;
    }
    setIsSimulating(true);
    await new Promise((r) => setTimeout(r, 600));

    const tx: SandboxTransaction = {
      id: `tx_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: "prompt_mint",
      status: "success",
      summary: `Simulated Prompt Mint: "${simPromptTitle}" at ${simPromptPrice} XLM`,
      details: {
        creator: wallet.publicKey,
        priceXlm: simPromptPrice,
        status: "active",
      },
    };
    setTransactions((prev) => [tx, ...prev]);
    setIsSimulating(false);
  };

  const handleSimulatePurchase = async () => {
    if (!wallet || wallet.status !== "funded") {
      setErrorMessage("Sandbox wallet must be funded with testnet XLM to simulate purchase.");
      return;
    }
    setIsSimulating(true);
    await new Promise((r) => setTimeout(r, 600));

    const currentBal = parseFloat(wallet.balanceXlm);
    const cost = parseFloat(simPromptPrice) || 25;
    const nextBal = Math.max(0, currentBal - cost).toFixed(2);

    setWallet({
      ...wallet,
      balanceXlm: nextBal,
    });

    const tx: SandboxTransaction = {
      id: `tx_${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      type: "prompt_purchase",
      status: "success",
      summary: `Simulated Purchase: prompt unlocked for ${wallet.publicKey.slice(0, 8)}... (${cost} XLM)`,
      details: {
        buyer: wallet.publicKey,
        amountChargedXlm: cost,
        remainingBalance: nextBal,
      },
    };
    setTransactions((prev) => [tx, ...prev]);
    setIsSimulating(false);
  };

  const handleResetSandbox = () => {
    const clean = resetSandboxState();
    setWallet(clean.wallet);
    setConfig(clean.config);
    setNetwork(clean.config.network);
    setTransactions(clean.transactions);
    setSelectedPresetId(clean.selectedPresetId);
    setFundingMessage(null);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-200">
              <Terminal className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Developer Sandbox</h1>
              <p className="text-sm text-slate-400">
                Interactive sandbox environment with Stellar testnet faucet funds and contract testing utilities.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-xl border border-white/10 bg-slate-900/60 p-1">
              {(["TESTNET", "FUTURENET", "LOCAL"] as SandboxNetwork[]).map((net) => (
                <button
                  key={net}
                  onClick={() => handleNetworkChange(net)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    network === net
                      ? "bg-cyan-400 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {net}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleResetSandbox}
              className="border-white/10 text-slate-300 hover:bg-white/5"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Reset State
            </Button>
          </div>
        </header>

        {/* Status Alerts */}
        {fundingMessage && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-400" />
            <span>{fundingMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 2-Column Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left Column (2/3): Wallet & Faucet */}
          <div className="space-y-6 lg:col-span-2">
            {/* Sandbox Wallet Card */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between pb-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-cyan-300" />
                  <h2 className="text-lg font-semibold">Ephemeral Sandbox Wallet</h2>
                </div>
                <Button
                  size="sm"
                  onClick={handleGenerateWallet}
                  className="bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                >
                  Generate New Wallet
                </Button>
              </div>

              {!wallet ? (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
                  <p className="text-sm text-slate-400">
                    No active sandbox wallet. Click "Generate New Wallet" to provision a fresh Stellar keypair.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  {/* Public Key */}
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-wider text-slate-400">
                      Public Address (G...)
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-lg bg-slate-950/80 px-3 py-2 font-mono text-xs text-cyan-200 border border-white/10">
                        {wallet.publicKey}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCopy(wallet.publicKey, "pub")}
                        className="border-white/10"
                      >
                        {copiedKey === "pub" ? (
                          <Check className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Secret Key */}
                  <div className="space-y-1">
                    <label className="text-xs uppercase tracking-wider text-slate-400">
                      Secret Key (S...)
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-lg bg-slate-950/80 px-3 py-2 font-mono text-xs text-amber-200 border border-white/10">
                        {showSecretKey ? wallet.secretKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowSecretKey(!showSecretKey)}
                        className="border-white/10"
                      >
                        {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCopy(wallet.secretKey, "sec")}
                        className="border-white/10"
                      >
                        {copiedKey === "sec" ? (
                          <Check className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Balance Display & Faucet Funding Button */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wider">Testnet Balance</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-emerald-300">
                          {wallet.balanceXlm} XLM
                        </span>
                        <span className="text-xs text-slate-500">
                          ({wallet.status})
                        </span>
                      </div>
                    </div>
                    <Button
                      onClick={handleFundWallet}
                      disabled={isFunding}
                      className="bg-emerald-400 text-slate-950 hover:bg-emerald-300 font-semibold"
                    >
                      <Coins className="mr-2 h-4 w-4" />
                      {isFunding ? "Requesting from Friendbot..." : "Request 10,000 Testnet XLM"}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* Custom Address Funding Card */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-semibold">Direct Friendbot Faucet</h2>
              </div>
              <p className="text-xs text-slate-400">
                Fund any external Stellar testnet address directly through the repository faucet integration.
              </p>
              <div className="flex gap-2">
                <Input
                  value={customAddress}
                  onChange={(e) => setCustomAddress(e.target.value)}
                  placeholder="Enter G... recipient testnet address"
                  className="border-white/10 bg-slate-950/80 font-mono text-xs text-slate-200"
                />
                <Button
                  onClick={handleFundCustomAddress}
                  disabled={isFundingCustom || !customAddress.trim()}
                  className="bg-cyan-400 text-slate-950 hover:bg-cyan-300 flex-shrink-0"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {isFundingCustom ? "Funding..." : "Fund Address"}
                </Button>
              </div>
            </section>

            {/* Interactive Simulation Playground */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Play className="h-5 w-5 text-amber-300" />
                  <h2 className="text-lg font-semibold">Contract Sandbox Simulator</h2>
                </div>
                <span className="text-xs text-slate-400">Soroban Contract Mock Runner</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Prompt Title</label>
                  <Input
                    value={simPromptTitle}
                    onChange={(e) => setSimPromptTitle(e.target.value)}
                    className="border-white/10 bg-slate-950/80 text-xs text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Price (XLM)</label>
                  <Input
                    type="number"
                    value={simPromptPrice}
                    onChange={(e) => setSimPromptPrice(e.target.value)}
                    className="border-white/10 bg-slate-950/80 text-xs text-slate-100"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleSimulateMint}
                  disabled={isSimulating}
                  className="bg-cyan-400 text-slate-950 hover:bg-cyan-300 text-xs"
                >
                  Simulate Prompt Mint
                </Button>
                <Button
                  onClick={handleSimulatePurchase}
                  disabled={isSimulating}
                  variant="outline"
                  className="border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 text-xs"
                >
                  Simulate Purchase Unlock
                </Button>
              </div>
            </section>
          </div>

          {/* Right Column (1/3): Presets, Config & Activity Log */}
          <div className="space-y-6">
            {/* Presets */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-cyan-300" />
                <h3 className="font-semibold text-white">Environment Presets</h3>
              </div>
              <div className="space-y-2.5">
                {SANDBOX_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handlePresetSelect(preset)}
                    className={`w-full text-left rounded-xl p-3 border transition ${
                      selectedPresetId === preset.id
                        ? "border-cyan-400/50 bg-cyan-400/10"
                        : "border-white/5 bg-slate-950/40 hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-xs text-white">{preset.name}</span>
                      <span className="text-[10px] text-cyan-300 font-mono">
                        {preset.recommendedFundsXlm} XLM
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{preset.description}</p>
                  </button>
                ))}
              </div>
            </section>

            {/* Network Config Overview */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-slate-400">Sandbox Parameters</h3>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-slate-500">RPC Endpoint:</span>
                  <p className="font-mono text-slate-300 truncate">{config.rpcUrl}</p>
                </div>
                <div>
                  <span className="text-slate-500">Contract ID:</span>
                  <p className="font-mono text-cyan-300 truncate">{config.contractId}</p>
                </div>
                <div>
                  <span className="text-slate-500">Passphrase:</span>
                  <p className="font-mono text-slate-400 truncate">{config.networkPassphrase}</p>
                </div>
              </div>
            </section>

            {/* Activity Stream */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-400" />
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-slate-400">
                    Activity Log
                  </h3>
                </div>
                {transactions.length > 0 && (
                  <button
                    onClick={() => setTransactions([])}
                    className="text-[11px] text-slate-500 hover:text-slate-300"
                  >
                    Clear
                  </button>
                )}
              </div>

              {transactions.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No activity recorded yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {transactions.slice(0, 10).map((t) => (
                    <div
                      key={t.id}
                      className="rounded-lg border border-white/5 bg-slate-950/60 p-2 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>{t.type}</span>
                        <span>{t.timestamp}</span>
                      </div>
                      <p className="text-slate-200 text-[11px]">{t.summary}</p>
                      {t.explorerUrl && (
                        <a
                          href={t.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-cyan-400 hover:underline block"
                        >
                          View on Stellar Expert &rarr;
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
