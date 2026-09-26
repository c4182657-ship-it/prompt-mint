# Developer Sandbox Environment

The developer sandbox environment (`/sandbox`) allows engineers and external integrators to provision ephemeral Stellar keypairs, request testnet funds via Stellar Friendbot, test Soroban contract mutations, and debug payment flows without risking mainnet funds.

## Features

- **Ephemeral Wallet Provisioning**: One-click creation of cryptographic Stellar keypairs (Public `G...` and Secret `S...`).
- **Direct Friendbot Faucet**: Request 10,000 testnet XLM for newly generated sandbox wallets or arbitrary external test addresses.
- **Multinetwork Support**: Switch seamlessly between Stellar `TESTNET`, `FUTURENET`, and `LOCAL` standalone configurations.
- **Role-Based Presets**:
  - `Fresh Buyer Sandbox`: 1,000 XLM baseline for testing prompt discovery and checkout.
  - `Funded Creator Sandbox`: 10,000 XLM allocation for minting and licensing prompts.
  - `API & Event Integrator`: 25,000 XLM for high-throughput testing and event consumer ingestion.
- **Contract Simulation Playground**: Simulate prompt minting, licensing purchases, and inspect contract configuration directly within the UI.
- **Activity & Transaction Logging**: View real-time transaction activity, request statuses, and direct links to Stellar Expert block explorer.

## Accessing the Sandbox

Start the development server and navigate to:
```
http://localhost:5173/sandbox
```

## Running Unit Tests

To validate the sandbox utilities:
```bash
yarn vitest run --environment=node src/test/sandbox.test.ts
```
