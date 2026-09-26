# Creator Catalog Export

`scripts/creator-catalog-export.mjs` exports all prompt listings for a creator wallet to JSON or CSV. It works against either the public API (preferred, indexed and paginated) or directly against the Soroban RPC (read-only, no transaction submitted). Output is deterministic and sorted by prompt id.

## Usage

```bash
# API mode (preferred) — uses the indexed read model
node scripts/creator-catalog-export.mjs --creator GB7...XYZ --api-url https://api.promptmint.io --format json --output catalog.json
yarn catalog:export -- --creator GB7...XYZ --api-url https://api.promptmint.io --format csv --output catalog.csv

# RPC mode — reads directly from the contract (requires contractId)
node scripts/creator-catalog-export.mjs --creator GB7...XYZ --network testnet --contract-id C... --format json
node scripts/creator-catalog-export.mjs --creator GB7...XYZ --network testnet --contract-id C... --format csv --active-only --limit 50

# Pretty JSON to stdout
node scripts/creator-catalog-export.mjs --creator GB7...XYZ --api-url https://api.promptmint.io --pretty

# Verbose logs to stderr
node scripts/creator-catalog-export.mjs --creator GB7...XYZ --api-url https://api.promptmint.io --verbose
```

All flags fall back to `.env` / environment vars (`PUBLIC_STELLAR_NETWORK`, `PUBLIC_STELLAR_RPC_URL`, `PUBLIC_PROMPT_HASH_CONTRACT_ID`, `PUBLIC_API_BASE`, `API_URL`). When `apiUrl` is set the tool prefers the API; otherwise it requires `contractId` and reads via RPC.

Exit code is `0` on success, `1` on error (invalid creator, unreachable API/RPC, etc.).

### Options

| Flag | Default | Meaning |
|---|---|---|
| `--creator G...` | *(required)* | Creator Stellar address (`G...` StrKey) |
| `--network` | `testnet` | `testnet` | `mainnet` | `futurenet` | `local` |
| `--contract-id C...` | `.env` `PUBLIC_PROMPT_HASH_CONTRACT_ID` | Contract to read in RPC mode |
| `--rpc-url` | preset for `--network` | Soroban RPC endpoint (RPC mode) |
| `--api-url` | `PUBLIC_API_BASE` / `API_URL` | API base URL (API mode) |
| `--format json\|csv` | `json` | Output format |
| `--output <path>` | stdout | Write to file (creates parent directories) |
| `--active-only` | off | Only export `active` listings |
| `--limit <n>` | all | Cap number of exported prompts |
| `--pretty` | off | Pretty-print JSON |
| `--verbose` | off | Extra logs to stderr |

### Output schemas

**JSON** (`--format json`):

```json
{
  "exportedAt": "2025-01-01T00:00:00.000Z",
  "count": 2,
  "prompts": [
    {
      "id": "42",
      "creator": "GB7...XYZ",
      "title": "My prompt",
      "category": "general",
      "price": 5000000,
      "active": true,
      "salesCount": 3,
      "contentHash": "abc...",
      "previewText": "Preview...",
      "raw": { /* original API/contract record */ }
    }
  ]
}
```

**CSV** (`--format csv`):

```
id,creator,title,category,price,active,salesCount,contentHash
42,GB7...XYZ,"My prompt",general,5000000,true,3,abc...
```

Fields are the normalized export shape returned by `normalizePrompt`. The `raw` field in JSON preserves the original record for debugging. CSV values are escaped per RFC 4180.

### How it fetches

- **API mode:** `GET {apiUrl}/api/prompts?creator={creator}&limit=1000`, then `normalizePrompt` + `filterAndSort`. The API is the indexed read model, so it supports large catalogs without ledger scans.
- **RPC mode:** `POST getLedgerEntries` for `CreatorPrompts` (read-only). When the RPC does not expose that key shape, the tool degrades to an empty catalog rather than failing — production exports should use API mode. The RPC path is stubbed in `src/test/scripts/creatorCatalogExport.test.ts` so tests don't need a live node.

Both paths are wrapped by `fetchCreatorCatalog`, which is the single entry point tested by `yarn test:frontend`.

### Examples

```bash
# Export creator's active listings to CSV, cap at 100, via API
node scripts/creator-catalog-export.mjs \
  --creator GDEXAMPLE... \
  --api-url https://api.promptmint.io \
  --format csv --active-only --limit 100 --output ./exports/creator.csv

# Export via RPC on local network (for local dev)
node scripts/creator-catalog-export.mjs \
  --creator GDEXAMPLE... \
  --network local --contract-id CEXAMPLE... \
  --format json --pretty --output ./exports/local.json
```

### Related

- [Chain Status](./operations/chain-status.md) — probes RPC/Horizon liveness for the same network
- [Integration Guide](../integration-guide.md) — server SDKs for programmatic reads
- [Monorepo Map](../monorepo-map.md) — `scripts/` ownership and CI gate
