# Regression Catalog

Quality Curator changes this catalog. A status becomes `fixed` only after the
owning deterministic check passes and an independent Tester rerun confirms it.
All R1-R9 runner checks are T2 source contracts; R2 and R4 also have the listed
T1 behavioral support. T2 does not prove database, API, or browser execution.

| ID | Area | Root cause / regression | Detection | Evidence tier | Status | Date |
|---|---|---|---|---|---|---|
| R1 | Orders/products | Custom text remained after partial removal | Required-file-sensitive source scan plus negative fixture | T2 | fixed | 2026-07-15 |
| R2 | Inventory | `failed` blocked later completion deduction | Inventory helper unit tests plus accounting source contract | T1 + T2 | fixed | 2026-07-15 |
| R3 | Categories | Category row referenced undefined filament `f` | `newSpoolBtn` absence contract plus negative fixture | T2 | fixed | 2026-07-15 |
| R4 | Init security | Missing `NODE_ENV` bypassed `INIT_SECRET` | Authorization matrix plus source/environment contract | T1 + T2 | fixed | 2026-07-15 |
| R5 | Login | Admin was redirected to the friend welcome page | Login redirect source contract plus negative fixture | T2 | fixed | 2026-07-15 |
| R6 | Goals/ledger | Submit failures escaped without button recovery | Managed-handler source contract plus negative fixture | T2 | fixed | 2026-07-15 |
| R7 | Status UI | Failed orders remained open and the specification drifted | Closed-status/spec source contract plus negative fixture | T2 | fixed | 2026-07-15 |
| R8 | Orders | `failed_attempts` incremented on every save | Prior-status transition source contract plus negative fixture | T2 | fixed | 2026-07-15 |
| R9 | Migration | Init re-derived valid manager risk choices | Idempotent migration source contract plus negative fixture | T2 | fixed | 2026-07-15 |
