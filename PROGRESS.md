# ✅ 518 Build Progress

Tracks work against [SIMPLR-518-BUILD-PLAN.md](SIMPLR-518-BUILD-PLAN.md).

**Legend:** ✅ done (type-checked, not browser-tested) · 🧪 needs live test · ⬜ not started · ⏳ blocked on client input · ⚠️ caveat

_Last updated: 2026-10-15 (prototype redesign + dedicated ElevenLabs agent)_

---

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
- ✅ Work orders + checklist/photos/receipts/hours/expenses/notes
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
