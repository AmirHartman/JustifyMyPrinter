# מדפסת חברים — Product Specification

> **Canonical location.** This file in `docs/` is the authoritative version.
> The root-level `PRODUCT_SPEC.md` is a legacy copy and may be outdated.

## 1. Product goal

"מדפסת חברים" is a real app for managing 3D-printing orders for friends.
It supports public browsing, friend registration, admin approval, ordering,
order tracking, manual payment tracking, income/expense tracking, and
transparent reinvestment/support.

Long-term direction: possibly become a public paid business. MVP is for friends.

## 2. Users and permissions

### Public visitor
- Can view landing/explanation page.
- Can view public catalog (no login required — active products are always public).
- Cannot order.
- Cannot access personal or admin areas.

### Pending user
- Registered but not yet approved by admin.
- Can log in and view catalog.
- **Cannot order.**

### Active friend
- Can order.
- Can view personal area.
- Can see active and completed orders with status and paid/unpaid state.
- Can approve special-order price before printing begins.
- Can cancel before printing; must provide a cancellation reason.
- Can open WhatsApp to the admin.

### Inactive/rejected user
- Cannot order.

### Admin
- Single admin: the owner (Amir).
- Can manage users, products, categories, orders, payments, income, expenses.
- Can use the app as normal user "Amir" and place personal orders so personal
  prints affect material usage.

## 3. Registration fields

User registration must collect:
- full name;
- display name / nickname (username);
- phone;
- email;
- password (confirm password);
- how the user knows the admin (e.g. "friend of Lior");
- short message to the admin.

User statuses:
- `pending` — awaiting approval;
- `active` — approved, can order;
- `inactive` — deactivated;
- `rejected` — rejected with reason.

> **Gap (Builder 4):** Current code uses 'approved' for the active state and
> is missing phone, "how do you know me", and "message to admin" fields.

## 4. Site structure

Pages/areas needed:
- landing/explanation page;
- public catalog;
- printed products catalog;
- ideas/future prints area;
- product details modal;
- order form modal;
- personal area;
- order history/status area;
- admin dashboard;
- manage products;
- manage orders;
- manage users;
- manage categories;
- manage income/expenses;
- transparency/support page;
- how-it-works / policy page;
- gallery / portfolio;
- future: filament/inventory management.

Entry behavior:
- First visit: landing/explanation page.
- Returning unauthenticated: prioritize login.
- Logged-in friend: personal area.
- Logged-in admin: can switch between normal user view and admin area.

## 5. Catalog and products

### Already printed products
- Real photos taken by admin.
- Known price. Estimated print time. Estimated material weight.
- Available colors/options. Can be ordered immediately.

### Ideas / future prints
- Inspirations and models not yet printed.
- No final price. Require admin review before printing.
- Future: friends may suggest ideas.

All active products are **publicly visible** (no login required).
Ordering requires active friend status.

Product fields:
- name;
- short description;
- product images (multiple);
- dynamic categories (multiple per product);
- base/known price;
- calculated cost;
- estimated print time;
- estimated material weight;
- possible colors;
- required colors;
- requires admin approval before printing (flag);
- active/displayed state;
- external model source link;
- internal STL/3MF file if available;
- internal print notes/instructions;
- selectable options: color, quantity, custom text, future size/options;
- whether multiple units are allowed.

Categories must be dynamic, editable in admin, and products may belong to multiple.

> **Gap (Builder 7):** `category` is currently a single text field in the DB.
> Dynamic multi-category support needs a schema change and admin UI.

## 6. Orders

Supported order types:
- catalog product order;
- external model link order;
- free/custom request;
- order from previous printed work;
- future: STL/3MF upload.

Order approval:
- Known catalog products may auto-approve.
- External links/custom/new products require admin review, price estimate, and
  user approval before printing begins.

### Order statuses (canonical)

| Status             | Meaning                                             |
|--------------------|-----------------------------------------------------|
| `new`              | Just placed, awaiting admin review                  |
| `waiting_approval` | Admin set a price; waiting for friend to approve    |
| `waiting_print`    | Approved; queued for printing                       |
| `printing`         | Currently on the printer                            |
| `ready_delivery`   | Printed; ready for pickup/delivery                  |
| `completed`        | Delivered and done                                  |
| `cancelled`        | Cancelled (reason required)                         |

> **Gap (Builder 5):** Current code uses a different set of statuses
> (`new, approved, printing, ready, delivered, rejected`). Statuses must be
> migrated to the canonical set above without losing existing order data.

Payment is separate from status:
- `paid: true/false` (manual, no online payment in MVP).

Order fields:
- order number;
- user;
- catalog product if relevant;
- order type;
- request description;
- external model link;
- future: attached file;
- quantity;
- selected color(s);
- user notes;
- internal admin notes;
- status (canonical set above);
- paid: true/false;
- base cost;
- support amount;
- final amount due;
- estimated material weight;
- estimated print time;
- requires user price approval (flag);
- user approved price (flag);
- cancellation reason (required if cancelled);
- created date;
- updated date;
- delivered/completed date.

MVP: one order = one product/request. No cart.

Admin can group a friend's orders for a WhatsApp payment summary and mark
multiple orders as paid together.

Users can cancel before printing and must provide a reason.

