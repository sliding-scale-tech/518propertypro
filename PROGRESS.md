# ✅ 518 Build Progress

Tracks work against [SIMPLR-518-BUILD-PLAN.md](SIMPLR-518-BUILD-PLAN.md).

**Legend:** ✅ done (type-checked, not browser-tested) · 🧪 needs live test · ⬜ not started · ⏳ blocked on client input · ⚠️ caveat

_Last updated: 2026-10-15 (prototype redesign + dedicated ElevenLabs agent)_

---

> **Note:** Checklist removed per client decision (2026-10-16); PRD §6.4/6.5 checklist requirement waived by user. DB fields/table kept (deprecated) so no data is lost.

> **Decisions 2026-10-16 (Sarah + manual requests):** (A) `send_photo_link` no longer texts anyone: it records a "Photo request from the call" on the request and texts the AM (`photo_request` template); the AM's "Ask tenant for photos" is the only way a link goes out. (B) `find_resident` and phone/email resident matching removed; chain is lookup_caller → caller name → property → unit → find_unit → record callback only + log_unmatched_caller; server stores `nameMatchesResident` for the AM. Re-save the Sarah agent so the stale tool is detached. (C) Manual requests: Executive/admin/Pat any unit; AM own units only and always forwarded to Pat ("Waiting on Pat"). ⚠️ `workOrders.create` without a request still lets an AM create a work order directly (outside this change's file scope).

## 🚀 Before testing (one-time)
- ⬜ `npx convex dev` in `dashboard/` (pushes schema + functions, regenerates types)
- ⬜ Convex env: `RESEND_API_KEY`, `APP_BASE_URL`, Twilio vars, Google vars
- ⬜ Reset Sarah prompt: `npx convex run agents:resetToDefaultPrompt` then Settings → Save (registers new tools)
- ⬜ Team time zone → `America/New_York`
- ⬜ Assign roles on Team page (Admin / Asset manager / Technician)
- ⬜ Dedicated ElevenLabs agent: `npx convex run agents:listForOps` → `npx convex run agents:createDedicatedAgent '{"orgId":"<id>","name":"518 Property Pro – Sarah"}'`
- ⬜ ElevenLabs → Phone numbers: assign the 518 number to the new agent
- ⬜ Sarah config → Tenant messages: Pat approves photo-request / out-of-scope wording, then Publish

## Phase 0: Build lock
- ✅ Build plan · ✅ CLAUDE.md model rule
- ⏳ Client inputs (plan §13) · ⏳ Conflicts C1–C13 · ⏳ Scope/price in writing
- ⬜ Separate production setup (Convex prod, Clerk prod, ElevenLabs agent, Twilio, published Google OAuth)

## Roles and access
- ✅ 3 user types in UI: Admin, Asset manager, Technician (`team.setAppRole`, guards: last admin, self-demote, AM owning units)
- ✅ Four views + `/home` redirect + role-aware sidebar + `RequireView` page guards
- ✅ Invite flows: Add admin / asset manager / technician (email via Resend)
- ✅ Server guards on admin-only functions
- ⬜ Guard `/tasks` and `/team` by view

## Data foundations
- ✅ Units with required asset manager (hard rule) · ✅ multi-property
- ✅ Residents + phone matching
- ✅ Maintenance requests + routing + exceptions + duplicate check
- ✅ Work orders + photos/receipts/hours/expenses/notes (checklist removed, see note below)
- ✅ Audit log · ✅ SMS notifications (logged) · ✅ public token links (helpers)
- ⬜ Buildium CSV import (dry run)
- ⚠️ Remove old `properties.units` once Sarah reads only `units`

## Admin pages
- ✅ Dashboard (maintenance stats, needs attention, recent, failed calls)
- ✅ Maintenance: all requests · request detail (all actions) · exceptions
- ✅ Validated queue (Pat) · Work orders list/board · create form · detail + review
- ✅ Leads (capture only, owner-prospect badge) · Residents · Resident calls
- ✅ Properties & Units (edit/remove)
- ✅ Tasks (assignee, My/All)
- ✅ Sarah configuration (8 tabs, draft → preview → publish → rollback)
- ✅ Audit log page · ✅ Finance tab (coming soon)
- ⬜ Resident calls: Route to / owner / close with reason
- ⬜ Leads: staff status dropdown
- ⬜ Sarah config: "Send test alert" button

## Asset manager + technician (minimal, needed for end-to-end)
- ✅ AM inbox (same page, scoped) · ✅ Technician `/tech` mobile job list + job page
- 🧪 Camera upload on real iPhone/Android
- ⬜ Tenant photo upload page `/m/[token]`
- ⬜ ★ Revisit leads scoping: decide whether asset managers should see only leads for their own properties (currently every AM sees all leads).

## Sarah (voice)
- ✅ Tools: lookup_caller, find_unit, log_maintenance_request, route_owner_prospect
- ✅ Prompt rebranded 518 · emergency scripts · capture-only leasing · escalation alerts on
- ⏳ Pat sign-off: scripts, severity matrix, escalation contacts, tenant-responsibility wording
- 🧪 Address matching against real 518 addresses
- 🧪 5 concurrent calls · 3 a.m. call

