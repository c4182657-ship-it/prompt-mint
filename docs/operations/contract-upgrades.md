# Contract Upgrades

PromptHash Stellar utilizes a Soroban smart contract that stores prompt listings and purchase rights. As the protocol evolves, it may be necessary to upgrade the smart contract without losing the underlying state (prompt data, purchase records, balances). 

The contract implements the `Ownable` trait, meaning that the `admin` who initialized the contract has the exclusive right to upgrade the contract's Wasm logic.

## Upgrade Assumptions & Requirements

To successfully perform an upgrade, the following conditions must be met:
1. **Admin Key Access:** You must have access to the Stellar identity/private key that was configured as the `admin` during the contract's `__constructor` initialization. Without this key, the `upgrade` invocation will fail with an authorization error.
2. **State Compatibility:** The new Wasm code must maintain state compatibility with the existing storage. This means:
   - Data structures (like `Prompt`) must be backward compatible if modifying existing fields.
   - Storage keys must not overlap unintentionally or break the current mapping of data.
3. **Soroban Environment:** The current `NETWORK` (e.g. `testnet` or `mainnet`) must be explicitly set or defined in your CLI when performing the upgrade to ensure you're interacting with the correct instance.

## Upgrade Flow

We have provided an automated script to handle the compilation, installation, and upgrade process: `./scripts/upgrade.sh`.

### 1. Identify the Contract
You need the deployed contract ID. If you deployed using the deployment script, this should be in your `.env` file as `PUBLIC_PROMPT_HASH_CONTRACT_ID`. 

If not, provide it explicitly:
```bash
export CONTRACT_ID=C...
```

### 2. Configure Your Environment
Ensure your `ADMIN_ALIAS` identity exists in your local `stellar-cli` configuration (`stellar keys address admin`). 

By default, the script targets `testnet`. To target a different network, set the `NETWORK` variable:
```bash
export NETWORK=mainnet
export ADMIN_ALIAS=admin_mainnet
```

### 3. Run the Upgrade Script
Execute the upgrade script from the repository root:
```bash
./scripts/upgrade.sh
# Or simulate first (no transactions):
./scripts/upgrade.sh --dry-run
# Or via the Node dry-run directly:
node scripts/upgrade-dry-run.mjs --network testnet --contract-id C... --wasm target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm --json
```

### Dry-run (no chain writes)

Both entry points delegate to `scripts/upgrade-dry-run.mjs`, which never submits a transaction. It:

1. Builds and optimizes the Wasm (unless `--skip-build`).
2. Hashes the output (`SHA-256`) and validates it is non-zero and well-formed.
3. Probes the live contract via RPC (`get_all_prompts`, `get_schema_version`, `is_paused`) to run the same storage/license integrity gates that `confirm_upgrade` performs on-chain.
4. Prints a human-readable plan (or `--json` for CI) and exits `0` when the plan looks safe, `1` otherwise.

```bash
# Full build + probe
./scripts/upgrade.sh --dry-run

# Reuse existing Wasm, JSON output for CI
node scripts/upgrade-dry-run.mjs --skip-build --network testnet --json
yarn upgrade:dry-run -- --skip-build --json
```

The dry-run intentionally does not call `stellar contract install` or `propose_upgrade`/`confirm_upgrade`. Promote to a real upgrade only after the dry-run reports `PASS`. See `scripts/upgrade-dry-run.mjs` (`yarn test:frontend` covers its argument parsing and hash validation).

### What the script does under the hood:
1. **Builds the Contract:** Compiles the rust source code and outputs it to `target/wasm32-unknown-unknown/release/prompt_hash.wasm`.
2. **Optimizes the Wasm:** Runs `stellar contract optimize` to reduce the Wasm size.
3. **Installs the Wasm (Compute Hash):** Uploads the optimized Wasm code to the Stellar network using `stellar contract install`. This returns a `WASM_HASH`. It does not execute or instantiate the contract.
4. **Applies the Upgrade:** Invokes the `upgrade` method on the currently running contract, passing in the new `WASM_HASH`. The contract logic (specifically the `env.deployer().update_current_contract_wasm(new_wasm_hash)` call) safely replaces the contract's executing code while retaining all storage.
5. **Verifies:** Calls a read-only endpoint (`get_all_prompts`) to ensure the contract is still responsive and healthy.

## Safety Considerations

- **Always test upgrades on `testnet`** before executing them on production.
- If you're altering data structures (e.g. adding fields to `Prompt`), ensure you test the migration path thoroughly. Soroban strictly enforces data types; reading an old `Prompt` struct as a new `Prompt` struct with different fields will panic if not explicitly handled via enum versioning or backward-compatible storage keys.
- Monitor fee configurations post-upgrade to ensure no regression occurs.

## Schema Versioning & Migration Hooks

`upgrade` only swaps the running Wasm code — it does not touch storage. If an
upgrade changes the *shape* of stored data (new fields, renamed keys, etc.),
run a separate, deliberate migration step afterward so storage reads never
silently misinterpret old data as the new shape.

The contract tracks this with two additional owner-only/read-only endpoints:

- `get_schema_version() -> u32` — the schema version currently applied to
  this contract's storage. `0` means the key was never written, which is the
  state of any contract deployed before this versioning scheme existed.
- `migrate(new_version: u32) -> Result<u32, Error>` — owner-only (same
  `Ownable` admin as `upgrade`). Advances the stored schema version and emits
  a `SchemaMigrated` event. Rejects with `Error::VersionMismatch` if:
  - `new_version` is not strictly greater than the currently stored version
    (no no-ops, no downgrades), or
  - `new_version` is greater than `CONTRACT_SCHEMA_VERSION` — the highest
    version the *currently running* contract code has migration logic for.
    This prevents an operator from marking storage as "migrated" to a version
    the deployed Wasm doesn't actually know how to read/write yet.

### Recommended flow for a storage-shape change

1. Add the new fields/keys to the contract, guarded by whatever
   backward-compatible read logic the change needs (e.g. an `Option<T>` field
   that defaults on read for pre-migration records).
2. Bump `CONTRACT_SCHEMA_VERSION` in `contract.rs` and add the actual
   migration steps to `migrate` (e.g. backfilling a new key from an old one).
3. Deploy via `upgrade` as usual.
4. Immediately call `migrate(new_version)` as the admin. Until this call
   succeeds, `get_schema_version()` still reports the old version, so
   off-chain tooling can detect an upgrade that hasn't been migrated yet.
5. Verify with `get_schema_version()` before resuming normal writes that
   depend on the new shape.
