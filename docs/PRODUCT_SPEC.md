# מדפסת חברים — Product Specification

> **Canonical location.** This file in `docs/` is the authoritative version.
> The root-level `PRODUCT_SPEC.md` is a legacy copy and may be outdated.

## 1. Product goal

"מדפסת חברים" is a real app for managing 3D-printing orders for friends.
It supports a public landing page, friend registration, an authenticated catalog,
admin approval, ordering,
order tracking, manual payment tracking, income/expense tracking, and
transparent reinvestment/support.

Long-term direction: possibly become a public paid business. MVP is for friends.

## 2. Users and permissions

### Public visitor
- Can view landing/explanation page.
- Cannot view the catalog without registering and logging in.
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
- gender (used for gender-aware Hebrew wording);
- password (confirm password);
- how the user knows the admin (e.g. "friend of Lior");
- short message to the admin.

User statuses:
- `pending` — awaiting approval;
- `active` — approved, can order;
- `inactive` — deactivated;
- `rejected` — rejected with reason.

> Implemented: the API uses these canonical states, captures these registration
> fields, and normalizes legacy `approved` values to `active`.

## 4. Site structure

Pages/areas needed:
- landing/explanation page;
- authenticated catalog;
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
- When print time and material data are available, show an estimated price that
  includes the configured untested-model risk surcharge. Without that data,
  show no price and require a manual quote.
- The first print always enters admin review before the printer queue. A price
  already shown in the catalog does not require separate friend approval unless
  the product's explicit approval flag is enabled.
- Future: friends may suggest ideas.

Published products are visible only to authenticated users.
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
- catalog kind (`printed` or `idea`) and an automatically derived publication
  state;
- external model source link;
- internal STL/3MF file if available;
- internal print notes/instructions;
- selectable options: color, quantity, and future size/options;
- whether multiple units are allowed.

Catalog publication is automatic. There is no manual "show in catalog"
control. A product with all required fields is public; an incomplete product is
kept as an admin draft with an explicit missing-requirements list and cannot be
activated manually. Readiness rules may differ between a known printed product
and an untested idea. A published product remains visible when filament is
temporarily unavailable and is marked "not currently available" instead of
disappearing. Public product responses are explicit DTOs and never include
internal print notes, inventory quantities, spool costs, or pricing internals.

The admin product editor is a full-page form ordered by printing necessity. It
supports possible and required colors and an ordered image gallery whose first
image is automatically the primary image,
quantity restrictions, internal notes, risk level, and readiness feedback.
Extra print time per copy defaults automatically to the full product print time,
and purge is extracted automatically from color-change commands in a sliced
print file. Neither value is entered manually. Product descriptions are entered manually;
the application does not generate them.

Categories must be dynamic, editable in admin, and products may belong to multiple.

> Implemented with an admin-managed `categories` table and product
> `category_ids`. The legacy single `category` field remains for compatibility.

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
| `waiting_assembly` | Printed; parts still need assembling (optional step)|
| `ready_delivery`   | Printed; ready for pickup/delivery                  |
| `completed`        | Delivered and done                                  |
| `failed`           | A print attempt failed; cumulative waste is recorded|
| `cancelled`        | Cancelled (reason required)                         |

> Implemented. Legacy order status values are normalized at API boundaries.

An order is stored as one row per product, so a friend's order can be
**partially ready**: the admin marks individual products as printed and the
group shows "X of Y printed". A product counts as printed once its status is
`waiting_assembly`, `ready_delivery`, or `completed`; there is no separate
printed flag.

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
- failed-attempt count and cumulative wasted material/time.

Catalog order options are validated again by the API. The selected color must
belong to the product, and quantity must be one when multiple units are disabled.
Order snapshots preserve the product/options context, while reorder always uses
the product's current price and requires a new confirmation.

When a requested color is unavailable, the order records a separate color
alternative approval state. The admin proposes an available filament; the
friend approves or rejects it in the personal area. An order cannot move to the
print queue or printing while an alternative is needed, pending, or rejected.
This workflow does not add new canonical order statuses.

A friend adds products to a cart in the browser (localStorage, per user) and
sends the whole cart in one checkout. One order row is still one product: a
checkout writes one order per cart line, joined by a shared `cart_id`, so
inventory, print jobs, per-product statistics and WhatsApp messages stay
single-product. The optional support amount is chosen once per checkout and
recorded whole on a single row of the cart, never split across rows.

External-link and custom requests are not part of the cart; they are still sent
one at a time from their own dialog.

### Local print bridge and plates

