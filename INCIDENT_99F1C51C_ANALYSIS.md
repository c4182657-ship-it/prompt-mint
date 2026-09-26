# Incident SEV-1 — Deploy Failure: 99f1c51c

**Date**: September 24, 2026
**Severity**: SEV-1 (Critical — Deployment Failure)
**Status**: Incident Response In Progress
**Failed SHA**: `99f1c51c0574ded2458b5a1a3e967eb8748b08fb`
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

A second consecutive frontend deployment failure occurred on commit `99f1c51c` on the `main` branch, triggered by actor `barry01-hash`. Like the preceding incident (`d60c5021`), the automated rollback found **no distinct READY production deployment** and produced an `incident_only` outcome. Two successive deploy failures with no rollback target indicate either a persistent build breakage introduced across both commits, or a Vercel project state issue (no prior READY deployment on record). Immediate manual investigation is required.

---

## 1. Incident Timeline (UTC)

| Time | Event | Details |
|------|-------|---------|
| 2026-09-24 ~T+00 | Commit `99f1c51c` pushed to `main` | Actor: barry01-hash — exact push time TBD from Actions log |
| 2026-09-24 ~T+03m | Deploy workflow triggered | `Deploy - Frontend to Vercel and Artifacts` pipeline started |
| 2026-09-24 ~T+05m | Build or deploy step failed | Exact failure step TBD — see Actions run log |
| 2026-09-24 ~T+07m | Auto-rollback triggered | `.github/workflows/auto-rollback.yml` detected `failure` |
| 2026-09-24 ~T+09m | Rollback decision: `incident_only` | No previous READY Vercel deployment found with a different SHA |
| 2026-09-24 ~T+09m | GitHub incident ticket created | Automation opened this ticket (`sev-1`, `incident` labels) |
| 2026-09-24 (ongoing) | **CURRENT** | Manual investigation and remediation in progress |

*Times marked ~T+Xm are estimated relative offsets from commit push. Replace with exact UTC timestamps from the Actions run log.*

---

## 2. Root Cause Analysis

### 2.1 Two consecutive failures — elevated concern

Both `d60c5021` and `99f1c51c` failed the same workflow with the same `incident_only` outcome. This pattern points to one of:

| Hypothesis | Likelihood | Evidence to check |
|------------|-----------|-------------------|
| A breaking change was introduced in `d60c5021` and `99f1c51c` did not fix it | High | Diff both commits; run `yarn build` and `yarn typecheck` locally |
| A new dependency was added that fails to resolve in CI | Medium | Check `yarn install` output in both Actions runs |
| Vite build error (bad import, missing env var, TS strict error) | High | Look for first non-zero exit in `vite build` step |
| Vercel project has no prior READY deployment (new project or history pruned) | Medium | Check Vercel dashboard — Deployments tab |
| Vercel API token expired or quota exceeded | Low | Check Vercel account status and `VERCEL_TOKEN` secret |
| ESLint / lint-staged blocking the build | Medium | Run `yarn lint` on the failing SHA |
| i18n locale JSON syntax error in newly added locale keys | Low | Run `jq . src/i18n/locales/*.json` to validate all locale files |

### 2.2 Scope

The Soroban smart contract is deployed independently and is **not affected** by a Vercel frontend deploy failure. Contract state can be inspected at any time:

```bash
yarn inspect:contract config --network testnet
yarn inspect:contract full --json > snapshot-$(date +%s).json
```

### 2.3 No rollback target — second time

The rollback system has now failed to find a prior READY deployment twice in a row. If no prior READY deployment exists in Vercel's history, the only paths to restoring production are:

1. **Fix-forward**: Repair the build error and push a new commit that deploys successfully.
2. **Manual Vercel deploy**: Trigger a manual Vercel deploy from a known-good local build artifact.
3. **Re-deploy from a prior git SHA**: Check out the last known-good commit and push a deploy directly via `vercel --prod`.

---

## 3. Immediate Verification Checklist

- [ ] Inspect the Actions run for `99f1c51c` — identify the first failing step and error message
- [ ] Compare the diff between `d60c5021` and `99f1c51c` — determine if the same root cause applies
- [ ] Run `yarn build` locally on `99f1c51c`
- [ ] Run `yarn typecheck` locally on `99f1c51c`
- [ ] Run `yarn lint` locally on `99f1c51c`
- [ ] Validate locale JSON files: `for f in src/i18n/locales/*.json; do jq . "$f" > /dev/null && echo "OK: $f" || echo "FAIL: $f"; done`
- [ ] Confirm `/api/health` endpoint status
- [ ] Confirm `/api/status` endpoint status
- [ ] Check Vercel dashboard for any stalled or errored deployments
- [ ] Check Vercel status page: https://www.vercel-status.com
- [ ] Verify contract state is unaffected: `yarn inspect:contract config --network testnet`

---

## 4. Health Check Status

| Endpoint | Status | Checked At |
|----------|--------|------------|
| `/api/health` | ❓ Not yet verified | — |
| `/api/status` | ❓ Not yet verified | — |
| Vercel Dashboard | ❓ Not yet checked | — |
| Soroban RPC (testnet) | ❓ Not yet checked | — |
| Prior READY Vercel Deployment | ❌ None found | Auto-rollback outcome |

---

## 5. Related Incident

This is the **second consecutive deploy failure** on `main` by `barry01-hash`:

| # | Failed SHA | Outcome | Ticket |
|---|-----------|---------|--------|
| 1 | `d60c5021cce1e2e4a94eb8264aede887ba1d4117` | incident_only | `INCIDENT_D60C5021_ANALYSIS.md` |
| 2 | `99f1c51c0574ded2458b5a1a3e967eb8748b08fb` | incident_only | **This file** |

Both incidents must be resolved before closing either ticket. A single post-mortem covering both failures is acceptable.

---

## 6. Recommended Next Steps

1. **Identify the root cause** — inspect both Actions run logs and diff both commits.
2. **Fix forward**: Apply a targeted fix commit that makes the build green, then push to `main` and verify the deploy succeeds end-to-end.
3. **If fix is not immediately available**: Manually deploy a known-good build via `vercel --prod` from a clean checkout of the last stable commit on `main` prior to `d60c5021`.
4. Once `/api/health` and `/api/status` are green, update health check status above and close both tickets.
5. File a combined post-mortem within 48 hours per `docs/operations/deployment-runbook.md` §7.3.
6. **Process improvement**: Ensure CI enforces `yarn build` + `yarn typecheck` on every PR so build-breaking commits cannot reach `main`. Add a required status check if not already present.

---

## 7. Severity Justification

**SEV-1** is appropriate because:
- Production frontend is in an unknown/down state for the second consecutive deploy
- No automatic rollback was possible — there is no prior READY deployment
- All users attempting to access the marketplace may be impacted
- Two successive failures by the same actor indicate an unreviewed or undertested change
- Target response time: < 15 minutes (see `docs/operations/deployment-runbook.md` §7.1)
