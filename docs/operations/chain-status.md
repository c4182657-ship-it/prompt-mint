# Chain Status Check

`scripts/chain-status.mjs` probes the live Stellar network, Horizon, and the deployed PromptHash contract to report liveness and configuration health. It never submits a transaction.

## Usage

```bash
# Human-readable table (uses .env by default)
node scripts/chain-status.mjs
yarn chain:status

# Specify network and contract
node scripts/chain-status.mjs --network testnet --contract-id C... --rpc-url https://soroban-testnet.stellar.org

# Machine-readable JSON for CI
node scripts/chain-status.mjs --json
yarn chain:status -- --json

# Custom timeout and verbose raw bodies
node scripts/chain-status.mjs --timeout 5000 --verbose --json
```

All flags fall back to `.env` / environment vars (`PUBLIC_STELLAR_NETWORK`, `PUBLIC_STELLAR_RPC_URL`, `PUBLIC_STELLAR_HORIZON_URL`, `PUBLIC_PROMPT_HASH_CONTRACT_ID`, `NETWORK`, `RPC_URL`, `CONTRACT_ID`). See `.env.example` for the full template.

Exit code is `0` when all critical checks pass, `1` otherwise. Use `--json` to parse the result programmatically.

### Checks

| Name | What it does | Severity when unhealthy |
|---|---|---|
| `rpc_health` | `POST getHealth` to the RPC | `fail` — RPC unreachable or unhealthy |
| `rpc_network` | `POST getNetwork` — verifies the RPC's passphrase matches `PUBLIC_STELLAR_NETWORK_PASSPHRASE` | `fail` on mismatch, `warn` when `getNetwork` is unavailable |
| `latest_ledger` | `POST getLatestLedger` — confirms the ledger is advancing | `warn` (degraded, but not fatal) |
| `horizon_health` | `GET /` on Horizon — checks `horizon_version` | `fail` when unreachable |
| `contract_deployed` | `POST getLedgerEntries` for the contract instance — validates `C...` StrKey and that the contract exists on this network | `fail` when not found, `warn` when placeholder |

`warn` means degraded but not blocked; `fail` means the chain is not usable for marketplace operations. `formatHuman` and `summarize` are pure helpers so the same logic drives the CLI and `src/test/scripts/chainStatus.test.ts`.

### JSON shape

```json
{
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "horizonUrl": "https://horizon-testnet.stellar.org",
  "contractId": "C...",
  "checks": [
    { "name": "rpc_health", "status": "ok", "detail": "RPC healthy", "latencyMs": 123 }
  ],
  "summary": { "healthy": true, "degraded": false, "ok": 5, "warn": 0, "fail": 0, "total": 5 },
  "generatedAt": "2025-01-01T00:00:00.000Z"
}
```

### CI example

```yaml
- run: node scripts/chain-status.mjs --json > /tmp/chain-status.json
- run: node -e "const j=require('/tmp/chain-status.json'); if(!j.summary.healthy) process.exit(1)"
```

### Related

- [Contract Upgrades](./contract-upgrades.md) — dry-run probes reuse the same RPC helpers
- [Deploy Manifest](../deploy-manifest.md) — artifact hashes and addresses for the same contract
- [Monorepo Map](../monorepo-map.md) — `scripts/` ownership and CI gate (`ci.yml`)
