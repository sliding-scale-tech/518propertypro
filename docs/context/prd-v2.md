# Simplr × 518 Property Pro — Product Requirements Document (v2.0)

**Source file:** `Simplr_518PropertyPro_PRD_v2.docx` (repo root). Document header: "SIMPLR / PRODUCT & ENGINEERING"; footer: "Simplr × 518 Property Pro | Internal working PRD | Version 2.0".

## What this doc is

The internal working PRD (v2.0) for Simplr's custom implementation of "518 Property Pro" for the client Property Pro Rentals. It defines the product outcome, which capabilities already exist in Simplr versus what is net-new, user roles and access, the mandatory unit-to-asset-manager routing rule, the maintenance workflow (highest priority), leasing/Sarah configuration, property/unit setup, Stripe finance, the monthly owner statement (ROS), cross-cutting requirements, required screens, pilot acceptance criteria, inputs still needed from the client, the delivery plan (handover target November 1, 2026), commercial terms and explicit out-of-scope items.

## Key facts & rules

- Commercial: first 60 days after launch free; then $600/month, agreed upfront (about 33% below the roughly $900/month Buildium cost Pat cited). Confirm in writing before pilot start.
- Target handover: **November 1, 2026**, dependent on timely client inputs (especially Stripe/payment decisions and the ROS example). First reviewable build about one week after scope approval.
- Maintenance is the primary workflow (more volume than leasing). Core principle: automate repetitive work, preserve human judgment, make ownership of every request unmistakable.
- Status tags used throughout: [EXISTING], [CONFIGURE], [NEW BUILD], [VERIFY].
- Roles: Alex (business oversight/owners), Pat (maintenance lead), Asset Manager (owns assigned units), Technician (assigned work orders only), Accountant (ROS data access), Simplr Admin (configuration).
- **Mandatory rule:** every unit has exactly one designated Asset Manager; maintenance requests route to that manager first, never by general availability. Unit→Asset Manager is a first-class data relationship; changes record who/when. Unmatched unit → exception queue (never guess). Unavailable manager → flag/escalate to Pat/admin; never silently reassign. Leasing tours may use team-wide availability; maintenance must not.
- Phone (Sarah) is the only maintenance intake channel in this release. Email and Buildium-originated intake are out of scope.
- Sarah must not diagnose issues or make commitments beyond approved scripts; must not improvise emergency instructions. All scripts, emergency language and escalation contacts need Pat's sign-off before production.
- Intake request is separate from a formal work order; no work order exists until the required human decision. AI is not the only creation path: Pat/Asset Managers can create tasks/work orders manually.
- Suggested states: New Request → Under Review → More Information Needed → Forwarded to Pat → Work Order Created → Assigned → In Progress → Completed → Reviewed/Closed. Default one work order per validated request (to be confirmed).
- Asset Manager actions: validate; request more info/photo/video; close as not the company's responsibility (with reason); forward validated request to Pat. All actions logged (actor, timestamp, notes).
- Technician workflow is mobile-first (checklist, photos, receipts, hours, materials/expenses, notes, submit completion). Notification channel (SMS/push/both) undecided.
- Leasing: Sarah answers availability only from current unit data; unavailable units never offered; tours scheduled against valid asset-manager calendars with no double-booking; prospects wanting to hire 518 Property Pro for management go to Alex; no "press zero to reach Pat" escape unless explicitly approved.
- A unit lacking a designated asset manager must be blocked from maintenance intake activation; provide a missing-assignment report.
- Buildium: CSV/export only for agreed pilot setup; no live integration assumed; no full migration.
- Stripe/finance is substantial net-new work, not an existing feature. Do not claim Simplr replaces Buildium unless the complete payment flow is validated; test mode first; Alex, Pat and the accountant must approve before production.
- ROS (monthly owner statement, around the 10th) is report assembly/workflow, not full accounting; needs real ROS example, field definitions and formulas first.
- Cross-cutting: audit history, role-based access, no duplicate work orders from repeated call events, access controls on tenant/transcript/receipt/payment data, no-code configurability where practical, desktop-friendly office UI plus phone-friendly technician UI, error logging.
- Out of scope: vendor onboarding/background screening, email intake, live Buildium API/auto-migration, replacing every Buildium function on day one, full accounting replacement, unapproved resident FAQ flows (renewal, payment plans), automatic approval/rejection of tenants or maintenance claims without human review.

