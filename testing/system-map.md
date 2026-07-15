# JustifyMyPrinter system map

## Runtime

- `server.js`: Express routing, health check, and static file allowlist.
- `api/`: Neon-backed handlers; authorization is enforced here.
- `js/`: browser ES modules and Hebrew RTL rendering.
- `api/init.js`: additive, idempotent schema initialization.
- `docs/PRODUCT_SPEC.md`: canonical product specification.

## Verification architecture

- `scripts/run-tester.js`: read-only deterministic runner with human and bounded
  JSON output.
- `testing/test-manifest.json`: check tiers, prerequisites, mutation level,
  proof limits, timeouts, and default skip reasons.
- `scripts/lib/regression-checks.js`: missing-file-sensitive R1-R9 T2 source
  contracts.
- `tests/`: T1 unit, runner-policy, wrapper-governance, and negative-fixture
  sensitivity coverage.
- `agent-system/roles/tester.md`: independent read-only verification role.
- `agent-system/roles/quality-curator.md`: sole owner of tests, regression/task
  state, and approved durable system knowledge.

Only executed check failures affect tester exit status. Open or later tasks and
skipped integration, browser, or remote checks remain visible but non-failing.

## Canonical states

- Users: `pending`, `active`, `inactive`, `rejected`.
- Orders: `new`, `waiting_approval`, `waiting_print`, `printing`,
  `ready_delivery`, `completed`, `failed`, `cancelled`.
- Legacy order writes normalize `approved`, `ready`, `delivered`, and `rejected`.

## Core flows and invariants

- Public catalog reads expose only published product DTOs; ordering requires an
  eligible authenticated account.
- Friends can read only their own orders; administrative data and mutations are
  admin-only.
- Payment is manual and independent of order status.
- Special-order printing waits for price approval; unavailable colors require a
  separate alternative-color approval.
- Completed catalog orders deduct material and purge once. Failed attempts deduct
  only cumulative recorded waste that was not previously deducted.
- Database columns use snake_case; API and frontend contracts use camelCase.
- Messaging endpoints remain disabled; communication is via WhatsApp links.
