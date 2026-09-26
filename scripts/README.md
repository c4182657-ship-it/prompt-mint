# Soroban Deployment & Upgrade Scripts

This directory contains scripts to automate the deployment, initialization, and upgrade of the `PromptHash` contract.

## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup#install-the-stellar-cli) installed.
- Rust and Soroban target installed (`rustup target add wasm32-unknown-unknown`).

## Scripts

### 1. `deploy.sh`
Deploys and initializes the contract to a specified network. It also automatically updates your `.env` and `.env.local` files.

**Usage:**
```bash
# Deploy to testnet (default)
./scripts/deploy.sh

# Deploy to local network
./scripts/deploy.sh local
```

**Environment Variables:**
- `NETWORK`: Target network (`testnet`, `local`). Defaults to `testnet`.
- `ADMIN_ALIAS`: Alias for the admin identity. Defaults to `admin`.
- `FEE_WALLET_ALIAS`: Alias for the fee wallet identity. Defaults to `fee_wallet`.

### 2. `upgrade.sh`
Upgrades an existing contract instance with a new Wasm version.

**Usage:**
```bash
# Upgrade on testnet
./scripts/upgrade.sh

# Upgrade on local
./scripts/upgrade.sh local

# Simulate without touching the chain (no install, no invoke)
./scripts/upgrade.sh --dry-run
./scripts/upgrade.sh --dry-run --skip-build
./scripts/upgrade.sh --dry-run --json
```

`--dry-run` delegates to `scripts/upgrade-dry-run.mjs`, which builds (unless `--skip-build`), hashes the Wasm, and probes the live contract via RPC (`get_all_prompts`, `get_schema_version`, `is_paused`) to run the same storage/license integrity gates that `confirm_upgrade` performs on-chain. No transaction is submitted. Exit `0` means the plan looks safe. See `docs/operations/contract-upgrades.md`.

**Note:** Ensure `CONTRACT_ID` is set in your `.env` file or passed as an environment variable.

### 3. Security testing (`scripts/security/`)

- `dast-target.mjs` — local OpenAPI-faithful HTTP API used by OWASP ZAP in `.github/workflows/security-pentest.yml`. Run with `yarn security:dast-target` (listens on `127.0.0.1:5000`).
- `contract-analysis.sh` — Slither (when Solidity is present) plus cargo clippy, cargo-audit, and Soroban detectors. Run with `yarn security:contract-analysis`.

See `docs/security/penetration-testing.md` for cadence and `docs/contract-gas-benchmarks.md` for contract resource-cost gates (`yarn test:gas`).

### 4. `verify.sh`
Performs a comprehensive check of the deployed contract's configuration (owner, fee settings, XLM SAC, etc.).

**Usage:**
```bash
./scripts/verify.sh local
```

### 4. `ci-rollback.ts`
Automates last-known-good rollback after a failed production deploy (issue #236). Invoked by `.github/workflows/auto-rollback.yml`.

```bash
yarn ops:rollback --dry-run
```

See [Automated rollback](../docs/operations/auto-rollback.md).

### 5. `bootstrap.mjs`
One-command setup for new contributors. It enables Corepack, installs the frontend and server dependencies, creates `.env` from `.env.example` without overwriting an existing file, adds the Rust wasm target, and runs `check-local-setup.mjs`.

```bash
node scripts/bootstrap.mjs [--dry-run] [--skip-server] [--skip-rust] [--skip-env]
```

### 6. `deploy-manifest.mjs`
Writes and verifies deploy manifests: contract ID, addresses, and the SHA-256 of each artifact. `deploy.sh` calls it automatically and writes `deployments/<network>.json`. CI calls it to produce the signed `deploy-manifest.json` release asset.

```bash
yarn deploy:manifest verify --manifest deployments/testnet.json
```

See [Deploy Manifest](../docs/deploy-manifest.md).

### 7. `chain-status.mjs`
Probes RPC, Horizon, and the deployed contract to report liveness and configuration health. No transactions are submitted.

```bash
node scripts/chain-status.mjs --network testnet --contract-id C... --json
yarn chain:status -- --json
```

See [Chain Status](../docs/operations/chain-status.md).

### 8. `creator-catalog-export.mjs`
Exports all prompt listings for a creator wallet to JSON or CSV via the API (preferred) or RPC (read-only).

```bash
node scripts/creator-catalog-export.mjs --creator G... --api-url https://api.promptmint.io --format json --output catalog.json
yarn catalog:export -- --creator G... --format csv --output catalog.csv
```

See [Creator Catalog Export](../docs/creator-catalog-export.md).

### 9. `upgrade-dry-run.mjs`
Simulates a contract upgrade without writing to the chain. Validates the Wasm hash, checks it differs from the deployed bytecode, and probes the live contract for storage/license integrity.

```bash
node scripts/upgrade-dry-run.mjs --network testnet --contract-id C... --skip-build --json
yarn upgrade:dry-run -- --skip-build --json
```

## Environment Consistency

The `deploy.sh` script synchronizes the following variables across `.env` and `.env.local`:
- `PUBLIC_STELLAR_NETWORK`
- `PUBLIC_STELLAR_NETWORK_PASSPHRASE`
- `PUBLIC_STELLAR_RPC_URL`
- `PUBLIC_PROMPT_HASH_CONTRACT_ID`
- `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID`

This ensures that the frontend and backend are always pointing to the correct contract instance.

After syncing, `deploy.sh` writes a deploy manifest to `deployments/$NETWORK.json`. Set `MANIFEST_PATH` to write it somewhere else.

## Upgrade Flow Assumptions

- The `upgrade` function can only be called by the current contract owner.
- The new Wasm hash must be installed on the network first (handled by the script).
- Contract state is preserved during the upgrade.
