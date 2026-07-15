# מדפסת חברים — Builder Plan

> **Archived plan (completed 2026-07-04).** Builders 2–8 are implemented.
> Builder 9 remains useful as a QA checklist, but this file no longer assigns
> active ownership. Use `AGENTS.md` for current instructions.

This document records the multi-agent implementation sequence used for the
JustifyMyPrinter / מדפסת חברים project. Each builder has a specific role,
tool, and historical file ownership scope.

## Collision rules (all builders must follow)

1. **Read docs first.** Always read `docs/PROJECT_CONTEXT.md`,
   `docs/PRODUCT_SPEC.md`, and this file before starting work.
2. **Declare files.** State which files you intend to edit before editing them.
3. **Respect ownership.** If another builder owns a file, avoid editing it
   unless necessary. Explain why if you must.
4. **Small commits.** Prefer small, focused commits per builder.
5. **Stop on risk.** If a change requires schema/auth/runtime risk, stop and
   report before making broad edits.
6. **No paid services.** Do not add paid services or major dependencies without
   approval from the owner.
7. **No secrets.** Never expose DATABASE_URL, API keys, or env values.
8. **Prefer additive.** Prefer `ADD COLUMN IF NOT EXISTS` and safe migrations
   over destructive DB changes.

---

## Builder 0 — Documentation Bootstrapper ✅

**Tool:** Claude Code
**Status:** Complete (2026-07-03)
**Mode:** Docs-only. No application code changes.

