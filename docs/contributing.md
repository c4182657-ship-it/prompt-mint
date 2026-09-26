# Contributor Local Development Guide

This guide documents the local setup required to work on the PromptHash Stellar frontend, Soroban contract, and serverless unlock endpoints.

## Quick start with Dev Container (recommended)

The repository includes a versioned Dev Container configuration (`.devcontainer/`) that pins all major toolchain versions and matches what CI runs. This is the fastest way to get a consistent development environment.

### Prerequisites

- **Visual Studio Code** with the **Dev Containers** extension (`ms-vscode-remote.remote-containers`).
- **Docker** (Docker Desktop, Rancher Desktop, or Docker CE).
- **Git** to clone the repository.

### Startup time

| Step                        | Duration (approx.)      | Notes                                                     |
| --------------------------- | ----------------------- | --------------------------------------------------------- |
| Image build (first time)    | 30–50 min *             | Compiling Stellar CLI from source; cached on rebuild.     |
| Image build (subsequent)    | 30–90 sec               | Layer cache hit — only changed layers rebuild.            |
| Post-create script          | 2–5 min                 | Installs `node_modules` and `server/node_modules`.        |
| Container stop + restart    | ~5 sec                  |

> *\* Varies significantly by machine specs and network speed. The first build compiles `stellar-cli` from source. This is a one-time cost. On subsequent rebuilds (e.g., switching branches without Dockerfile changes), the cached layer is reused and startup is near-instant.

### Port forwarding

The container automatically forwards:

| Host port | Container port | Service                        |
| --------- | -------------- | ------------------------------ |
| `5173`    | `5173`         | Vite dev server (frontend)     |
| `5000`    | `5000`         | Express backend server         |

To open in your host browser, navigate to `http://localhost:5173` (frontend) or `http://localhost:5000` (backend).

### Using the Dev Container

1. **Clone the repository** and open it in VS Code:

   ```bash
   git clone https://github.com/PromptMintLabs/prompt-mint.git
   cd prompt-mint
   code .
   ```

2. **Reopen in Container** — When VS Code prompts "Reopen in Container?", click **Reopen**. Or run the **Dev Containers: Reopen in Container** command from the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

3. **Wait for the post-create script** to finish — it installs `node_modules`, server dependencies, and runs `yarn check:setup`. The terminal shows progress.

