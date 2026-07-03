# מדפסת חברים — Product Specification

## 1. Product goal
“מדפסת חברים” is a real app for managing 3D-printing orders for friends. It should support public browsing, friend registration, admin approval, ordering, order tracking, manual payment tracking, income/expense tracking, and transparent reinvestment/support.

Long-term direction: possibly become a public paid business, but MVP is for friends.

## 2. Users and permissions

### Public visitor
- Can view landing/explanation page.
- Can view public catalog.
- Cannot order.
- Cannot access personal/admin areas.

### Pending user
- Registered but not approved.
- Can log in and view catalog.
- Cannot order.

### Active friend
- Can order.
- Can view personal area.
- Can see active and completed orders.
- Can see order status and paid/unpaid state.
- Can approve special-order price.
- Can cancel before printing with a required cancellation reason.
- Can open WhatsApp to the admin.

### Inactive/rejected user
- Cannot order.

### Admin
- Single admin: the owner.
- Can manage users, products, categories, orders, payments, income, expenses, and dashboards.
- Can use the app as normal user “Amir” and place personal orders, so personal prints affect material usage.

## 3. Registration fields
User registration should include:
- full name;
- display name / nickname;
- phone;
- email;
- password;
- how the user knows the admin, e.g. “friend of Lior”;
- short message to the admin.

User statuses:
- pending approval;
- active;
- inactive;
- rejected.

## 4. Site structure
Needed areas/pages:
- landing/explanation page;
- public catalog;
- printed products catalog;
- ideas/future prints area;
- product details page or modal;
- order form page or modal;
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
- Returning unauthenticated user: prioritize login.
- Logged-in user: personal area.
- Logged-in admin: can switch between normal user view and admin area.

## 5. Catalog and products

The catalog has two conceptual areas:

### Already printed products
- Real photos taken by the admin.
- Known price.
- Estimated print time.
- Estimated material weight.
- Available colors/options.
- Can be ordered like a small shop.

### Ideas / future prints
- Inspirations and models not yet printed.
- No final price.
- Require admin approval before printing.
- Future: friends may suggest ideas.

All active products are visible publicly. There is no separate “friends-only product visibility” in MVP. Ordering requires active friend status.

Product fields:
- name;
- short description;
- product images;
- dynamic categories;
- base/known price;
- calculated cost;
- estimated print time;
- estimated material weight;
- possible colors;
- required colors;
- requires admin approval before printing;
- active/displayed state;
- external model source link;
- internal STL/3MF file if available;
- internal print notes/instructions;
- selectable options: color, quantity, custom text, future size/options;
- whether multiple units are allowed.

Categories should be dynamic, editable in admin, and products may belong to multiple categories.

## 6. Orders

Supported order types:
- catalog product order;
- external model link order;
- free/custom request;
- order from previous printed work;
- future: STL/3MF upload.

Order approval:
- Known catalog products may auto-approve.
- External links/custom/new products require admin review, price estimate, and user approval before printing.

Order statuses:
1. new
2. waiting_approval
3. waiting_print
4. printing
5. ready_delivery
6. completed
7. cancelled

Payment is separate from status:
- paid: true/false.

Order fields:
- order number;
- user;
- catalog product if relevant;
- order type;
- request description;
- external model link;
- future attached file;
- quantity;
- selected color/colors;
- user notes;
- internal admin notes;
- status;
- paid true/false;
- base cost;
- support amount;
- final amount due;
- estimated material weight;
- estimated print time;
- requires user price approval;
- user approved price;
- cancellation reason if cancelled;
- created date;
- updated date;
- delivered/completed date.

MVP: one order = one product/request. No cart yet.

Admin should still be able to group a friend’s orders for WhatsApp payment summary and mark multiple orders as paid together.

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
- clear price upfront;
- can auto-approve.

Special/external/custom order:
- admin calculates price;
- user sees price before printing;
- printing starts only after user approval.

External model failure policy:
- Admin tries to check the model first.
- Admin does not fully guarantee external models will print well.
- If failure is due to the external model/file/design, the friend still pays for consumed material and may choose whether to try again.

MVP has no online payment.
- Payment is outside the app.
- App tracks paid/unpaid manually.
- Admin can mark one or multiple orders as paid.

## 8. WhatsApp communication

