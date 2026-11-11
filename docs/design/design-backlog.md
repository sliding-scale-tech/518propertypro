# Design backlog: bring the app in line with Figma (where the client docs agree)

_Created 2026-11-02 from `docs/design/figma-audit.md`. Figma file `wISc3YonhsLV3mc6MiuVMe`; node ids are clickable as `https://www.figma.com/design/wISc3YonhsLV3mc6MiuVMe/Simplr?node-id=<id with - instead of :>`._

How to read this file:
- **P0** = a core flow is broken or missing. **P1** = a visible gap on a main screen. **P2** = polish.
- **[UI]** = front end only (`dashboard/app`, `dashboard/components`). **[BE]** = also needs Convex work (`dashboard/convex`): a new query, mutation, argument or table.
- **→ Bxx** = already in `BACKLOG.md`. Work it there; the line here only adds the design detail. Don't create a second copy.
- Every form item follows the global form rule (field-level errors, toast, `ConvexError` on the server), which is **BACKLOG B6**.
- Where Figma conflicts with the client docs, the item says so and points to the conflict number (C-x) in the audit. The docs win until the user decides.

## Decisions first

- [ ] **D-0** Confirm which Figma page is current: Active Screens `0:1` (the app follows it) or Client flows v2 `220:2` (different navigation, 74 empty placeholder frames). Then ask the designer to fix conflicts C-1…C-11 in Figma so the file stops contradicting the PRD. (Decision, no code.)

## P0: core flow broken or missing

- [ ] **P0-1 [UI] Unit form: expose the PRD §8 minimum fields.** Parking, leasing facts, available-from and top floor are accepted by `units.create` / `units.update` but no screen edits them, so Sarah's leasing facts can't be maintained by staff. Also fix the field labelled "Unit type" that actually sets bedrooms. Figma `454:22110`, `121:11394`. Files: `dashboard/components/units/add-unit-modal.tsx`, `dashboard/components/units/edit-unit-modal.tsx`, `dashboard/components/units/unit-inventory.tsx`.

_No other P0 gaps: the maintenance core flow (intake → asset-manager review → Pat → work order → technician → sign-off) is built and matches Figma. Finance is missing but is gated on the client (see the Finance section)._

## P1: visible gaps on main screens

### Technicians (Figma TC flow `342:35605`): missing
- [ ] **P1-1 [BE] Technicians list page** with KPIs (Total / Busy / Idle), invite card (name, email, phone), table (Pending, Active, Needs Sign Off, Busy/Idle, ⋯), search, filters, pager, row drawer (assigned work, needs sign-off, current work order, View Profile). Needs a `technicians` overview query with per-person counts (mirror `convex/assetManagers.ts`). Figma `320:28059`, `292:3152`. Files: new `dashboard/app/technicians/page.tsx`, new `dashboard/components/technicians/*`, new `dashboard/convex/technicians.ts`, `dashboard/components/app-sidebar.tsx` (add "Technicians" under Maintenance).
- [ ] **P1-2 [BE] Technician profile** with Overview (Pending / In Progress / Awaiting Sign Off cards, contact, internal notes, Edit profile, Danger Zone) and Work orders tab (search, priority, status filters). Figma `295:1245`, `429:9250`, `295:1248`. Files: new `dashboard/app/technicians/[userId]/page.tsx`, `dashboard/convex/technicians.ts` (profile + work-orders query; can reuse `board.table` with `technicianUserId`).
- [ ] **P1-3 [BE] Move a technician's work orders to another technician** ("Manage assignment" → pick work orders → new technician → "Assignment Updated" handoff summary). Needs a bulk reassign mutation that writes audit events and notifies both technicians. Figma `432:10043`, `432:10235`, `432:9676`. Files: `dashboard/convex/workOrders.ts`, new modal in `dashboard/components/technicians/`.

