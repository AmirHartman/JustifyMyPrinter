# Verification Matrix

| Tier | Evidence | Typical checks | Claim limit |
|---|---|---|---|
| T0 | Syntax/configuration | `node --check`, JSON/TOML/YAML parsing, wrapper links | Files parse; behavior is not proved. |
| T1 | Unit behavior | `node --test` | Tested pure/module behavior only. |
| T2 | Source contracts/regressions | Static invariants and R1–R9 checks | Required source shape exists; runtime reachability is not proved. |
| T3 | Local integration | Local HTTP smoke or disposable PostgreSQL/API tests | Only the exercised local environment and paths. |
| T4 | Browser workflow | Local browser console, network, accessibility, mobile/RTL flows | Only exercised browsers and workflows. |
| T5 | Deployment/remote read-only | Explicitly approved safe smoke | Reachability/read behavior only; no mutation or release proof. |

Select checks in proportion to risk. Permission changes require allowed and
forbidden cases. Database claims require an actual disposable/local
PostgreSQL-compatible run. Source scans must be labeled T2, not behavioral proof.

Every report states commands, exit codes, environment, mutation level, passes,
failures, skips and reasons, proof, remaining uncertainty, severity, and file and
line evidence. Skipped tiers are visible and do not fail the suite.
