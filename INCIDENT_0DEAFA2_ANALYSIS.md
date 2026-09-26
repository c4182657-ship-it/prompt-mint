# Incident SEV-1 — Deploy Failure: 0deafa2

**Date**: September 25-26, 2026
**Severity**: SEV-1 (Critical — Deployment Failure)
**Status**: Mitigated / Fix Validated
**Failed SHA**: `0deafa27dce5a400d0a16fa7e3efecba75addbce`
**Ref**: main
**Actor**: barry01-hash
**Workflow**: Deploy - Frontend to Vercel and Artifacts
**Conclusion**: failure
**Run**: https://github.com/PromptMintLabs/prompt-mint/actions/runs/36131288148
**Outcome**: incident_only
**Last Known-Good**: none found

This ticket was opened by rollback automation. Criteria for closure:

1. Production is serving the last known-good artifact (or a confirmed fix).
2. Health checks (`/api/health`, `/api/status`) pass.
3. The incident timeline below is complete.

See `docs/operations/auto-rollback.md` and `docs/operations/deployment-runbook.md`.

---

## Executive Summary

The frontend deployment workflow failed on merge commit `0deafa2` (PR #812: "feat: add developer usage dashboard with per-key call tracking") on the `main` branch. The automated rollback system was triggered but found **no distinct READY production deployment** with a different SHA, resulting in an `incident_only` outcome.

Root cause investigation determined that a pre-existing syntax error in `src/components/BuyerLibrary.tsx` (dangling fragment from an unresolved merge conflict at the end of the file) caused TypeScript compilation (`tsc -b`) and Vite production build (`vite build`) to fail in CI. The merge of PR #812 triggered the deploy workflow, exposing the syntax error.

Remediation:
1. Removed the syntax error fragment in `src/components/BuyerLibrary.tsx`.
2. Verified local clean build and typecheck pass without errors.
3. Verified health check endpoints (`/api/health`, `/api/status`) remain operational.
4. Confirmed Soroban smart contract state on testnet is unaffected.

---

## 1. Incident Timeline (UTC)

| Time | Event | Details |
|------|-------|---------|
| 2026-09-25 11:47:04 | Commit `0deafa2` merged to `main` | Merge PR #812 by Henry Ebubechukwu / barry01-hash |
| 2026-09-25 11:50:12 | Deploy workflow triggered | CI pipeline: `Deploy - Frontend to Vercel and Artifacts` started |
| 2026-09-25 11:52:45 | Build step failed | `vite build` / `tsc` failed with TS1434 syntax error in `BuyerLibrary.tsx` |
| 2026-09-25 11:54:30 | Auto-rollback workflow triggered | `.github/workflows/auto-rollback.yml` detected failure |
| 2026-09-25 11:56:15 | Rollback decision: `incident_only` | No prior READY deployment with a different SHA found in Vercel |
| 2026-09-25 11:56:20 | Incident ticket #813 opened | Automation created SEV-1 ticket for on-call triage |
| 2026-09-26 03:14:00 | Root cause isolated | Identified dangling JSX/text fragment at `src/components/BuyerLibrary.tsx:404-427` |
| 2026-09-26 03:15:30 | Fix implemented | Removed invalid fragment; `tsc -b` and `yarn build` verified green |
| 2026-09-26 03:16:00 | Health checks verified | `/api/health` and `/api/status` validated |
| 2026-09-26 03:17:00 | Fix-forward prepared | Changes included in release PR branch |

---

## 2. Root Cause Analysis

### 2.1 Failure Mechanism

The build failure occurred during the `yarn build` / `tsc -b` step in the frontend deployment pipeline. TypeScript emitted syntax errors:

```text
src/components/BuyerLibrary.tsx:404:23 - error TS1434: Unexpected keyword or identifier.
src/components/BuyerLibrary.tsx:404:50 - error TS1127: Invalid character.
src/components/BuyerLibrary.tsx:406:19 - error TS1109: Expression expected.
src/components/BuyerLibrary.tsx:427:1 - error TS1128: Declaration or statement expected.
Found 15 errors.
```

The lines following the closing brace of `BuyerLibrary` contained duplicate unclosed JSX from a previous manual merge resolution:

```tsx
  );
}
                      Unlock Service Unavailable — Reconnect to verify on - chain license
                    </div >
                  )}
                </div >
...
```

### 2.2 Why was there no rollback target?

The automated rollback query against Vercel production deployments found no prior deployment in `READY` state with a distinct SHA. This occurred because previous deployment attempts on `main` had encountered build failures, leaving no healthy fallback artifact on record.

### 2.3 Scope

The failure was strictly confined to frontend bundle compilation. The Soroban smart contracts (`prompt-hash`) and auxiliary backend APIs are independent and were not impacted.

---

## 3. Verification Checklist

- [x] Inspect failed Actions run logs (Run 36131288148)
- [x] Reproduce compilation failure locally via `yarn typecheck`
- [x] Remove dangling code fragment from `src/components/BuyerLibrary.tsx`
- [x] Verify clean `tsc -b` / `yarn typecheck` pass
- [x] Verify health check endpoints (`/api/health`, `/api/status`)
- [x] Verify smart contract state is healthy on testnet: `yarn inspect:contract config`
- [x] Ensure fix-forward commit is ready for deployment

---

## 4. Health Check Status

| Endpoint / Component | Status | Checked At |
|----------------------|--------|------------|
| `/api/health` | Healthy | 2026-09-26 03:16 UTC |
| `/api/status` | Healthy | 2026-09-26 03:16 UTC |
| Smart Contract (`prompt-hash`) | Active / Unaffected | 2026-09-26 03:16 UTC |
| TypeScript Compiler (`tsc -b`) | Passing (0 errors) | 2026-09-26 03:16 UTC |

---

## 5. Preventative Actions

1. Enforce branch protection rule requiring `yarn typecheck` and `yarn test:frontend` to pass before merge.
2. Add automated pre-merge syntax check in PR workflows to catch unresolved merge remnants.
3. Maintain at least one pinned stable production deployment on Vercel to guarantee automated rollback targets.
