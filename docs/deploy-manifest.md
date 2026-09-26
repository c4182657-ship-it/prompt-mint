# Deploy Manifest

Every contract deployment and every CI release writes a **deploy manifest**: a JSON file that records the contract ID, the network, the admin and fee addresses, and the SHA-256 of each artifact that went into the deployment. The manifest links the live contract on Stellar to the exact bytes in a signed release.

Generator/verifier: [`scripts/deploy-manifest.mjs`](../scripts/deploy-manifest.mjs) (Node, no dependencies).

## Where manifests come from

| Producer                                              | Output                               | Contains                                                                            |
| ----------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `scripts/deploy.sh <network>`                         | `deployments/<network>.json`         | contract ID, Wasm hash, network, admin / fee wallet / XLM SAC addresses, git commit |
| `.github/workflows/deploy.yml` (`sign-artifacts` job) | `deploy-manifest.json` release asset | Wasm hash, frontend checksum-list hash, commit, workflow run ID                     |

The CI manifest has `contractId: null` because CI builds the contract but does not deploy it. The manifest is listed in `release-checksums.txt`, so the cosign signature on that file covers it.

`deployments/local.json` is git-ignored. Commit testnet manifests with the PR that changes the deployed contract ID.

## Format

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-23T12:00:00.000Z",
  "network": {
    "name": "testnet",
    "passphrase": "Test SDF Network ; September 2015",
    "rpcUrl": "https://soroban-testnet.stellar.org"
  },
  "source": {
    "repository": "PromptMintLabs/prompt-mint",
    "commit": "<40-char git sha>",
    "ref": "main",
    "workflowRunId": null
  },
  "contracts": {
    "prompt_hash": {
      "contractId": "C…",
      "wasm": {
        "path": "target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm",
        "sha256": "<64 hex chars>",
        "sizeBytes": 123456
      }
    }
  },
  "addresses": {
    "admin": "G…",
    "adminTwo": "G…",
    "adminThree": "G…",
    "feeWallet": "G…",
    "xlmSac": "C…"
  },
  "artifacts": []
}
```

Validation rules, enforced by `validateManifest` before a manifest is written:

- `contractId` and `xlmSac` must be 56-character `C…` strkeys. The other addresses must be `G…` account IDs.
- `sha256` must be lowercase hex, and `sizeBytes` must be a non-negative integer.
- `source.commit`, when set, must be a full 40-character SHA.
- An unknown key under `addresses` is rejected, which catches typos.

## Commands

```bash
# Written automatically at the end of scripts/deploy.sh; manual form:
yarn deploy:manifest generate --network testnet \
  --contract-id C... --wasm target/wasm32-unknown-unknown/release/prompt_hash.optimized.wasm \
  --admin G... --fee-wallet G... --xlm-sac C...

# Re-hash every artifact listed in the manifest (paths resolve against --root)
yarn deploy:manifest verify --manifest deployments/testnet.json

# Emit a shields.io endpoint badge describing the verification result
yarn deploy:manifest badge --manifest deployments/testnet.json --out provenance-badge.json
```

`verify` exits non-zero on a hash mismatch, a missing file, or a schema error.

## Checking a live contract against a manifest

A Soroban contract's on-chain Wasm hash is the SHA-256 of the uploaded Wasm. Compare it directly with the manifest:

```bash
jq -r '.contracts.prompt_hash.wasm.sha256' deployments/testnet.json
stellar contract fetch --id "$(jq -r '.contracts.prompt_hash.contractId' deployments/testnet.json)" \
  --network testnet | sha256sum
```

The two values must match. To confirm that the Wasm came from a signed release, compare the manifest hash with `prompt_hash.wasm` in `release-checksums.txt`, then follow [Artifact Verification](./artifact-verification.md).

> `deploy.sh` deploys the **optimized** Wasm. Its hash differs from the unoptimized `prompt_hash.wasm` that CI publishes, so compare like with like.

## Tests

`src/test/deployManifest.test.ts` covers building, validating, verifying, and badge generation (`yarn test:frontend`).
