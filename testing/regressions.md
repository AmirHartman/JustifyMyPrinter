# Regression catalog

Status becomes `fixed` only after its deterministic check passes.

| ID | Area | Regression | Detection | Status | Date |
|---|---|---|---|---|---|
| R1 | Orders/products | Custom text remained after partial removal | Source-contract scan excludes DB compatibility columns | open | 2026-07-15 |
| R2 | Inventory | `failed` blocked later completion deduction | Inventory unit tests and atomic-query source check | open | 2026-07-15 |
| R3 | Categories | Category row referenced undefined filament `f` | `newSpoolBtn` absence check | open | 2026-07-15 |
| R4 | Init security | Missing `NODE_ENV` bypassed `INIT_SECRET` | Init authorization matrix | open | 2026-07-15 |
| R5 | Login | Admin was redirected to friend welcome page | Login redirect source check | open | 2026-07-15 |
| R6 | Goals/ledger | Submit failures escaped without button recovery | Handler guard source check | open | 2026-07-15 |
| R7 | Status UI | Failed orders remained in open lists/spec drifted | Canonical/closed-status checks | open | 2026-07-15 |
| R8 | Orders | `failed_attempts` incremented on every save | Transition unit/source check | open | 2026-07-15 |
| R9 | Migration | Init re-derived valid manager risk choices | Idempotent migration source check | open | 2026-07-15 |
