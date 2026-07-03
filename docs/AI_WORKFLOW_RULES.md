# מדפסת חברים — AI Workflow Rules

> **Canonical location.** This file in `docs/` is the authoritative version.
> The root-level `AI_WORKFLOW_RULES.md` points here to avoid duplication.

## Source of truth

Use `docs/PROJECT_CONTEXT.md` and `docs/PRODUCT_SPEC.md` as the source of truth.
Inspect current code before editing. `docs/BUILDER_PLAN.md` is historical and
does not assign active file ownership.

## Language

- Write plans, progress updates, analyses, summaries, test results, and final
  handoffs to the user in English unless the user explicitly requests another
  language.
- Prompts intended for Claude Code, Codex, Cursor, or other coding/build AIs
  must be written in English by default.
- Keep user-facing product copy and UI text in Hebrew unless the task explicitly
  changes the product language requirement.
- Coding-agent prompts should be token-efficient but clear and actionable.

## Non-negotiable defaults for all agents

| Rule | Detail |
|------|--------|
| Database | Neon PostgreSQL. Do not replace. |
| Deployment | Render (Express). Do not add Vercel serverless functions. |
| Free tier | No paid services or paid add-ons without explicit approval. |
| Architecture | No framework replacement without approval. |
| RTL | Preserve Hebrew RTL UI. |
| Secrets | Never expose DATABASE_URL, API keys, or env values. |
| Admin guard | Only admin can access admin pages/data. |
| Pending users | Can view catalog but **cannot order**. |
| Active products | Publicly visible — no login required for catalog browsing. |
| Ordering | Active friends only. |
| Internal messages | Removed/disabled. WhatsApp links replace them. |
| Payment | Manual paid/unpaid only. No payment processing in MVP. |
| Multi-pay | Admin can mark multiple orders from one friend as paid together. |
| Admin as user | Admin can also act as a normal user and place personal orders. |
| Categories | Dynamic, not hard-coded. |
| MVP scope | Catalog orders + external-link orders. No file upload, no cart. |

## When generating coding-agent prompts

Include only the relevant constraints. Avoid long background unless needed.
Reference specific files and line numbers where possible.

## Standard prompt patterns

### Audit first (use for large/risky tasks)

```
Read docs/PROJECT_CONTEXT.md and docs/PRODUCT_SPEC.md, then inspect the repository.
Do not modify files yet.
Return:
1. Current behavior
2. Gaps vs the spec
3. Files likely affected
4. Minimal implementation plan
5. Risks and test steps
Keep Neon/Render free-tier constraints in mind.
```

### Direct implementation (use for small clear tasks)

```
Implement this change with minimal edits.
Constraints:
- Preserve the current Express + Neon architecture.
- Keep Hebrew RTL UI.
- Do not add paid services or new major dependencies.
- Do not expose env/secrets.
Return: summary, files changed, and test steps.
```

### Change WhatsApp communication

```
Change the existing WhatsApp-based communication.
- Keep internal message/notification compatibility endpoints disabled.
- Use wa.me links with prefilled Hebrew messages for user profile, order status
  update, price approval, delivery coordination, and payment summary.
- No WhatsApp API.
- Preserve auth, permissions, Hebrew RTL, and mobile UX.
- Do not drop the messages/notifications DB tables yet — just stop using them.
Return: files changed and test steps.
```

### Auth / approval flow

```
Preserve and extend the existing auth and user approval flow:
- Anyone can register.
- New users start as status='pending'.
- Pending users can view catalog but cannot order.
- Active users (status='active') can order.
- Inactive/rejected users cannot order.
- Only admin can access admin pages.
- Admin can also use the site as a normal user.
- Keep legacy 'approved' normalization to 'active'.
- Preserve registration fields: phone, how_you_know_admin, registration_message.
Return: changed files, migration notes, and test steps.
```

### Order flow / statuses

```
Preserve and extend the order flow in docs/PRODUCT_SPEC.md §6:
Canonical statuses: new, waiting_approval, waiting_print, printing,
  ready_delivery, completed, cancelled.
Payment is separate: paid true/false.
Catalog orders may auto-approve (skip waiting_approval).
External-link/custom orders require admin price approval and user confirmation
  before printing begins.
Users may cancel before printing; cancellation reason is required.
Admin can mark multiple orders from one friend as paid in a single API call.
Return: changed files, migration plan for existing orders, and test steps.
```

### Public catalog

```
Preserve product catalog visibility:
- GET /api/products must return active products without requiring auth.
- Authenticated admin sees all products (including inactive).
- Authenticated friend sees only active products.
- Unauthenticated visitors also see active products (no 401).
Return: changed file and test steps.
```

### Products / categories

```
Change the existing dynamic product category system:
- Categories are admin-managed, not hard-coded.
- Products may belong to multiple categories.
- Public catalog can filter by category.
Preserve the legacy category field unless an explicit migration removes it.
Return: schema change plan, files affected, and test steps.
```