## 7. Pricing and payment

Pricing inputs:
- material cost;
- print time;
- electricity;
- wear/maintenance;
- automatic recommended price;
- manual admin override;
- transparent base cost + optional support.

Known catalog product:
- clear price upfront; can auto-approve.

Special/external/custom order:
- admin calculates price;
- user sees price before printing;
- printing starts only after user approval.

External model failure policy:
- Admin tries to check the model first.
- No full guarantee for external models.
- If failure is due to external model/file/design, friend pays consumed material
  and may choose whether to try again.

No online payment in MVP. Payment is outside the app. App tracks paid/unpaid manually.
Admin can mark one or multiple orders as paid.

## 8. WhatsApp communication

**No internal messaging and no email notifications in MVP.**
Existing internal messaging must be removed (Builder 6 owns this).

WhatsApp is the communication channel.

MVP WhatsApp features:
- button on each friend profile (admin view);
- button near each order;
- prefilled status update message (Hebrew);
- prefilled price approval message (Hebrew);
- prefilled delivery coordination message (Hebrew);
- prefilled payment summary message (Hebrew);
- admin sends manually via WhatsApp/WhatsApp Web.

Implementation: `wa.me/<phone>?text=<encoded Hebrew message>` links only.
No WhatsApp API in MVP.

## 9. Admin dashboard

Short main dashboard + separate management pages.

Dashboard widgets:
- new orders needing attention;
- orders waiting for price approval;
- orders queued to print;
- orders currently printing;
- orders ready for delivery;
- unpaid orders;
- monthly income / profit / expenses;
- available reinvestment/support fund;
- future: low filament warnings;
- users waiting for approval;
- products missing price/photo/info.

Quick actions:
- add product;
- add expense;
- mark multiple orders from a friend as paid;
- WhatsApp friends with ready orders.

Admin management pages: orders, products, users, categories, income/expenses,
transparency/goals, future: filament/colors/inventory, future: WhatsApp templates.

## 10. Personal area

Friend sees:
- active orders with status and paid/unpaid;
- completed order history;
- total due for open orders;
- support amount paid above cost;
- reorder previous product;
- cancel before printing with reason;
- approve special-order price;
- admin notes/updates on order;
- WhatsApp button to admin;
- permission state: pending / active / inactive / rejected;
- future: recommendations.

## 11. Filament/inventory

MVP: medium accuracy, designed for future full accuracy.

Filament spool fields:
- material type; color; brand/manufacturer;
- starting weight; estimated remaining weight;
- spool cost; cost per kg/gram; active/available state.

Behavior:
- friends see available and unavailable colors;
- if a required color is unavailable, friend must approve alternative;
- admin can get low-filament warnings;
- system can estimate if enough material exists before approval;
- admin updates remaining weight manually;
- material deducted only after `ready_delivery` / `completed`.

## 12. Finance and transparency

Admin tracks: income, estimated cost, profit, support amount per order;
filament/parts/maintenance/electricity/general expenses; monthly report (future);
purchase goals (future); transparent support fund.

Friends may see: base order cost; their own added support; total support fund
collected; what money was reinvested into; future purchase goals.

Transparency page: total support collected; future purchase goals; purchases
made from the fund; number of prints completed; optionally top supporter names
(no amounts, opt-in).

Friends must not see other friends' personal order/payment details.

## 13. Failure / responsibility policy

Catalog products: friend pays only for a successful/usable product.
If failure is on admin/printer side, admin absorbs cost and retries.

External files/links: no full guarantee. If failure is due to external
model/file/design, friend pays consumed material and can choose to retry.

Admin-designed custom: price and expectations agreed before printing.

Small defects: may be delivered only with user approval; may include discount.

Unavailable colors: user must approve alternative color before printing.

Policy must appear on the "how it works / policy" page in friendly clear language.

## 14. MVP requirements

Must-have before first friend release:
- clear landing/explanation page;
- registration/login;
- admin user approval;
- public catalog (no login required);
- catalog for logged-in friends;
- catalog order;
- external-link order;
- personal area with orders/statuses;
- admin order management;
- paid/unpaid tracking;
- product management;
- income/expense management;
- mobile-friendly design;
- publishable visual design;
- WhatsApp buttons/templates instead of internal messages.

Post-release (can wait):
- file uploads;
- advanced inventory;
- monthly reports;
- full transparent fund page;
- printer connection;
- online payment;
- automatic email/WhatsApp notifications;
- friend-submitted idea board;
- advanced visual polish;
- cart.

## 15. Technical constraints

- **Database:** Neon PostgreSQL (serverless). Do not replace without approval.
- **Deployment:** Render (Express server). See `docs/RENDER_DEPLOYMENT_NOTES.md`.
- **Frontend:** Plain HTML + vanilla JS ES modules. No framework, no bundler.
- **No paid services** without explicit approval.
- **No architecture replacement** without approval.
- Do not delete existing features without explaining why.
- Do remove/replace internal messaging with WhatsApp.
- Preserve Hebrew RTL.
- Keep mobile UX good.
- Prefer simple clear solutions over over-engineering.
- Secrets only in env variables. Never expose API keys, DB URLs, or secrets.
- Enforce permissions: only admin sees admin data; users see only their own data.