4. **Set your environment secrets** — The post-create script copies `.env.example` → `.env`. Open that file and fill in the required values listed under [Environment variables](#environment-variables).

5. **Start developing** — Run `yarn dev` for the frontend or the relevant commands below.

### Troubleshooting

- **Container build fails on `cargo install stellar-cli`**: Ensure Docker has enough memory (≥8 GB recommended for Rust compilation). On Docker Desktop, go to **Settings → Resources → Advanced** and increase memory.
- **Port conflicts on host**: If port 5173 or 5000 is already in use on your host machine, you can change the mapping in `.devcontainer/devcontainer.json` under `forwardPorts` and `portsAttributes`.
- **Secrets not persisted**: The `.env` file lives on the bind-mounted workspace, so it persists across container restarts. The image itself never contains `.env` files.
- **Changes not reflected**: The workspace root is bind-mounted by default, so any edits you make locally are immediately visible inside the container. No rebuild needed.

### Upgrading the container

When the Dockerfile, `rust-toolchain.toml`, or `package.json` toolchain requirements change:

1. Pull the latest branch: `git pull`.
2. Run **Dev Containers: Rebuild Container** from the command palette.
3. The post-create script runs again automatically.

To force a full rebuild from cache:

```bash
# In a terminal outside the container:
docker compose down --rmi all -v  # If using Docker Compose
# Or just rebuild in VS Code: Dev Containers: Rebuild Container Without Cache
```

### CI alignment

The Dev Container intentionally matches CI:

| Tool          | Dev Container version | CI version (source)                         |
| ------------- | --------------------- | ------------------------------------------- |
| Node.js       | 22 (via NodeSource)   | 22 (via `actions/setup-node@v7`)            |
| Yarn          | 4.9.2 (via Corepack)  | 4.9.2 (via `corepack prepare`)              |
| Rust          | 1.89.0 (via rustup)   | 1.89.0 (via `dtolnay/rust-toolchain@stable`)|
| wasm target   | wasm32v1-none         | wasm32v1-none                                |
| Stellar CLI   | 22.3.0 via `cargo install` | Not tested in CI (recommended for deploy) |

## Prerequisites (manual setup)

If you are not using the Dev Container, install these tools before running the project locally:

Install these tools before running the project locally:

- **Node.js 22 or newer** for the Vite React application and serverless API tests.
- **Yarn 4.x** through Corepack. Run `corepack enable` and let Yarn use the version pinned in `package.json`.
- **Rust 1.89.0** through rustup. The repository pins this toolchain in `rust-toolchain.toml`.
- **wasm32v1-none Rust target** for Soroban-compatible builds: `rustup target add wasm32v1-none`.
- **Stellar CLI with Soroban support** for contract build/deploy workflows and local network operations.
- **GitHub-compatible shell environment** such as bash, zsh, WSL, or a Linux/macOS terminal.

You can run `yarn check:setup` after installing dependencies to validate local tools and required environment variables without printing secret values.

## Install dependencies

### One-command bootstrap

From the repository root, run:

```bash
node scripts/bootstrap.mjs            # or: yarn bootstrap
node scripts/bootstrap.mjs --dry-run  # print the plan without changing anything
```

The bootstrap enables Corepack when Yarn 4 is missing, runs `yarn install` and `npm ci` in `server/`, and copies `.env.example` to `.env` only if `.env` does not exist yet. It also adds the `wasm32-unknown-unknown` Rust target when `rustup` is present, then finishes with `yarn check:setup --warn-only`. It never installs Node, Rust, or the Stellar CLI for you. When one is missing, it prints the install command. You can re-run it at any time.

Flags: `--skip-server`, `--skip-rust` (frontend-only contributors), `--skip-env`.

### Manual install

From the repository root:

```bash
yarn install
```

The optional Express workspace under `server/` has its own npm lockfile:

```bash
cd server
npm install
cd ..
```

## Environment variables

Create a local environment file from the checked-in template:

```bash
cp .env.example .env
```

Fill in the values below before running the frontend or unlock endpoints:

| Variable                                  | Required for         | Notes                                                                                         |
| ----------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `STELLAR_SCAFFOLD_ENV`                    | contract tooling     | Use `development` locally unless you have a custom Soroban scaffold environment.              |
| `XDG_CONFIG_HOME`                         | contract tooling     | Defaults to `.config` in the template to keep local Stellar config inside the repo workspace. |
| `PUBLIC_STELLAR_NETWORK`                  | frontend, unlock API | Usually `TESTNET` for contributor development.                                                |
| `PUBLIC_STELLAR_NETWORK_PASSPHRASE`       | frontend, unlock API | Must match the selected Stellar network.                                                      |
| `PUBLIC_STELLAR_RPC_URL`                  | frontend, unlock API | Testnet default is `https://soroban-testnet.stellar.org`.                                     |
| `PUBLIC_STELLAR_HORIZON_URL`              | frontend             | Testnet default is `https://horizon-testnet.stellar.org`.                                     |
| `PUBLIC_PROMPT_HASH_CONTRACT_ID`          | frontend, unlock API | Set to the deployed prompt-hash Soroban contract ID you want to exercise.                     |
| `PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID` | frontend, unlock API | Native XLM SAC contract ID for the selected network.                                          |
| `PUBLIC_STELLAR_SIMULATION_ACCOUNT`       | frontend, unlock API | Public account used for read/simulation calls.                                                |
| `PUBLIC_UNLOCK_PUBLIC_KEY`                | frontend             | Public key paired with the unlock service encryption key.                                     |
| `CHALLENGE_TOKEN_SECRET`                  | unlock API           | Long random secret used to sign wallet-auth challenge tokens.                                 |
| `UNLOCK_PUBLIC_KEY`                       | unlock API           | Base64 public key for prompt key wrapping.                                                    |
| `UNLOCK_PRIVATE_KEY`                      | unlock API           | Base64 private key used by the serverless unlock endpoint to unwrap prompt keys.              |
| `REDIS_URL`                               | unlock API, optional | Enables shared rate limiting; when omitted, development falls back to in-memory limiting.     |

Never commit a populated `.env` file or real unlock private keys.

## Run the frontend locally

Start the Vite development server from the repository root:

```bash
yarn dev
```

The command runs `scripts/check-local-setup.mjs --warn-only` first, then starts Vite. Keep the browser wallet, contract ID, RPC URL, and selected network aligned; a testnet wallet cannot buy from a mainnet contract and vice versa.

Useful frontend validation commands:

```bash
yarn lint
yarn test:frontend --run api/prompts/unlock.test.ts src/lib/auth/challenge.test.ts src/lib/crypto/promptCrypto.test.ts
yarn build
```

## Run Soroban contract tests locally

Run the prompt-hash contract tests from the repository root:

```bash
cargo test -p prompt-hash
```

If contract dependencies or toolchains fail to resolve, confirm that rustup is using the pinned toolchain and that the target is installed:

```bash
rustup show
rustup target add wasm32v1-none
```

The contract tests use Soroban SDK test utilities and a mock asset contract, so they do not require a live Stellar RPC server.

## Configure and test unlock endpoints locally

The unlock service is implemented as Vercel-style serverless functions in `api/auth/challenge.ts` and `api/prompts/unlock.ts`.

1. Populate `.env` with the Stellar, challenge-token, and unlock key variables listed above.
2. Ensure `PUBLIC_PROMPT_HASH_CONTRACT_ID`, `PUBLIC_STELLAR_RPC_URL`, `PUBLIC_STELLAR_NETWORK_PASSPHRASE`, and `PUBLIC_STELLAR_SIMULATION_ACCOUNT` point at a contract/account that can answer `has_access` reads.
3. Run the API unit tests:

```bash
yarn test:frontend -- api/prompts/unlock.test.ts src/lib/auth/challenge.test.ts src/lib/crypto/promptCrypto.test.ts
```

4. For end-to-end manual testing, start the frontend with `yarn dev`, buy or seed access for a prompt on the configured network, then use the UI unlock flow. The endpoint verifies the challenge token, wallet signature, on-chain access, key unwrap, decryption, and content hash before returning plaintext.

## Troubleshooting

- **`yarn check:setup` reports placeholder environment values**: replace `CXXXX...`, `GXXXX...`, and `BASE64_...` placeholders in `.env` with real development values.
- **Vite starts but contract reads fail**: verify that `PUBLIC_STELLAR_NETWORK_PASSPHRASE`, `PUBLIC_STELLAR_RPC_URL`, and `PUBLIC_PROMPT_HASH_CONTRACT_ID` all reference the same network.
- **Wallet prompts never appear**: confirm your browser wallet is connected to the same Stellar network as `PUBLIC_STELLAR_NETWORK`.
- **Unlock returns unauthorized or access denied**: confirm the wallet that signs the challenge has purchased the prompt and that `PUBLIC_STELLAR_SIMULATION_ACCOUNT` can simulate contract reads.
- **Unlock decryption fails**: ensure `UNLOCK_PRIVATE_KEY` matches `PUBLIC_UNLOCK_PUBLIC_KEY` and the prompt was encrypted with the matching public key.
- **Contract tests fail after a Rust upgrade**: run `rustup override unset` from the repo if you have a conflicting local override, then retry with the pinned `rust-toolchain.toml`.

## Running all test suites

To run the contract, frontend, and API test suites in one command:

```bash
yarn test:all
```

This runs:

1. `vitest run` — frontend integration tests and API endpoint tests
2. `cargo test -p prompt-hash` — Soroban contract tests
3. `cd server && npm test` — Express server tests

The command exits on the first failing suite, so you always know which area needs attention.

> **Note:** E2E (Playwright) tests are not included in `test:all` because they require a running dev server and installed browser binaries. Run them separately with `yarn test:e2e`.

## Pull request checks

Every pull request is expected to pass the same checks that CI runs:

```bash
yarn lint
yarn test:all
yarn build
```

Run the relevant subset locally before pushing, and run the full set when touching shared frontend, API, or contract code.

## Dev Container maintenance

### When to rebuild

- After pulling a commit that changes `.devcontainer/Dockerfile` or `.devcontainer/devcontainer.json`.
- After `rust-toolchain.toml` changes (Rust version).
- After the Yarn version changes in `package.json` (`packageManager` field).
- After the Node.js version changes in any CI workflow.

### How to update

1. Update the relevant version argument(s) in `.devcontainer/Dockerfile`.
2. Rebuild with **Dev Containers: Rebuild Container**.
3. Run `yarn check:setup` to validate all tools are at the expected versions.
4. Update the CI alignment table above if versions changed.

### Keeping secrets out of the image

The `.devcontainer/.env*` pattern is included in `.gitignore`, and the post-create script copies `.env.example` → `.env` at runtime (never at build time). This guarantees that wallet secrets, challenge tokens, and unlock private keys never enter the Docker image layer.