---

# Full content (transcribed from the source document)

**SIMPLR × 518 PROPERTY PRO**

Product Requirements Document

Custom implementation for Property Pro Rentals | Version 2.0 | Target handover: November 1, 2026

Commercial terms: first 60 days free after launch; then $600/month, agreed upfront.

# 1. Product outcome

Build on Simplr’s existing platform to reduce the manual work spread across phone calls, paper work orders, technician follow-ups and Buildium. Maintenance is the primary workflow because it represents materially more volume than leasing. Start with Property Pro Rentals, test in a real operating environment, then consider wider rollout.

Core principle: automate repetitive work, preserve human judgment, and make ownership of every request unmistakable.

# 2. Status legend

**[EXISTING]** Capability already present in Simplr; reuse it and adapt where needed.

**[CONFIGURE]** Existing capability requiring setup for 518 Property Pro.

**[NEW BUILD]** Net-new engineering or meaningful extension; do not assume it exists today.

**[VERIFY]** Provider behavior or technical capability must be confirmed before production.

# 3. Existing vs. custom work

**[EXISTING]** Simplr dashboard/workspace; Sarah voice call handling; call records/transcripts; lead capture and qualification; configurable screening questions; tour/calendar concepts; basic tasks; property context/knowledge; team access.

**[CONFIGURE]** 518 roles and permissions; Sarah’s scripts; leasing/maintenance question sets; severity rules and escalation contacts; pilot properties/units; unit-to-asset-manager mapping; leasing availability; team calendars.

**[NEW BUILD]** Maintenance request review and handoff to Pat; strict unit-based routing; formal work-order lifecycle; technician mobile workflow with checklists/evidence/expenses; ROS owner-reporting workflow; Stripe payment experience and related finance records.

**[VERIFY]** Sarah’s 24/7 availability and five-call concurrency under the selected voice plan; SMS/push delivery; Stripe account eligibility and end-to-end payment/reconciliation behavior.

# 4. Users and access

- Alex — business oversight, owner relationships, growth and high-level escalation; broad operational visibility.

- Pat — maintenance lead; reviews validated requests, creates formal work orders, assigns technicians, reviews completion and handles escalations.

- Asset Manager — owns assigned units; reviews requests for those units, requests clarification, closes out-of-scope requests or forwards validated requests to Pat.

- Technician — sees assigned work orders only; completes checklists and submits photos, receipts, hours, expenses and notes.

- Accountant — accesses financial/maintenance data required for ROS; this is not a full accounting replacement.

- Simplr Admin — configures users, call flows, rules, unit assignments and pilot setup.

# 5. Mandatory unit-to-asset-manager rule

**Every unit must have one designated asset manager.** Any maintenance request for that unit must route to that manager first. Never route maintenance based on general availability or send it to another manager simply because they are online.

- Unit → designated Asset Manager must be a first-class data relationship, not just a display field.

- Authorized admins can update the assignment; record who changed it and when.

- If a request cannot be confidently matched to a unit, route it to an exception queue for human resolution—do not guess.

- If the assigned manager is unavailable, flag/escalate to Pat or an admin until Alex/Pat approve a fallback rule. Do not silently reassign.

- Leasing tours may use team-wide availability; maintenance routing must not.

# 6. Maintenance workflow — highest priority

## 6.1 Phone intake through Sarah

**[EXISTING]** Reuse Sarah’s call handling, transcripts and structured call capture.

**[CONFIGURE]** Phone is the only intake channel in this release. Email and Buildium-originated intake are out of scope; email automation can be scoped later.

- Capture caller/tenant name, property address, unit number, issue description, approximate date first reported and relevant follow-up answers.

- Use known tenant/unit data to prefill or confirm information. Ask if uncertain; do not assume.

- Ask issue-specific questions when needed and request photos/videos where appropriate.

