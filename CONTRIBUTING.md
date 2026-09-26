# Contributing

Thank you for contributing to PromptHash Stellar.

## Scope

This project is an in-development Soroban application for encrypted prompt licensing on Stellar. Contributions should prioritize:

- contract correctness and test coverage
- secure unlock and wallet-auth flows
- clear developer ergonomics
- practical marketplace UX

## Before You Start

- Open an issue for significant feature work or architectural changes.
- Keep pull requests focused. Avoid mixing product docs, contract changes, and unrelated UI cleanup in one PR.
- Check [docs/monorepo-map.md](docs/monorepo-map.md) to see which area owns the code you are changing and which cross-directory imports are allowed.
- Preserve existing user changes in the repo when working locally.

## Development Workflow

1. Fork the repository and create a branch from `main`.
2. Run `node scripts/bootstrap.mjs` to install frontend and `server/` dependencies, create `.env` from `.env.example`, and validate your toolchain. Use `--dry-run` to preview the steps first.
3. Fill in the placeholder values in `.env`.
4. Make changes with tests or validation steps where possible.
5. Submit a pull request with a clear explanation of what changed and why.

## Recommended Local Checks

```bash
yarn check:setup
yarn test:all
yarn build
```

If you changed the auxiliary server:

```bash
cd server
npm run build
```

To inspect live contract state on testnet (no wallet needed for read-only calls):

```bash
yarn inspect:contract config
yarn inspect:contract full --json
```

## Coding Expectations

- Prefer TypeScript and Rust changes that are explicit and easy to audit.
- Keep smart contract logic simple and well-bounded.
- Document security-sensitive assumptions, especially around signing, decryption, and key handling.
- Avoid introducing hidden off-chain dependencies for contract-critical flows.
- Add or update frontend integration coverage when wallet, contract, unlock, or dashboard behavior changes.
- Follow `docs/frontend-testing.md` for the shared mocked-wallet and mocked-Soroban testing pattern.

### Internationalisation (i18n) and number formatting

The UI is fully internationalised via `react-i18next`. When adding or changing copy:

- Add the key to **all five** locale files in `src/i18n/locales/` (`en`, `es`, `fr`, `zh`, `ja`).
- For new number or currency display, use the helpers in `src/lib/i18n-number.ts` (`useXlmFormatter`, `useUsdFormatter`) or `src/lib/formatters.ts`. Do **not** call `toLocaleString` with a hard-coded `"en-US"` locale — pass `undefined` or the active `i18n.language` so the output respects the user's language selection.
- XLM amounts are always sourced from stroops (bigint). Use `formatXlmLocale(stroops, "stroops", locale)` or the `useXlmFormatter()` hook.
- Adding a new locale: add a JSON file to `src/i18n/locales/`, import it in `src/i18n/index.ts`, and add it to `SUPPORTED_LANGUAGES`. No changes to the formatting helpers are required.

## Pull Request Guidelines

Include:

- a short summary of the problem
- the implemented approach
- validation steps performed
- screenshots for UI changes when relevant

## Security

If you find a security issue related to contract behavior, decryption, wallet auth, or secret handling, do not open a public issue with exploit details. Contact the maintainer privately first.

## License

By contributing, you agree that your contributions will be licensed under Apache-2.0.
