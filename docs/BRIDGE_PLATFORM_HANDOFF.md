# Bridge platform pause handoff

This file is the durable restart point for the paused local-print-bridge work.
Read it before changing bridge APIs, schema, the daemon, or the Windows shell.
The product requirements remain in `docs/PRODUCT_SPEC.md`; this handoff records
the verified implementation and the work that is intentionally still open.

## Repository checkpoint

- Task ID: `bridge-platform-zero2-v1`
- Role: Coordinator / Git Steward handoff
- Bridge branch: `agent/bridge-platform-integration-v1`
- Bridge worktree: `/private/tmp/JMP-bridge-platform-integration-v1`
- Current site baseline merged into this branch: `1073e4a`
- Integrated bridge tip before this handoff file: `03676ce`
- Naive-site cleanup branch: `agent/site-naive-without-bridge-v1`
- Naive-site cleanup commit: `6c87e7b`
- Publication state: local commits only; no bridge push, deployment, database
  migration, or hardware command was performed by this work.

The bridge branch contains patch-equivalent integrations of the original site,
runtime/Pi, and Windows builder commits, followed by shared tests, localhost
support, partial-dashboard recovery, and the latest printer/order UI merge.
The historical builder worktrees are not additional sources of truth.

## Implemented behavior

### Website

- The site remains the source of truth for order allocation and the print queue.
- Bridge authentication requires `BRIDGE_SECRET` and the fixed
  `BRIDGE_ID=home-bridge`; Bearer is preferred and the legacy header remains for
  compatibility.
- Admin and bridge DTOs are separated. `bridge-queue` is read-only, bounded,
  and excludes customer/payment PII and claim tokens.
- Claims are atomic and return a per-claim token. Heartbeat and report calls
  require that token. Terminal completion is idempotent.
- A print job represents one physical plate and may allocate quantities across
  `print_job_items`. `orders.printed_quantity` records partial fulfilment.
- Uncertain physical state can move to `attention_required` and never retries
  automatically.
- The admin UI supports bridge-file selection, a confirmation summary, custom
  plates, same-checkout/exact-colour suggestions, and explicit manual-fit/AMS
  warnings.
- A failed admin endpoint no longer blanks every dataset: products and users
  remain visible with an accessible partial-load warning.
- The printer workflow is a separate admin view from the customer/order view.

### Portable daemon and Raspberry Pi Zero 2 W

- `bridge/` is independent of Electron and platform-specific GUI APIs.
- 3MF inspection uses lazy ZIP entries and line-by-line G-code parsing instead
  of loading the archive or plate G-code in full.
- The library owns `incoming/`, `library/`, and `quarantine/`, performs stable
  import, SHA-256 deduplication, atomic placement, cache checks, full inventory
  sync, and a low-disk claim/import guard.
- The management API binds to loopback by default and requires a bearer
  capability. Public binding is not part of v1.
- Pi configuration, resource limits, systemd hardening, storage layout, and
  installation notes live in `bridge/PI-INSTALL.md` and
  `bridge/jmp-print-bridge.service`.

### Windows shell

- `bridge-desktop/` is an Electron RTL controller that communicates only with
  the management API; it has no daemon imports.
- Renderer isolation, CSP, preload allowlisting, `safeStorage`, loopback API
  access, import streaming, tray behavior, and per-user NSIS configuration are
  scaffolded.
- The Windows package does not yet bundle or provision a daemon executable.
  It must not be described as an installer-complete bridge runtime.

## Verification at pause point

- `node --test tests/local-bridge.test.js tests/bridge-platform.test.js tests/dashboard-partial-load.test.js tests/printer-tab.test.js`
  — 24 passed, 0 failed.
- `npm test` — 98 passed, 0 failed.
- `npm run build` — built 6 pages and static assets.
- `npm run tester` — 14 passed, 0 failed, 4 expected skips.
- `git diff --check` — passed.

These are T0-T2 checks. They do not prove PostgreSQL behavior, an authenticated
browser workflow, Electron packaging on Windows, Pi memory/RSS limits, Wi-Fi
recovery, or physical FTPS/MQTT behavior.