- Classify severity using client-approved rules; store severity, answers, linked unit, transcript/summary, timestamp and next action.

- Sarah must not diagnose an issue or make commitments beyond approved scripts.

## 6.2 Sarah question configuration

- General maintenance: tenant name, property address, asset manager if known, unit number, issue and approximate date first reported.

- Electrical: ask whether the breaker box or GFCI/GFI outlet was checked, when relevant and safe.

- Water leak: floor, exact location, whether there is a unit above, whether a bathroom/kitchen is above, whether water is actively flowing; request a photo/video when appropriate.

- Broken item/fixture: item, exact location, duration and photo where useful.

- Gas odor: follow Pat’s approved script. Current notes say gas odor with hissing → leave immediately and call 911; slight odor without hissing → leave immediately and contact the applicable utility provider. Pat must confirm exact wording and numbers before launch.

- Fire, flooding and other urgent cases must follow a written severity matrix and approved safety script. Sarah must not improvise emergency instructions.

- Other policy questions (pets, access/availability, prior report date) are asked only when relevant.

- All scripts, emergency language and escalation contacts require Pat’s sign-off before production.

## 6.3 Asset Manager review

**[NEW BUILD]** Build a dedicated maintenance inbox/request detail and review actions if the current task module does not already support them.

- Route request automatically to the designated manager for that unit.

- Manager sees transcript/summary, structured answers, severity, tenant and unit details.

- Actions: validate; request more information/photo/video; close as not the company’s responsibility with a reason; or forward the validated request to Pat.

- Keep the intake request separate from a formal work order. No formal work order exists until the required human decision.

- Log each review/action, actor, timestamp and notes.

## 6.4 Pat and work-order creation

**[NEW BUILD]** Implement the explicit handoff from the Asset Manager to Pat and the conversion of a validated request into a formal work order.

- Pat receives a queue of validated requests and can review all context.

- Pat decides whether a work order is needed, defines the work/checklist and assigns a technician.

- Authorized humans—including Pat or an Asset Manager—must also be able to create tasks/work orders manually. AI is not the only creation path.

- Suggested states: New Request → Under Review → More Information Needed → Forwarded to Pat → Work Order Created → Assigned → In Progress → Completed → Reviewed/Closed.

- High-severity cases alert Pat and configured escalation contacts; routine cases stay in the review workflow.

- Default assumption is one work order per validated request; confirm whether multiple work orders per request are needed.

## 6.5 Technician mobile experience

**[NEW BUILD]** Build a mobile-first technician workflow. Existing general tasks should be reused only if they support every requirement below.

- Technician sees assigned jobs, priority, property/unit, issue, checklist and relevant access/context.

- Technician can check off individual tasks, save progress, upload completion photos and receipts, enter hours and materials/expenses, and add notes.

- Technician can submit the work as completed; required fields should be configurable.

- Notify technicians when a job is assigned or materially changed. Final channel—SMS, push or both—must be decided.

- Pat and authorized office staff can inspect completion evidence, costs and notes.

- Files must remain linked to the correct work order, unit and technician.

# 7. Leasing and Sarah configuration

**[EXISTING]** Lead capture, qualification answers, call records/transcripts, funnel and tour/calendar concepts already exist in Simplr.

**[CONFIGURE]** Set up Property Pro’s scripts, qualification questions, unit facts/availability, calendars and routing.

- Initial qualification questions from Pat: preferred bedrooms; monthly budget; third-party payer (and details/contact if yes); preferred communities or communities to avoid in the Capital Region; pets (number/type); preferred move-in date; other relevant information.

- Sarah may answer availability questions only from current unit data. Unavailable units must never be offered.

- Schedule tours against valid asset-manager calendars; prevent double-booking and apply agreed duration/buffer rules.

- Flag prospects who want to hire 518 Property Pro for property management and route them to Alex.

- Do not include a general “press zero to reach Pat” escape route unless Alex/Pat explicitly approve it.

- Lease renewal, rent-payment FAQs, portal login, applications, eviction notices and payment-plan questions appear in Pat’s broader list but are not automatically part of the initial pilot. Confirm before adding them.