**Owns:**
- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/*.md` (all files in this directory)

**Does not touch:** any `.js`, `.html`, `.css`, `.json`, `.env`, or server files.

**Output:** Created `docs/` directory with:
- `docs/PROJECT_CONTEXT.md`
- `docs/PRODUCT_SPEC.md`
- `docs/AI_WORKFLOW_RULES.md`
- `docs/BUILDER_PLAN.md` (this file)
- `docs/RENDER_DEPLOYMENT_NOTES.md`
- Updated `CLAUDE.md`, `AGENTS.md`, `README.md`

---

## Builder 1 — Repo Audit / Coordinator

**Tool:** Claude Code
**Mode:** Read-only audit. No file edits.

**Owns:** Nothing (read-only pass).

**Task:**
1. Read all files in `docs/`, `api/`, `js/`, HTML pages, `package.json`, `server.js`.
2. Produce a complete **file ownership map** (which builder touches which file).
3. Produce a **risk list**: schema mismatches, missing endpoints, broken imports,
   auth gaps, status mismatches.
4. Produce a **priority order** for Builders 2–9 based on dependencies.
5. Note any files that two builders might need to touch (coordination needed).

**Must not:** modify any file.

**Original audit findings (resolved):**
- Order and user statuses were aligned with the spec, with legacy normalization.
- Product/category GETs were made public for active records.
- Notification writes and frontend message/notification fetches were removed.
- Legacy message/notification tables remain intentionally for compatibility.
- Registration metadata, multi-pay, price approval, and cancellation reasons
  were implemented.
- Passwords now use scrypt; legacy plaintext is upgraded after successful login.

---

## Builder 2 — Render Runtime / Backend Foundation

**Tool:** Codex
**Owns:** `server.js`, `package.json`, deployment/runtime docs only.

**Task:**
- Verify `npm start` (`node server.js`) works correctly on Render.
- Verify Express dependency and version in `package.json`.
- Verify all API routes in `server.js` match files in `api/`.
- Verify `process.env.PORT` is used (already is — just confirm).
- Add a `/health` endpoint if needed for Render health checks.
- If `render.yaml` is beneficial, create it (optional).
- Update `docs/RENDER_DEPLOYMENT_NOTES.md` if discoveries change anything.

**Must not:** edit HTML, CSS, frontend JS, API handler logic, or DB schema.

---

## Builder 3 — DB / API / Schema Alignment

**Tool:** Codex
**Owns:** `api/init.js`, `api/_db.js`, `api/settings.js`, schema-related changes.

**Task:**
- Add missing columns to `orders`: `cancellation_reason`, `support_amount`,
  `user_approved_price`, `requires_price_approval`, `updated_at`,
  `completed_at`, `order_type`, `user_notes`, `admin_notes`, `external_link`.
- Add missing columns to `users`: `phone`, `how_you_know_admin`,
  `message_to_admin`.
- Add `categories` table for dynamic category management.
- Keep all changes additive (`ADD COLUMN IF NOT EXISTS`).
- Keep Neon and avoid destructive migrations.
- Do not change existing column names or types.
- Coordinate with Builder 5 (orders) before changing order schema.

**Must not:** change authentication logic, product logic, or frontend code.

---

## Builder 4 — Auth / Users / Permissions

**Tool:** Claude Code
**Owns:** `api/auth.js`, `api/users.js`, auth-related parts of `api/_middleware.js`.

**Task:**
- Rename user status 'approved' → 'active' (in code and DB if safe).
- Add missing registration fields: phone, how_you_know_admin, message_to_admin.
- Enforce: pending users can view catalog but cannot order.
- Enforce: only active friends can order.
- Enforce: inactive/rejected users cannot order.
- Enforce: only admin accesses admin pages.
- Admin can also act as a normal user (already supported — verify).
- Add user status 'inactive' support if not present.

**Must not:** change order logic, product logic, or public catalog visibility
(that's Builder 7).

**Coordinate with Builder 3** if new user columns are needed.

---

## Builder 5 — Orders / Pricing / Payments

**Tool:** Claude Code
**Owns:** `api/orders.js`, order-related DB schema additions.

**Task:**
- Migrate order statuses to canonical set:
  `new, waiting_approval, waiting_print, printing, ready_delivery, completed, cancelled`.
- Add price approval flow: admin sets price → user approves → printing begins.
- Add cancellation with required reason.
- Add mark-multiple-orders-as-paid endpoint (e.g. POST `/api/orders?action=mark-paid`
  with array of order IDs and friend name).
- Remove or replace `STATUS_NOTIFICATION` and `notifications` table writes
  (coordinate with Builder 6).
- Verify orders POST checks user status (only active friends can order).
- Verify `friend_name` linkage uses user ID not just name if Builder 4 changes schema.

**Coordinate with Builder 3** for schema additions.
**Coordinate with Builder 6** to avoid duplicating notification removal.

---

## Builder 6 — Remove Internal Messages / Add WhatsApp

**Tool:** Codex
**Owns:** `api/messages.js`, `api/notifications.js`, WhatsApp helper/templates.

**Task:**
- Remove or disable internal message UI from all HTML pages and `js/render.js`.
- Remove `messages` and `conversations` from `js/state.js` `loadData()`.
- Remove notification inserts from `api/orders.js` (coordinate with Builder 5).
- Add a `js/whatsapp.js` helper with prefilled Hebrew message templates for:
  - status update;
  - price approval;
  - delivery coordination;
  - payment summary.
- Add WhatsApp buttons in admin user list view and near each order.
- Use `wa.me/<phone>?text=<encoded>` links only. No WhatsApp API.
- Do not drop the `messages` and `notifications` DB tables — just stop using them.
  Tables can be dropped in a future cleanup pass.
- Do not edit `api/messages.js` or `api/notifications.js` to break auth —
  just stop calling them from the frontend.

**Must not:** change product logic, order status logic, or user auth.

---

## Builder 7 — Products / Categories / Catalog

**Tool:** Claude Code
**Owns:** `api/products.js`, `catalog.html`, product-related frontend in `js/`.

**Task:**
- Fix: GET `/api/products` must return active products without requiring auth
  (currently requires auth — blocks public catalog).
- Implement dynamic categories: replace `category` text field with a proper
  category system. Products may belong to multiple categories.
- Add public category filter in catalog page.
- Ensure active products are visible to unauthenticated visitors.
- Ensure admin can manage categories.

**Coordinate with Builder 3** for categories table schema.

---

## Builder 8 — UI / RTL / Mobile / Dashboard

**Tool:** Claude Code
**Owns:** HTML pages (`index.html`, `welcome.html`, `catalog.html`, `dashboard.html`),
`styles.css`, `js/render.js`, `js/app.js`.

**Task:**
- Polish Hebrew RTL layout and mobile usability.
- Update landing page to match product vision.
- Update admin dashboard UI for new order statuses and quick actions.
- Update personal area for friend with correct order status labels.
- Add policy / how-it-works page.
- Remove internal message UI remnants (coordinate with Builder 6).
- Add WhatsApp buttons where appropriate.

**Must not:** change API logic or DB schema.

---

## Builder 9 — QA / Regression / Release Readiness

**Tool:** Codex
**Runs after:** all other builders.

**Task:**
- Verify app starts: `npm start` and `npm run dev`.
- Verify all API routes respond correctly (auth, catalog, orders, users, filaments).
- Verify Render deployment works (start command, PORT, env vars).
- Check for broken imports across all JS files.
- Check for secrets or env values in tracked files.
- Check that `api/init.js` is idempotent and works on a fresh DB.
- Verify pending users cannot place orders.
- Verify unauthenticated visitors can view the public catalog.
- Verify admin-only routes are protected.
- Note any remaining technical debt.

**Must not:** make functional changes — QA and report only.

---

## File ownership summary

| File / Directory       | Builder |
|------------------------|---------|
| `docs/*.md`            | 0       |
| `README.md`, `CLAUDE.md`, `AGENTS.md` | 0 |
| `server.js`            | 2       |
| `package.json`         | 2       |
| `api/init.js`          | 3       |
| `api/_db.js`           | 3       |
| `api/settings.js`      | 3       |
| `api/auth.js`          | 4       |
| `api/users.js`         | 4       |
| `api/_middleware.js`   | 4       |
| `api/orders.js`        | 5       |
| `api/messages.js`      | 6       |
| `api/notifications.js` | 6       |
| `js/whatsapp.js`       | 6 (new) |
| `api/products.js`      | 7       |
| `catalog.html`         | 7       |
| `index.html`           | 8       |
| `welcome.html`         | 8       |
| `dashboard.html`       | 8       |
| `styles.css`           | 8       |
| `js/render.js`         | 8       |
| `js/app.js`            | 8       |
| `js/state.js`          | 6 (messages removal), 8 (rendering) |

Files that multiple builders may touch are marked in bold above. Those builders
must coordinate to avoid conflicts.