## Database and environment status

The configured shared Neon database was inspected read-only on 2026-08-06. It
had existing products/users/orders but did not yet have `bridges`,
`bridge_files`, `print_job_items`, or `orders.printed_quantity`. The bridge
branch's admin page therefore degrades safely, but the full queue is not
operational against that schema.

Do not call `/api/init` against the shared database merely to make localhost
green. The preferred next step is a separate development database or database
branch, then the additive initializer, followed by T3 API tests. Applying the
additive schema to the shared site requires explicit owner approval.

Required configuration names are documented in `bridge/.env.example`. Never
copy real secret values into Git, logs, issue text, or this handoff.

## Known open work

1. Create an isolated development database, run the additive initialization,
   and verify sync -> select file -> approve plate -> claim -> report -> partial
   and complete order fulfilment.
2. Add real T3 concurrency coverage with PostgreSQL for claim races,
   allocation limits, stale claims, and duplicate completion.
3. Perform T4 Hebrew RTL/mobile/accessibility browser checks for normal and
   custom plate flows, offline bridge, missing file, and busy printer.
4. Complete Windows daemon packaging/provisioning and test install, upgrade,
   uninstall preservation, DPAPI, scaling, tray, and slow import behavior on
   Windows 11.
5. Run the specified Zero 2 W memory, disk, restart, Wi-Fi, and 100MiB tests on
   physical hardware. Do not approve the device target from source tests alone.
6. Validate real printer FTPS/MQTT behavior and a small physical print only
   after a separate owner confirmation.

## Branch separation and safe resumption

The owner paused bridge development and wants the normal site to remain unaware
of the bridge. Commit `6c87e7b` removes the printer tab, print-job buttons,
bridge polling/routes/schema bootstrap, bridge runtime files, and bridge tests
from the naive-site branch while keeping manual order status progression.

At the time of this checkpoint, the primary `main` worktree contained unrelated
uncommitted pricing/idea work. Three of those files overlap the naive cleanup:
`api/print-jobs.js`, `dashboard.html`, and `js/render.js`. For that reason,
`6c87e7b` was not fast-forwarded into `main`. Preserve or commit that owner work
before integrating the cleanup; do not stash, reset, or overwrite it.

When resuming bridge work:

1. Start from `agent/bridge-platform-integration-v1` and verify its current
   head and worktree status.
2. Re-read this file plus `bridge/README.md`, `bridge/PI-INSTALL.md`, and
   `bridge-desktop/README.md`.
3. Re-check `main` and `origin/main`; merge/rebase only with explicit approval
   and rerun the full verification matrix after reconciliation.
4. Never run two active daemons with the same bridge identity.
5. Keep commit, push, `main` integration, deployment, database migration, and
   worktree cleanup as separate approval boundaries.

## Historical worktrees

Several older bridge worktrees remain. Their bridge-specific core files were
compared with the integrated base and were already present. The untracked
`bridge/package-lock.json` in the old cart worktree is stale because it still
contains `adm-zip`; do not copy it. The uncommitted Cloudinary split prototype
under `JMP-fix-print-upload-limit` was explicitly excluded from this bridge
plan. Do not merge historical worktrees wholesale.

## Handoff contract summary

- Files changed: website bridge API/schema/UI, `bridge/`, `bridge-desktop/`,
  bridge/platform tests, partial-load recovery, this handoff.
- Assumptions: one site, one printer, one active daemon, one physical plate per
  job, local print bytes only, manual AMS mapping, no automatic reprint.
- Skipped checks: disposable PostgreSQL, authenticated browser, Windows
  packaging, Pi hardware, printer hardware, remote/deployment verification.
- Unresolved risks: schema is not applied, Windows daemon artifact is missing,
  physical printer protocol remains unverified, Zero 2 W resource acceptance
  is unproven on hardware.
- Proposed knowledge update: none; this repository file is the durable handoff.
- Proposed regression update: existing bridge and partial-load tests already
  record the implemented T1/T2 boundaries.