### Properties and units (Figma Property Flow `121:11393`): partial
- [ ] **P1-4 [BE] Properties overview to match PR2:** KPI cards (Total Properties, Total Units, Rented Units), properties table (ID, Property, Owner, Total / Rented / Available units, ⋯) with search and Properties / Owners filters; open a property to see today's profile + unit inventory. Needs per-property unit counts (rented = occupied) in `properties.list` or a new query. Figma `439:8212`. Files: `dashboard/components/properties/property-page.tsx`, `dashboard/convex/properties.ts`. Fix the leftover admin subtitle ("These rules drive the agent's qualification check…").
- [ ] **P1-5 [BE] Unit detail page** (breadcrumb, status pill, fact cards, Unit Information, Utilities, Current Tenant, Management with asset-manager link and team, Edit Details). Data mostly exists (roster fields from B2, `residents`). Needs a `units.get` that returns unit + current resident + property team, and `units.update` must accept the roster fields (unitType, occupancy, leaseType, leaseEnd, gasPaidBy, electricPaidBy, laundry), which today only `rosterImport` writes. Figma `121:11394`. Files: new `dashboard/app/properties/[id]/units/[unitId]/page.tsx` (today `app/properties/[id]/page.tsx` only redirects), `dashboard/convex/units.ts`. Keys/lockbox stay masked and role-limited → B11.
- [ ] **P1-6 [BE] Full Add / Edit Unit form** (Basic, Rental, Utility sections + property context card). Conflicts C-1 and C-5: asset manager **required**, tenant and square footage **optional**. Square footage, lease term / start date and notes are not in the schema: add only if the client wants them. Figma `454:22110`. Files: `dashboard/components/units/add-unit-modal.tsx`, `edit-unit-modal.tsx` (or a page), `dashboard/convex/units.ts`, `dashboard/convex/schema.ts`. Validation → B6.
- [ ] **P1-7 [BE] Add New Property page** (type, street / city / state / ZIP, owner, management team, notes, photo). Owner fields wait for the client answer on owner vs ownership entity (C-10, BACKLOG "Waiting on the client › Teams and ownership"). Property type, notes and photo need schema fields + file storage. Figma `461:23954`. Files: `dashboard/components/properties/property-form.tsx`, `property-page.tsx`, `dashboard/convex/properties.ts`, `schema.ts`.
- [ ] **P1-8 [UI] "Import CSV" entry point** on the Properties page for the pilot roster / Buildium export, with mapping, validation and an exceptions summary (Client flows AD-06…AD-08). → **B3** (roster importer, CLI today) and **B26** (Buildium CSV import). Figma `439:8212`. Files: `dashboard/components/properties/property-page.tsx`, `dashboard/convex/rosterImport.ts`.

### Asset managers: small gaps
- [ ] **P1-9 [BE] Work orders tab filters** on the asset-manager profile (search, Priorities, Statuses). `assetManagers.workOrders` takes only page args today. Figma `409:39198` (filters as in `295:1248`). Files: `dashboard/components/asset-managers/profile-view.tsx`, `dashboard/convex/assetManagers.ts`.
- [ ] **P1-10 [UI] Danger Zone on the asset-manager profile:** "Delete User" with confirm, disabled with "Reassign their N units first" while they own units (reuse `team.removeMember`, which already enforces this). Figma `409:37614`. Files: `dashboard/components/asset-managers/profile-view.tsx`.

### Work orders: small gap
- [ ] **P1-11 [UI] Recently closed table under the Kanban** (Work order, Unit, Outcome pill "Closed <date>" / "Rejected", Hours, Materials). Can reuse `board.table` with `status: "closed"`. Keep the app's 5 columns (C-4). Figma `269:15250`. Files: `dashboard/components/board/board.tsx`, `dashboard/app/work-orders/page.tsx`.

