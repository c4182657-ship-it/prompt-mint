# Contract Tooling Fixtures

This note documents the lightweight contract tooling that frontend and release contributors can use before a real deployment is available. It complements the deploy manifest flow in `docs/deploy-manifest.md` and keeps mock contract data out of application code.

## Managed address book

`deployments/address-book.json` is the checked-in source for contract IDs that the frontend can read in tests, Storybook stories, local development helpers, and review fixtures. Each contract is grouped by environment and records:

- the contract ID or an empty string when that environment has not been deployed yet;
- the network label, RPC URL, and network passphrase used by the frontend;
- the Wasm hash associated with the entry;
- the source that produced the record;
- the timestamp when the record was generated.

`deployments/address-book.schema.json` describes the expected shape so future validation can be added without changing the data contract.

## Frontend mock deploy

Use the mock deploy helper when a UI flow needs a deterministic contract ID before a Soroban deployment exists:

```bash
node scripts/frontend-mock-deploy.mjs --env local --contract prompt_hash
```

The helper writes a deterministic local entry into `deployments/address-book.json` and appends a bytecode provenance line to `deployments/bytecode-provenance.ndjson`. The generated contract ID and Wasm hash are intentionally marked as mock data and should not be promoted to testnet or mainnet.

## Bytecode provenance journal

For real artifacts, append a journal entry with:

```bash
node scripts/bytecode-provenance-journal.mjs \
  --artifact target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm \
  --contract prompt_hash \
  --env testnet \
  --source "$GITHUB_SHA"
```

The journal is newline-delimited JSON so CI jobs, release workflows, and reviewers can diff individual events. Each line captures the artifact path, byte size, SHA-256 hash, contract name, environment, source, and optional GitHub workflow run ID.

## Unlock flow factory

`src/test/fixtures/unlock-flow.ts` exports reusable unlock states for frontend and service tests. Prefer these fixtures over hand-written objects when covering catalog browsing, challenge creation, wallet signing, purchase submission, claimable unlocks, and expired challenges.

Example:

```ts
import { createUnlockFlowFixture } from "./fixtures/unlock-flow";

const claimable = createUnlockFlowFixture({ status: "claimable" });
```

The factory keeps prompt IDs, wallet addresses, hashes, timestamps, and transaction values consistent across tests while still allowing each test to override the fields it cares about.