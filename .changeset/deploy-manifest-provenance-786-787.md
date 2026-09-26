---
"prompt-hash-stellar": minor
---

Add deploy manifests and a verified deployment provenance badge (#786, #787). `scripts/deploy.sh` now writes `deployments/<network>.json` recording the contract ID, admin/fee/XLM SAC addresses, and the SHA-256 of the deployed Wasm. Every CI release ships a signed `deploy-manifest.json` that is re-verified (cosign + hash check) before the release is published, so the "Deploy provenance" badge in the README is only green when provenance checks out. See `docs/deploy-manifest.md`.
