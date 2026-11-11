# Figma audit: 518 Property Pro dashboard vs the Simplr design

_Audited 2026-11-02 on branch `staging` (working tree, uncommitted changes included). Read-only: no code or Figma changes._

- **Figma file:** `wISc3YonhsLV3mc6MiuVMe` ("Simplr"). Starting node `409:39858` is the main content of the admin dashboard frame `409:39794` ("WO1-Dashboard") on the **Active Screens** page.
- **App:** `dashboard/` (Next.js app router + Convex). Status was judged by reading the code (layout, fields, states, actions, data wiring), not by running the app.
- **Source of truth:** `docs/context/prd-v2.md` and the other client docs win over Figma. Every conflict is listed in [Figma vs PRD conflicts](#figma-vs-prd-and-client-doc-conflicts) for the user to decide.

## How the Figma file is organised

| Page | What it holds | How it was used in this audit |
|---|---|---|
| `0:1` **Active Screens** | High-fidelity desktop screens (1280 wide) in 5 sections: Calendar Flow, Property Flow, Admin Flow (Work Orders, Technicians, Asset Managers, Finance: Payments + Owner Reports, Tenant payment journey on mobile). About 75 frames. | **Primary reference.** The app's sidebar, work-order board and asset-manager pages were clearly built from it. |
| `220:2` **518 Property Pro · Client flows v2** | A PRD-derived flow map: a "Start here" scope page, a PRD flow register (F01–F09), then one section per role (Alex, Asset Manager, Pat, Technician mobile, Simplr Admin, Accountant, Tenant) plus shared components (`518/Button`, `518/Badge/*`, `518/Field`, `518/Checklist item`, `518/Navigation/*`). 57 frames have content; **74 frames are empty, named placeholders** (`259:*`, e.g. "AM-09 Tour · Unit and host selection"). Uses a different, simpler navigation (Overview, Maintenance, Work orders, Calls, Properties & units, Leasing, Calendar, Owner reports, Payments). | **Secondary reference.** Lower-fidelity and partly placeholder, but closer to the PRD wording. Used for the screens Active Screens does not cover (Sarah config, technician mobile, team access, unit activation, calls). |
| `105:517` Archived, `101:2` Assets | Old frames and image assets. | Not audited. |

**Decision needed:** the two pages use different navigation and page structure. The app follows **Active Screens**. Confirm Active Screens is the current design and Client flows v2 is a requirements map only (see design backlog D-0).

Screenshots were taken of about 45 representative frames; near-identical variants (marked "variant" below) were judged from their frame name plus the sibling screenshot.

Legend: ✅ built and matches · 🟡 partial (specifics listed) · ❌ missing · ➖ no app screen needed / superseded by a recorded decision.

---

## 1. Shell: sidebar and layout

| Figma | App | Status | Notes |
|---|---|---|---|
| Sidebar `Navbar` in every Active Screens frame (e.g. `121:8569`, `439:9001`) | `components/app-sidebar.tsx`, `components/app-chrome.tsx` | 🟡 | Groups match (Dashboard · Maintenance · Customers · Knowledge · Finance · Productivity · Team), role-filtered, collapsible, with a live work-order badge and a user footer. **Missing: "Technicians" under Maintenance** (Figma has Work Orders / Assets Managers / Technicians). "Tasks" under Productivity is intentionally gone (Tasks page removed, `app/tasks/page.tsx` redirects). "Screening" in some older frames is superseded by `/sarah` (`app/screening/page.tsx` redirects). Labels copy Figma's typo "Assets Managers" and use "Payment" (Figma uses both "Payment" and "Payments"). The app adds Call, Sarah config and Profile links that Figma does not show. |
| Mobile | `BOTTOM_NAV_*` in `app-sidebar.tsx` | ➖ | Figma has no mobile designs for office screens. |

## 2. Dashboard

| Figma frame (node) | App route / files | Status | Notes |
|---|---|---|---|
| WO1-Simplr Dashboard Opened `121:12601`; PR1-Simplr Dashboard `439:9000` (variant, "Quick Action" title); WO1-Dashboard `121:12281`, `409:39794` (contains start node `409:39858`); TC1-Dashboard `377:20154`; Simplr Dashboard `121:13268` (variants) | `/dashboard` → `app/dashboard/page.tsx`, `components/dashboard/admin-dashboard.tsx`, `am-dashboard.tsx`, `follow-up-card.tsx`, `lead-cards.tsx`, `people-cards.tsx`, Convex `convex/dashboard.ts` | ✅ | Greeting + date, KPI cards (Calls Handled, Tours Booked, Active Work Orders with "N high priority"), Recent Leads table, Open Work Orders table with "Maintenance Inbox →", Today's Schedule with "View Calendar →", Properties Snapshot (Work Orders, Total Units, Asset Managers, Active Technicians), all on live Convex data with loading dashes and empty states. Differences: Figma's **"My Tasks"** card is replaced by a follow-up card (Tasks were removed by decision); the "New Leads" KPI from the collapsed-nav variant is not shown; the app adds a maintenance pipeline card and Asset Manager / Technician cards. The asset-manager and accountant dashboards have no Figma design (the accountant one is a "Finance coming soon" placeholder). |

## 3. Work orders (Admin Flow › Work Orders Flow `323:35604`)

| Figma frame (node) | App route / files | Status | Notes |
|---|---|---|---|
| WO2-Work Orders (Kanban View) `269:15250` | `/work-orders` → `app/work-orders/page.tsx`, `components/board/board.tsx` (`Kanban`, `BoardCard`), `design-select.tsx`, Convex `convex/board.ts` (`kanban`) | 🟡 | Search, All Priorities, All Technicians, Table/Kanban toggle (remembered per browser), cards with ID, age, title, property · unit, priority chip, coloured left border, assignee avatar, comment and attachment counts. **Differences:** the app has **5 columns** (Asset Manager Review, Admin Review, Escalated, Work in Progress, Completed (Needs Sign Off)); Figma has 3. The app's extra columns follow the PRD states, so keep them (see conflicts). **Missing:** Figma's "recently closed" table under the board (Work order / Unit / Outcome / Hours / Materials). The app adds a "New Work Order" button and an "N requests need routing" link (both PRD-required). |
| WO2-Work Orders (Table View) `269:19061` | same page, `WorkOrderTable`, `StatusChips` | ✅ | Status chips with counts (adds an "Escalated" chip), columns #ID / Unit / Property / Issue / Priority / Status / Assigned To / Due Date / Created / ⋯, pagination with page size. Row checkboxes select but no bulk action exists (Figma has none either). |
| WO2.1 Escalated `271:23195`; WO2.2 Work in Progress `317:24870` (variant); WO2.3 Completed, Sign-off Needed (Overview) `317:25641`; WO2.4 Closed `317:27287` (variant) | `components/board/wo-drawer.tsx`, `chips.tsx`, `window-field.tsx`; Convex `board.ts`, `workOrders.ts`, `maintenance.ts` | ✅ | Drawer: number + status pill, title, property · unit, Priority / Time Window / Assigned to / Asset Manager selects, description, Location + "View property", Unit + "View unit", Asset Manager, Created, Tenant + phone, Photos & videos with add tile (size limits enforced), comment box, comments and activity history. Actions per state match Figma: **Create and Assign / Request for More Information / Reject as Out of Scope**, **Confirm as Completed / Request for More Information** (sends back to technician), reopen on closed. Deliberate difference: the Asset Manager field is **read-only** ("can't be changed here"), because the PRD makes it a unit-level assignment. |
| WO2.31 Completed (Expenses tab) `317:26448` | `wo-drawer.tsx` Expenses tab | ✅ | Hours submitted, materials total, expense lines with "Submitted by … · Receipt attached", technician expense note, "Labor amount calculated" amber notice, photos, receipt documents with Open Document. Paper-form fields (invoice #, cost vs bill, SWEEP/REIMB, paid) are not in Figma or the app: tracked as **BACKLOG B18**. |
| WO2.5 Reject as Out of Scope `295:1228`; WO2.51 Request Closed `295:1229` (variant) | `components/board/reject-panel.tsx`, `wo-drawer.tsx` | ✅ | Closure reason select (required), Explanation (required), "Confirm the decision" notice, Confirm Rejection / Keep Reviewing, then a "rejection recorded" state. |
| (no Active Screens frame) Exceptions; Client flows "05 Routing exceptions" `220:7` | `components/board/exceptions-drawer.tsx`, `/maintenance/exceptions` → `app/maintenance/exceptions/page.tsx` | ✅ | Built from the PRD (unmatched unit → exception queue). No hi-fi Figma design. |
| (no frame) New work order; Client flows "29 Manual work order" `230:584`, "07 Create & assign work order" `220:9` | `components/board/new-wo-drawer.tsx`, `/work-orders/new` → `app/work-orders/new/page.tsx` | ✅ | Manual creation by Pat / asset managers (PRD §6.4). No hi-fi Figma design. |

## 4. Technicians (Admin Flow › TC-Technicians Flow `342:35605`)

| Figma frame (node) | App route / files | Status | Notes |
|---|---|---|---|
| TC2-Technicians Table `320:28059` | Closest: `/team?role=technician` → `app/team/page.tsx`, `components/team/invite-panel.tsx`; dashboard `TechniciansCard` in `components/dashboard/people-cards.tsx` | ❌ | Figma: page with KPIs (Total / Busy / Idle technicians), "Invite New Technicians" card, table (Pending / Active / Needs Sign Off counts, Busy/Idle status, ⋯), search and filters. App: only the generic Team roster filtered by role (avatar, name, role badge, Tours switch) and a generic invite panel. No workload counts, no busy/idle status, no sidebar link. |
| TC3-Technicians Table with drawer `292:3152` | `components/team/member-drawer.tsx`, `member-details.tsx` | 🟡 | App drawer shows contact, role, notify-by, out of office and remove. Missing: assigned work count, needs-sign-off count, current work order, "View Profile". (Figma's own header text in this frame says "asset managers": a copy slip in the design.) |
| TC4-Profile Overview `295:1245`; TC5-Edit Profile `429:9250` (variant) | none | ❌ | No technician profile page (KPI cards Pending / In Progress / Awaiting Sign Off, details, internal notes, Edit profile, Danger Zone). |
| TC6-Technician Work Orders `295:1248` | none (board can filter by technician: `app/work-orders/page.tsx`) | ❌ | No per-technician work-order tab with search / priority / status filters and "Manage assignment". |
| TC6.1 / TC6.2 Work Orders Assignments `432:10043`, `432:10235`; TC6.3 Assignment Updated `432:9676` | none (single work-order reassignment exists in `wo-drawer.tsx` "Assigned to") | ❌ | No "move this technician's work orders to another technician" flow with handoff confirmation. |

## 5. Asset managers (Admin Flow › AM-Asset Managers Flow `409:36747`)

| Figma frame (node) | App route / files | Status | Notes |
|---|---|---|---|
| AM1-Asset Managers Table `409:36748` | `/asset-managers` → `app/asset-managers/page.tsx`, `components/asset-managers/managers-tab.tsx`, Convex `convex/assetManagers.ts` | ✅ | 4 KPI cards with deltas, Invite New Asset Manager (name + email, toast), search, All Properties / All Statuses filters, table (Assigned Units, Open Requests, Active Work Orders, Properties, Status, Actions), pagination. App adds a "Property assignments" tab (`property-assignments-tab.tsx`) not in Figma. |
| AM2-Asset Managers Table with drawer `409:37121` (variant) | `managers-tab.tsx` drawer | ✅ | Stat tiles that deep-link, notes editing. |
| AM3-Asset Manager Profile `409:37614` | `/asset-managers/[userId]` → `components/asset-managers/profile-view.tsx` | 🟡 | Tabs (Overview / Work orders / Assigned units), 4 count cards with "View details →", details card with availability and internal notes, Edit profile, Today's Schedule. **Missing: Danger Zone "Delete User"** (removal exists only on `/team`, blocked while the person owns units). |
| AM3.1-Edit Profile `409:37726`; AM3.11-Edit Availability `409:37946` | `profile-view.tsx` (`?edit=1`), `availability-modal.tsx`, `manager-availability.tsx` | ✅ | "Availability Timings" per weekday with "Same timings?", Back / Continue. |
| AM3.2 / AM3.21 Asset Manager Calendar `409:38173`, `409:38532` | `/asset-managers/[userId]/calendar` → `components/asset-managers/manager-calendar.tsx` | ✅ | |
| AM4-Profile Work Order `409:39198` | `profile-view.tsx` `WorkOrdersTab`, Convex `assetManagers.workOrders` | 🟡 | Table and pagination built. **Missing:** search, Priorities and Statuses filters (shown in the equivalent TC6 frame). Select-all checkbox is not wired. |
| AM5-Profile Assigned Units `409:39009` | `profile-view.tsx` `UnitsTab` | ✅ | "Unit ownership" table (Property / unit, Beds / baths, Availability, Open requests, View unit →) and "Manage assignment". |
| AM5.11 Manage Unit Assignments `409:39161`; AM5.12 Assignment Updated `409:39408`; AM5.13 Assigned Units after reassignment `409:39437` | `components/asset-managers/manage-units-modal.tsx`, Convex `assetManagers.reassignUnit` | ✅ | Reassign tab with current manager, portfolio, unit, new manager, required reason, "A unit must keep one designated manager" notice, result screen. |
| AM5.2 Assign Another Unit `409:39580`; AM5.21 Unit Assigned `409:39607`; AM5.22 Assigned Units (unit added) `409:39630` | same modal, "Assign another unit" tab | ✅ | Deliberate difference: Figma lists "All Unmanaged Units"; the app lists "Units managed by others", because every unit always has an asset manager (PRD §5, enforced in `convex/schema.ts`). Keep the app's version. |

## 6. Calendar (Calendar Flow `116:2325`)

| Figma frame (node) | App route / files | Status | Notes |
|---|---|---|---|
| Calendar - Filled Calendar `116:2326`; Calendar - Empty Calendar `121:5370` (variant) | `/calendar` → `app/calendar/page.tsx`, Convex `calendarView.ts`, `tours.ts`, `googleCalendar.ts` | ✅ | Today / prev / next, month title, Edit Availability, Week / Month toggle, week grid with tour blocks (time, title, bedrooms, property), "Need a day off?" banner with "Manage availability", tour detail with cancel, Google Calendar status notices. |
| Calendar - Admin `117:3403` | same page (`userId` state) | ✅ | Admin can view another member's calendar. Figma puts the member picker top-right; check placement is equivalent (P2). |
| Calendar - Turn off day `121:9107` | `DaysOffModal` in `app/calendar/page.tsx`, Convex `tours.addDayOff` | 🟡 | Day-off works, but through a "Days off" modal with a date input. Figma opens "Turn off this day?" from the clicked day, shows "Available to turn off" or blocks days that have bookings, with an optional reason (0/200). |
| Calendar - Availability Setting `121:4851` (older sidebar) | `components/tour-hours-editor.tsx`, Edit Availability | ✅ | |

## 7. Properties and units (Property Flow `121:11393`)

| Figma frame (node) | App route / files | Status | Notes |
|---|---|---|---|
| PR2-Properties Table `439:8212` | `/properties` → `app/properties/page.tsx`, `components/properties/property-page.tsx`, `property-form.tsx`, `components/units/unit-inventory.tsx`, Convex `properties.ts`, `units.ts` | 🟡 | Functionally rich but a **different layout**: the app picks one building with chips and shows a property profile card, default asset manager card and a unit inventory table (unit, tenant, rent, asset manager, availability toggle, history, edit, remove). **Missing from Figma:** KPI cards (Total Properties, Total Units, Rented Units), a properties table (ID, Property, Owner, Total / Rented / Available units, ⋯) with search and Properties / Owners filters, the inline "Add New Property" card, and "Import CSV". The page subtitle for admins ("These rules drive the agent's qualification check…") is leftover copy. |
| PR3-Add New Property `461:23954` | "Add property" dialog in `property-page.tsx` | 🟡 | App asks for name, address (Google Places), pilot flag, gas utility phone. Missing: Property Type, separate City / State / ZIP, Property Owner, Management Team, Notes, Property Photo. Owner name / email exist in the schema and form (`showOwner`) but are hidden on create. |
| PR3-Unit View `121:11394` | none (edit modal only: `components/units/edit-unit-modal.tsx`, history: `unit-history.tsx`) | ❌ | No unit detail page. Figma: breadcrumb, unit number + status pill, 4 fact cards (Unit Type, Floor, Size, Monthly Rent), Unit Information, Utilities (gas, electric, laundry), Current Tenant (contact, lease type, dates, term), Management (asset manager link, team), Edit Details. Most of this data already exists in `units` and `residents` (roster fields from B2) but no screen shows it. |
| PR4-Add New Unit `454:22110` | `components/units/add-unit-modal.tsx`, `edit-unit-modal.tsx` | 🟡 | App: unit number, a field **labelled "Unit type" that actually sets bedrooms** (studio / 1br / …), floor, baths, rent, asset manager (required), available toggle. Missing: the real unit type (residential / commercial / …), square footage, occupancy, move-in date, lease type / term / dates, tenant, gas / electric responsibility, laundry, notes, property context card. PRD §8 minimum fields **parking, leasing facts and available-from are not editable anywhere in the UI** although `units.create` / `units.update` already accept them. |
| PR1-Simplr Dashboard `439:9000` | see Dashboard | ✅ | |
| Client flows "14 Unit setup & ownership" `220:16`, "13 Properties & units" `220:15`, AD-01…AD-08 (placeholders) | — | 🟡 | "Activate maintenance intake" control (`units.maintenanceIntakeActive`) has **no UI**; units are created active. Missing-assignment report is moot (schema requires an asset manager). CSV import screens (AD-06…AD-08) have no UI: rosters are imported by CLI script (`dashboard/scripts/roster/import_roster.py`, BACKLOG B3). |

## 8. Finance (Admin Flow › Finance Flows `377:20483`)

All finance screens are **❌ missing**. `/finance` (`app/finance/page.tsx`) is a "Coming soon" card for both "Payment" and "Owner Reports"; there are no payment or statement tables in `convex/schema.ts`. Tracked as **BACKLOG B24 (ROS) and B25 (Stripe)**, which say finance is after Nov 1 unless agreed in writing.

| Figma frames (node) | What they show | Status |
|---|---|---|
| FP01-Payments `396:21858`; FP01-Payments-Pending Verification `397:39219` | KPIs (Total Collected, Pending, Failed), tabs (Transactions / Payment requests / Pending Verification), search, Period, Status, table with Review / Verify, "+ Create Payment Request" | ❌ |
| FP04-Payments-Requests `397:39534`; FP04.1 Create Payment Request `368:14055`; FP04.2 Review `368:14057`; FP02 Payment Request Sent `368:14058` | 2-step drawer: tenant, property / unit, rent period, email, title, amount, due date, bank details **and** Stripe payment link | ❌ |
| FP02 Pending Verification `368:14052`; FP02.1 Verify Payment `368:14061`; FP02.2 Payment Successful `396:22140`; FP03 Payment Failed `368:14054`; FP02.21 Successful / Failed tables `397:22919`, `397:24130`; FP03.1 Failed table `397:23213`; FP03.2 Request Resent `397:24445` | Manual verification: payment record vs "authoritative rent record", settlement evidence (deposit slip), reconciliation comments, Confirm Payment / Mark as Failed | ❌ |
| OR01-Owner Reports Table `402:32724` | KPIs (Total, Pending Review, Draft, Sent), filters, table with status (Sent / Draft / Pending Review / Overdue), "+ Create Report" | ❌ |
| OR02-Statement Preview `368:14077`; OR03-Maintenance `368:14074`; OR04-Calculations `368:14076`; OR06 Saved as Draft `409:36112`; OR07 Statement Sent `409:35894`; OR08 Statement Overdue `409:36502` | Statement preview (owner, report details, 4-line summary), maintenance tab, calculations tab, Approve & Send / Save as Draft | ❌ |
| Tenant · Finance payment journey `326:24924`: P01 Pay your rent `326:24925` … P08 Payment link unavailable `326:24932`; Client flows 21–24, 27, TN-01…TN-05 | Public mobile pay page: confirm amount, card form, bank verification, received, processing, declined, receipt, expired link. All marked "Test mode". | ❌ (no `/pay/[token]` route) |

## 9. Screens with no Active Screens design (Client flows v2 only, or none)

| Figma (Client flows v2 node) | App route / files | Status | Notes |
|---|---|---|---|
| 02 Asset Manager inbox `220:4`; 03 Maintenance request review `220:5`; 04 Request more information `220:6`; 28 Validated · Ready to forward `229:417`; 25 Close request with reason `220:27`; AM-01…AM-08 (placeholders) | AM view of `/work-orders` (scoped to own units), `wo-drawer.tsx`; `/maintenance/[id]` → `components/maintenance/request-detail.tsx` | ✅ | The PRD's AM inbox is the scoped board. Review actions (validate and forward, request info, reject with reason) all built. |
| 06 Pat · Validated requests `220:8`; 08 Completion review `220:10`; OF-03 / OF-04 Work orders `259:868`, `259:869`; ML-01…ML-14 (placeholders) | "Admin Review" and "Completed" columns on `/work-orders` | ✅ | |
| 09–12 Technician mobile `220:11`…`220:14`; TX-01…TX-10 (placeholders) | `/tech`, `/tech/jobs/[id]` → `app/tech/page.tsx`, `components/tech/job-card.tsx`, `job-detail.tsx`, `lib.ts` | ✅ / ➖ | Job list, job detail with access notes, photos / videos with upload progress and retry, receipts with amount, hours, notes, submit with "missing" list, submitted state. **Checklist (`220:12`, `518/Checklist item`) intentionally not built:** removed by client decision 2026-10-16 (PROGRESS.md; BACKLOG B28 notes the PRD is not updated). "Sent back" corrections show only as a note, with no banner like TX-10. |
| 15 Sarah · Scripts & severity `220:17`; AD-09…AD-14 (placeholders) | `/sarah` → `app/sarah/page.tsx`, `components/sarah/*` | 🟡 | Tabs for call types, severity, escalation contacts, leasing; preview and publish with version history. Figma shows "Pat's sign-off required" with Publish disabled until approval; the app lets any admin approve by saving (**BACKLOG B7**). |
| 16 Call record & intake `220:18`; OF-01 / OF-02 Calls `259:866`, `259:867` | `/tenants` (Resident calls / Callbacks / Residents) → `app/tenants/page.tsx`, `components/residents/*`; `/call` (test call) | 🟡 | Call list, transcripts and callbacks exist. No separate "Calls" nav item as in Client flows; "needs follow-up" is the Callbacks tab. |
| 17 Leasing lead detail `220:19`; OF-06 Leasing · Leads `259:871` | `/leads` → `app/leads/page.tsx`, `components/leads/lead-assignment.tsx` | 🟡 | Expandable rows with transcript, owner-prospect filter, assignment. Staff status dropdown missing (**BACKLOG B21**). |
| 18 Book a tour `220:20`; AM-09…AM-15 (placeholders) | none (Sarah books; staff can only cancel in `app/calendar/page.tsx`) | ❌ | No staff-side tour booking or rescheduling. |
| 01 Operations overview `220:3`; AX-01…AX-04 (placeholders) | `/dashboard` | 🟡 | App dashboard covers calls, work orders and leads. Missing the "N requests need routing attention" banner and a "Needs a decision" list as designed for Alex. |
| 26 Team access & delivery issues `220:28`; AD-15…AD-18 (placeholders) | `/team` → `app/team/page.tsx` (members, invites, lead routing, audit tab) | 🟡 | Roles and audit exist. **No notification delivery log** (failed SMS / alerts with retry): the `notificationLog` table exists but no query or screen reads it. |
| 20 Staff · Payments `220:22`; 19 ROS `220:21`; FN-01…FN-09; 21–24, 27 Tenant payments | — | ❌ | See section 8. |
| (none) Knowledge `/docs`, Profile `/profile`, Settings / Messages / WhatsApp (hidden), sign-in / sign-up / accept-invite, public media upload `/m/[token]`, landing pages | various | ➖ | No Figma design. Not audited against Figma. |

---

## Figma vs PRD and client-doc conflicts

The client docs win. Each item needs the user's decision before anyone builds the Figma version.

| # | Figma (node) | Client doc | App today | Suggested default |
|---|---|---|---|---|
| C-1 | Add New Unit `454:22110`: **Asset Manager is optional** (no asterisk). | PRD §5, §8: every unit has exactly one designated asset manager; block intake activation without one. | Required (schema `units.assetManagerUserId` is not optional). | Keep it required. Tell the designer. |
| C-2 | AM5.2 `409:39580`: "All **Unmanaged** Units". | PRD §5: no unit is unmanaged; changes are reassignments with an audit trail. | "Units managed by others". | Keep the app's version. |
| C-3 | WO drawer `271:23195`: **Asset Manager is an editable dropdown** on the work order. | PRD §5: unit → asset manager is a first-class relationship; never silently reassign. | Read-only on the work order; reassign via the unit. | Keep read-only. |
| C-4 | Kanban `269:15250`: only Escalated / Work in Progress / Completed, and "Escalated" is described as "Pending admin work order creation". | PRD §6.3–6.4 states: New Request → Under Review → More Info → Forwarded to Pat → Work Order Created → … Escalation is a high-severity alert, not a queue stage. | 5 columns including Asset Manager Review and Admin Review. | Keep 5 columns. Ask the designer to update Figma. |
| C-5 | Add New Unit `454:22110`: **Tenant is required** and **Square Footage is required**. | Rosters list vacant units (no tenant) and have no square footage (`docs/context/unit-*.md`, `docs/rosters/unit-fields-spec.md`). | Neither field exists. | Make both optional; tenant only when occupied. |
| C-6 | Technician "Job checklist" `220:12` and `518/Checklist item`. | PRD §6.5 requires a checklist, but the client removed it 2026-10-16 (PROGRESS.md; `docs/context/README.md` open question). | No checklist. | Follow the client decision; update the PRD (BACKLOG B28). |
| C-7 | Payments FP04.1 `368:14055`: payment request offers **bank transfer details and a Stripe link**, with manual "Verify payment" against a deposit slip (`368:14061`). | PRD §9: Stripe is the target; the exact flow, funds flow and reconciliation must be agreed first; test mode first; Alex, Pat and the accountant approve. Bank transfer is not mentioned. | Nothing built. | Don't build until the payment model is agreed (B25). |
| C-8 | Tenant P02 "Payment details" `326:24926`: a **custom card form** (card number, expiry, CVC) on our page. | PRD §9 (Stripe) and §11 (protect payment records). Collecting raw card numbers ourselves would put the app in PCI scope. | Nothing built. | Use Stripe-hosted Checkout or Stripe Elements; never our own card inputs. |
| C-9 | ROS Statement Preview `368:14077`: 4-line summary; "Management earnings −$500" on $5,000 rent (10%); "Approve & Send to Owner". | The client's real owner statement (`docs/context/work-order-receipt-and-owner-statement-samples.md`): **5.00% management fee**, cash summary, income statement, transaction ledger, security deposits, owner draw. PRD §10: report assembly, delivery method still to be agreed. | Nothing built. | Design from the client sample, not Figma (B24). |
| C-10 | Add New Property `461:23954`: "Property Owner" is a "Select team" dropdown and a separate "Management Team". | Team (Gold / Silver / Make Up) maps to an asset manager; whether the owner payee differs from the ownership entity is an open client question (BACKLOG "Waiting on the client › Teams and ownership"). | `properties.category`, `ownership`, `ownerName`, `ownerEmail`. | Wait for the client answer before designing owner fields. |
| C-11 | Dashboard "My Tasks" `409:40068`, sidebar "Tasks" and "Screening". | Tasks were removed (`app/tasks/page.tsx`); Screening was replaced by Sarah configuration (build plan P17). | Follow-up card; `/sarah`. | Remove from Figma. |
| C-12 | Two Figma pages with different navigation (Active Screens vs Client flows v2). | — | Follows Active Screens. | Confirm Active Screens is current (backlog D-0). |
| C-13 | Client flows `220:17`: Sarah wording needs **Pat's sign-off** before publishing. | PRD §6.2 / §14 agree with Figma here. | Any admin approves by saving. | Already BACKLOG B7 (needs a client answer). |

Copy slips in Figma itself (tell the designer, don't copy into the app): "Create a technicians account and share exclusive credentials" on the Add New Property card (`439:8212`); "Save property" as the Add New Unit button (`454:22110`); the Technicians drawer frame `292:3152` uses asset-manager headings; "Assets Managers" in the sidebar.

---

## Design-system gaps

- **Colours: match.** Figma variables (`get_variable_defs` on `269:19061`): Simplr Primary `#2563eb`, Selected Tab `#eff6ff`, Selected Tab Content `#2563eb`, Placeholder Tab `#475569`, Current Green `#059669`. The app's `--primary` is blue-600 (`#2563eb`) and `--accent` is blue-50 in `dashboard/app/globals.css`. Success ink is `#047857` (emerald-700) vs Figma's `#059669` (emerald-600): small drift.
- **Two styling dialects.** The work-order board (`components/board/*`, `app/work-orders/page.tsx`, 7 files) hard-codes Tailwind slate colours and pixel values copied from Figma (`text-[13.5px]`, `rounded-[10px]`, `text-slate-900`). Most other pages (83 files) use the token-based kit in `components/ui/*` (`Card`, `PageHeader`, `Chips`, `Seg`, `--radius-card: 20px`). The result: page headers, tabs and tables look different from page to page (e.g. Work Orders has its own 28px header; Properties uses chips and cards where Figma uses KPI cards plus a table). Pick the kit, add the missing Figma patterns to it (KPI card with delta, data table with filter bar and pager, underline tabs, side drawer with sticky action footer, status pill), and move the board onto it.
- **Tabs.** Figma uses underline tabs everywhere (profiles, payments, statements). The app mixes underline tabs (`UnderlineTabs` in `components/asset-managers/shared.tsx`) and pill segmented controls (`Seg` on `/asset-managers`, `/tenants`, `/team`).
- **Typography.** The app uses Geist (`dashboard/app/layout.tsx`). The Figma screenshots look like Inter. Not verified (the text-style query needs a different tool): check the font in Figma and align, or accept Geist.
- **Shared components in Client flows v2** (`518/Button` with Primary / Secondary / Danger / Disabled, `518/Badge/*`, `518/Field`, `518/Navigation/*`) map well onto `components/ui/controls.tsx` and `badges.tsx`. There is no Code Connect mapping.
- **Dead affordances.** Row checkboxes on the work-order table, asset-manager table and AM work-orders tab select rows, but no bulk action exists (some are not wired at all). Either add bulk actions or remove the checkboxes.
