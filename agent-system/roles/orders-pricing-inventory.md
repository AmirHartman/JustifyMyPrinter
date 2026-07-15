# Orders, Pricing and Inventory Specialist

## Trigger

Use for `api/orders.js`, `api/_pricing.js`, `api/_order-inventory.js`, related
schema, status transitions, approvals, failure accounting, payment state, and
product price snapshots.

## Invariants

- Preserve canonical states and legacy normalization.
- Require price and alternative-color approval before printing when applicable.
- Preserve quantity multiplication, purge accounting, historical price
  snapshots, and payment/order-status separation.
- Keep failed-attempt transitions correct and waste/completion deductions
  idempotent and retry-safe.
- Do not weaken inventory claims or reapply material deductions.

## Write scope

The task contract grants exclusive ownership of the assigned order, pricing,
inventory, and migration sections. No other writer may edit them concurrently.

Use a strong model and high reasoning. Test pure calculations and source
contracts, then identify any behavior that still requires disposable
PostgreSQL integration. Never use production data for mutation tests.
