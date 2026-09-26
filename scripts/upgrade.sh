#!/bin/bash
set -e

# ─── flag parsing ────────────────────────────────────────────────────────────
DRY_RUN="false"
SKIP_BUILD="false"
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="true" ;;
    --skip-build) SKIP_BUILD="true" ;;
    --help|-h)
      cat <<'EOF'
Usage: ./scripts/upgrade.sh [--dry-run] [--skip-build] [testnet|local|mainnet]

Options:
  --dry-run     Simulate the upgrade without installing Wasm or invoking the contract.
               Runs `node scripts/upgrade-dry-run.mjs` under the hood, builds (unless
               --skip-build), hashes the Wasm, and probes the live contract via RPC.
               No transaction is submitted. Exit 0 means the plan looks safe.
  --skip-build  Skip `stellar contract build` / `optimize` (reuse existing Wasm).
  --help        Show this help.

Environment:
  NETWORK, CONTRACT_ID, ADMIN_ALIAS, RPC_URL, NETWORK_PASSPHRASE control targeting.
  See docs/operations/contract-upgrades.md and scripts/upgrade-dry-run.mjs.
EOF
      exit 0
      ;;
    testnet|local|mainnet) NETWORK="$arg" ;;
    --*) echo "Unknown flag: $arg" >&2; exit 1 ;;
    *) EXTRA_ARGS+=("$arg") ;;
  esac
done

echo "==========================================="
echo " PromptHash Contract Upgrade Script"
echo "==========================================="

# Honor positional network arg plus env var
if [ ${#EXTRA_ARGS[@]} -gt 0 ] && [ -z "$NETWORK" ]; then
  NETWORK="${EXTRA_ARGS[0]}"
fi

# Default to testnet if not specified
NETWORK=${NETWORK:-testnet}

if [ "$NETWORK" == "testnet" ]; then
    RPC_URL="https://soroban-testnet.stellar.org"
    NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
    STELLAR_NETWORK="testnet"
elif [ "$NETWORK" == "local" ]; then
    RPC_URL="http://localhost:8000"
    NETWORK_PASSPHRASE="Standalone Network ; February 2017"
    STELLAR_NETWORK="local"
else
    RPC_URL=${RPC_URL:-"http://localhost:8000"}
    NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE:-"Standalone Network ; February 2017"}
    STELLAR_NETWORK=${STELLAR_NETWORK:-"custom"}
fi

# Ensure contract ID is provided or exists in env
if [ -z "$CONTRACT_ID" ]; then
    if [ -f .env ]; then
        CONTRACT_ID=$(grep PUBLIC_PROMPT_HASH_CONTRACT_ID .env | cut -d '=' -f2 | tr -d '"' | tr -d ' ')
    fi
fi

if [ -z "$CONTRACT_ID" ] || [ "$CONTRACT_ID" == "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" ]; then
    echo "❌ Error: CONTRACT_ID is not set or is still the placeholder."
    echo "Please set it via CONTRACT_ID environment variable or in .env"
    exit 1
fi

# Admin identity
ADMIN_ALIAS=${ADMIN_ALIAS:-admin}

echo "🌐 Network: $NETWORK"
echo "📄 Contract ID: $CONTRACT_ID"
echo "🔑 Admin Alias: $ADMIN_ALIAS"

WASM_PATH="target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm"

# ─── dry-run: simulate without touching the chain ────────────────────────────
if [ "$DRY_RUN" = "true" ]; then
  echo ""
  echo "🔍 DRY-RUN mode — no transactions will be submitted."
  DRY_ARGS=(--network "$NETWORK" --contract-id "$CONTRACT_ID" --wasm "$WASM_PATH" --admin "$ADMIN_ALIAS")
  if [ "$SKIP_BUILD" = "true" ]; then DRY_ARGS+=(--skip-build); fi
  # Pass through verbosity/json if present in original invocation
  for a in "$@"; do
    case "$a" in --json|--verbose) DRY_ARGS+=("$a") ;; esac
  done
  node "$(dirname "$0")/upgrade-dry-run.mjs" "${DRY_ARGS[@]}"
  exit $?
fi

# Build and Optimize
echo ""
echo "📦 Building and optimizing new contract version..."
if [ "$SKIP_BUILD" != "true" ]; then
  stellar contract build
  stellar contract optimize --wasm target/wasm32-unknown-unknown/release/prompt_hash.wasm
else
  echo "⏭️  Skipping build (--skip-build)"
fi

# Install Wasm
echo ""
echo "⬆️ Installing new Wasm on network..."
WASM_HASH=$(stellar contract install \
    --wasm $WASM_PATH \
    --source $ADMIN_ALIAS \
    --network $NETWORK)

echo "✅ Installed Wasm with hash: $WASM_HASH"

# Invoke Upgrade
echo ""
echo "⚙️ Invoking upgrade on contract..."
stellar contract invoke \
    --id $CONTRACT_ID \
    --source $ADMIN_ALIAS \
    --network $NETWORK \
    -- \
    upgrade \
    --new_wasm_hash "$WASM_HASH"

echo "✅ Contract upgraded successfully!"

# Verification
echo ""
echo "🔍 Running post-upgrade verification..."
PROMPTS_COUNT=$(stellar contract invoke \
    --id $CONTRACT_ID \
    --source $ADMIN_ALIAS \
    --network $NETWORK \
    -- \
    get_all_prompts)

echo "✅ Upgrade verified. Current prompts count: $PROMPTS_COUNT"
echo "--------------------------------------------------------"
echo "Upgrade successful!"
echo "--------------------------------------------------------"

