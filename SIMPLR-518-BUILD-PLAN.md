# 🏢 Simplr × 518 Property Pro: Page-by-Page Build Plan

> **Sources read:** `Simplr_518PropertyPro_PRD_v2.docx` (PRD v2.0), `Simplr × 518 Property Pro — Sarah Configuration.docx` (Sarah Config), and the current codebase in [`dashboard/`](dashboard/) (Next.js 16 + Convex + Clerk + ElevenLabs + Google Calendar + Twilio).
>
> **Plan written:** 2026-10-15 · **Target handover:** **2026-11-01** (PRD §15) · **Commercial terms:** free for 60 days, then $600/month

> [!CAUTION]
> **Schedule reality check.** There are **17 calendar days** between today and the target handover. PRD §15 assumes about one week to a *first reviewable build*, followed by review rounds and hardening. Maintenance (Phases 0 to 3 below) fits in that window if client inputs arrive now. **Stripe payments and the ROS cannot be finished by Nov 1** unless Alex, Pat and the accountant supply the payment model and a real ROS example this week. Agree this split in writing before starting.

---

## 📑 Table of contents

1. [Colour legend and how to read this file](#-1-colour-legend-and-how-to-read-this-file)
2. [What exists today (verified in code)](#-2-what-exists-today-verified-in-code)
3. [Gap matrix: PRD vs current code](#-3-gap-matrix-prd-vs-current-code)
4. [Conflicts and contradictions to resolve](#-4-conflicts-and-contradictions-to-resolve-before-build-lock)
5. [Foundation work (before any page)](#-5-foundation-work-before-any-page)
6. [New navigation map](#-6-new-navigation-map)
7. [Page-by-page plan](#-7-page-by-page-plan)
8. [Sarah (voice agent) changes](#-8-sarah-voice-agent-changes)
9. [Notifications](#-9-notifications)
10. [Roles and permissions matrix](#-10-roles-and-permissions-matrix)
11. [Security, privacy and audit](#-11-security-privacy-and-audit)
12. [Delivery phases, steps and gates](#-12-delivery-phases-steps-and-gates)
13. [Client inputs checklist](#-13-client-inputs-checklist)
14. [Pilot acceptance test script](#-14-pilot-acceptance-test-script)
15. [Explicitly out of scope](#-15-explicitly-out-of-scope)
16. [Housekeeping and tech debt found along the way](#-16-housekeeping-and-tech-debt-found-along-the-way)

---

## 🎨 1. Colour legend and how to read this file

| Badge | Meaning | PRD tag |
|---|---|---|
| 🟢 **EXISTING** | Already works in Simplr. Reuse as is. | `[EXISTING]` |
| 🔵 **CONFIGURE** | Exists, but needs 518-specific data, wording or settings. No new code (or trivial code). | `[CONFIGURE]` |
| 🟡 **UPDATE** | Existing page or function that needs real code changes or extension. | *(between EXISTING and NEW BUILD)* |
| 🔴 **NEW BUILD** | Net-new page, table, tool or workflow. Do not assume any of it exists. | `[NEW BUILD]` |
| 🟣 **VERIFY** | Provider behaviour or capability that must be proven before production. | `[VERIFY]` |
| ⏳ **BLOCKED** | Cannot be finished until the client supplies an input (see §13). | n/a |
| ⚫ **OUT** | Out of scope for this release. | PRD §17 |
| 🙈 **HIDDEN** | Route exists and works but is not linked in the sidebar. | n/a |

Every page in §7 follows the same layout:

- **Route · Status · Who sees it**
- **Today** (what the code does now, with file links)
- **Change / Add** (bullet list, each tagged with a colour)
- **Data and backend** (tables, Convex functions)
- **Steps** (ordered implementation steps)
- **Done when** (acceptance checks)
- **Blocked by** (client inputs, if any)

> [!NOTE]
> File links are relative to the repo root. All Convex code lives in [`dashboard/convex/`](dashboard/convex/), and all pages live in [`dashboard/app/`](dashboard/app/).

---

## 🔍 2. What exists today (verified in code)

### 2.1 Stack

| Layer | Technology | Where |
|---|---|---|
| Frontend | Next.js 16.1.6 (App Router), React 19, Tailwind 4, shadcn/radix, framer-motion | [`dashboard/app/`](dashboard/app/) |
| Auth | Clerk (`@clerk/nextjs` 7). Identity only. Teams live in Convex. | [`dashboard/proxy.ts`](dashboard/proxy.ts), [`convex/clerkWebhook.ts`](dashboard/convex/clerkWebhook.ts) |
| Backend / DB | Convex (queries, mutations, actions, crons, file storage, HTTP routes) | [`convex/schema.ts`](dashboard/convex/schema.ts), [`convex/http.ts`](dashboard/convex/http.ts) |
| Voice agent "Sarah" | ElevenLabs Conversational AI, model `eleven_v3_conversational`, server tools that call Convex HTTP routes | [`convex/agents.ts`](dashboard/convex/agents.ts), [`convex/elevenLabsApi.ts`](dashboard/convex/elevenLabsApi.ts) |
| Calendar | Google Calendar OAuth. AES-GCM-encrypted refresh tokens. | [`convex/googleApi.ts`](dashboard/convex/googleApi.ts), [`convex/googleCalendar.ts`](dashboard/convex/googleCalendar.ts) |
| SMS | Twilio | [`convex/twilioApi.ts`](dashboard/convex/twilioApi.ts), [`convex/notifications.ts`](dashboard/convex/notifications.ts) |
| Email | Resend | [`convex/resendApi.ts`](dashboard/convex/resendApi.ts) |
| Address lookup | Google Places API (New), called server-side only | [`convex/placesApi.ts`](dashboard/convex/placesApi.ts) |
| Deployment model | **Single-tenant.** The first account creates the team and becomes `admin`. Everyone after joins as `member`. | [`convex/team.ts:331`](dashboard/convex/team.ts#L331) |

### 2.2 Current routes

| Route | Sidebar | What it is |
|---|---|---|
| `/` | n/a | Public landing page (`components/landing/`) |
| `/simplr-landing`, `/simplr-landing/demo` | n/a | Marketing site for simplr.pro (host rewrite in `proxy.ts`) |
| `/sign-in`, `/sign-up`, `/sso-callback`, `/accept-invite` | n/a | Auth flows |
| `/privacy`, `/terms` | n/a | Legal pages (needed for Google OAuth verification) |
| `/dashboard` | ✅ Dashboard | Greeting, 3 stat cards (New Leads, Calls Handled, Tours Booked), Recent Leads, Today's Schedule, My Tasks |
| `/call` | ✅ Call | In-browser test call with Sarah |
| `/leads` | ✅ Customers → Leads | Leasing calls, filters, transcript, qualification, conversion funnel |
| `/tenants` | ✅ Customers → Tenants | Resident calls logged by `log_tenant_issue`, 1 to 10 severity, open/resolved, override severity |
| `/docs` | ✅ Knowledge → Knowledge | Knowledge base docs synced to ElevenLabs RAG |
| `/property` | ✅ Knowledge → Property | **One** property profile, address, move-in window, pets flag, **unit types** (bedrooms, rent min/max, available), CSV import |
| `/tasks` | ✅ Productivity → Tasks | Team to-dos (todo / in_progress / completed, priority, category, due date, tags, attachments) |
| `/calendar` | ✅ Productivity → Calendar | Week/month view, Google busy times, tours booked by Sarah, tour hours |
| `/screening` | ✅ Screening | 5 built-in leasing questions (toggle) + custom screening questions with optional criteria |
| `/team` | ✅ Team | Team name, invite, members, team time zone, tour readiness per member |
| `/settings` | 🙈 | Agent prompt, first message, voice, staff phone number, lead scoring, WhatsApp prompt, severity scale |
| `/messages` | 🙈 | SMS threads (Twilio) |
| `/whatsapp` | 🙈 | WhatsApp bot via WAHA |

### 2.3 Current data model (tables in [`schema.ts`](dashboard/convex/schema.ts))

`users`, `organizations`, `memberships` (role: `admin` | `member`), `invites`, `googleCalendarConnections`, `googleOAuthStates`, `tourAvailability`, `tourTimeChecks`, `tours`, `agents`, `conversations`, `messages`, `docs`, `tasks`, `taskAttachments`, `usage`, `threads`, `debugWebhookLogs`, `smsMessages`, `orgSettings`, `properties`, `callRatings`, `qualifications`, `screeningQuestions`, `screeningBuiltins`, `tenantIssues`, `waConfig`, `waSession`, `waThreads`, `waMessages`, `waLeads`, `waIssues`.

### 2.4 Current Sarah tools (ElevenLabs server tools, served by [`convex/http.ts`](dashboard/convex/http.ts))

| Tool | HTTP route | Purpose |
|---|---|---|
| `check_availability` | `/tools/check-availability` | Rent/availability/pets lookup from the property row |
| `check_qualification` | `/tools/check-qualification` | Applies rules in `qualifyRules.ts` and **returns qualified/disqualified** |
| `find_tour_times` | `/tools/find-tour-times` | Free slots across **all team members** with connected calendars |
| `request_tour` | `/tools/request-tour` | Books into Google Calendar |
| `find_my_tour` / `cancel_tour` / `reschedule_tour` | `/tools/...` | Manage an existing tour |
| `escalate` | `/tools/escalate` | Marks the conversation escalated. **The staff SMS is commented out** (`http.ts` around line 742). |
| `log_tenant_issue` | `/tools/log-tenant-issue` | Writes/updates a `tenantIssues` row (name, unit as free text, callback, reason, category, severity 1 to 10) |
| `end_call` | built-in | Hang up |

### 2.5 Facts that drive the plan

- **The prompt is hard-coded to "Maple Court Apartments"** ([`agents.ts:78`](dashboard/convex/agents.ts#L78), [`agents.ts:212`](dashboard/convex/agents.ts#L212)).
- **There are no real units.** `properties.units` is a list of *unit types* (bedrooms, rent range, available). There is no unit number, address per unit, or asset manager.
- **Only one property per team** (`properties.by_org` → `.first()`).
- **There is no residents/tenants directory.** `tenantIssues.unit` is free text spoken on the call.
- **Roles are only `admin` and `member`.** There is no Pat, Asset Manager, Technician or Accountant.
- **Tasks have no assignee**, no unit link and no lifecycle beyond 3 statuses.
- **There is no audit log** anywhere.
- **Nothing exists for Stripe, payments, owners or owner statements.**
- **Tours:** 45 min + 15 min buffer, 30 min slot step, 120 min minimum lead time ([`tourSchedule.ts`](dashboard/convex/tourSchedule.ts)). Pooled team-wide over members with a connected Google Calendar.
- **Severity:** generic 1 to 10 rubric in [`severity.ts`](dashboard/convex/severity.ts), rendered both into the prompt and on the Tenants page.
- **Life-safety block** in [`residentTriage.ts`](dashboard/convex/residentTriage.ts) tells *every* emergency caller to "get out and call 911". This conflicts with Pat's flooding and slight-gas scripts (see §4).
- **File storage already works** (Convex `_storage`, used by `taskAttachments` and docs import). Reuse it for photos and receipts.

---

## 📊 3. Gap matrix: PRD vs current code

| # | PRD requirement | Today | Action | Badge |
|---|---|---|---|---|
| 1 | Dashboard / workspace | `/dashboard` (leasing-centric) | Add maintenance + work-order cards | 🟡 UPDATE |
| 2 | Sarah phone call handling, transcripts | Works | Reuse | 🟢 EXISTING |
| 3 | Lead capture and qualification | Works, but auto-disqualifies | Add 518 questions; switch to capture-and-flag | 🟡 UPDATE |
| 4 | Configurable screening questions | `/screening` | Extend into full Sarah Configuration | 🟡 UPDATE |
| 5 | Tour / calendar | Works, team-wide pool | Restrict to approved asset-manager calendars (decision) | 🟡 UPDATE |
| 6 | Basic tasks | `/tasks` | Add assignee + links; keep separate from work orders | 🟡 UPDATE |
| 7 | Property context / knowledge | `/property` (one property), `/docs` | Multi-property + real units | 🔴 NEW BUILD |
| 8 | Team access | admin/member | Six job roles + scoped access | 🔴 NEW BUILD |
| 9 | Unit → designated asset manager (first-class) | ❌ | `units.assetManagerUserId` + history | 🔴 NEW BUILD |
| 10 | Exception queue (no unit match / no AM) | ❌ | New queue | 🔴 NEW BUILD |
| 11 | Maintenance request intake record | `tenantIssues` (partial) | New `maintenanceRequests` table | 🔴 NEW BUILD |
| 12 | Asset Manager inbox and review actions | ❌ | New pages | 🔴 NEW BUILD |
| 13 | Handoff to Pat + validated-request queue | ❌ | New page | 🔴 NEW BUILD |
| 14 | Formal work orders + lifecycle | ❌ | New table + pages | 🔴 NEW BUILD |
| 15 | Technician mobile workflow | ❌ | New mobile pages | 🔴 NEW BUILD |
| 16 | Photos / receipts / hours / expenses | Storage only | New tables + UI | 🔴 NEW BUILD |
| 17 | Technician notifications (SMS/push) | Twilio SMS util exists | New notification service | 🔴 + 🟣 |
| 18 | High-severity alerts to Pat + contacts | Escalation SMS disabled | Re-enable via configurable contacts | 🟡 + ⏳ |
| 19 | Severity matrix + approved emergency scripts | Generic rubric + generic 911 block | Configurable per-incident scripts | 🔴 + ⏳ |
| 20 | Audit history | ❌ | `auditEvents` table + timeline UI | 🔴 NEW BUILD |
| 21 | Duplicate-request prevention | Per-call dedupe only | Cross-call duplicate check | 🔴 NEW BUILD |
| 22 | Failed/uncertain calls visible | `status: failed`, `intent: unclear` exist but are not surfaced | "Needs follow-up" queue | 🟡 UPDATE |
| 23 | Stripe tenant payments | ❌ | New | 🔴 + 🟣 + ⏳ |
| 24 | ROS owner statement | ❌ | New | 🔴 + ⏳ |
| 25 | 24/7 + 5 concurrent calls | Unknown | Confirm ElevenLabs plan concurrency + phone number setup | 🟣 VERIFY |
| 26 | Owner-prospect routing to Alex | ❌ | New intent + notification | 🔴 NEW BUILD |
| 27 | Buildium CSV pilot import | CSV import of unit types only | New unit/resident CSV importer | 🔴 NEW BUILD |

---

## ⚠️ 4. Conflicts and contradictions to resolve before build lock

> [!WARNING]
> Each item below is a place where the two client documents disagree with each other, or with the current code. Get a written answer from Alex/Pat on each. Do not guess.

| # | Topic | Source A | Source B / current code | Recommended default until answered |
|---|---|---|---|---|
| C1 | **Tour calendars** | PRD §7: "Schedule tours against valid **asset-manager** calendars" | Sarah Config §1: "using the **team's** calendar availability". Code: whole team pool. | Pool only members whose job role includes `asset_manager` *and* who opted into tours. |
| C2 | **Owner phone menu** (Press 1 Pat … Press 6 Alyssa) | Sarah Config §13 | PRD §7: "Do not include a general 'press zero to reach Pat' escape route unless Alex/Pat explicitly approve" | Build the routing directory as data, **disabled** until approved. |
| C3 | **Flooding script** | Sarah Config §4: "Move to a safe place … call **518-365-0996**" | Code `LIFE_SAFETY_BLOCK`: "get out and call 911" for everything | Replace the generic block with per-incident scripts (§8.3). Pat signs off. |
| C4 | **Slight gas odor, no hissing** | Sarah Config §4: "Leave and contact the applicable **utility provider**" | Code: "call 911" | Same as C3. Needs the utility provider number per property. |
| C5 | **Electrical troubleshooting** | Sarah Config §2: ask whether the breaker/GFI was checked | Code prompt: "Never try to troubleshoot a repair yourself" and "never ask them to check or do anything in the unit" | Allow exactly this one approved question, only for non-emergency electrical calls. |
| C6 | **Water leak: "put a bucket under it"** | Sarah Config §2 | Code: never ask them to do anything in the unit | Allow as an approved instruction for non-emergency leaks only. |
| C7 | **Lightbulbs, blinds, trash** | Sarah Config §2: tenant responsibility, not replaced | Code rubric: "burnt-out bulb" scored 3–4 Routine and logged as a repair | Add a "tenant responsibility" category. Sarah explains the policy (Pat-approved wording) and logs it as *closed: out of scope*. |
| C8 | **Auto-disqualifying leads** | PRD §17: no automatic approval/rejection of tenants without human review | Code: `check_qualification` returns qualified/disqualified and Sarah tells the caller | Switch 518 to **capture-and-flag**: answers stored, staff decide. Sarah never says "you don't qualify". |
| C9 | **Resident FAQs** (rent/late fees, portal login, applying, eviction, non-renewal, work-order status, renewal, vendor payment) | Sarah Config §5–12: scripted flows | PRD §7: not automatically part of the pilot | Build the call-type framework so each flow is a **toggle**. Ship only Pat-approved flows enabled. |
| C10 | **Neighbor disputes** | Sarah Config §2: direct to local law enforcement | Not in PRD | Add as a call type, disabled until wording is approved. |
| C11 | **Maintenance "pets" + "convenient time to meet a technician"** | Sarah Config §2 basic questions | PRD §6.2 lists pets only "when relevant" | Ask both on every maintenance call (they help technician entry). Confirm with Pat. |
| C12 | **Multiple work orders per request** | PRD §6.4: default one; confirm | n/a | Model allows many (`workOrders.requestId` is not unique); UI creates one by default. |
| C13 | **Sarah prompt says "Simplr"/"Maple Court"** | n/a | Hard-coded in `agents.ts` | Brand to "518 Property Pro" / "Property Pro Rentals". Confirm the exact name Sarah says. |

---

## 🧱 5. Foundation work (before any page)

These are shared building blocks. Several pages depend on each one, so build them first, in this order.

### F1 🔴 Job roles

**Why:** PRD §4 defines Alex, Pat, Asset Manager, Technician, Accountant and Simplr Admin. Today there is only `admin`/`member`.

**Design:** keep `memberships.role` (`admin` | `member`) for *team administration* (invite/remove/rename), which already works. Add a separate **`jobRoles`** array, because one person can hold several roles (Pat may also be an asset manager).

```ts
// schema.ts → memberships
jobRoles: v.optional(v.array(v.union(
  v.literal("executive"),          // Alex
  v.literal("maintenance_lead"),   // Pat
  v.literal("asset_manager"),
  v.literal("technician"),
  v.literal("accountant"),
  v.literal("simplr_admin"),
))),
phone: v.optional(v.string()),               // E.164, for SMS
notifyBy: v.optional(v.array(v.union(v.literal("sms"), v.literal("email"), v.literal("push")))),
unavailableUntil: v.optional(v.number()),    // out-of-office flag for AM fallback
```

**Steps**
1. Add the fields as `v.optional` (the widen step; no migration needed to deploy).
2. Add helpers in [`authz.ts`](dashboard/convex/authz.ts): `hasJobRole(org, role)`, `requireJobRole(ctx, ...roles)`. Treat `simplr_admin` as satisfying every check.
3. Backfill: existing `admin` members get `["simplr_admin"]`. Everyone else gets `[]` until assigned on the Team page.
4. Update `sidebar` visibility (`adminOnly` → `roles?: JobRole[]`) in [`app-sidebar.tsx`](dashboard/components/app-sidebar.tsx).
5. **Server-side checks are the boundary.** Hiding a nav item is courtesy only (the code already follows this rule; keep it).

### F2 🔴 Properties and units (first-class)

**Why:** PRD §5 and §8 require a real unit with a number and a designated asset manager. Today only unit *types* exist, under one property.

```ts
properties: defineTable({
  orgId: v.string(),
  name: v.string(),                         // "Property Pro Rentals – 12 Lark St"
  address: propertyAddressValidator,
  ownerId: v.optional(v.id("owners")),      // for ROS
  utilityGasPhone: v.optional(v.string()),  // for the slight-gas-odor script (C4)
  isPilot: v.boolean(),
  petsAllowed: v.boolean(),
  notes: v.optional(v.string()),
  updatedAt: v.number(),
}).index("by_org", ["orgId"]),

units: defineTable({
  orgId: v.string(),
  propertyId: v.id("properties"),
  unitNumber: v.string(),                   // normalized: "4B", "2", "Rear"
  unitNumberKey: v.string(),                // lowercased, spaces/#/“apt” stripped, for matching
  floor: v.optional(v.number()),
  isTopFloor: v.optional(v.boolean()),      // drives the roof/leak script
  bedrooms: v.string(),                     // "studio" | "1br" | "2br" | "3br+"
  bathrooms: v.optional(v.number()),
  parking: v.optional(v.string()),
  rent: v.optional(v.number()),
  available: v.boolean(),                   // Sarah offers ONLY when true
  availableFrom: v.optional(v.string()),
  leasingFacts: v.optional(v.string()),
  assetManagerUserId: v.optional(v.id("users")), // REQUIRED to activate maintenance intake
  maintenanceIntakeActive: v.boolean(),     // false until an AM is assigned
  updatedAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_property", ["propertyId"])
  .index("by_property_and_unit_key", ["propertyId", "unitNumberKey"])
  .index("by_asset_manager", ["assetManagerUserId"]),
```

**Rules (PRD §5)**
- `maintenanceIntakeActive` **cannot** be set to `true` while `assetManagerUserId` is empty. Enforce this in the mutation, not only the UI.
- Every change to `assetManagerUserId` writes an `auditEvents` row (who, when, old → new).
- Unassigning an AM sets `maintenanceIntakeActive = false` automatically and adds the unit to the missing-assignment report.

**Migration of existing data**
1. Keep the old `properties.units` array readable during the transition (widen).
2. Write `properties.migrateToUnits` (internal mutation): for each old unit-type row, create nothing automatically. Unit types are not units. Instead, show a banner on the new Properties page asking the admin to import the real unit list (F2 is replaced by real data, not converted).
3. Point `check_availability` and `qualifyRules` at the `units` table.
4. Once nothing reads `properties.units`, remove it from the schema (narrow).

### F3 🔴 Residents (tenant directory)

**Why:** PRD §6.1 says "Use known tenant/unit data to prefill or confirm information". This needs a resident record to match the caller ID against.

```ts
residents: defineTable({
  orgId: v.string(),
  unitId: v.id("units"),
  fullName: v.string(),
  phones: v.array(v.string()),   // E.164, normalized
  email: v.optional(v.string()),
  leaseEnd: v.optional(v.string()),
  active: v.boolean(),
  source: v.union(v.literal("manual"), v.literal("buildium_csv")),
  updatedAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_unit", ["unitId"])
  .index("by_phone", ["phones"]),  // note: array index matches whole array. Use a separate residentPhones table if lookup by single phone is needed.
```

> [!TIP]
> Convex cannot index individual array elements. Add a tiny `residentPhones { orgId, residentId, phone }` table with `by_org_and_phone` so a caller-ID lookup is a single indexed read.

### F4 🔴 Maintenance requests (intake record, separate from work orders)

**Why:** PRD §6.3: "Keep the intake request separate from a formal work order. No formal work order exists until the required human decision."

```ts
maintenanceRequests: defineTable({
  orgId: v.string(),
  number: v.number(),                         // human-friendly MR-1042
  source: v.union(v.literal("phone"), v.literal("manual")),
  elevenLabsConversationId: v.optional(v.string()),
  conversationId: v.optional(v.id("conversations")),

  // Caller and location
  callerName: v.optional(v.string()),
  callerNumber: v.optional(v.string()),       // telephony caller ID (trusted)
  callbackNumber: v.optional(v.string()),     // spoken (may be misheard)
  spokenAddress: v.optional(v.string()),
  spokenUnit: v.optional(v.string()),
  residentId: v.optional(v.id("residents")),
  propertyId: v.optional(v.id("properties")),
  unitId: v.optional(v.id("units")),
  matchConfidence: v.union(v.literal("exact"), v.literal("caller_id"), v.literal("none")),

  // Issue
  issueType: v.string(),                      // electrical | water_leak | broken_item | gas | fire | flooding | tenant_responsibility | other
  description: v.string(),
  firstNoticed: v.optional(v.string()),
  answers: v.array(v.object({ key: v.string(), question: v.string(), value: v.string() })),
  pets: v.optional(v.string()),
  preferredAccessTimes: v.optional(v.string()),
  severity: v.union(v.literal("emergency"), v.literal("urgent"), v.literal("routine"), v.literal("informational")),
  severityScore: v.optional(v.number()),      // keep 1-10 for continuity with tenantIssues
  severityReason: v.optional(v.string()),
  originalSeverity: v.optional(v.string()),
  mediaRequested: v.boolean(),

  // Routing
  assignedAssetManagerUserId: v.optional(v.id("users")),
  routeReason: v.optional(v.string()),        // "unit AM", "exception: no unit match", "exception: AM unavailable"
  inExceptionQueue: v.boolean(),

  status: v.union(
    v.literal("new"),
    v.literal("under_review"),
    v.literal("more_info_needed"),
    v.literal("forwarded_to_pat"),
    v.literal("work_order_created"),
    v.literal("closed_out_of_scope"),
    v.literal("closed_duplicate"),
  ),
  closeReason: v.optional(v.string()),
  possibleDuplicateOf: v.optional(v.id("maintenanceRequests")),
  nextAction: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_org_and_status", ["orgId", "status"])
  .index("by_assigned_am_and_status", ["assignedAssetManagerUserId", "status"])
  .index("by_unit_and_created", ["unitId", "createdAt"])
  .index("by_exception", ["orgId", "inExceptionQueue"])
  .index("by_conversation", ["elevenLabsConversationId"]),

maintenanceMedia: defineTable({
  orgId: v.string(),
  requestId: v.id("maintenanceRequests"),
  storageId: v.id("_storage"),
  kind: v.union(v.literal("photo"), v.literal("video")),
  uploadedBy: v.union(v.literal("tenant"), v.literal("staff")),
  createdAt: v.number(),
}).index("by_request", ["requestId"]),
```

**Routing function (single source of truth): `routing.routeRequest(requestId)`**
1. Match the unit: `propertyId` + `unitNumberKey` exact match → `matchConfidence: "exact"`. Otherwise use a caller-ID → `residentPhones` → unit match → `"caller_id"`, but **only if** the spoken unit doesn't contradict it. Otherwise `"none"`.
2. If `"none"`: `inExceptionQueue = true`, `routeReason = "no unit match"`. **Never guess** (PRD §5).
3. If the unit has no AM, or `maintenanceIntakeActive = false`: exception queue, `routeReason = "unit has no asset manager"`.
4. If the AM has `unavailableUntil > now`: keep `assignedAssetManagerUserId` = that AM (**do not reassign**), set `routeReason = "AM unavailable"`, and flag Pat + admins (PRD §5: "flag/escalate … do not silently reassign").
5. Otherwise assign to the unit's AM.
6. Write an `auditEvents` row for the routing decision.

**Duplicate check (PRD §11):** on create, look up open requests for the same `unitId` with the same `issueType` in the last 72 h (tunable). If found, set `possibleDuplicateOf` and show a banner. **Do not auto-merge.** A human decides.

### F5 🔴 Work orders

```ts
workOrders: defineTable({
  orgId: v.string(),
  number: v.number(),                         // WO-2051
  requestId: v.optional(v.id("maintenanceRequests")), // absent for manual WOs
  unitId: v.id("units"),
  propertyId: v.id("properties"),
  title: v.string(),
  scope: v.string(),                          // what the work is
  priority: v.union(v.literal("emergency"), v.literal("urgent"), v.literal("routine")),
  checklist: v.array(v.object({
    id: v.string(), label: v.string(), required: v.boolean(),
    done: v.boolean(), doneAt: v.optional(v.number()), doneBy: v.optional(v.id("users")),
  })),
  technicianUserId: v.optional(v.id("users")),
  accessNotes: v.optional(v.string()),        // pets, preferred times, entry permission
  requiredOnSubmit: v.object({                // PRD §6.5 "required fields configurable"
    photos: v.boolean(), hours: v.boolean(), receipts: v.boolean(), notes: v.boolean(),
  }),
  status: v.union(
    v.literal("created"),
    v.literal("assigned"),
    v.literal("in_progress"),
    v.literal("completed"),       // technician submitted
    v.literal("reviewed_closed"), // Pat reviewed
    v.literal("cancelled"),
  ),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  closedAt: v.optional(v.number()),
})
  .index("by_org_and_status", ["orgId", "status"])
  .index("by_technician_and_status", ["technicianUserId", "status"])
  .index("by_request", ["requestId"])
  .index("by_unit", ["unitId"]),

workOrderFiles: defineTable({
  orgId: v.string(), workOrderId: v.id("workOrders"), unitId: v.id("units"),
  storageId: v.id("_storage"),
  kind: v.union(v.literal("completion_photo"), v.literal("receipt"), v.literal("other")),
  uploadedByUserId: v.id("users"), createdAt: v.number(),
}).index("by_work_order", ["workOrderId"]),

workOrderTime: defineTable({
  orgId: v.string(), workOrderId: v.id("workOrders"), technicianUserId: v.id("users"),
  date: v.string(), hours: v.number(), note: v.optional(v.string()), createdAt: v.number(),
}).index("by_work_order", ["workOrderId"]),

workOrderExpenses: defineTable({
  orgId: v.string(), workOrderId: v.id("workOrders"), technicianUserId: v.id("users"),
  kind: v.union(v.literal("material"), v.literal("expense")),
  description: v.string(), amountCents: v.number(), quantity: v.optional(v.number()),
  receiptFileId: v.optional(v.id("workOrderFiles")),
  reimbursable: v.optional(v.boolean()),
  createdAt: v.number(),
}).index("by_work_order", ["workOrderId"]),

workOrderNotes: defineTable({
  orgId: v.string(), workOrderId: v.id("workOrders"), authorUserId: v.id("users"),
  body: v.string(), createdAt: v.number(),
}).index("by_work_order", ["workOrderId"]),
```

> [!IMPORTANT]
> Store money as **integer cents**. Never use floats. This matters for ROS totals later.

**Lifecycle (PRD §6.4, combined across both records)**

```
Request:  New → Under Review → (More Information Needed ↺) → Forwarded to Pat → Work Order Created
                                     ↘ Closed: out of scope / duplicate
Work order:  Created → Assigned → In Progress → Completed → Reviewed/Closed
                                                   ↘ (Pat sends back) → In Progress
```

Allowed transitions are enforced in **one** server function per record (`assertTransition(from, to, actorRoles)`). The UI only offers buttons the server would accept.

### F6 🔴 Audit log

```ts
auditEvents: defineTable({
  orgId: v.string(),
  entity: v.union(v.literal("request"), v.literal("work_order"), v.literal("unit"),
                  v.literal("payment"), v.literal("ros"), v.literal("config"), v.literal("membership")),
  entityId: v.string(),
  action: v.string(),              // "routed", "validated", "info_requested", "forwarded", "wo_created", "assigned", "checklist_checked", "submitted", "closed", "am_changed", ...
  actorUserId: v.optional(v.id("users")),   // absent = Sarah/system
  actorLabel: v.string(),          // "Sarah", "System", or the person's name at that time
  from: v.optional(v.string()),
  to: v.optional(v.string()),
  note: v.optional(v.string()),
  at: v.number(),
}).index("by_entity", ["entity", "entityId", "at"])
  .index("by_org_and_at", ["orgId", "at"]),
```

- Write audit rows **inside the same mutation** as the change, so a change never exists without its history.
- Audit rows are append-only. No update/delete mutation is exported.

### F7 🔴 Notification service

One internal action, `notify.send({ toUserIds | toPhones, template, data, channel })`. It reads each member's `notifyBy` and `phone`, sends SMS via the existing [`twilioApi.sendSms`](dashboard/convex/twilioApi.ts), and logs a `notificationLog` row (sent / failed / error text). See §9 for the events.

### F8 🔴 Public token pages (no login)

Needed for (a) tenant photo/video upload after a call, and (b) the tenant payment page.

```ts
publicLinks: defineTable({
  orgId: v.string(),
  purpose: v.union(v.literal("maintenance_media"), v.literal("payment")),
  tokenHash: v.string(),           // SHA-256, same pattern as invites.tokenHash
  targetId: v.string(),            // maintenanceRequests id or payment id
  expiresAt: v.number(),
  usedAt: v.optional(v.number()),
  createdAt: v.number(),
}).index("by_token_hash", ["tokenHash"]),
```

- Store only the hash, never the raw token (the existing `invites` pattern).
- Expire media links after 72 h. Payment links follow the agreed Stripe flow.
- Add the routes to `PUBLIC_ROUTE_PREFIXES` in [`lib/public-routes.ts`](dashboard/lib/public-routes.ts).
- Validate uploads server-side: allow only image/* and video/*, enforce a size cap (for example 50 MB video, 10 MB image), and limit the file count per link.

### F9 🔴 Sarah configuration as data

See §8 and page P17. New tables: `callTypes`, `callTypeQuestions`, `approvedResponses`, `severityRules`, `emergencyScripts`, `escalationContacts`, `routingDirectory`. The prompt is **composed** from these at save time (same pattern as the current `composePrompt` in [`agents.ts:261`](dashboard/convex/agents.ts#L261)).

---

## 🧭 6. New navigation map

```
📊 Dashboard                    /dashboard                 🟡 everyone (cards vary by role)
📞 Test call                    /call                      🟢 admin, Pat, Alex
🔧 Maintenance  ▾
    📥 My inbox                 /maintenance               🔴 asset_manager (own units)
    ⚠️ Exceptions               /maintenance/exceptions    🔴 Pat, admin
    ✅ Validated queue          /work-orders/queue         🔴 Pat
    🧰 Work orders              /work-orders               🔴 Pat, AM (own units), Alex, accountant (read)
👷 My jobs                      /tech                      🔴 technician (mobile-first)
👥 Customers  ▾
    🎯 Leads                    /leads                     🟡
    🏠 Residents                /residents                 🔴
    📋 Resident calls           /tenants                   🟡 (non-maintenance calls)
🏢 Properties & units           /properties                🔴 (replaces /property)
📅 Calendar                     /calendar                  🟡
✔️ Tasks                        /tasks                     🟡
💳 Payments                     /payments                  🔴 ⏳ accountant, Alex, admin
📄 Owner statements (ROS)       /owner-statements          🔴 ⏳ accountant, Alex, admin
🤖 Sarah configuration          /sarah                     🔴 (replaces /screening) admin, Pat
📚 Knowledge                    /docs                      🔵
👤 Team                         /team                      🟡
🕵️ Audit log                    /audit                     🔴 admin, Alex
```

**Public, no login:** `/m/[token]` (tenant media upload), `/pay/[token]` (tenant payment).
**Hidden (keep, not linked):** `/settings`, `/messages`, `/whatsapp`.

**Mobile bottom nav** ([`app-sidebar.tsx`](dashboard/components/app-sidebar.tsx) `BOTTOM_NAV_LINKS`): make it role-aware. Technicians get **My jobs** only. Asset managers get **Inbox · Work orders · Dashboard**.

---

## 🗂️ 7. Page-by-page plan

---

### P1 · Sign-in / Sign-up / SSO / Accept invite

**Route:** `/sign-in`, `/sign-up`, `/sso-callback`, `/accept-invite` · **Status:** 🟢 EXISTING + 🔵 CONFIGURE · **Who:** everyone

**Today:** custom Clerk forms ([`sign-in-form.tsx`](dashboard/components/sign-in-form.tsx), [`sign-up-form.tsx`](dashboard/components/sign-up-form.tsx)), Google SSO, invite tokens hashed in `invites`. After sign-in, users land on `/call` ([`lib/auth-navigate.ts`](dashboard/lib/auth-navigate.ts)).

**Change / Add**
- 🔵 Branding: logo, name "518 Property Pro" or "Simplr for 518 Property Pro" (confirm).
- 🟡 Post-login destination by role: technician → `/tech`; asset manager → `/maintenance`; everyone else → `/dashboard`. Today it is always `/call`, which is wrong for 518 users.
- 🟡 Invite form: choose **job roles** and phone number at invite time, not just admin/member.
- 🔵 Clerk Dashboard: production instance, `518` domain/subdomain, redirect URLs, Google social connection with the correct redirect URI.
- 🟣 Technicians may not have Google accounts. Confirm email+password or SMS OTP is enabled in Clerk.

**Steps**
1. Update `afterAuthDestination()` to take the role into account (fetch `team.overview` after finalize, or redirect from `/dashboard` by role).
2. Extend `team.invite` args with `jobRoles` and `phone`. Store them on the invite and copy them onto the membership in `redeemInvite`.
3. Branding pass on [`auth-shell.tsx`](dashboard/components/auth-shell.tsx).

**Done when:** a technician invited by email signs up on a phone and lands on `/tech` with only their jobs visible.

---

### P2 · Operations Dashboard

**Route:** `/dashboard` · **Status:** 🟡 UPDATE · **Who:** everyone (content varies by role)

**Today** ([`app/dashboard/page.tsx`](dashboard/app/dashboard/page.tsx), [`convex/dashboard.ts`](dashboard/convex/dashboard.ts)): greeting, stat cards **New Leads / Calls Handled / Tours Booked** (week over week), **Recent Leads**, **Today's Schedule** (tours), **My Tasks**. One query, one round trip.

**Change / Add** (PRD §12: "calls, maintenance requests, active/completed work orders and leasing activity")
- 🔴 Stat cards row 2: **Open maintenance requests**, **Emergencies (24h)**, **Work orders in progress**, **Completed this week**.
- 🔴 Card **"Needs attention"**: exception-queue count, requests waiting more than X hours in `new`, failed calls, `intent: unclear` calls, work orders past due.
- 🔴 Card **"Recent maintenance"**: last 5 requests with severity badge and status.
- 🔴 Card **"Failed / uncertain calls"**: `conversations.status = failed` or `intent = unclear`, each with a "Mark followed up" action (PRD §11).
- 🟡 Role-specific views:
  - **Asset Manager:** only their units' numbers, plus their inbox count.
  - **Technician:** redirect to `/tech`; dashboard not shown.
  - **Accountant:** completed work orders this month, expense total, ROS status (once built).
  - **Alex/Pat/admin:** everything.
- 🟢 Keep leasing cards (leads, tours) for leasing-capable roles.
- 🔵 Copy: "Here's what's happening with your properties today" is fine.

**Data and backend**
- Extend `dashboard.overview` with a `maintenance` section. Use the indexes `by_org_and_status` on requests and work orders. **Do not** full-scan.
- Add `conversations.needsFollowUp` (failed or unclear, not yet followed up). Add `followedUpAt`/`followedUpBy` to `conversations`.

**Steps**
1. Backend: add the maintenance and follow-up sections to `dashboard.overview`, scoped by role (AM → `by_assigned_am_and_status`).
2. UI: add a second `StatCard` row and the two new cards. Reuse `Card`, `CardHeader`, `EmptyState`, `StatCard` from the same file.
3. Add the "Mark followed up" mutation with an audit row.

**Done when:** Pat opens the dashboard and sees today's emergencies, items stuck in review, and failed calls, without opening another page.

---

### P3 · Test call

**Route:** `/call` · **Status:** 🟢 EXISTING + 🔵 CONFIGURE · **Who:** admin, Pat, Alex

**Today:** browser call with the team's agent ([`app/call/page.tsx`](dashboard/app/call/page.tsx)), live waveform, `conversations.start`.

**Change / Add**
- 🔵 After Sarah config changes (§8), this is the **testing harness** for scripts. Keep it.
- 🟡 Add a "Simulate caller ID" field so caller-ID resident matching can be tested from the browser (pass as an ElevenLabs dynamic variable override for test sessions only, admin-only).
- 🟡 Show which tools fired during the call in a side panel (helps Pat verify scripts during sign-off).
- 🔵 Hide from technicians and accountants (role-based nav).

**Done when:** Pat can run each scenario in §14 from the browser before real phone tests.

---

### P4 · Leads

**Route:** `/leads` · **Status:** 🟡 UPDATE · **Who:** Alex, Pat, asset managers, admin

**Today** ([`app/leads/page.tsx`](dashboard/app/leads/page.tsx)): call list with intent/outcome filters, search, monthly lead stats, conversion funnel, expandable transcript, qualification fields (Bedrooms, Move-in, Budget, Pets, Name, Phone, Tour slot).

**Change / Add** (PRD §7, Sarah Config §1)
- 🔵 New captured fields in the detail panel: **Third-party payer (yes/no)**, **payer name / phone / email**, **Preferred communities**, **Communities to avoid**, **Pet type and count**, **Other info**. Implement as screening questions (data) so no schema change is needed for most of them (P17).
- 🔴 **"Owner prospect"** flag and filter: callers who want 518 to *manage their property*. Badge "→ Alex", and a notification to Alex (PRD §7).
- 🟡 **Remove the hard "Disqualified" decision for 518 (C8).** Keep the captured answers. Replace the badge with **"Matches criteria" / "Review needed"**, computed for staff only. Sarah does not tell the caller.
- 🟡 Status workflow for staff: New → Contacted → Tour booked → Application sent → Closed (manual dropdown + audit).
- 🟡 Show **which unit** the caller was offered (link to the unit, P14) once availability is unit-level.
- 🟢 Keep transcript, funnel and search.

**Data and backend**
- `qualifications`: add `ownerProspect: v.optional(v.boolean())`, `ownerProspectNotes`, `staffStatus`.
- New tool or extended `escalate` reason `owner_prospect` (§8.2).
- `qualifyRules.ts`: add an org-level setting `qualificationMode: "decide" | "capture_only"`. In `capture_only` mode, `check_qualification` returns availability facts but never `qualifies: false` to the agent.

**Steps**
1. Add the setting and the capture-only branch in `/tools/check-qualification` ([`http.ts:176`](dashboard/convex/http.ts#L176)).
2. Add the 518 leasing questions on `/sarah` (P17) as data.
3. Add the owner-prospect field, filter and notification.
4. Update the detail panel to render all `screeningAnswers` generically (it partly does today).

**Done when:** a test caller answers all 8 of Pat's questions. All answers appear on the lead. No caller is told they don't qualify. An owner prospect shows a "→ Alex" badge and Alex gets an SMS.

**Blocked by:** ⏳ final question list and answer options (§13 item 1).

---

### P5 · Resident calls (current "Tenants")

**Route:** `/tenants` (rename label to **Resident calls**) · **Status:** 🟡 UPDATE · **Who:** Pat, Alex, admin, AMs (own units)

**Today** ([`app/tenants/page.tsx`](dashboard/app/tenants/page.tsx), [`convex/tenants.ts`](dashboard/convex/tenants.ts)): every resident call logged by `log_tenant_issue`, sorted by severity, with stat cards (Open, High severity, Resolved), filters, expandable transcript, severity override, and resolve/delete.

**Decision:** maintenance calls move to the new **Maintenance** pages (P6 to P9). This page keeps **non-maintenance resident calls**: rent/late-fee questions, portal login, application questions, non-renewal notices, renewal requests, work-order status checks, vendor payment questions, neighbor disputes, and anything unclear.

**Change / Add**
- 🟡 Filter by **call type** (from P17 call types) instead of free-text category.
- 🟡 Each row gets a **"Route to"** action (pick a staff member) and an **owner** column. Today rows have no owner.
- 🟡 Link to the matched **resident** and **unit** when known.
- 🟡 **Remove delete** for non-admins. Deleting a resident call destroys audit history (PRD §11). Replace with "Close with reason".
- 🟡 Severity override stays, but writes an audit row.
- 🟢 Keep transcript expansion.

**Data and backend**
- Add `callType`, `unitId`, `residentId`, `ownerUserId`, `closedReason` to `tenantIssues` (all optional).
- `log_tenant_issue` stays for non-maintenance calls. Maintenance goes through the new `log_maintenance_request` tool (§8.2).

**Steps**
1. Add the fields (optional) and backfill nothing (old rows stay readable).
2. Change `removeIssue` to admin-only. Add `closeIssue(reason)`.
3. Update the page: call-type filter, owner column, Route-to action.

**Done when:** a portal-login call appears here (not in Maintenance), is routed to the office person, and is closed with a reason that shows in the audit log.

---

### P6 · Maintenance inbox (Asset Manager)

**Route:** `/maintenance` · **Status:** 🔴 NEW BUILD · **Who:** asset managers (own units only). Pat/admin can switch "View as AM" (read-only).

**Purpose** (PRD §6.3): each AM sees **only** requests for units where they are the designated AM.

**Layout**
- Header: "Maintenance inbox". Counters: **New · More info needed · Forwarded · Closed (7d)**.
- Tabs: **New** (default) · **Waiting on tenant** · **Forwarded to Pat** · **Closed**.
- Row: severity badge (🔴 Emergency / 🟠 Urgent / 🟡 Routine / ⚪ Info), MR number, property + unit, issue type, one-line description, caller name, time since created, media icon if photos exist, ⚠️ "possible duplicate" chip.
- Sort: severity first, then oldest first (an untouched emergency must never sink).
- Empty state: "No requests for your units 🎉".
- Mobile-friendly: AMs may check from a phone.

**Data and backend**
- `maintenance.inbox({ tab })`: requires the `asset_manager` role and reads `by_assigned_am_and_status` for the **current user only**. The server ignores any client-supplied AM id unless the caller is Pat/admin.
- Live updates via Convex reactivity (new calls appear without refresh).

**Steps**
1. Build F1, F2 and F4 first.
2. Query + page + row component.
3. Add an unread indicator (the `firstViewedAt` field on the request, set when the detail opens).
4. Add the sidebar entry with a count badge.

**Done when:** AM A cannot see AM B's request, by UI or by calling the query directly with B's id (test it).

---

### P7 · Maintenance request detail (review actions)

**Route:** `/maintenance/[id]` · **Status:** 🔴 NEW BUILD · **Who:** the assigned AM, Pat, Alex, admin

**Sections**
1. **Header:** MR number, severity (editable with reason → audit), status pill, unit + property link, assigned AM.
2. **Caller:** name, caller ID (trusted), callback number (spoken), matched resident (with a "not this person?" fix), pets, preferred access times.
3. **Issue:** issue type, description, first noticed, every structured answer (for example *floor 3, kitchen ceiling, unit above: yes, actively flowing: no*).
4. **Media:** tenant photos/videos (from `/m/[token]`), plus staff upload.
5. **Call:** Sarah's summary, full transcript (reuse the Leads/Tenants transcript component), call duration, link to the conversation.
6. **Timeline:** every `auditEvents` row for this request.
7. **Duplicate banner** if `possibleDuplicateOf` is set: "Possible duplicate of MR-1039 (same unit, 2h ago)", with **Mark duplicate** / **Not a duplicate**.

**Actions (PRD §6.3)** — each is a server mutation with role check, transition check and audit row:

| Button | From status | To status | Required input | Side effects |
|---|---|---|---|---|
| ✅ **Validate** | new, under_review, more_info_needed | under_review (validated flag) | optional note | n/a |
| 📷 **Request more info / photo / video** | new, under_review | more_info_needed | what is needed (text) | Optionally SMS the tenant a `/m/[token]` upload link (template approved by Pat) |
| 🚫 **Close: not our responsibility** | new, under_review, more_info_needed | closed_out_of_scope | **reason required** (pick list + free text) | Optional SMS to tenant with approved wording |
| ➡️ **Forward to Pat** | under_review (validated) | forwarded_to_pat | optional note | Notify Pat (§9) |
| 🔁 **Mark duplicate** | any open | closed_duplicate | link to the original | n/a |
| ✏️ **Fix unit** | any open | (re-route) | pick property + unit | Re-runs routing. If the AM changes, the request moves to the new AM's inbox. |

> [!IMPORTANT]
> **No work order is created on this page.** Forwarding to Pat is the only path toward a work order from an AM (PRD §6.3/§6.4). The one exception is a manual work order (P10), which authorized humans can always create.

**Steps**
1. Shared transcript component: extract it from `leads`/`tenants` into `components/transcript.tsx`.
2. Detail query: request + unit + property + resident + media + audit, with a permission check.
3. Action mutations with `assertTransition`.
4. Tenant SMS templates are stored in `approvedResponses` (P17). Disabled until Pat approves the wording.

**Done when:** every action above works, each one leaves a timeline entry with actor, time and note, and the AM cannot open a request for someone else's unit.

**Blocked by:** ⏳ out-of-scope reason list; ⏳ tenant SMS wording.

---

### P8 · Exception queue

**Route:** `/maintenance/exceptions` · **Status:** 🔴 NEW BUILD · **Who:** Pat, admin (Alex read-only)

**Purpose** (PRD §5): requests that could not be routed safely.

**Reasons shown**
- ❓ **No unit match**: the spoken address/unit was not found and caller ID did not match.
- 🧑‍💼 **Unit has no asset manager**.
- 🏖️ **Assigned AM unavailable** (out-of-office): stays assigned, flagged here as well.
- ⛔ **Unit not active for maintenance intake**.

**Actions**
- **Resolve unit** → pick property + unit → re-route (audit).
- **Assign AM to unit** (shortcut to P14, permission-checked) → re-route.
- **Approve temporary fallback** for an unavailable AM: forward to a named person *for this request only* (audit note required). Applies only after Alex/Pat define a fallback rule (PRD §5). Until then, Pat handles it directly.

**Done when:** a call for "unit 99 at an unknown address" lands here and nowhere else, and Pat can resolve it to a real unit, after which it appears in the correct AM's inbox.

---

### P9 · Pat's validated-request queue

**Route:** `/work-orders/queue` · **Status:** 🔴 NEW BUILD · **Who:** Pat (maintenance_lead), admin

**Purpose** (PRD §6.4): everything AMs forwarded, plus emergencies.

**Layout**
- Columns: severity, MR number, unit/property, issue, forwarded by (AM), forwarded at, AM's note, media count.
- Pinned at the top: 🔴 **Emergencies** (severity emergency/urgent), even before forwarding. PRD §6.4: "High-severity cases alert Pat and configured escalation contacts."
- Row click opens the request detail (P7) in a side panel. Pat sees all context without leaving the queue.

**Actions per row**
- 🧰 **Create work order** → opens P10 pre-filled.
- ↩️ **Send back to AM** (with note) → status `under_review` (audit).
- 🚫 **Close: no work order needed** (reason required).

**Done when:** a forwarded request appears here within seconds, and Pat can turn it into a work order in under a minute.

---

### P10 · Work-order create / assign form

**Route:** `/work-orders/new?request=[id]` (or a modal on P9) · **Status:** 🔴 NEW BUILD · **Who:** Pat, asset managers (manual creation), admin

**Fields**
| Field | Prefill from request | Required |
|---|---|---|
| Unit / property | ✅ | ✅ |
| Title | issue type + short description | ✅ |
| Scope of work | description + structured answers | ✅ |
| Priority | mapped from severity | ✅ |
| Checklist items | from a **checklist template** for the issue type (P17) | ≥ 1 |
| Technician | dropdown of `technician` members | optional at create (status `created`); setting it moves status to `assigned` |
| Access notes | pets, preferred times, entry permission | optional |
| Required on submit | photos / hours / receipts / notes toggles (defaults from config) | ✅ |
| Due date | n/a | optional |

**Manual creation (PRD §6.4: "AI is not the only creation path")**
- "New work order" button on `/work-orders` with no request → `requestId` absent, `source: manual`.
- Asset managers can create manual work orders **only for their own units**.

**Server rules**
- Creating from a request sets the request status to `work_order_created`, in the **same mutation**.
- Assigning a technician sends a notification (§9).
- Default: one work order per request. A "Create another" link is allowed (C12).

**Done when:** Pat creates and assigns a work order from a forwarded request, and the technician's phone gets an SMS with a link.

**Blocked by:** ⏳ the real work-order example with checklist fields (§13 item 8).

---

### P11 · Work orders list

**Route:** `/work-orders` · **Status:** 🔴 NEW BUILD · **Who:** Pat, Alex, admin (all), AMs (own units), accountant (read, completed only)

**Layout**
- Filters: status, technician, property, priority, date range. Search by WO number or unit.
- Views: **Table** (desktop) and **Board** by status (Created · Assigned · In progress · Completed · Closed).
- Row: WO number, unit, title, technician, priority, status, last update, hours total, expenses total.
- Export CSV (feeds the ROS until the ROS is built).

**Done when:** filters work, AMs only see their units, and the accountant sees completed and closed work orders with costs.

---

### P12 · Work-order detail

**Route:** `/work-orders/[id]` · **Status:** 🔴 NEW BUILD · **Who:** Pat, Alex, admin, the unit's AM, the assigned technician (via `/tech` view), accountant (read)

**Sections** (PRD §12: "checklist, technician, photos, receipts, hours, expenses, notes and status")
1. Header: WO number, status, priority, unit/property, technician (reassign → notify), linked MR.
2. **Checklist** with who checked each item and when.
3. **Completion photos** gallery.
4. **Receipts** gallery, each linked to an expense line.
5. **Hours** table + total.
6. **Materials / expenses** table + total (cents → $).
7. **Notes** thread.
8. **Timeline** (audit).

**Pat's actions**
- ✅ **Review and close** (only from `completed`) → `reviewed_closed`.
- ↩️ **Send back to technician** with a note → `in_progress` + notify.
- ✏️ Edit scope/checklist (audit). Changing scope on an assigned WO notifies the technician (PRD §6.5: "materially changed").
- ❌ Cancel (reason required).

**Done when:** Pat can see every piece of evidence and the full history for a WO on one page (PRD §13 acceptance criterion 6).

---

### P13 · Technician mobile app

**Routes:** `/tech` (job list), `/tech/jobs/[id]` (job detail) · **Status:** 🔴 NEW BUILD · **Who:** technicians (assigned jobs only)

> [!IMPORTANT]
> Design for a phone first: 360–430 px wide, large tap targets (≥ 44 px), one primary action per screen, works on a weak signal. Must **not** use the desktop sidebar. Use a dedicated minimal layout.

**`/tech`: job list**
- Tabs: **Today / Open** · **Done**.
- Card: priority colour bar, address + unit (tap → opens Google Maps directions), title, access notes preview (pets!), due date, status.
- Pull-to-refresh is not needed (Convex is live), but show "updated just now".

**`/tech/jobs/[id]`: job detail**
1. Address (maps link), unit, tenant first name + **callback number** (tap to call), pets, preferred times, access notes.
2. Scope of work.
3. **Start job** button → `in_progress`.
4. **Checklist:** big checkboxes. Each tap saves immediately ("Save progress", PRD §6.5).
5. **Add photos:** uses `<input type="file" accept="image/*" capture="environment" multiple>` for the camera. Compress client-side before upload (for example max 1600 px, JPEG 0.8) to save mobile data.
6. **Add receipt:** photo + amount + description → creates an expense line linked to the receipt file.
7. **Hours:** date + hours (0.25 steps).
8. **Materials / expenses:** description, quantity, amount.
9. **Notes**.
10. **Submit as completed:** disabled until the configured required fields are present. Show exactly what is missing ("Add at least 1 completion photo").

**Server rules**
- Every query/mutation checks `workOrder.technicianUserId === me`. Otherwise "not found" (do not leak existence).
- Uploads: `generateUploadUrl` (role-checked) → `attachFile(workOrderId, storageId, kind)`. Verify the content type and size server-side via `ctx.storage.getMetadata`.
- Files stay linked to WO + unit + technician (PRD §6.5).

**Offline (nice to have, not pilot-critical):** queue checklist ticks locally and retry. Photos require a connection. Show a clear error with retry if an upload fails.

**🟣 VERIFY:** test on a real iPhone (Safari) and Android (Chrome): camera capture, upload of 3–5 photos on LTE, and the login session staying alive.

**Done when:** PRD §13 acceptance criterion 5 passes on a real phone.

---

### P14 · Properties and units

**Route:** `/properties`, `/properties/[id]` (replaces `/property`) · **Status:** 🔴 NEW BUILD (rework of 🟡 `/property`) · **Who:** admin, Pat, Alex (edit); AMs (read, plus availability edit if allowed)

**Today** ([`app/property/page.tsx`](dashboard/app/property/page.tsx), [`convex/properties.ts`](dashboard/convex/properties.ts)): **one** property: name, Google Places address, pets allowed, move-in window, a **unit-type** table (bedrooms, rent min/max, available), and CSV import of unit types. Saving also regenerates a knowledge doc "Property details (auto-generated)" ([`docs.ts:16`](dashboard/convex/docs.ts#L16)).

**`/properties`: list**
- Table: property name, address, units count, available count, **units missing AM** (red count), pilot flag.
- Buttons: **Add property**, **Import CSV** (Buildium export, PRD §8), **Missing-assignment report**.

**`/properties/[id]`: detail**
- Profile: name, address (reuse the Places autocomplete), owner (for ROS), gas utility phone (C4), pets policy, notes, **pilot** toggle.
- **Units table:** unit number, floor, top floor ✓, beds, baths, parking, rent, **available** toggle, available from, **Asset manager** (dropdown of `asset_manager` members), **Maintenance intake** toggle (locked off without an AM, with a tooltip explaining why), residents count.
- Bulk actions: assign AM to selected units, mark available/unavailable.
- Each unit row expands to show its **residents** (P15) and **AM change history** (from audit).

**Missing-assignment report** (PRD §8): every unit with `assetManagerUserId` empty or intake off, grouped by property, exportable to CSV.

**CSV import**
- Columns (proposed; confirm against the real Buildium export): `property_name, property_address, unit_number, floor, bedrooms, bathrooms, parking, rent, available, available_from, asset_manager_email, resident_name, resident_phone, resident_email, lease_end`.
- **Dry-run first:** show rows to create/update/skip with errors (unknown AM email, duplicate unit, bad phone). Then confirm.
- Import only `isPilot` properties if a filter is set (PRD §8: pilot only).
- Idempotent: re-importing updates by `(property, unitNumberKey)` and never duplicates.

**Availability → Sarah (PRD §8: "an unavailable unit must immediately stop being offered")**
- `check_availability` reads `units` live on every call. There is no cache, so a toggle takes effect on the next tool call.
- Regenerate the auto knowledge doc on change (existing `syncPropertyDoc` pattern), **but** availability must come from the tool, never from RAG text, because RAG indexing is asynchronous and can lag. Remove availability from the auto doc to avoid stale answers.

**Steps**
1. F2 schema + mutations with the AM rule enforced server-side.
2. List page, detail page, units table.
3. CSV import with dry run.
4. Missing-assignment report.
5. Point `check_availability` / `check_qualification` at `units`.
6. Redirect `/property` → `/properties`.

**Done when:** a unit cannot be activated for maintenance without an AM (try it via the UI and via a direct mutation call); changing an AM is recorded with who and when; marking a unit unavailable stops Sarah offering it on the next call.

**Blocked by:** ⏳ pilot property/unit list; ⏳ unit → AM assignments; ⏳ Buildium export sample.

---

### P15 · Residents

**Route:** `/residents` · **Status:** 🔴 NEW BUILD · **Who:** admin, Pat, Alex, AMs (own units), accountant (read)

**Purpose:** a caller-ID match for prefill (PRD §6.1), and the payments tenant list later.

- Table: name, property/unit, phones, email, lease end, active.
- Add/edit/deactivate (audit). CSV import shares the P14 importer.
- Detail: the resident's maintenance requests, resident calls and payments.

**Privacy:** phone/email are PII. Show them only to roles that need them (§10). Do not include them in Sarah's knowledge base.

**Done when:** a call from a known resident's number prefills their name and unit on the request, and Sarah *confirms* rather than assumes ("Am I speaking with Maria in 4B?").

---

### P16 · Calendar

**Route:** `/calendar` · **Status:** 🟡 UPDATE · **Who:** Alex, Pat, AMs; admin

**Today** ([`app/calendar/page.tsx`](dashboard/app/calendar/page.tsx), [`convex/calendarView.ts`](dashboard/convex/calendarView.ts)): week/month view, "Whose calendar" picker, Google busy blocks, tours booked by Sarah, outside-tour-hours shading, tour detail with the lead's Looking for / Budget / Move-in, cancel tour, personal tour hours editor and days off.

**Change / Add**
- 🟡 **Tour pool restricted by role (C1):** in `tours.bookingContext` ([`tours.ts:354`](dashboard/convex/tours.ts#L354)), include only members with job role `asset_manager` (or whatever Pat approves). Today it includes every member with a connected calendar.
- 🟡 Optionally restrict tours per property → only that property's AMs (if Pat wants the AM of the unit shown to give the tour).
- 🔵 Tour duration/buffer/lead time: today `45 / 15 / 120 min` are constants in [`tourSchedule.ts`](dashboard/convex/tourSchedule.ts). Move them to org settings, editable on `/sarah` → Leasing (PRD §7: "agreed duration/buffer rules").
- 🔵 Cancellation/rescheduling rules: today Sarah can cancel/reschedule (`cancel_tour`, `reschedule_tour`). Confirm the rule (for example no changes within 2 h).
- 🔴 Optional: show scheduled work-order due dates on the calendar for Pat (a separate colour). Nice to have.
- 🔵 **Google OAuth app must leave Testing mode.** In Testing, refresh tokens expire after 7 days, so every AM's calendar disconnects weekly (`invalidAt` handling exists, but it is a bad pilot experience). Submit for verification, or move to a Workspace internal app if 518 uses Google Workspace.

**Done when:** Sarah only offers slots from approved AMs' calendars, never double-books (already enforced by `reserve`, re-test), and respects the configured duration/buffer.

**Blocked by:** ⏳ AM calendars, tour duration, buffers, windows, cancellation rules (§13 item 6).

---

### P17 · Sarah configuration (replaces Screening)

**Route:** `/sarah` (old `/screening` redirects here) · **Status:** 🔴 NEW BUILD (extends 🟡 [`components/screening-questions.tsx`](dashboard/components/screening-questions.tsx)) · **Who:** admin, Pat (edit); Alex (read)

**Today:** `/screening` has 5 built-in leasing questions with on/off toggles ([`coreQuestions.ts`](dashboard/convex/coreQuestions.ts)) and custom screening questions with an answer kind (yes/no, number, choice, text) and an optional criterion. Saving pushes the prompt to ElevenLabs (`agents.pushScreening`). The agent prompt itself is only editable on hidden `/settings`.

**Tabs**

**1. Call types** (Sarah Config §14: "Which call types Sarah handles", "Which call flows are enabled for the pilot")

| Call type | Default for pilot | Source |
|---|---|---|
| Leasing inquiry | ✅ on | PRD §7 |
| Owner prospect (wants 518 to manage) | ✅ on | PRD §7 |
| Maintenance: general | ✅ on | PRD §6 |
| Maintenance: electrical | ✅ on | Sarah Config §2 |
| Maintenance: water leak | ✅ on | Sarah Config §2 |
| Maintenance: broken item | ✅ on | Sarah Config §2 |
| Maintenance: tenant-responsibility items | ⏳ off until wording approved | Sarah Config §2 |
| Emergency: fire / flooding / gas | ✅ on **only after Pat sign-off** | Sarah Config §4 |
| Neighbor dispute | ⏳ off | Sarah Config §2 |
| Rent due / late fees | ⏳ off | Sarah Config §5 |
| Portal login | ⏳ off | Sarah Config §6 |
| Applying for an apartment | ⏳ off | Sarah Config §7 |
| Eviction notice / late rent | ⏳ off (legal) | Sarah Config §8 |
| Lease non-renewal | ⏳ off | Sarah Config §9 |
| Work-order status | ⏳ off until the lookup tool exists | Sarah Config §10 |
| Lease renewal | ⏳ off | Sarah Config §11 |
| Vendor payment status | ⏳ off (needs Delia's contact) | Sarah Config §12 |
| Owner call routing menu | ⏳ off (C2) | Sarah Config §13 |

Each call type has: **enabled** toggle, **trigger description** (how Sarah recognizes it), **ordered questions**, **approved response wording**, **what to do when info is missing or a lookup fails**, **routing target** (person or role), and **sign-off** (who approved, when; enabling is blocked without sign-off for emergency/legal types).

**2. Questions per call type** (Sarah Config §14: questions, order, required/optional, conditional follow-ups)
- Reuse the `screeningQuestions` editor UI. Generalize it: `callTypeId`, `required`, `order`, `condition` (for example *ask only if issueType = water_leak and location ∈ {bathroom, kitchen}*), `answerKind`.
- Prefill with Pat's lists:
  - **Leasing:** bedrooms; monthly budget; third-party payer (y/n) → payer name, phone, email; preferred communities / communities to avoid (Capital Region); pets (y/n) → type and number; move-in date; other info.
  - **Maintenance basics:** name; apartment address; unit number; issue; when first noticed/reported; pets (type, count); convenient time to meet a technician.
  - **Electrical:** "Did you check your breaker box or the GFI outlet to see if a breaker has tripped?" (only when relevant and safe).
  - **Water leak:** floor; exact location; apartment above or top floor; if bathroom/kitchen, is a bathroom/kitchen directly above; actively flowing; request photo/video; ask them to put a bucket under it; if top floor and rain/storm/snow, explain the roof assessment may wait.
  - **Broken item:** what is broken; exact location; how long; photo.

**3. Severity matrix** (PRD §6.1/§6.4, §14)
- Table: level (Emergency / Urgent / Routine / Informational), **definition**, **examples**, **who is notified**, **how** (SMS/call), **response-time target**.
- Replaces the hard-coded `SEVERITY_RUBRIC` ([`severity.ts`](dashboard/convex/severity.ts)). Keep the 1 to 10 score internally if wanted, but map it to these named levels.
- Pre-filled draft from the current rubric, marked **DRAFT – needs Pat's approval**.

**4. Emergency scripts** (Sarah Config §4)
- One script per incident: **Fire** (leave the building, call 911), **Flooding** (move away from water, call 518-365-0996), **Gas + hissing** (leave, call 911, warn other tenants from outside), **Slight gas, no hissing** (leave, call the utility; number per property).
- Each script has: exact wording, phone numbers (validated format), **approved by / approved at**. Sarah reads phone numbers **only from this table**, never from memory (Sarah Config: "must not guess emergency contact details").
- Unapproved scripts fall back to the safest generic line ("leave the building and call 911") **and** escalation.

**5. Escalation contacts**
- Ordered list per severity level: person (member) or external number, channel, hours (24/7 or business hours).
- Test button: "Send test alert" (logs the result).

**6. Routing directory** (Sarah Config §13; disabled per C2)
- Name → phone/extension → hours → fallback. Pat Fiore, Alex Buell, Nikki, Nina, Delia (Accounting), Alyssa. Numbers ⏳.

**7. Leasing settings**
- Tour duration, buffer, slot step, minimum lead time (moved from constants).
- `qualificationMode`: capture only (default for 518, per C8).
- Tour pool: which roles/people give tours.

**8. Greeting and identity**
- First message (replaces the hard-coded "Thanks for calling Maple Court Apartments…"), company name, Sarah's persona notes.
- 🟣 "Never mention AI unless asked" stays (existing rule).

**Save → publish flow**
1. Edits save as a **draft**.
2. **Preview prompt** shows the composed system prompt.
3. **Publish** recomposes the prompt (extending `composePrompt`) and pushes it to ElevenLabs (existing `pushScreening` / `saveAgent` path), records a version (who/when) in `auditEvents`.
4. **Rollback** to the previous published version.

**Done when:** Pat can change a question's wording, publish, and hear the new wording on the next test call, without a developer.

**Blocked by:** ⏳ items 1, 2, 4 in §13.

---

### P18 · Knowledge

**Route:** `/docs` · **Status:** 🔵 CONFIGURE · **Who:** admin, Pat

**Today** ([`app/docs/page.tsx`](dashboard/app/docs/page.tsx), [`convex/docs.ts`](dashboard/convex/docs.ts)): docs with title/body, file upload (PDF/DOCX extraction via `pdf-parse`/`mammoth`), sync state Queued → Indexing → Live/Failed into ElevenLabs RAG.

**Change / Add**
- 🔵 Replace the demo/template docs (cloned by `docs.cloneDefaultsForOrg`) with 518 content: office address and hours, payment methods (only once Pat confirms), application instructions (518propertypro.com → yellow "View" tab, **confirm still current**), pet policy, parking, community descriptions for the Capital Region.
- 🟡 **Never** put availability, emergency numbers or legal wording in RAG docs. Those must come from tools or approved scripts so they cannot go stale or be paraphrased.
- 🔵 Add a "Last reviewed by / on" field per doc (lightweight).

**Done when:** every doc is 518-specific and nothing from "Maple Court" remains.

---

### P19 · Team

**Route:** `/team` · **Status:** 🟡 UPDATE · **Who:** everyone (read); admin (edit)

**Today** ([`app/team/page.tsx`](dashboard/app/team/page.tsx), [`convex/team.ts`](dashboard/convex/team.ts)): team name, invite by email (admin/member), member list with tour status ("Bookable for tours", "Not taking tours", "Google Calendar not connected", "needs to reconnect", "waiting on the team time zone"), team time zone (admin only), remove member, revoke invite.

**Change / Add**
- 🔴 **Job roles** column with multi-select (F1). Edits are audited.
- 🔴 **Phone number** (E.164, validated) and **notification preferences** per member (SMS/email/push).
- 🔴 **Out of office** (`unavailableUntil`) for asset managers. It drives the routing flag (F4 step 4).
- 🔴 **Units assigned** count per AM, linking to a filtered P14.
- 🟡 Guard: removing an AM who still owns units is **blocked** until their units are reassigned (otherwise units silently lose their AM). Show which units.
- 🔵 Set the **team time zone** to `America/New_York` (Capital Region, NY). The screenshot shows it is unset, so Sarah cannot book tours yet.
- 🔵 Make sure the first operator is `admin`. If the deployment already had a team, promote the account in the Convex `memberships` table.

**Done when:** an admin can invite Pat as `maintenance_lead` with a phone number, mark an AM out of office, and is prevented from removing an AM who still owns units.

---

### P20 · Tasks

**Route:** `/tasks` · **Status:** 🟡 UPDATE · **Who:** all office roles

**Today** ([`app/tasks/page.tsx`](dashboard/app/tasks/page.tsx), [`convex/tasks.ts`](dashboard/convex/tasks.ts)): team to-dos grouped In Progress / Todo / Completed, priority, category, due date, tags, rich description, file attachments. **No assignee.**

**Decision (PRD §18: reuse vs separate):** work orders are a **separate** model (F5). The task model lacks technician scoping, a checklist, evidence, hours, expenses and a lifecycle, and bending it would break the existing page. Tasks stay as general office to-dos.

**Change / Add**
- 🟡 **Assignee** (`assigneeUserId`) and a "My tasks / All tasks" filter. The dashboard "My Tasks" card then actually means *mine*.
- 🟡 Optional links: `unitId`, `requestId`, `workOrderId` (for follow-ups like "call tenant back").
- 🟡 Hide from technicians (they use `/tech`).

**Done when:** a task can be assigned to a person and appears on their dashboard.

---

### P21 · Payments (staff) and tenant payment page

**Routes:** `/payments` (staff), `/pay/[token]` (tenant, public) · **Status:** 🔴 NEW BUILD + 🟣 VERIFY + ⏳ BLOCKED · **Who:** accountant, Alex, admin; tenant via link

> [!CAUTION]
> PRD §9 says this is **not** an existing feature to switch on, and Simplr must **not** be represented as able to replace Buildium until the full flow is validated. Do not start building until the funds-flow decision below is made in writing.

**Decisions required first (PRD §9, §18)**
1. Stripe account owner: 518's own account (simplest, **recommended**) vs Stripe Connect under Simplr.
2. Payment methods: card, ACH (US bank, cheaper for rent), or both. Who pays fees (pass-through or absorbed)?
3. **Source of truth for amount due:** Buildium ledger (manual entry or CSV) vs Simplr. PRD: Stripe alone does not replace the ledger.
4. Partial payments allowed? Late fee ($50 after day 5, per Sarah Config §5) added automatically or manually?
5. Refunds, failed ACH returns, disputes/chargebacks: who handles them and how are they shown?
6. How staff confirm settlement / reconcile (payout report vs per-payment).

**Minimum pilot (if approved)**
- Staff create a **payment request** for a resident: amount (cents), period, description → generates `/pay/[token]`, sent by SMS/email.
- Tenant page: 518 branding, amount, **Stripe Checkout** (hosted, so no card data touches Simplr), success/cancel pages.
- **Webhook** `/webhooks/stripe` (Convex HTTP route): verify the signature, handle `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`. **Idempotent** on the Stripe event id.
- Staff list: status (pending / succeeded / failed / refunded / disputed), resident, unit, amount, Stripe reference, date; filter + CSV export for reconciliation.
- Audit row for every status change.

```ts
payments: defineTable({
  orgId: v.string(), residentId: v.id("residents"), unitId: v.id("units"),
  amountCents: v.number(), currency: v.literal("usd"), period: v.optional(v.string()),
  description: v.string(),
  status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed"),
                  v.literal("refunded"), v.literal("disputed"), v.literal("cancelled")),
  stripeCheckoutSessionId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  createdBy: v.id("users"), createdAt: v.number(), updatedAt: v.number(),
}).index("by_org_and_status", ["orgId", "status"]).index("by_resident", ["residentId"]),
stripeEvents: defineTable({ eventId: v.string(), type: v.string(), processedAt: v.number() })
  .index("by_event_id", ["eventId"]),
```

**Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` live only in Convex env. **Test mode first** (PRD §9). Alex, Pat and the accountant approve before live keys.

**Done when:** PRD §13 criterion 9 passes in test mode: success, failure (`4000 0000 0000 0002`), pending/ACH, refund, and the staff reconciliation view matches the Stripe dashboard.

---

### P22 · Owner statements (ROS)

**Routes:** `/owner-statements`, `/owner-statements/[id]` · **Status:** 🔴 NEW BUILD + ⏳ BLOCKED · **Who:** accountant, Alex, admin

> [!WARNING]
> PRD §10: the actual ROS example, field definitions, formulas and delivery method are required **before** finalizing. Until then, build only the *assembly workflow*, not automatic totals.

**Minimum workflow**
1. **Owners** table (name, email, properties owned, management fee %).
2. Each month (target around the 10th, PRD §10), **Generate drafts** creates one statement per owner per month.
3. The draft auto-fills the **maintenance section** from work orders closed in that period for the owner's properties: description, work completed, hours, materials, expenses.
4. Financial lines (rent collected, property expenses, management earnings, owner bottom line): **manual entry** in the pilot, or from payments if P21 is live. Formulas apply only once the client confirms them.
5. The accountant reviews and edits, then marks it **Final** (locked, audit).
6. Export PDF / send email (delivery method ⏳).

**Done when:** a draft for one owner shows every closed work order for their units in the month with hours and costs, the accountant can finalize it, and the export matches the client's template.

**Blocked by:** ⏳ the real ROS, field definitions, formulas, delivery format (§13 item 9).

---

### P23 · Audit log

**Route:** `/audit` · **Status:** 🔴 NEW BUILD · **Who:** admin, Alex

- Filter by entity (request, work order, unit, payment, config, membership), actor, date range, action.
- Row: time, actor, action, entity link, from → to, note.
- CSV export.
- Per-record timelines (P7, P12, P14) read from the same table.

---

### P24 · Agent settings (hidden)

**Route:** `/settings` · **Status:** 🙈 + 🟡 UPDATE · **Who:** admin only

**Today** ([`app/settings/page.tsx`](dashboard/app/settings/page.tsx)): raw system prompt, first message, voice, staff phone number (used by the call-summary SMS), lead scoring, WhatsApp prompt, severity scale. Linked nowhere.

**Change / Add**
- 🟡 Make it **admin-only server-side** (today any signed-in member reaching the URL can see the agent prompt; check `agents.saveAgent` for a role check and add one).
- 🟡 After P17 exists, the raw prompt editor becomes an **advanced / emergency override** with a warning, because P17 recomposes the prompt on publish and would overwrite manual edits.
- 🔵 Staff phone number → superseded by escalation contacts (P17 tab 5).

---

### P25 · Messages / WhatsApp (hidden)

**Routes:** `/messages`, `/whatsapp` · **Status:** 🙈 ⚫ OUT for this release · **Who:** none

PRD §6.1: phone is the **only** intake channel. Keep these routes hidden. Make sure no WhatsApp/SMS bot auto-replies on 518's numbers. Confirm the Twilio and WAHA webhooks are **not** pointed at the 518 deployment, or disable them.

---

### P26 · Public tenant media upload

**Route:** `/m/[token]` · **Status:** 🔴 NEW BUILD · **Who:** tenant (no login)

- Triggered by Sarah ("I'll text you a link to send a photo") or by an AM ("Request photo" in P7).
- Page: 518 branding, "Upload photos or a short video of the issue at **Unit 4B**", camera capture, upload progress, "Thanks, we've got it".
- Shows **no** other tenant data (only the unit label).
- Token rules in F8. Rate-limit uploads per token.
- Each upload creates `maintenanceMedia` + an audit row and notifies the AM ("New photo on MR-1042").

**🟣 VERIFY:** SMS deliverability from the Twilio number (A2P 10DLC registration is required in the US for application-to-person SMS; unregistered traffic gets filtered).

---

### P27 · Landing / marketing pages

**Routes:** `/`, `/simplr-landing`, `/privacy`, `/terms` · **Status:** 🟢 EXISTING · **Who:** public

- No 518 functional change.
- 🔵 `/privacy` and `/terms` must exist and be reachable for Google OAuth verification (already public).
- 🔵 If 518 gets its own subdomain, decide what `/` shows there (probably redirect to `/sign-in`).

---

## 🤖 8. Sarah (voice agent) changes

### 8.1 Prompt rewrite 🟡

| Area | Today | Change |
|---|---|---|
| Identity | "Sarah, the leasing receptionist for Maple Court Apartments" | Company name from config (P17 tab 8) |
| Scope | Leasing + generic resident triage | Call-type driven: only enabled types are rendered into the prompt |
| Emergency block | One generic "get out, call 911" | Per-incident approved scripts with numbers from config (C3, C4) |
| Troubleshooting ban | Absolute | Exceptions: the approved breaker/GFI question and the bucket instruction (C5, C6) |
| Qualification | Sarah announces qualify/disqualify | Capture only; never tell a caller they don't qualify (C8) |
| Severity | 1 to 10 rubric in the prompt | Named levels from the severity matrix (P17 tab 3) |
| Tenant-responsibility items | Logged as routine repairs | Approved policy wording, logged as closed out of scope (C7) |
| "Do not discuss lease terms" | Absolute | Stays for all disabled call types; enabled types follow their approved wording only |
| Diagnosis | "Never troubleshoot" | Keep: "Sarah must not diagnose an issue or make commitments beyond approved scripts" (PRD §6.1) |
| Legal | n/a | Never give legal advice, never promise a payment plan or deposit outcome (Sarah Config §8, §9) |

### 8.2 Tools

| Tool | Status | Route | Notes |
|---|---|---|---|
| `lookup_caller` | 🔴 | `/tools/lookup-caller` | Input: `system__caller_id`. Returns the matched resident's first name + unit (for **confirming**, not assuming) or "no match". Called at the start of resident calls. Returns no other PII. |
| `find_unit` | 🔴 | `/tools/find-unit` | Input: spoken address + unit. Returns `matched: true/false` and the canonical unit label. Never returns another tenant's data. |
| `log_maintenance_request` | 🔴 | `/tools/log-maintenance-request` | Replaces `log_tenant_issue` for maintenance. Upserts by conversation id (same safety pattern as today). Takes issue type, description, answers, severity level, pets, access times, first noticed. Runs routing (F4). |
| `send_photo_link` | 🔴 | `/tools/send-photo-link` | Creates a `/m/[token]` link and texts it to the callback number. Only after the caller agrees. |
| `check_work_order_status` | 🔴 ⏳ | `/tools/work-order-status` | Requires a matched unit + name. Returns the recorded status in plain words. Never invents one (Sarah Config §10). Off until approved. |
| `route_owner_prospect` | 🔴 | `/tools/owner-prospect` | Captures name/phone/property details → notifies Alex. |
| `log_tenant_issue` | 🟡 | existing | Kept for non-maintenance resident calls, with `call_type` added. |
| `escalate` | 🟡 | existing | **Re-enable notifications** via the notification service (F7) to configured escalation contacts. Today the SMS is commented out ([`http.ts`](dashboard/convex/http.ts) `/tools/escalate`). |
| `check_availability` | 🟡 | existing | Read from `units`, filter `available = true`. Never offer an unavailable unit (PRD §7). |
| `check_qualification` | 🟡 | existing | Capture-only mode (C8). |
| `find_tour_times` / `request_tour` / … | 🟡 | existing | Tour pool by role (C1); durations from config. |

> [!IMPORTANT]
> **Tool registration.** Tools are matched by URL in `agents.ensureTools` ([`agents.ts:677`](dashboard/convex/agents.ts#L677)) so each Convex deployment owns its own copies. Keep that rule for the new tools. Use a **separate ElevenLabs workspace or agent** for the 518 production deployment so dev never writes into 518's live data.

### 8.3 Emergency handling order (proposed, pending Pat's sign-off)

1. Detect the emergency type (fire / flooding / gas with hissing / slight gas / other life-safety).
2. Say the **approved script for that type** immediately, with numbers read from config.
3. `log_maintenance_request` with severity **emergency** right away, even with no name/unit (keep the existing "log first" safety behaviour).
4. Ask once for name, address/unit and callback number.
5. `escalate` → notifies emergency contacts (SMS; consider an automated **voice call** for emergencies after hours, 🟣).
6. Update the request with full details.
7. End the call quickly so the caller can contact emergency services. Never send them back inside.

### 8.4 Telephony and capacity 🟣

- **24/7 and 5 concurrent calls (PRD §3, §18):** confirm the ElevenLabs plan's concurrency limit and that the 518 phone number (Twilio import or ElevenLabs-native) is attached to the 518 agent.
- **Load test:** 5 simultaneous test calls with no busy signal and correct records for all 5.
- **Call forwarding:** how 518's existing office line reaches Sarah (always, after hours only, or on no-answer). Client decision.
- **Monthly minute usage:** a commented-out `MONTHLY_LIMIT_SEC` exists in [`conversations.ts:13`](dashboard/convex/conversations.ts#L13). Confirm the minute budget behind the $600/month price.

---

## 🔔 9. Notifications

| Event | Recipient | Channel | Status |
|---|---|---|---|
| New maintenance request (routine) | Assigned AM | In-app badge (+ optional daily SMS digest) | 🔴 |
| New request **urgent/emergency** | Assigned AM + Pat + severity-level escalation contacts | SMS immediately | 🔴 ⏳ |
| Request in exception queue | Pat (+ admin) | SMS + in-app | 🔴 |
| AM unavailable for a request | Pat (+ admin) | SMS | 🔴 |
| Tenant uploaded media | Assigned AM | In-app | 🔴 |
| Request forwarded to Pat | Pat | In-app (+ SMS if urgent) | 🔴 |
| Work order assigned / reassigned / materially changed | Technician | **SMS** with link to `/tech/jobs/[id]` (push later) | 🔴 🟣 |
| Work order submitted as completed | Pat | In-app | 🔴 |
| Work order sent back | Technician | SMS | 🔴 |
| Owner prospect | Alex | SMS + in-app | 🔴 |
| Tour booked | AM giving the tour | Google Calendar event (existing) | 🟢 |
| Tour confirmation to prospect | Prospect | SMS (`sendTourConfirmation`, existing) | 🟢 🔵 wording |
| Call summary to staff | `orgSettings.staffPhoneNumber` | SMS (existing) | 🟢 → review whether 518 wants this on every call |
| Payment succeeded / failed | Accountant | In-app | 🔴 ⏳ |

**Rules**
- SMS bodies must **not** contain tenant PII beyond first name + unit. Put details behind the login link.
- Log every send attempt and result (`notificationLog`), so failures are visible (PRD §11).
- Retry once on a transient Twilio failure, then mark failed and surface it on the dashboard.
- **🟣 Decide SMS vs push vs both** (PRD §18). SMS is recommended for the pilot because no app install is needed.

---

## 🔐 10. Roles and permissions matrix

Legend: ✅ full · ✏️ edit own scope · 👁️ read · ❌ none

| Capability | Simplr Admin | Alex (exec) | Pat (maint. lead) | Asset Manager | Technician | Accountant |
|---|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | ✏️ own units | ❌ (→ /tech) | 👁️ finance cards |
| Maintenance inbox | 👁️ all | 👁️ all | 👁️ all | ✏️ **own units only** | ❌ | ❌ |
| Request review actions | ✅ | 👁️ | ✅ | ✏️ own units | ❌ | ❌ |
| Exception queue | ✅ | 👁️ | ✅ | ❌ | ❌ | ❌ |
| Validated queue / create WO | ✅ | 👁️ | ✅ | ✏️ manual WO, own units | ❌ | ❌ |
| Work orders list/detail | ✅ | 👁️ | ✅ | 👁️ own units | ✏️ **assigned only** | 👁️ completed/closed |
| Close/review WO | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Properties & units | ✅ | ✅ | ✅ | 👁️ (+ availability if allowed) | ❌ | 👁️ |
| Change unit → AM | ✅ | ✅ | ✅ (if authorized, ⏳) | ❌ | ❌ | ❌ |
| Residents | ✅ | 👁️ | 👁️ | 👁️ own units | ❌ (only the tenant on their job) | 👁️ |
| Leads | ✅ | ✅ | 👁️ | ✏️ | ❌ | ❌ |
| Calendar / tours | ✅ | ✅ | ✅ | ✏️ own | ❌ | ❌ |
| Sarah configuration | ✅ | 👁️ | ✏️ (publish needs sign-off) | ❌ | ❌ | ❌ |
| Team & roles | ✅ | 👁️ | 👁️ | 👁️ | ❌ | 👁️ |
| Payments | ✅ | 👁️ | ❌ | ❌ | ❌ | ✅ |
| Owner statements | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Audit log | ✅ | 👁️ | 👁️ (own records) | ❌ | ❌ | ❌ |

> [!IMPORTANT]
> Every row of this matrix is enforced **in Convex functions**, not just by hiding UI. Write a test per row that calls the function as the wrong role and expects a refusal.

---

## 🛡️ 11. Security, privacy and audit

- **Authorization:** each query/mutation resolves `currentOrg` → job roles → scope (AM: own units; technician: assigned WOs). Never trust ids from the client for scoping.
- **IDOR tests:** for every `[id]` page, request another scope's id and expect "not found".
- **PII:** tenant names, phones, transcripts, receipts and payment records. Keep them out of SMS bodies, logs and the knowledge base.
- **Transcripts:** contain everything a caller says. Restrict them to roles that need them. Decide a retention period with Alex.
- **Uploads:** server-side type/size checks via storage metadata. Serve them only through signed Convex storage URLs from permission-checked queries.
- **Public tokens:** hashed at rest, expire, single purpose, rate-limited.
- **Webhooks:** verify signatures (Stripe; Clerk via svix) and make them idempotent.
  - ⚠️ **Found in code:** the ElevenLabs post-call route ([`http.ts:1007`](dashboard/convex/http.ts#L1007)) checks the HMAC only `if (secret && signature)`. A request **without** an `ElevenLabs-Signature` header, or a deployment with no secret set, is accepted unverified. Anyone who knows the URL could inject fake calls/transcripts. Fix: reject when the secret is set and the header is missing, and require the secret in production.
  - The mid-call `/tools/*` routes have no signature at all (ElevenLabs server tools). Confirm whether ElevenLabs supports a secret header for tools and add one (for example a shared secret header checked on every `/tools/*` request).
- **Secrets:** only in Convex env / Vercel env. Rotate the Google client secret, Maps key and token-encryption key that were shared in a screenshot earlier. Note that rotating `GOOGLE_TOKEN_ENCRYPTION_KEY` invalidates stored calendar tokens (everyone reconnects).
- **Clean up debug data:** `debugWebhookLogs` stores raw post-call bodies, including transcripts. Remove it, or purge it on a cron, before go-live.
- **Audit:** append-only, written in the same transaction as the change.
- **Error logging (PRD §11):** routing, notification, payment and integration errors go to a `systemErrors` table with a dashboard card for admins.

---

## 🚦 12. Delivery phases, steps and gates

> [!NOTE]
> 🛑 = **gate**: do not proceed past it without the named sign-off.

### Phase 0: Build lock (days 1–2)

1. Send the §13 input checklist to Alex/Pat. Get answers to C1–C13 (§4).
2. Confirm the scope split: **maintenance + leasing config for Nov 1**; payments + ROS as a follow-up phase unless inputs arrive.
3. Separate production setup: own Convex prod deployment, Clerk prod instance, ElevenLabs agent, Twilio number, Google OAuth client (published).
4. 🛑 **Gate 0:** written scope + price confirmation (PRD §16).

### Phase 1: Foundations (days 2–5)

1. F1 job roles + authz helpers + tests.
2. F2 properties/units + F3 residents + CSV importer (dry run).
3. F6 audit log, F7 notification service, F8 public tokens.
4. Team page updates (P19). Properties pages (P14). Residents (P15).
5. Import pilot units and AM assignments.
6. 🛑 **Gate 1:** every pilot unit has an AM (missing-assignment report shows zero).

### Phase 2: Maintenance intake and review (days 4–8)

1. F4 requests + routing + duplicate check.
2. New Sarah tools: `lookup_caller`, `find_unit`, `log_maintenance_request`, `send_photo_link`. Re-enable `escalate` notifications.
3. Sarah configuration P17 (call types, questions, severity, emergency scripts, contacts).
4. Pages P6, P7, P8, P26.
5. 🛑 **Gate 2:** Pat signs off every script, the severity matrix and escalation contacts **before any real tenant call**.

### Phase 3: Work orders and technician (days 6–11)

1. F5 work orders + files/time/expenses/notes.
2. Pages P9, P10, P11, P12, P13 (mobile).
3. Technician SMS notifications.
4. Real-device testing (iOS + Android).
5. 🛑 **Gate 3:** first reviewable build → Alex/Pat walk through real scenarios (PRD §15).

### Phase 4: Leasing configuration (parallel, days 5–10)

1. Capture-only qualification, 518 questions, owner-prospect route (P4).
2. Tour pool by role, configurable durations (P16).
3. Knowledge content (P18). Prompt rebrand (§8.1).
4. Dashboard updates (P2), tasks assignee (P20), audit page (P23).

### Phase 5: Pilot hardening (days 10–16)

1. Routing edge cases: unknown unit, two units with the same number in different buildings, AM out of office, AM removed.
2. Permission tests (matrix §10), IDOR tests, upload abuse tests.
3. Concurrency load test (5 calls), 24/7 check (night call).
4. Office staff UAT (PRD §15).
5. Remove `debugWebhookLogs`, rotate secrets, publish the Google OAuth app.
6. 🛑 **Gate 4:** the acceptance script (§14) passes end to end → **handover Nov 1**.

### Phase 6: Finance (after inputs; likely after Nov 1)

1. 🛑 **Gate 5:** Stripe model + ROS template received and approved.
2. P21 payments in test mode → test matrix → approval → live.
3. P22 ROS drafts from work orders → accountant review → final template match.

---

## 📥 13. Client inputs checklist

| # | Input (PRD §14) | From | Blocks | Status |
|---|---|---|---|---|
| 1 | Final leasing + maintenance questions, answer options, branching | Pat | P4, P17 | ⏳ partially given (Sarah Config) |
| 2 | Written severity definitions, approved emergency scripts, escalation contacts per severity | Pat | P17, §8.3, §9 | ⏳ partial (fire/flood/gas notes) |
| 3 | Pilot property/unit list | Alex/Pat | P14 | ⏳ |
| 4 | Unit → AM assignments, who may change them, fallback when an AM is unavailable | Alex/Pat | F4, P8, P14 | ⏳ |
| 5 | Current availability + rules for offering/showing units | Pat | P14, P4 | ⏳ |
| 6 | AM calendars, tour duration, buffers, windows, cancellation/reschedule rules | Pat | P16 | ⏳ |
| 7 | Technician names, roles, mobile numbers, notification preferences | Pat | P13, §9 | ⏳ |
| 8 | Real work-order example (checklist, hours, materials, receipts, reimbursement) | Pat | P10, P12, P13 | ⏳ |
| 9 | Real ROS / owner statement, fields, formulas, delivery format | Accountant | P22 | ⏳ |
| 10 | Stripe account, payment methods, funds flow, settlement, refunds, disputes, reconciliation | Alex/accountant | P21 | ⏳ |
| 11 | Buildium export/CSV for pilot data | Alex/Pat | P14, P15 | ⏳ |
| 12 | Which resident FAQs are in the pilot (renewal, payment FAQs, portal, etc.) | Alex/Pat | P17 call types | ⏳ |
| 13 | Answers to conflicts C1–C13 | Alex/Pat | various | ⏳ |
| 14 | Gas utility provider number per property | Pat | §8.3 | ⏳ |
| 15 | Delia's contact; owner-routing numbers/extensions + after-hours fallback | Pat | P17 tab 6 | ⏳ |
| 16 | Out-of-scope reason list + approved tenant SMS wording | Pat | P7, P26 | ⏳ |
| 17 | Exact business name Sarah says; phone number and forwarding setup | Alex | §8.1, §8.4 | ⏳ |
| 18 | Confirmation that the application website instructions are current | Pat | P18 | ⏳ |

---

## ✅ 14. Pilot acceptance test script

Run each test by phone (not only `/call`) on the production deployment with test data, then repeat the critical ones with a real AM and technician.

| # | Scenario | Expected result | PRD §13 |
|---|---|---|---|
| T1 | Known resident calls about a dripping faucet | Sarah confirms name/unit from caller ID, asks the basics, logs a **routine** request routed **only** to that unit's AM; no staff retyping | 1, 2 |
| T2 | Unknown caller gives an address/unit that doesn't exist | Request lands in the **exception queue**, not in any AM inbox | 2 |
| T3 | Unit whose AM is out of office | Stays assigned to that AM, flagged to Pat; **not** reassigned silently | 2 |
| T4 | AM requests a photo | Tenant gets an SMS link, uploads a photo; it appears on the request | 3 |
| T5 | AM closes "lightbulb out" as not our responsibility | Reason required; status closed; audit entry | 3 |
| T6 | AM forwards a validated leak | Appears in Pat's queue; Pat notified | 3 |
| T7 | Pat creates and assigns a WO | Technician gets an SMS; job visible only to that technician | 4 |
| T8 | AM creates a manual WO for own unit; tries another AM's unit | First succeeds; second refused | 4 |
| T9 | Technician completes a job on a phone | Checklist, 3 photos, receipt, 2.5 h, $38.40 materials, notes; submit is blocked until required items are present | 5 |
| T10 | Pat reviews | Sees all evidence + full timeline; closes the WO | 6 |
| T11 | Leasing caller | All of Pat's questions captured; never told they don't qualify; tour offered only from available units and valid AM slots; no double-booking | 7 |
| T12 | Unit marked unavailable mid-day | The next caller is not offered it | 7 |
| T13 | Owner wants 518 to manage their building | Flagged, routed to Alex, Alex notified | 7 |
| T14 | Caller reports a fire / flooding / gas with hissing / slight gas | The **exact approved script** with the correct number; logged as emergency; contacts alerted; call ends promptly | 6.2 |
| T15 | Same tenant calls twice about the same leak within an hour | Second request flagged as a possible duplicate; not auto-merged | 11 |
| T16 | Five simultaneous calls | All answered; five correct records | VERIFY |
| T17 | Call at 3 a.m. | Answered; emergency path works; routine request waits in the inbox | VERIFY |
| T18 | Technician opens another technician's job URL | "Not found" | 11 |
| T19 | ROS draft for one owner | Lists the month's closed WOs with hours/costs (once inputs exist) | 8 |
| T20 | Stripe test: success, decline, refund | Correct statuses; staff view reconciles with the Stripe dashboard (once approved) | 9 |
| T21 | Pilot isolation | Only pilot units accept maintenance intake; no Buildium dependency | 10 |

---

## ⚫ 15. Explicitly out of scope

From PRD §17, plus findings from the code:

- ⚫ Vendor onboarding and vendor background screening.
- ⚫ Email-based maintenance intake.
- ⚫ Live Buildium API integration or full automatic migration (CSV for the pilot only).
- ⚫ Replacing every Buildium function on day one.
- ⚫ Full accounting/bookkeeping beyond the agreed ROS workflow.
- ⚫ Unapproved resident FAQ flows (lease renewal, payment-plan negotiation, etc.) until each is approved and toggled on.
- ⚫ Automatic approval/rejection of tenants or maintenance claims without human review.
- ⚫ SMS and WhatsApp bots (`/messages`, `/whatsapp`) for 518.
- ⚫ Native mobile apps (the technician view is a mobile web app).
- ⚫ Push notifications (unless chosen in §9; SMS first).

---

## 🧹 16. Housekeeping and tech debt found along the way

| Item | Where | Action |
|---|---|---|
| Package name still `voice-agent` | [`dashboard/package.json`](dashboard/package.json) | Rename (cosmetic) |
| Hard-coded "Maple Court Apartments" | [`agents.ts:78`](dashboard/convex/agents.ts#L78), [`agents.ts:212`](dashboard/convex/agents.ts#L212) | Move to config (§8.1) |
| Escalation SMS commented out | [`http.ts`](dashboard/convex/http.ts) `/tools/escalate` | Replace with the notification service |
| `debugWebhookLogs` table stores raw call bodies | [`schema.ts:315`](dashboard/convex/schema.ts#L315) | Remove before go-live |
| Post-login destination always `/call` | [`lib/auth-navigate.ts`](dashboard/lib/auth-navigate.ts) | Role-based (P1) |
| Env fallback redirects set to `/`, ClerkProvider `/dashboard`, code `/call` | `.env.local`, [`app/layout.tsx`](dashboard/app/layout.tsx), `auth-navigate.ts` | Make all three agree |
| Team time zone unset | Team page | Set `America/New_York` |
| Google OAuth app in Testing mode | Google Cloud Console | Add test users now; publish/verify before pilot (7-day token expiry) |
| Leaked secrets in a screenshot | Google Cloud Console | Rotate the client secret, Maps key and token-encryption key |
| Admin promotion relies on "first account on an empty deployment" | [`team.ts:331`](dashboard/convex/team.ts#L331) | Document it; add an internal `promoteToAdmin` mutation for operators |
| Tour constants in code | [`tourSchedule.ts`](dashboard/convex/tourSchedule.ts) | Move to settings (P16) |
| `properties.units` are types, not units | [`schema.ts:339`](dashboard/convex/schema.ts#L339) | Replace with the `units` table (F2) |
| `/settings`: `agents.saveAgent` has no admin check, so any member can rewrite Sarah's prompt | [`agents.ts:707`](dashboard/convex/agents.ts#L707) | Add `requireOrgAdmin` / job-role check |
| Post-call webhook accepts unsigned requests | [`http.ts:1007`](dashboard/convex/http.ts#L1007) | Reject missing signature (§11) |
| Old git history | repo root | The folder was re-initialised for `sliding-scale-tech/518propertypro`; Voice-Agent history is not carried over |

---

<sub>End of plan. Update each ⏳ in §13 as inputs arrive, and tick each 🛑 gate in §12 with the date and the name of the person who signed off.</sub>