### Operations and admin (Client flows v2)
- [ ] **P1-12 [BE] Notification delivery log:** failed SMS / alerts with event, state, next action and Retry (PRD §11 "log routing, notification … errors"). `notificationLog` is written but never read. Figma `220:28`, AD-17 `259:930`, AD-18 `259:931` (placeholders). Files: new section in `dashboard/app/team/page.tsx` (or `/team?tab=delivery`), `dashboard/convex/notifications.ts`. Note: `app/team/page.tsx` has uncommitted edits in progress; coordinate.
- [ ] **P1-13 [BE] Staff tour booking and rescheduling** from a lead or the calendar (unit + host, available slots, confirm, reschedule, cancel). Today only Sarah books; staff can only cancel. PRD §12 "calendar/tour scheduling". Figma `220:20`, AM-09…AM-15 `259:881`…`259:887` (placeholders). Files: `dashboard/app/leads/page.tsx`, `dashboard/app/calendar/page.tsx`, `dashboard/convex/tours.ts`. Depends on the tour setup in BACKLOG "Contacts and setup › Tour booking setup".
- [ ] **P1-14 [UI] Routing-attention banner on the admin dashboard** ("N requests need routing attention" with a link to exceptions), as in Alex's overview. Data exists (`board.counts.exceptions`). Figma `220:3`. Files: `dashboard/components/dashboard/admin-dashboard.tsx`.