No internal messaging and no email notifications in MVP. Existing internal messaging should be removed.

WhatsApp is the communication channel.

MVP WhatsApp features:
- button on each friend profile;
- button near each order;
- prefilled status update message;
- prefilled price approval message;
- prefilled delivery coordination message;
- prefilled payment summary message;
- admin sends manually via WhatsApp/WhatsApp Web.

Future only: WhatsApp API/real automation.

## 9. Admin dashboard

Use a short main dashboard + separate management pages.

Dashboard should show:
- new orders needing attention;
- orders waiting for price approval;
- orders waiting to print;
- orders currently printing;
- orders ready for delivery;
- unpaid orders;
- monthly income;
- monthly profit;
- monthly expenses;
- available reinvestment/support fund;
- low filament warnings in future;
- users waiting for approval;
- products missing price/photo/info.

Quick actions:
- add product;
- add expense;
- mark multiple orders from a friend as paid;
- WhatsApp friends with ready orders.

Admin pages:
- orders;
- products;
- users;
- categories;
- income/expenses;
- transparency/goals;
- future: filament/colors/inventory;
- future: WhatsApp templates.

## 10. Personal area
Friend sees:
- active orders;
- completed order history;
- status for each order;
- paid/unpaid state;
- total due for open orders;
- support amount paid above cost;
- reorder previous product;
- cancel before printing with reason;
- approve special-order price;
- admin notes/updates on order;
- WhatsApp button to admin;
- permission state: pending, active, inactive, rejected;
- future: recommendations.

## 11. Filament/inventory
MVP can be medium accuracy but should be designed for future full accuracy.

Filament spool fields:
- material type;
- color;
- brand/manufacturer;
- starting weight;
- estimated remaining weight;
- spool cost;
- cost per kg/gram;
- active/available state.

Behavior:
- friends see available and unavailable colors;
- if a required color is unavailable, friend can choose/approve an alternative;
- admin can get low-filament warnings;
- system can estimate if enough material exists before approval;
- admin updates remaining weight manually;
- material should be deducted only after printing stage, e.g. ready_delivery/completed.

## 12. Finance and transparency

Admin tracks:
- income per order;
- estimated cost per order;
- profit per order;
- support amount per order;
- filament expenses;
- parts/maintenance/accessory expenses;
- paid model/file expenses;
- electricity expenses;
- general hobby/business expenses;
- future monthly report;
- future purchase goals;
- transparent support fund.

Friends may see:
- base order cost;
- their own added support;
- total support fund collected;
- what money was reinvested into;
- future purchase goals.

Transparency page shows:
- total support collected;
- future purchase goals;
- purchases made from the fund;
- number of prints completed;
- optionally: top total supporter name and top single-order supporter name, without numbers, preferably opt-in.

Friends should not see other friends’ personal order/payment details.

## 13. Failure/responsibility policy

Catalog products already printed successfully:
- friend pays only for a successful/usable product;
- if failure is due to printer/settings/admin side, admin absorbs and retries.

External files/links:
- admin tries to check in advance;
- no full guarantee;
- if failure is due to external model/file/design, friend pays consumed material and can choose whether to retry.

Admin-designed custom work:
- price and expectations are agreed before printing;
- printing starts only after approval.

Small defects:
- can be delivered only with user approval;
- may include discount/reduced price.

Unavailable colors:
- user must approve alternative color before printing.

Policy should appear in “how it works / policy” page in friendly clear language.

## 14. MVP requirements

Must-have before first friend release:
- clear landing/explanation page;
- registration/login;
- admin user approval;
- public catalog;
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

Can wait until after first release:
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

Current stack assumptions:
- Neon database exists.
- Vercel deployment exists.
- Vercel free-tier issues may exist.

Rules:
- Keep Vercel/free-tier compatibility where possible.
- Use existing Neon DB unless explicitly changed.
- Do not add paid services without explicit approval.
- Do not replace framework/architecture without approval.
- Do not delete existing features without explaining why.
- Do remove/replace internal messaging with WhatsApp.
- Preserve Hebrew RTL.
- Keep mobile UX good.
- Prefer simple clear solutions over over-engineering.
- Store secrets only in env variables.
- Never expose API keys, DB URLs, or secrets.
- Enforce permissions: only admin sees admin; normal users see only their own data.
