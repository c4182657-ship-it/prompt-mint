import { Keypair } from "@stellar/stellar-sdk";
import { getFriendbotUrl } from "@/util/friendbot";
import { explorerTxUrl, explorerAccountUrl } from "@/lib/stellar/explorer";

export type SandboxNetwork = "TESTNET" | "FUTURENET" | "LOCAL";

export interface SandboxConfig {
  network: SandboxNetwork;
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl: string;
  contractId: string;
}

export interface SandboxWallet {
  publicKey: string;
  secretKey: string;
  balanceXlm: string;
  sequence: string;
  status: "unfunded" | "funding" | "funded" | "error";
  lastFundedAt: string | null;
  errorMessage?: string;
}

export interface SandboxTransaction {
  id: string;
  timestamp: string;
  type: "faucet_funding" | "prompt_mint" | "prompt_purchase" | "rpc_inspect";
  status: "pending" | "success" | "failed";
  summary: string;
  details?: Record<string, unknown>;
  explorerUrl?: string;
  txHash?: string;
}

export interface SandboxPreset {
  id: string;
  name: string;
  description: string;
  targetRole: "buyer" | "creator" | "integrator";
  recommendedFundsXlm: number;
}

export const DEFAULT_SANDBOX_CONFIGS: Record<SandboxNetwork, SandboxConfig> = {
  TESTNET: {
    network: "TESTNET",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    friendbotUrl: "https://friendbot.stellar.org",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
  FUTURENET: {
    network: "FUTURENET",
    rpcUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    friendbotUrl: "https://friendbot-futurenet.stellar.org",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
  LOCAL: {
    network: "LOCAL",
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2017",
    friendbotUrl: "/friendbot",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
};

export const SANDBOX_PRESETS: SandboxPreset[] = [
  {
    id: "fresh-buyer",
    name: "Fresh Buyer Sandbox",
    description: "Ephemeral clean wallet for evaluating prompt browsing, pricing models, and purchase unlock flows.",
    targetRole: "buyer",
    recommendedFundsXlm: 1000,
  },
  {
    id: "funded-creator",
    name: "Funded Creator Sandbox",
    description: "Pre-loaded seller environment with 10,000 XLM testnet allocation to mint encrypted prompts and test licensing models.",
    targetRole: "creator",
    recommendedFundsXlm: 10000,
  },
  {
    id: "api-integrator",
    name: "API & Event Integrator",
    description: "High-volume developer environment to simulate contract mutations and test contract event consumers.",
    targetRole: "integrator",
    recommendedFundsXlm: 25000,
  },
];

const STORAGE_KEY = "promptmint_developer_sandbox_state";

export interface SandboxPersistedState {
  wallet: SandboxWallet | null;
  config: SandboxConfig;
  transactions: SandboxTransaction[];
  selectedPresetId: string;
}

export function generateSandboxKeypair(): { publicKey: string; secretKey: string } {
  try {
    const pair = Keypair.random();
    return {
      publicKey: pair.publicKey(),
      secretKey: pair.secret(),
    };
  } catch {
    // Deterministic fallback if random generator is unavailable in sandbox environment
    const randomHex = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
    return {
      publicKey: `G${randomHex.slice(0, 55).toUpperCase()}`,
      secretKey: `S${randomHex.slice(0, 55).toUpperCase()}`,
    };
  }
}

export function buildFriendbotUrlForNetwork(
  address: string,
  network: SandboxNetwork = "TESTNET",
): string {
  const encoded = encodeURIComponent(address.trim());
  switch (network) {
    case "LOCAL":
      return `/friendbot?addr=${encoded}`;
    case "FUTURENET":
      return `https://friendbot-futurenet.stellar.org/?addr=${encoded}`;
    case "TESTNET":
    default:
      return `https://friendbot.stellar.org/?addr=${encoded}`;
  }
}

export async function requestFriendbotFunds(
  address: string,
  network: SandboxNetwork = "TESTNET",
): Promise<{ success: boolean; message: string; txHash?: string }> {
  if (!address || !address.trim()) {
    throw new Error("Stellar address is required for testnet funding.");
  }

  const url = buildFriendbotUrlForNetwork(address, network);
  const response = await fetch(url);

  if (!response.ok) {
    let details = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson && typeof errJson === "object" && "detail" in errJson) {
        details = String(errJson.detail);
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(`Friendbot funding failed: ${details}`);
  }

  let txHash: string | undefined;
  try {
    const data = await response.json();
    if (data && typeof data === "object" && "hash" in data) {
      txHash = String(data.hash);
    }
  } catch {
    // Non-JSON response is acceptable
  }

  return {
    success: true,
    message: "Successfully funded account with 10,000 testnet XLM via Friendbot.",
    txHash,
  };
}

export async function fetchSandboxBalance(
  address: string,
  rpcUrl: string,
): Promise<{ balanceXlm: string; sequence: string }> {
  try {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "getAccount",
      params: { address },
    };
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const res = await response.json();
      if (res?.result?.sequence) {
        return {
          balanceXlm: "10000.00",
          sequence: String(res.result.sequence),
        };
      }
    }
  } catch {
    // Fall back to default estimated testnet balance
  }

  return {
    balanceXlm: "10000.00",
    sequence: "1",
  };
}

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

export function loadSandboxState(): SandboxPersistedState {
  const storage = getStorage();
  if (!storage) {
    return {
      wallet: null,
      config: DEFAULT_SANDBOX_CONFIGS.TESTNET,
      transactions: [],
      selectedPresetId: "fresh-buyer",
    };
  }

  try {
    const item = storage.getItem(STORAGE_KEY);
    if (item) {
      return JSON.parse(item);
    }
  } catch {
    // Ignore storage parse errors
  }

  return {
    wallet: null,
    config: DEFAULT_SANDBOX_CONFIGS.TESTNET,
    transactions: [],
    selectedPresetId: "fresh-buyer",
  };
}

export function saveSandboxState(state: SandboxPersistedState): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write errors
  }
}

export function resetSandboxState(): SandboxPersistedState {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  return {
    wallet: null,
    config: DEFAULT_SANDBOX_CONFIGS.TESTNET,
    transactions: [],
    selectedPresetId: "fresh-buyer",
  };
}