### Linked items already in BACKLOG.md (design detail only)
- [ ] Sarah configuration: only Pat signs off emergency / legal wording, Publish disabled until approved, as in Figma `220:17`. → **B7**.
- [ ] Work-order drawer: paper-form fields (invoice #, team, ownership entity, keys masked, cost vs bill, SWEEP/REIMB, paid). Figma `317:26448` has none of them; design them into the Expenses tab. → **B18**, **B11**.
- [ ] Leads: staff status dropdown in the row. Figma `220:19`. → **B21**.
- [ ] Every form in this file: field-level validation. → **B6**.

## P2: polish

- [ ] **P2-1 [UI] Sidebar parity:** rename "Assets Managers" → "Asset Managers" and "Payment" → "Payments"; add "Technicians" (with P1-1). Figma `121:8569`. Files: `dashboard/components/app-sidebar.tsx`.
- [ ] **P2-2 [UI] One styling system.** Move `components/board/*` and `app/work-orders/page.tsx` off hard-coded slate / pixel classes onto `components/ui/*` tokens; add the Figma patterns to the kit (KPI card with delta, filter bar + table + pager, underline tabs, drawer with sticky action footer). Files: `dashboard/components/ui/*`, `dashboard/components/board/*`, `dashboard/app/globals.css`.
- [ ] **P2-3 [UI] Tabs:** use underline tabs (Figma style) instead of pill segmented controls on `/asset-managers`, `/tenants`, `/team`. Files: `dashboard/app/asset-managers/page.tsx`, `dashboard/app/tenants/page.tsx`, `dashboard/app/team/page.tsx`, `dashboard/components/asset-managers/shared.tsx` (`UnderlineTabs`).
- [ ] **P2-4 [UI] Font:** check Figma's font (looks like Inter); switch from Geist or record that Geist is accepted. Files: `dashboard/app/layout.tsx`, `dashboard/app/globals.css`.
- [ ] **P2-5 [UI] Success colour:** align `--success-ink` / emerald shades with Figma "Current Green" `#059669`. Files: `dashboard/app/globals.css`.
- [ ] **P2-6 [UI] Row checkboxes:** add bulk actions or remove the checkboxes (work-order table, asset-manager table, AM work-orders tab, where select-all is not wired). Files: `dashboard/components/board/board.tsx`, `dashboard/components/asset-managers/managers-tab.tsx`, `profile-view.tsx`.
- [ ] **P2-7 [UI] Turn off a day from the calendar grid:** click a day → "Turn off this day?" with booked / free state and optional reason (0/200). Uses existing `tours.addDayOff`. Figma `121:9107`. Files: `dashboard/app/calendar/page.tsx`.
- [ ] **P2-8 [UI] Technician "Sent back" banner** on the job when the office requests a correction, instead of only a note. Figma TX-10 `259:913` (placeholder). Files: `dashboard/components/tech/job-detail.tsx`, `dashboard/components/tech/job-card.tsx`.
- [ ] **P2-9 [UI] Dashboard "My Tasks" card:** Figma still shows it; Tasks were removed. Ask the designer to replace it with the follow-up card (C-11). Figma `409:40068`. Files: none (Figma change).
- [ ] **P2-10 [BE] Maintenance-intake activation per unit** (PRD §8; Client flows "Activate maintenance intake" `220:16`). `units.maintenanceIntakeActive` is always true and has no UI or mutation. Confirm it is still wanted now that every unit must have an asset manager. Files: `dashboard/convex/units.ts`, `dashboard/components/units/unit-inventory.tsx`.
- [ ] **P2-11 [UI] Copy:** Figma copy slips are for the designer, not the app ("Create a technicians account…" on Add New Property `439:8212`, "Save property" on Add New Unit `454:22110`, asset-manager headings in the technician drawer `292:3152`).

## Finance (gated: after Nov 1 unless agreed in writing)

Everything here is missing (`/finance` is a "Coming soon" card) and waits on client inputs. Work it under **B24 (ROS)** and **B25 (Stripe)**; the breakdown below is the screen list from Figma. Don't start until conflicts C-7…C-9 are decided.

- [ ] **F-1 [BE] Payments overview:** KPIs, tabs (Transactions / Payment requests / Pending Verification), filters, table with Review / Verify. Figma `396:21858`, `397:39219`. → **B25**. Files: `dashboard/app/finance/page.tsx`, new `dashboard/convex/payments.ts`, `schema.ts`.
- [ ] **F-2 [BE] Create payment request** (2-step drawer, review, sent). Bank transfer option only if the client confirms it (C-7). Figma `368:14055`, `368:14057`, `368:14058`, `397:39534`. → **B25**.
- [ ] **F-3 [BE] Verify / fail / resend payment** with settlement evidence and reconciliation comments. Figma `368:14061`, `396:22140`, `368:14054`, `397:22919`, `397:24130`, `397:23213`, `397:24445`, `368:14052`. → **B25**.
- [ ] **F-4 [BE] Public tenant pay page** `/pay/[token]` with the eight states (confirm, pay, bank verification, received, processing, declined, receipt, link unavailable) and a "Test mode" badge. **Use Stripe-hosted Checkout or Elements, never our own card fields (C-8).** Figma `326:24924` (P01–P08), Client flows `220:23`…`220:26`, `229:416`. → **B25**. Files: new `dashboard/app/pay/[token]/page.tsx`, `dashboard/convex/publicLinks.ts`, `http.ts` (Stripe webhook).
- [ ] **F-5 [BE] Owner reports list** (KPIs, filters, status Sent / Draft / Pending Review / Overdue, Create Report). Figma `402:32724`. → **B24**.
- [ ] **F-6 [BE] Statement preview, maintenance and calculations tabs, draft / send / overdue states.** Lay out the statement from the client's real sample (5% management fee, cash summary, income statement, ledger, deposits held, owner draw), not Figma's 4-line summary (C-9). Prefill maintenance from closed work orders. Figma `368:14077`, `368:14074`, `368:14076`, `409:36112`, `409:35894`, `409:36502`. → **B24**.
- [ ] **F-7 [UI] Accountant dashboard:** replace the "coming soon" card with payment and statement KPIs once F-1 / F-5 exist. Files: `dashboard/app/dashboard/page.tsx`.

## Suggested order (top 10)

1. **D-0** Confirm the current Figma page and send conflicts C-1…C-11 to the designer (no code; unblocks everything else).
2. **P0-1** Unit form PRD fields (parking, leasing facts, available-from) + fix the mislabelled "Unit type". [UI]
3. **P1-5** Unit detail page. [BE]
4. **P1-6** Full Add / Edit Unit form (AM required, tenant optional). [BE]
5. **P1-4** Properties overview with KPIs and a properties table. [BE]
6. **P1-1** Technicians list page + sidebar link. [BE]
7. **P1-2** Technician profile with work-orders tab. [BE]
8. **P1-12** Notification delivery log. [BE]
9. **P1-11** Recently closed table under the Kanban. [UI]
10. **P1-9 + P1-10** Asset-manager profile: work-order filters and Danger Zone. [BE] / [UI]

Then P1-3, P1-13, P1-14, P1-7, P1-8 and the P2 list. Finance (F-1…F-7) starts only when B24 / B25 are unblocked.