# 8. Property and unit setup

**[CONFIGURE]** Import or enter the Property Pro Rentals pilot data.

- Minimum unit fields: property/address, unit number, bedrooms, bathrooms, parking if relevant, current availability, leasing facts and designated asset manager.

- Availability must be editable by authorized staff; an unavailable unit must immediately stop being offered by Sarah.

- Block activation of a unit for maintenance intake if it lacks a designated asset manager; provide a missing-assignment report.

- Use Buildium CSV/export only for agreed pilot setup. Do not assume a live Buildium integration.

- Keep the pilot limited to the agreed Property Pro Rentals units; no full migration is assumed.

# 9. Finance and Stripe — substantial net-new work

**This is not an existing Simplr feature to switch on.** It requires product design, integration and end-to-end validation. Stripe is the target provider, but the exact flow must be agreed first.

**[NEW BUILD]** Tenant payment experience, payment records/statuses, payment history/references for staff, success/failure/pending states, and the agreed reconciliation workflow.

**[VERIFY]** Confirm account ownership/eligibility, merchant or connected-account model if relevant, payment methods, funds flow, payout timing, fees, refunds, failed payments, disputes/chargebacks, rent-ledger source of truth and reconciliation.

- Tenants need a straightforward online payment path through the agreed tenant portal or payment link.

- A payment link in the ROS was discussed, but confirm whether ROS is the main entry point and when it is generated.

- Do not assume Stripe alone replaces Buildium’s rent ledger, balances, recurring rent schedules, late fees, partial payments, payment plans, owner accounting or reconciliation.

- Define the minimum pilot: eligible tenant, amount due/source of truth, payment confirmation, failed-payment handling, transaction history and how staff confirm settlement.

- Payment processing is non-negotiable for a full transition away from Buildium. If the complete flow is not validated, do not represent Simplr as ready to replace Buildium.

- Use test mode and test cases before live payments. Alex, Pat and the accountant must approve the flow before production.

# 10. Monthly Renters-Owner Statement (ROS)

**[NEW BUILD]** Build a Property Pro-specific owner-reporting workflow. This is not a complete accounting system.

- Target cadence: around the 10th of each month.

- Expected data: rent collected, property expenses, management earnings, owner’s bottom-line amount, plus maintenance description, work completed, hours, materials and expenses.

- Use completed work-order data to prefill maintenance details rather than reconstructing them from paper.

- The actual ROS example, field definitions, formulas and delivery method are required before finalizing the report.

- Until source data and formulas are confirmed, treat this as report assembly/workflow—not a guarantee that all totals reconcile automatically.

# 11. Cross-cutting requirements

- Audit history for creation, review, edits, routing, assignment, completion and closure.

- Role-based access: technicians see assigned work only; Asset Managers see their units; Pat/Alex/admin have broader access by role.

- Prevent duplicate work orders from repeated call events where practical; make failed/uncertain calls visible for follow-up.

- Protect tenant details, transcripts, uploaded receipts and payment records with appropriate access controls.

- Questions, severity rules, escalation contacts, unit assignments and work-order fields should be configurable without code where practical.

- Desktop-friendly office screens; technician experience must work on a phone.

- Log routing, notification, payment and integration errors for support and debugging.

# 12. Screens required

- Operations dashboard: calls, maintenance requests, active/completed work orders and leasing activity.

- Asset Manager maintenance inbox and request detail.

- Pat’s validated-request queue and work-order creation/assignment form.

- Work-order detail with checklist, technician, photos, receipts, hours, expenses, notes and status.

- Technician mobile job list, job detail, checklist, uploads and completion submission.

- Property/unit management with availability and required asset-manager assignment.

- Sarah configuration for leasing/maintenance questions, severity rules and escalation contacts.

- Leasing lead detail and calendar/tour scheduling.

- ROS/owner-report workflow.

- Tenant payment page and staff-side payment status/history.

# 13. Pilot acceptance criteria

- A tenant calls Sarah and submits a maintenance request without staff retyping the initial report.

- The request is matched to the correct unit and routed only to that unit’s designated Asset Manager.