## Hardening / security
- ⬜ Shared-secret header on `/tools/*` (unauthenticated today)
- ⬜ Post-call webhook rejects unsigned requests (`http.ts`)
- ⬜ Permission + IDOR tests per role
- ⬜ Remove `debugWebhookLogs`; rotate leaked secrets
- ⬜ Acceptance script (plan §14)

## Finance
- ⏳ Stripe payments · ⏳ Owner statements (ROS)

## Prototype redesign (Pat admin view)
- ✅ Design tokens + UI primitives (`components/ui`) · ✅ prototype sidebar + redirects
- ✅ Work orders: one board (AM review → Waiting on lead → With technician → Needs sign-off) + drawer, two records (request + WO)
- ✅ Exceptions banner · ✅ New work order drawer (auto-forward) · ✅ tenant photo upload `/m/[token]`
- ✅ Dashboard (pipeline, AMs, technicians, attention, schedule) · ✅ Asset managers page (default AM, tours toggle, escalation rules, upcoming tours)
- ✅ Property page (default AM + per-unit override, owner) · ✅ Tenants: Resident calls | Residents tabs
- ✅ Team: invite card, skills, Audit log tab · ✅ Sarah config: Tenant messages tab · ✅ technician phone restyle
- ✅ Approve & send to Pat · reject with optional tenant notice (approved wording only) · severity n/10
- ✅ Accountant read-only board · ✅ dedicated ElevenLabs agent command
- 🧪 Browser + live test of all of the above
- ⬜ tasks/calendar/docs/call bodies only partly restyled

---
⚠️ Nothing committed (per instruction).

## Texting policy (SMS)

For now the app sends text messages in only two cases: an emergency alert to admins, and (later) work-order texts to technicians. Technician texts are switched off by one constant, SMS_TECHNICIAN_ENABLED in dashboard/convex/twilioApi.ts; flipping it to true turns on the wo_assigned, wo_changed and wo_sent_back templates with no other change. The allowlist is SMS_ALLOWED_TEMPLATES in the same file, and it is enforced in three places: scheduleNotify and the send action in dashboard/convex/notify.ts, and the low-level sendSms and sendWhatsApp in twilioApi.ts, which drop any send that does not name an allowed template (they log the reason, never a number or message text, and do not throw). Every other notification template, tenant text, bot auto-reply and the staff reply box on /messages is off; in-app records and audit rows are still written. The emergency text uses the emergency_alert template with fixed wording ("EMERGENCY: MR-n at unit. Open the request."), goes to team admins, executives, maintenance leads and simplr_admins plus the Sarah config escalation contacts for the Emergency level, ignores out-of-office and each person's channel preference, and is sent at most once per request (tracked by an emergency_alert_sent audit row). Urgent requests no longer text. Not covered because they live in files outside this change: the WhatsApp (WAHA) sends in convex/waBot.ts and convex/whatsapp.ts.

- Tasks page removed; work orders are the only page (2026-10). /tasks redirects to /work-orders. Sarah log_task_request now files a "Question" maintenance request for the unit AM. DB table and convex/tasks.ts kept.
- Technicians page removed; Team is the single people page (2026-10). **Reversed 2026-11-11: Technicians section restored** (user-approved; the removal was a developer decision with no client doc behind it). /technicians matches Figma TC2-TC6.3: KPIs Total/Busy/Idle, invite, search + property/status filters, workload table and side card (`components/technicians/technicians-tab.tsx`); /technicians/[userId] profile with Pending/In Progress/Awaiting Sign Off cards, edit profile, reset password, Danger Zone delete, and a Work orders tab with priority/status filters and "Manage assignment" (`components/technicians/profile-view.tsx`). Backend `convex/technicians.ts` (admin-view only) and `workOrders.reassignMany` (required reason on each audit row, same notify path as assign). Metrics (not client-defined): Pending = created/assigned, Active = in_progress, Needs Sign Off = completed, Busy = 1+ in progress. Sidebar has Technicians under Maintenance; dashboard links point there; Team keeps its role chips (?role=admin|asset_manager|technician) and the Team drawer links technicians to their profile. Accept-invite now lands via /home and no longer loops on error.

- Sarah config approval: any admin-view user (team admin, executive, maintenance lead, simplr_admin) can approve/request changes/reject from draft; last-editor self-approve block removed; stamp and audit record who approved.

- Authorization unified: one rule, `authz.isAdminView` (team admin flag, executive, maintenance_lead, simplr_admin = Admin) drives canManageMaintenance, requireOrgAdmin, requireAdminView(Id), hasJobRole/requireJobRole, sarahConfig publish/rollback/KB, agents.saveAgent, calendar/tours teammate access, audit.forEntity, units/properties writes, invites; team.list/myAccess/tours `isAdmin` now means Admin view; last-Admin protection counts Admin view; Admin chip "Full access. Pat and Alex."

- Sarah config friction removed for Admins: admin saves and switching a call type on auto-approve the wording (audited), publish approves remaining enabled drafts, `sarahConfig.adminApproveAll` (internal) + "Approve all drafts" button, locks and "needs approval" copy gone, panel is now "To finish" (gas utility phone only).
