# Deployments

Deploy manifests written by `scripts/deploy.sh` (one file per network, e.g. `testnet.json`).
Each manifest records the contract ID, admin/fee addresses, and the SHA-256 of the deployed Wasm.

- Format and verification: [docs/deploy-manifest.md](../docs/deploy-manifest.md)
- `local.json` is git-ignored; commit `testnet.json` alongside PRs that change the deployed contract ID.

Verify a manifest against local build output:

```bash
yarn deploy:manifest verify --manifest deployments/testnet.json
```
