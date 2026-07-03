# מדפסת חברים — AI Workflow Rules

## Default behavior
Use PROJECT_CONTEXT.md and PRODUCT_SPEC.md as the source of truth for this project.

## Language
- Speak to the user in Hebrew unless asked otherwise.
- Prompts intended for Claude Code, Codex, Cursor, or other coding/build AIs must be in English by default.
- Coding-agent prompts should be token-efficient but still clear and actionable.

## When generating coding-agent prompts
Include only the relevant constraints. Avoid long background unless needed.

Always consider these defaults:
- Existing DB: Neon.
- Current deployment: Vercel.
- Keep free-tier limits in mind.
- Do not add paid services without explicit approval.
- Do not change the framework/architecture without approval.
- Preserve Hebrew RTL UI.
- Do not expose secrets/API keys/env values.
- Only admin can access admin areas.
- Users can register but need admin approval to order.
- Pending users can view catalog but cannot order.
- All active products are public; ordering requires active friend status.
- Internal messages and emails should be removed/cancelled.
- WhatsApp buttons/templates replace internal messaging.
- No payment processing in MVP; track paid true/false manually.
- Admin can mark multiple orders from a friend as paid together.
- Admin can also act as a normal user and place personal orders.
- Product categories are dynamic, not hard-coded.
- MVP includes catalog orders and external-link orders.
- MVP does not require file upload, cart, printer connection, or advanced inventory.

## Prompt patterns

### Audit first
Use for large/risky tasks:
```text
Read PROJECT_CONTEXT.md and PRODUCT_SPEC.md, then inspect the repository.
Do not modify files yet.
Return:
1. Current behavior
2. Gaps vs the spec
3. Files likely affected
4. Minimal implementation plan
5. Risks and test steps
Keep Neon/Vercel free-tier constraints in mind.
```

### Direct implementation
Use for small clear tasks:
```text
Implement this change with minimal edits.
Constraints:
- Preserve the current framework and architecture.
- Keep Hebrew RTL UI.
- Do not add paid services or new major dependencies.
- Do not expose env/secrets.
Return: summary, files changed, and test steps.
```

### Remove internal messages, add WhatsApp
```text
Replace the internal messaging feature with WhatsApp-based communication.
Remove/disable internal message UI and flows where appropriate.
Add wa.me links with prefilled Hebrew messages for: user profile, order status update, price approval, delivery coordination, and payment summary.
Do not integrate WhatsApp API yet.
Preserve auth, permissions, Hebrew RTL, and mobile UX.
```

### Auth/approval flow
```text
Fix auth and user approval flow:
- Anyone can register.
- New users are pending.
- Pending users can view catalog but cannot order.
- Active users can order.
- Inactive/rejected users cannot order.
- Only admin can access admin pages.
- Admin can also use the site as a normal user.
Return changed files and test steps.
```

### Order flow
```text
Align order flow with the spec:
Statuses: new, waiting_approval, waiting_print, printing, ready_delivery, completed, cancelled.
Payment is separate: paid true/false.
Catalog orders may auto-approve.
External-link/custom orders require admin price approval and user confirmation before printing.
Users may cancel before printing and must provide a cancellation reason.
```