- The Asset Manager can validate, request clarification, close as out of scope, or forward the request to Pat.

- Pat can create and assign a formal work order; authorized humans can also create tasks/work orders manually.

- A technician can use a phone to complete checklist items, upload photos/receipts and enter hours, expenses and notes.

- Pat/office staff can inspect evidence and the full action history.

- Sarah captures agreed leasing answers and books tours only against current availability and valid calendar slots.

- ROS uses the agreed fields and work-order data once the client provides the template/formulas.

- The agreed Stripe pilot flow passes tests for successful payment, failure, confirmation and staff reconciliation before live use.

- The pilot is limited to the agreed Property Pro Rentals units and does not depend on a full Buildium migration.

# 14. Inputs required from Alex, Pat and the team

- Final leasing and maintenance questions, answer options and branching rules for Sarah.

- Written severity definitions, approved emergency scripts, escalation contacts and who gets notified at each severity.

- Property Pro Rentals property/unit list and exact pilot units.

- Unit-to-Asset Manager assignments, who may change them, and fallback if the assigned manager is unavailable.

- Current rental availability and rules for offering/showing a unit.

- Asset-manager calendars, tour duration, buffer times, scheduling windows, cancellation and rescheduling rules.

- Technician names, roles, mobile numbers and notification preferences.

- Current work-order example with checklist fields, hours, materials, receipts and expense/reimbursement fields.

- Current ROS/owner statement, field definitions, formulas and delivery format.

- Stripe account/setup details and approved payment methods, funds flow, settlement, refunds, disputes and reconciliation expectations.

- Any Buildium export/CSV needed for the agreed pilot data.

- Confirmation whether lease renewals, payment FAQs, portal-login support and other resident FAQs are required for pilot or deferred.

# 15. Delivery plan and critical path

1.  Build lock: confirm pilot units, scripts, severity rules, unit assignments, notification path, ROS example and payment requirements.

2.  First usable build targeted within about one week after scope approval for Alex/Pat review. This is a reviewable build, not final handover.

3.  Alex and Pat review real scenarios; selected office staff then test the refined workflow.

4.  Pilot hardening: routing edge cases, permissions, audit history, technician mobile flow and integration tests.

5.  Target handover: November 1, 2026, dependent on timely client inputs—especially Stripe/payment decisions and the ROS example.

**Schedule risk:** the maintenance workflow can be developed and tested separately, but a dependable Buildium-replacement payment flow and accurate ROS depend on financial requirements and source data that are not fully specified yet.

# 16. Commercial and rollout assumptions

- Pilot begins on a small agreed set of Property Pro Rentals units.

- First 60 days after launch are free of cost.

- Ongoing price: $600/month, approximately 33% below the roughly $900/month Buildium cost Pat cited for their own portfolio. Confirm the agreed price/scope in writing before pilot start.

- Pilot feedback informs broader rollout; no client-property rollout until Alex/Pat approve.

- New channels, full accounting replacement or material workflows beyond this PRD require a separate scope decision.

# 17. Explicitly out of scope

- Vendor onboarding and vendor background screening.

- Email-based maintenance intake as a standard channel.

- Live Buildium API integration or full automatic migration unless separately approved.

- Replacing every Buildium function on day one.

- Full accounting/bookkeeping replacement beyond the agreed ROS workflow.

- Unapproved resident FAQ flows such as lease renewal or payment-plan negotiation.

- Automatic approval/rejection of tenants or maintenance claims without human review.

# 18. Engineering decisions before build lock

- Confirm what can be reused from Simplr’s current task model versus separate MaintenanceRequest and WorkOrder records.

- Confirm voice-provider availability for 24/7 service and five simultaneous calls.

- Choose SMS, push or both for technician and escalation notifications.

- Define fallback when the assigned Asset Manager is unavailable or a unit has no assignment.

- Agree Stripe architecture, minimum rent-payment flow, ledger/source of truth and reconciliation.

- Define ROS data sources and calculations after reviewing a real statement.

- Confirm audit/logging, upload storage, access controls, retries and payment-event handling.
