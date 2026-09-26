# Security Policy

## Reporting a Vulnerability

Please reach out to the team using GitHub's own security mechanism to submit an anonymous report.

See [docs/security/vulnerability-disclosure.md](docs/security/vulnerability-disclosure.md) for the full playbook: what to include, severity and remediation SLAs, triage steps, safe harbor, and the 90-day responsible-disclosure window.

## Related Documentation

- [Penetration testing schedule and methodology](docs/security/penetration-testing.md) — cadence, scope, and remediation SLAs for our recurring security testing program.
- [Security model and threat architecture](docs/security-model.md) — ongoing threat model for the on-chain contract and off-chain Unlock Service.
- [Security audit report](docs/security-audit.md) — most recent point-in-time audit findings.
- [`.github/workflows/security-pentest.yml`](.github/workflows/security-pentest.yml) — npm audit, Semgrep SAST, OWASP ZAP DAST, and Slither / Soroban contract analysis.
- [`.github/workflows/dependency-scan.yml`](.github/workflows/dependency-scan.yml) — automated dependency vulnerability scanning (npm + cargo) that runs on every PR and weekly.
- [Contract gas benchmarks](docs/contract-gas-benchmarks.md) — CPU/memory baselines and the >10% regression gate for contract operations.

---

# PromptHash Soroban Contract - Threat Model & Security Review

## 1. Threat Model Overview

### Actors

| Actor             | Capabilities                                         | Trust Level    |
| ----------------- | ---------------------------------------------------- | -------------- |
| Admin             | Set fee %, fee wallet, upgrade contract              | Highly Trusted |
| Creator           | Create prompts, modify own prompts, set price/status | Trusted        |
| Buyer             | Purchase prompts, access purchased content           | Semi-Trusted   |
| Off-chain Service | Index events, track unlocks                          | Semi-Trusted   |
| Malicious Caller  | Attempt exploits, griefing                           | Untrusted      |

## 2. Identified Risks & Mitigations

### Risk 1: Reentrancy in Purchase Flow

**Severity:** High  
**Vector:** `buy_prompt` performs two token transfers sequentially
**Mitigation:** Implement non-reentrant guard (State::DuringPurchase variant)

### Risk 2: Prompt ID Enumeration

**Severity:** Medium
**Vector:** Sequential prompt IDs allow enumeration
**Mitigation:** Use random/pseudorandom IDs (deferred, documented)

### Risk 3: Storage Growth DoS

**Severity:** Medium
**Vector:** No limits on purchases per prompt
**Mitigation:** Add max purchases cap in Prompt struct

### Risk 4: Fee Percentage Race Condition

**Severity:** Low
**Vector:** Fee can be changed during ongoing purchase
**Mitigation:** Snapshots fee at purchase start

### Risk 5: Upgrade Without Timelock

**Severity:** High
**Vector:** Immediate upgrade possible by admin
**Mitigation:** Document as known risk, consider timelock (deferred)

### Risk 6: Missing Prompt Existence Check

**Severity:** Medium
**Vector:** Operations on non-existent prompts return NotFound
**Mitigation:** Already handled via require_prompt()

### Risk 7: Arithmetic Overflow in Sales Count

**Severity:** Low
**Vector:** sales_count is u32, could overflow ~4B sales
**Mitigation:** Change to u64

### Risk 8: Fee Validation on Set

**Severity:** Low
**Vector:** Fee is validated (<= MAX_BPS), good
**Mitigation:** None needed

## 3. Security Fixes Applied

1. Added reentrancy guard to prevent double-spend during buy_prompt
2. Added max purchases limit to prevent storage spam
3. Changed sales_count to u64 to prevent overflow
4. Snapshotted fee percentage at purchase start
5. Added additional overflow checks in arithmetic paths

## 4. Deferred Risks (Future Work)

- Prompt enumeration protection (requires UX changes)
- Upgrade timelock (requires governance)
- Rate limiting on create_prompt (requires additional research)

## 5. Acceptance Criteria Status

- [x] Written threat model exists
- [x] Security findings fixed or documented
- [x] Purchase, entitlement, admin fee, fee wallet covered
- [x] Review completes before release
