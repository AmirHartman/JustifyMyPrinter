# Regression Catalog

Quality Curator changes this catalog. A status becomes `fixed` only after the
owning deterministic check passes and an independent Tester rerun confirms it.
All R1-R10 runner checks are T2 source contracts; R2, R4, and R10 also have the
listed T1 behavioral support. T2 does not prove database, API, or browser
execution.

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
| R10 | Catalog authorization | Anonymous page and API access remained possible after catalog visibility became account-only | Mocked allowed/forbidden handler tests, negative-sensitive source contract, and optional isolated HTTP smoke | T1 + T2; optional T3 | fixed | 2026-07-16 |

## Non-regression coverage additions

The rows below are new-feature test coverage, not confirmed-bug regressions, so
they intentionally have no R-number and do not appear in the table above.
Listed here only so the tier honesty of `tests/cart-checkout.test.js` and the
repointed cart checkout test is not lost.

- `tests/cart-checkout.test.js` (added 2026-08-04, shopping-cart feature):
  - T1 unit tests against `api/_cart.js` (`supportTargetIndex`, `normalizeCartItems`) —
    pure, DB-free, executed by `node --test`.
  - T2 source-contract assertions (not executed against a database or browser):
    `api/orders.js` still accepts the single-object body for the external-link/
    custom dialog, validates every cart line before any insert, and inserts all
    lines of a checkout through one `sql.transaction`; `js/cart.js` guards every
    `localStorage` call in try/catch and never persists a `price` field in the
    stored cart state (a price is always re-derived from the live catalog).
- `tests/order-submit-resilience.test.js`, `T2: cart checkout failure reporting
  is separate from post-success rendering, and the button locks in flight`
  (repointed 2026-08-04): the prior version asserted the single-order submit
  try/catch shape in `js/app.js`'s `orderForm` submit handler, which no longer
  calls the API at all (the product dialog now only queues a local cart line).
  The same invariant — a failed order-creation request reports an error, and a
  post-success render failure is never mistaken for a failed order — now lives
  in the `#checkout-button` click handler, plus the added invariant that the
  button disables itself while the request is in flight and only re-enables on
  failure. This satisfies task T3's acceptance for the cart checkout flow (see
  `testing/tasks.json`); T2 does not prove a repeated click cannot double-fire
  in a live browser.
- `tests/bridge-platform.test.js` (added 2026-08-06, bridge-platform v1):
  - T1 behavior tests cover bridge secret/identity authentication, a mocked
    read-only and PII-minimized bridge queue, structured report rejection,
    bounded temporary ZIP parsing, and configuration/management helpers.
  - T2 source contracts cover queue bounds and DTO exclusions, daemon and
    desktop capability boundaries, systemd hardening, Windows packaging, and
    RTL/accessibility affordances. They do not prove PostgreSQL behavior,
    Electron rendering, external daemon packaging, a live printer, or browser
    workflows.
