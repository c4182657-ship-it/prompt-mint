# Incident SEV-1 — Deploy Failure: d60c5021

**Date**: September 24, 2026
**Severity**: SEV-1 (Critical — Deployment Failure)
**Status**: Incident Response In Progress
**Failed SHA**: `d60c5021cce1e2e4a94eb8264aede887ba1d4117`
**Ref**: main
**Actor**: barry01-hash
**Workflow**: Deploy - Frontend to Vercel and Artifacts
**Conclusion**: failure
**Outcome**: incident_only
**Last Known-Good**: none found

This ticket was opened by rollback automation. Do not close it until:

1. Production is serving the last known-good artifact (or a confirmed fix).
2. Health checks (`/api/health`, `/api/status`) pass.
3. The incident timeline below is complete.

See `docs/operations/auto-rollback.md` and `docs/operations/deployment-runbook.md`.

---

## Executive Summary

The frontend deployment workflow failed on commit `d60c5021` on the `main` branch. The automated rollback system was triggered but found **no distinct READY production deployment** with a different SHA, resulting in an `incident_only` outcome. No automatic revert was possible; on-call escalation is required to restore production.

---

## 1. Incident Timeline (UTC)

| Time | Event | Details |
|------|-------|---------|
| 2026-09-24 ~T+00 | Commit `d60c5021` pushed to `main` | Actor: barry01-hash — exact merge time TBD from GitHub Actions log |
| 2026-09-24 ~T+03m | Deploy workflow triggered | CI pipeline: `Deploy - Frontend to Vercel and Artifacts` started |
| 2026-09-24 ~T+05m | Build or deploy step failed | Exact failure point TBD — inspect Actions run for first failing step |
| 2026-09-24 ~T+07m | Auto-rollback workflow triggered | `.github/workflows/auto-rollback.yml` detected `failure` conclusion |
| 2026-09-24 ~T+09m | Rollback decision: `incident_only` | No previous READY Vercel deployment found with a different SHA |
| 2026-09-24 ~T+09m | GitHub incident ticket created | Rollback automation opened this ticket with `sev-1`, `incident` labels |
| 2026-09-24 (ongoing) | **CURRENT** | Manual investigation and remediation in progress |

*Times marked ~T+Xm are estimated relative offsets. Replace with exact UTC timestamps from the Actions run log once inspected.*

---

## 2. Root Cause Analysis

### 2.1 Why did the deploy fail?

The `Deploy - Frontend to Vercel and Artifacts` workflow performs these steps:
1. Checkout + dependency install
2. Frontend build (`yarn build` / `vite build`)
3. Generate frontend checksums and artifact metadata
4. Upload build artifacts
5. Deploy to Vercel

**Investigation required** — open the failed Actions run and identify the first failing step.

Common causes for this workflow failing:

| Hypothesis | Evidence to check |
|------------|-------------------|
| TypeScript type error introduced by commit | Run `yarn typecheck` locally on `d60c5021` |
| ESLint/lint failure in CI | Check `yarn lint` output in the Actions log |
| Vite build failure (missing env var, bad import) | Look for `vite build` exit code and stderr |
| Dependency resolution failure | Check `yarn install` step for resolution errors |
| Artifact upload timeout | Look for `upload-artifact` step timeout in Actions log |
| Vercel API connectivity issue | Check Vercel status page at https://www.vercel-status.com |
| New locale JSON syntax error | Verify all files under `src/i18n/locales/` parse cleanly with `jq . <file>` |

### 2.2 Why was there no rollback target?

The automatic rollback checked Vercel's production deployments and found no `READY` deployment with a **different SHA**. This means either:
- No previous stable production version exists in Vercel's deployment history, or
- All prior Vercel deployments share the same or a parent SHA, or
- Vercel deployment history was pruned.

### 2.3 Scope

This appears to be a frontend deployment failure. The Soroban smart contract (`prompt-hash`) is deployed independently via `scripts/deploy.sh` / `scripts/upgrade.sh` and is **not affected** by a Vercel deploy failure.

---

## 3. Immediate Verification Checklist

- [ ] Inspect the failed Actions run — identify the first failing step
- [ ] Run `yarn typecheck` on `d60c5021` locally
- [ ] Run `yarn build` on `d60c5021` locally
- [ ] Confirm `/api/health` endpoint status
- [ ] Confirm `/api/status` endpoint status
- [ ] Check Vercel dashboard for any partial or stalled deployment
- [ ] Verify contract state is unaffected: `yarn inspect:contract config --network testnet`
- [ ] Check Vercel status page for platform incidents

---

## 4. Health Check Status

| Endpoint | Status | Checked At |
|----------|--------|------------|
| `/api/health` | ❓ Not yet verified | — |
| `/api/status` | ❓ Not yet verified | — |
| Vercel Dashboard | ❓ Not yet checked | — |
| Soroban RPC (testnet) | ❓ Not yet checked | — |

---

## 5. Recommended Next Steps

1. **Identify the failing step** in the Actions run for `d60c5021`.
2. **Fix forward** if the failure is a simple build error (lint, typecheck, bad import).
3. **If the fix is non-trivial**, manually roll back via Vercel dashboard: `vercel rollback <previous-id>` (see `docs/operations/deployment-runbook.md` §3.1).
4. Once production is healthy, update health check status above and close this ticket.
5. File a post-mortem per `docs/operations/deployment-runbook.md` §7.3 within 48 hours.

---

## 6. Severity Justification

**SEV-1** is appropriate because:
- The production frontend is in an unknown state (no confirmed last-known-good)
- The automated rollback system found no prior READY deployment — production may be completely down
- All users attempting to access the marketplace are potentially impacted
- Target response time: < 15 minutes (see runbook §7.1)