Sliced `.gcode.3mf` print files live only on the owner's local bridge computer.
The server records a SHA-256 checksum and derived slicing metadata, never the
file bytes or a local path. One file is one physical print plate. A plate may
link one or more order quantities, but the owner manually slices and confirms
that the models physically fit; v1 does not arrange models or infer AMS slots.
For cart checkouts, the admin receives an optional grouping suggestion only for
lines with the same `cart_id` and the exact same selected-color set. The owner
still chooses the items and quantities and confirms the manually sliced plate.
The bridge is outbound-only, scans a local incoming folder before claiming
work, and reports lifecycle events using a machine secret plus a per-claim
token. A completed plate increments each linked order's printed quantity once;
an order becomes `ready_delivery` only after every requested unit is printed.
The existing manual bed-clear gate remains in place between plates.

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
- transparent price that covers production cost and includes a modest default
  margin; optional support is added above that price.
- admin-editable percentages for low, medium, and high product risk, plus a
  separate untested-model surcharge and minimum order price; products may also have
  an optional per-unit minimum. Existing order price snapshots never change.

An untested model always uses the untested surcharge while its catalog kind is
`idea`, regardless of the low/medium/high level selected for later use. Changing
the catalog kind to `printed` applies the selected product risk level and may
lower its calculated price.

The admin calculation presents production cost before profit and the final
price after profit in separate cards. Material cost is derived from spool price
and spool weight (cost per gram); there is no independently editable price-per-
kilogram field. A machine-recovery component adds 10% after the configured risk
component and before the margin is applied.
Material quantities accept decimal gram values, are rounded automatically to
two decimal places, and are stored without integer truncation.

Known catalog product:
- clear price upfront; can auto-approve.

Untested catalog idea:
- remains in the ideas area whether its price is known or pending;
- with complete print data, has a visible estimated price and can be added to
  the cart at that price;
- without complete print data, remains visible with "price after review" and
  receives a manual quote;
- always stops for the admin before its first print can reach the printer queue.

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

**No internal messaging or automated notifications in MVP.**
Internal messaging is disabled. Compatibility endpoints return `410 Gone`, and
the frontend uses WhatsApp links/templates.

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
- home-printer state (idle/busy), bridge connectivity, current print progress,
  and a per-job event timeline.

Quick actions:
- add product;
- add expense;
- mark multiple orders from a friend as paid;
- WhatsApp friends with ready orders.
- create a self-print or order print job, approve it manually before the local
  bridge may claim it, cancel before printing begins, and mark the printer idle
  after the owner clears the bed.

Admin management pages: orders, printer, products, users, categories,
income/expenses, transparency/goals, future: filament/colors/inventory, future:
WhatsApp templates.

The orders page and the printer page are deliberately separate jobs:
- **Orders** — open orders only by default, grouped by friend. Each group shows
  the money (cost, profit, debt, total), a readiness chip (not printed /
  partially ready / all printed), bulk mark-as-paid and a WhatsApp payment
  summary, over the individual product cards.
- **Printer** — printer and bridge state, the print-job timeline with manual
  approval and cancellation, and the queue of orders waiting to print with a
  one-click "create print job" per order.

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
- spool price; spool weight; derived cost per gram; active/available state.

Material type is free-form so new types can be added without a schema or code
change. The admin form previews the selected color immediately.

Behavior:
- friends see available and unavailable colors;
- if a required color is unavailable, friend must approve alternative;
- admin can get low-filament warnings;
- system can estimate if enough material exists before approval;
- admin updates remaining weight manually;
- a `failed` attempt deducts only newly recorded cumulative waste;
- `completed` deducts product material and purge once, plus any failure waste
  that was not already deducted;
- retrying or resaving an order never deducts the same grams twice.

## 12. Finance and transparency

Admin tracks: income, estimated cost, profit, support amount per order;
filament/parts/maintenance/electricity/general expenses; monthly report (future);
purchase goals (future); transparent support fund.

Friends may see: base order cost; their own added support; total support fund
collected; what money was reinvested into; future purchase goals.

Transparency view: total support collected; amount reinvested; purchase goals
and progress; purchases/investments explicitly marked public by the admin; and
number of prints completed. Goals and ledger entries have an optional public
label, so internal descriptions need not be exposed. The endpoint returns only
aggregate or explicitly published records and never returns member orders,
personal payments, internal ledger details, or internal profit/pricing data.

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
- physical-printer FTPS/MQTT hardening, firmware compatibility, and AMS-slot
  mapping beyond the verified simulated bridge flow;
- online payment;
- automatic WhatsApp notifications;
- friend-submitted idea board;
- advanced visual polish;
- a server-side cart synced across devices (the cart lives in the browser).

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
