import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { currentOrg, hasAnyRole, hasRole, isAdminView, requireOrg } from "./authz";
import { managedUnitIds } from "./amScope";
import type { Id } from "./_generated/dataModel";
import { maintenanceOverview, scopedByStatus } from "./maintenance";
import { isLeasingLead } from "./conversations";
import { localDateKey, startOfLocalDay, addDays, isValidTimeZone, weekBounds } from "./tourSchedule";
import { windowIsToday, windowTimeRange } from "./workOrderWindow";
import { loadScope, makeLookups, requestCard, requestLane, requestStatusKey, STATUS_LABEL, workOrderCard, workOrderLane, workOrderStatusKey } from "./board";
import type { Card } from "./board";

/**
 * Everything the home dashboard renders, in one query.
 *
 * Deliberately one round trip rather than a query per card: the cards share the same
 * conversations and tours rows, and fetching them three times would cost three full scans to
 * answer three questions about the same data.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Percent change against the previous week, or null when the previous week had nothing — a
 * jump from 0 to any number is not "+∞%" or "+100%", it's a figure with no baseline, and the
 * card omits the comparison entirely rather than inventing one.
 */
function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Requests an asset manager still has to review (new / under review / more info needed) on the
 * units they MANAGE. The one definition behind both the admin "Asset managers" rows and the AM's
 * own dashboard, so an admin's count for an AM always equals what that AM sees.
 */
export function toReviewFor(requests: Doc<"maintenanceRequests">[], managed: Set<Id<"units">>) {
  return requests.filter((r) => requestLane(r) === "review" && r.unitId !== undefined && managed.has(r.unitId));
}

/** The badge on a lead row. Ordered most-decided first: an outcome the agent recorded beats
 *  anything inferred from what it managed to capture along the way. */
function leadStatus(
  conversation: Doc<"conversations">,
  qualification: Doc<"qualifications"> | null,
): "tour_booked" | "escalated" | "disqualified" | "qualified" | "contacted" | "new" {
  if (conversation.outcome === "tour_booked") return "tour_booked";
  if (conversation.outcome === "escalated") return "escalated";
  if (conversation.outcome === "disqualified") return "disqualified";
  if (qualification?.qualifies) return "qualified";
  if (qualification) return "contacted";
  return "new";
}

export const overview = query({
  // Only used until an admin sets the team's zone, so "today" still means the viewer's today.
  // Same convention as calendarView.week — see that action's own arg.
  args: { fallbackTimeZone: v.string() },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return null;

    const [organization, property] = await Promise.all([
      ctx.db.get(org.orgId),
      ctx.db
        .query("properties")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .first(),
    ]);
    // Same fallback chain as calendarView: the team's zone, else the viewer's — and never a
    // string the browser made up, which would throw inside Intl rather than just read oddly.
    const timeZone =
      organization?.timeZone ?? (isValidTimeZone(args.fallbackTimeZone) ? args.fallbackTimeZone : "UTC");
    const propertyName = property?.name ?? "—";

    const now = Date.now();
    const weekAgo = now - WEEK_MS;
    const twoWeeksAgo = now - 2 * WEEK_MS;

    // Leads, calls and tours are for the admin view and asset managers only. Technician,
    // accountant and role-less viewers get none of it (empty / zero).
    const leadsVisible = hasAnyRole(org, "admin", "asset_manager");

    // --- Stat cards: this week against the one before it ---------------------
    const fortnight = leadsVisible
      ? await ctx.db
          .query("conversations")
          .withIndex("by_org_and_started", (q) =>
            q.eq("orgId", org.orgId).gte("startedAt", twoWeeksAgo),
          )
          .collect()
      : [];
    const thisWeekCalls = fortnight.filter((c) => c.startedAt >= weekAgo);
    const lastWeekCalls = fortnight.filter((c) => c.startedAt < weekAgo);

    // Taken from a wider slice than the five shown, because the filter to leasing leads runs
    // after the read — the same caveat conversations.history carries.
    const latest = leadsVisible
      ? await ctx.db
          .query("conversations")
          .withIndex("by_org_and_started", (q) => q.eq("orgId", org.orgId))
          .order("desc")
          .take(40)
      : [];

    // Org-scoped lookups only: resident-call issues via the by_org index, and qualifications
    // fetched per this team's own conversation (qualifications has no org index).
    const allTenantIssues = leadsVisible
      ? await ctx.db
          .query("tenantIssues")
          .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
          .collect()
      : [];
    const allQualifications: Doc<"qualifications">[] = [];
    const seenQualification = new Set<string>();
    for (const c of [...fortnight, ...latest]) {
      const elId = c.elevenLabsConversationId;
      if (!elId || seenQualification.has(elId)) continue;
      seenQualification.add(elId);
      const row = await ctx.db
        .query("qualifications")
        .withIndex("by_elevenlabs_conversation_id", (q) => q.eq("elevenLabsConversationId", elId))
        .first();
      if (row) allQualifications.push(row);
    }
    const residentCallIds = new Set(allTenantIssues.map((i) => i.elevenLabsConversationId));
    const qualificationConversationIds = new Set(
      allQualifications.flatMap((q) => (q.conversationId ? [q.conversationId] : [])),
    );
    const qualificationElevenLabsIds = new Set(
      allQualifications.map((q) => q.elevenLabsConversationId),
    );
    const isLead = (c: Doc<"conversations">) =>
      isLeasingLead(c, residentCallIds, qualificationConversationIds, qualificationElevenLabsIds);
    const qualificationFor = (c: Doc<"conversations">) =>
      allQualifications.find(
        (q) =>
          q.conversationId === c._id ||
          (c.elevenLabsConversationId !== undefined &&
            q.elevenLabsConversationId === c.elevenLabsConversationId),
      ) ?? null;

    // Every tour in scope, not just upcoming ones: a booking made last week can be for a tour
    // months out, so the "booked" counts below look at createdAt, which no index covers.
    // Admin: the team's tours. Asset manager: only tours assigned to them. Others: none.
    const allTours =
      isAdminView(org)
        ? await ctx.db
            .query("tours")
            .withIndex("by_org_and_start", (q) => q.eq("orgId", org.orgId))
            .collect()
        : hasRole(org, "asset_manager")
          ? (
              await ctx.db
                .query("tours")
                .withIndex("by_assignee_and_start", (q) => q.eq("assignedUserId", org.user._id))
                .collect()
            ).filter((t) => t.orgId === org.orgId)
          : [];
    const booked = allTours.filter((t) => t.status === "booked");
    const bookedThisWeek = booked.filter((t) => t.createdAt >= weekAgo).length;
    const bookedLastWeek = booked.filter(
      (t) => t.createdAt >= twoWeeksAgo && t.createdAt < weekAgo,
    ).length;

    const newLeadsThisWeek = thisWeekCalls.filter(isLead).length;
    const newLeadsLastWeek = lastWeekCalls.filter(isLead).length;

    const stats = {
      newLeads: {
        value: newLeadsThisWeek,
        changePct: changePct(newLeadsThisWeek, newLeadsLastWeek),
      },
      callsHandled: {
        value: thisWeekCalls.length,
        changePct: changePct(thisWeekCalls.length, lastWeekCalls.length),
      },
      toursBooked: {
        value: bookedThisWeek,
        changePct: changePct(bookedThisWeek, bookedLastWeek),
      },
    };

    // --- Recent leads --------------------------------------------------------
    const recentLeads = latest
      .filter(isLead)
      .slice(0, 5)
      .map((c) => {
        const qualification = qualificationFor(c);
        return {
          id: c._id,
          name: qualification?.callerName ?? c.callerNumber ?? "Unknown caller",
          property: propertyName,
          source: c.channel === "phone" ? ("call" as const) : ("browser" as const),
          status: leadStatus(c, qualification),
          startedAt: c.startedAt,
        };
      });

    // --- Today's schedule ----------------------------------------------------
    const todayKey = localDateKey(now, timeZone);
    const dayStart = startOfLocalDay(todayKey, timeZone);
    const dayEnd = startOfLocalDay(addDays(todayKey, 1), timeZone);
    const todaysTours = booked
      .filter((t) => t.start >= dayStart && t.start < dayEnd)
      .sort((a, b) => a.start - b.start)
      .map((t) => {
        const qualification = t.elevenLabsConversationId
          ? (allQualifications.find(
              (q) => q.elevenLabsConversationId === t.elevenLabsConversationId,
            ) ?? null)
          : null;
        return {
          id: t._id,
          start: t.start,
          end: t.end,
          timeZone: t.timeZone,
          callerName: t.callerName ?? qualification?.callerName ?? null,
          bedrooms: qualification?.bedrooms ?? null,
          propertyName,
        };
      });

    // Maintenance cards, scoped to what this viewer may see (admin: team, AM: own units,
    // technician: own jobs, accountant: finished work).
    const maintenance = await maintenanceOverview(ctx, org);

    // --- Maintenance pipeline, people and attention (the board's data, summarised) -----------
    // Scoped like the board: admin = team, asset manager = their requests and units, others empty.
    const { view, requests, wos, scope: amScopeSet } = await loadScope(ctx, org);
    const L = makeLookups(ctx);
    const inLane = (lane: Card["lane"]) => ({
      requests: requests.filter((r) => requestLane(r) === lane),
      wos: wos.filter((w) => workOrderLane(w) === lane),
    });

    // Closed this month (reviewed work orders + rejected requests), in the team's time zone.
    const monthKey = localDateKey(now, timeZone).slice(0, 7);
    const monthStart = startOfLocalDay(`${monthKey}-01`, timeZone);
    let closedThisMonth = 0;
    if (view === "admin") {
      const closedWos = await ctx.db
        .query("workOrders")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", "reviewed_closed"))
        .order("desc")
        .take(300);
      closedThisMonth += closedWos.filter((w) => (w.closedAt ?? w.updatedAt) >= monthStart).length;
    }
    if (view) {
      for (const s of ["closed_out_of_scope", "closed_duplicate"] as const) {
        closedThisMonth += (await scopedByStatus(ctx, org, s, 300)).filter((r) => r.updatedAt >= monthStart).length;
      }
    }
    const pipeline = {
      review: inLane("review").requests.length,
      pat: inLane("pat").requests.length,
      tech: inLane("tech").wos.length,
      signoff: inLane("signoff").wos.length,
      closedThisMonth,
    };

    // People rows are the admin's dashboard; an asset manager has no use for a colleague roster.
    const week = weekBounds(now, timeZone);
    const toursThisWeekBy = new Map<string, number>();
    for (const t of booked) {
      if (t.start >= week.start && t.start < week.end) {
        toursThisWeekBy.set(t.assignedUserId, (toursThisWeekBy.get(t.assignedUserId) ?? 0) + 1);
      }
    }
    const assetManagers: Array<{ userId: string; name: string; units: number; toursThisWeek: number; toReview: number }> = [];
    const technicians: Array<{ userId: string; name: string; skill: string | null; assigned: number; toSignOff: number }> = [];
    let activeTechnicianCount = 0;
    if (view === "admin") {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect();
      for (const m of memberships) {
        const roles = m.jobRoles ?? [];
        if (roles.includes("asset_manager")) {
          const managed = new Set(await managedUnitIds(ctx, org.orgId, m.userId));
          assetManagers.push({
            userId: m.userId,
            name: (await L.user(m.userId)) ?? "Unknown",
            units: managed.size,
            toursThisWeek: toursThisWeekBy.get(m.userId) ?? 0,
            toReview: toReviewFor(requests, managed).length,
          });
        }
        if (roles.includes("technician")) {
          if (!(m.unavailableUntil !== undefined && m.unavailableUntil > now)) activeTechnicianCount += 1;
          technicians.push({
            userId: m.userId,
            name: (await L.user(m.userId)) ?? "Unknown",
            skill: m.skill ?? null,
            assigned: inLane("tech").wos.filter((w) => w.technicianUserId === m.userId).length,
            toSignOff: inLane("signoff").wos.filter((w) => w.technicianUserId === m.userId).length,
          });
        }
      }
    }

    // Needs attention: waiting on the maintenance lead, work to sign off, and unrouted requests
    // (admin only). Worst severity first, then oldest; a request is listed once.
    const attentionCards: Array<Card & { reason: "pat" | "signoff" | "exception" }> = [];
    for (const r of inLane("pat").requests) attentionCards.push({ ...(await requestCard(L, r)), reason: "pat" });
    for (const w of inLane("signoff").wos) attentionCards.push({ ...(await workOrderCard(ctx, L, w)), reason: "signoff" });
    if (view === "admin") {
      for (const r of requests.filter((x) => x.inExceptionQueue && x.status !== "forwarded_to_pat")) {
        attentionCards.push({ ...(await requestCard(L, r)), reason: "exception" });
      }
    }
    const rank = { emergency: 0, urgent: 1, routine: 2, informational: 3 } as const;
    const attention = attentionCards
      .sort((a, b) => rank[a.severity] - rank[b.severity] || a.createdAt - b.createdAt)
      .slice(0, 12);

    // Today's schedule: tours (admin: the team's, asset manager: their own) and work orders whose
    // window starts today in the team's zone. Older rows have only free text, so for them "Today ..."
    // is the best signal there is.
    const scheduleTours =
      view === "admin" || view === "asset_manager"
        ? todaysTours.filter((t) => view === "admin" || booked.find((b) => b._id === t.id)?.assignedUserId === org.user._id)
        : [];
    const todayWos = wos.filter((w) =>
      w.windowStart !== undefined
        ? windowIsToday(w.windowStart, now, timeZone)
        : w.window !== undefined && /^today\b/i.test(w.window.trim()),
    );
    const todaySchedule = [
      ...scheduleTours.map((t) => ({
        kind: "tour" as const,
        id: String(t.id),
        start: t.start,
        label: t.callerName ?? "Tour",
        sub: t.propertyName,
        window: null as string | null,
      })),
      ...(await Promise.all(
        todayWos.map(async (w) => ({
          kind: "work_order" as const,
          id: String(w._id),
          start: (w.windowStart ?? null) as number | null,
          label: `WO-${w.number} · ${w.title}`,
          sub: `${(await L.property(w.propertyId)) ?? ""} · ${(await L.unit(w.unitId))?.unitNumber ?? ""}`.trim(),
          window: w.window ?? null,
        })),
      )),
    ].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));

    // --- Figma dashboard block --------------------------------------------------------------
    // Admin view: the team. Asset manager: their own scoped equivalents (same lead scoping as
    // above, tours assigned to them, work orders on their units). Everyone else: null.
    let adminDash: {
      kpis: {
        callsHandled: { value: number; deltaPct: number | null };
        toursBooked: { value: number; deltaPct: number | null };
        activeWorkOrders: { value: number; highPriority: number };
      };
      todaySchedule: Array<{ id: string; kind: "tour" | "work_order"; start: number | null; time: string; title: string; sub: string }>;
      recentLeads: Array<{ id: string; name: string; property: string; sourceLabel: "Call" | "Browser"; status: string; statusLabel: string; startedAt: number; dateLabel: string }>;
      openWorkOrders: Array<{ kind: "work_order" | "request"; id: string; number: string; unit: string | null; property: string | null; issue: string; assignedToName: string | null; statusLabel: string; dueDate: number | null }>;
      propertiesSnapshot: { workOrders: number; totalUnits: number; assetManagers: number | null; activeTechnicians: number | null };
    } | null = null;

    if (view === "admin" || view === "asset_manager") {
      const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
      const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone });
      const todayK = localDateKey(now, timeZone);
      const yesterdayK = addDays(todayK, -1);
      const tomorrowK = addDays(todayK, 1);
      const dayWord = (ms: number) => {
        const k = localDateKey(ms, timeZone);
        return k === todayK ? "Today" : k === yesterdayK ? "Yesterday" : k === tomorrowK ? "Tomorrow" : monthDay.format(new Date(ms));
      };
      const bedroomLabel = (b: string | null | undefined) => {
        if (!b) return null;
        const k = b.toLowerCase();
        if (k === "studio") return "Studio";
        if (k === "1br") return "1 Bedroom";
        if (k === "2br") return "2 Bedroom";
        if (k === "3br+") return "3+ Bedroom";
        return b;
      };
      const LEAD_LABEL = { tour_booked: "Tour Booked", escalated: "Escalated", disqualified: "Disqualified", qualified: "Qualified", contacted: "Contacted", new: "New" } as const;

      const tourItems = scheduleTours.map((t) => ({
        id: String(t.id),
        kind: "tour" as const,
        start: t.start as number | null,
        time: clock.format(new Date(t.start)),
        title: `Tour – ${t.propertyName}`,
        sub: [bedroomLabel(t.bedrooms), t.propertyName].filter(Boolean).join(" • "),
      }));
      const woItems = todayWos.map((w) =>
        w.windowStart !== undefined && w.windowEnd !== undefined
          ? {
              id: String(w._id),
              kind: "work_order" as const,
              start: w.windowStart as number | null,
              time: clock.format(new Date(w.windowStart)),
              title: `WO-${w.number} – ${w.title}`,
              sub: windowTimeRange(w.windowStart, w.windowEnd, timeZone),
            }
          : {
              id: String(w._id),
              kind: "work_order" as const,
              start: null as number | null,
              time: w.window ?? "Today",
              title: `WO-${w.number} – ${w.title}`,
              sub: w.window ?? "",
            },
      );

      // Open work orders: active work orders plus requests waiting on the admin (forwarded).
      const rankOf = { emergency: 0, urgent: 1, routine: 2, informational: 3 } as const;
      type OpenRow = { kind: "work_order" | "request"; id: string; number: string; unit: string | null; property: string | null; issue: string; assignedToName: string | null; statusLabel: string; dueDate: number | null; rank: number; created: number };
      const openRows: OpenRow[] = [];
      for (const w of wos) {
        openRows.push({
          kind: "work_order",
          id: w._id,
          number: `WO-${w.number}`,
          unit: (await L.unit(w.unitId))?.unitNumber ?? null,
          property: (await L.property(w.propertyId)) ?? null,
          issue: shortTitle(w.title),
          assignedToName: (await L.user(w.technicianUserId)) ?? null,
          statusLabel: STATUS_LABEL[workOrderStatusKey(w)],
          dueDate: w.dueDate ?? null,
          rank: rankOf[w.priority],
          created: w.createdAt,
        });
      }
      for (const r of requests) {
        const key = r.status === "forwarded_to_pat" ? requestStatusKey(r) : null;
        if (!key) continue;
        openRows.push({
          kind: "request",
          id: r._id,
          number: `MR-${r.number}`,
          unit: (await L.unit(r.unitId))?.unitNumber ?? r.spokenUnit ?? null,
          property: (await L.property(r.propertyId)) ?? null,
          issue: shortTitle(r.title?.trim() || r.description),
          assignedToName: null,
          statusLabel: STATUS_LABEL[key],
          dueDate: null,
          rank: rankOf[r.severity],
          created: r.createdAt,
        });
      }
      openRows.sort((a, b) => a.rank - b.rank || (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || a.created - b.created);

      const totalUnits =
        view === "admin"
          ? (await ctx.db.query("units").withIndex("by_org", (q) => q.eq("orgId", org.orgId)).collect()).length
          : amScopeSet.managed.size;

      adminDash = {
        kpis: {
          callsHandled: { value: thisWeekCalls.length, deltaPct: stats.callsHandled.changePct },
          toursBooked: { value: bookedThisWeek, deltaPct: stats.toursBooked.changePct },
          activeWorkOrders: { value: wos.length, highPriority: wos.filter((w) => w.priority === "emergency" || w.priority === "urgent").length },
        },
        todaySchedule: [...tourItems, ...woItems].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity)),
        recentLeads: recentLeads.map((l) => ({
          id: String(l.id),
          name: l.name,
          property: l.property,
          sourceLabel: l.source === "call" ? ("Call" as const) : ("Browser" as const),
          status: l.status,
          statusLabel: LEAD_LABEL[l.status],
          startedAt: l.startedAt,
          dateLabel: dayWord(l.startedAt),
        })),
        openWorkOrders: openRows.slice(0, 5).map(({ rank, created, ...row }) => {
          void rank;
          void created;
          return row;
        }),
        propertiesSnapshot: {
          workOrders: wos.length,
          totalUnits,
          assetManagers: view === "admin" ? assetManagers.length : null,
          activeTechnicians: view === "admin" ? activeTechnicianCount : null,
        },
      };
    }

    return {
      timeZone,
      propertyName,
      stats,
      recentLeads,
      todaysTours,
      maintenance,
      pipeline,
      assetManagers,
      technicians,
      attention,
      todaySchedule,
      adminDash,
      callsThisWeek: { value: thisWeekCalls.length, changePct: stats.callsHandled.changePct },
    };
  },
});

// --- Asset manager dashboard ------------------------------------------------------

const REQUEST_STATUS_TEXT: Record<Doc<"maintenanceRequests">["status"], string> = {
  new: "New, waiting for review",
  under_review: "Under review",
  more_info_needed: "Waiting on the tenant",
  forwarded_to_pat: "With the maintenance lead",
  work_order_created: "Work order created",
  closed_out_of_scope: "Closed, out of scope",
  closed_duplicate: "Closed, duplicate",
};

function shortTitle(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * The asset manager's own dashboard, one round trip. Asset-manager view only (everyone else
 * throws). Scope is amScope: KPIs, the review queue and the "your properties" block cover the
 * units they MANAGE; the in-progress list also shows units they cover (read-only), and
 * `covering` summarises that cover. No rent or finance fields.
 */
export const amOverview = query({
  args: { fallbackTimeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!hasRole(org, "asset_manager")) throw new ConvexError("You don't have access to that.");

    const organization = await ctx.db.get(org.orgId);
    const timeZone =
      organization?.timeZone ??
      (args.fallbackTimeZone && isValidTimeZone(args.fallbackTimeZone) ? args.fallbackTimeZone : "UTC");
    const now = Date.now();
    const weekAgo = now - WEEK_MS;

    const { requests, wos, scope } = await loadScope(ctx, org);
    const L = makeLookups(ctx);
    const managed = scope.managed;
    const mine = (unitId: Id<"units"> | undefined) => unitId !== undefined && managed.has(unitId);

    // --- Review queue and the KPIs that hang off it ---
    const reviewReqs = toReviewFor(requests, managed).sort(
      (a, b) => RANK[a.severity] - RANK[b.severity] || a.createdAt - b.createdAt,
    );
    const reviewQueue = [];
    for (const r of reviewReqs.slice(0, 50)) {
      reviewQueue.push({
        id: r._id,
        number: r.number,
        title: shortTitle(r.description),
        severity: r.severity,
        severityScore: r.severityScore ?? null,
        propertyName: (await L.property(r.propertyId)) ?? null,
        unitNumber: (await L.unit(r.unitId))?.unitNumber ?? r.spokenUnit ?? null,
        status: r.status,
        createdAt: r.createdAt,
      });
    }

    // --- Escalations: emergency / urgent requests on managed units in the last 7 days (any status) ---
    const escalationRows: Doc<"maintenanceRequests">[] = [];
    for (const unitId of managed) {
      const recent = await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_unit_and_created", (q) => q.eq("unitId", unitId).gte("createdAt", weekAgo))
        .order("desc")
        .take(50);
      escalationRows.push(
        ...recent.filter((r) => r.orgId === org.orgId && (r.severity === "emergency" || r.severity === "urgent")),
      );
    }
    escalationRows.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.createdAt - a.createdAt);
    const escalations = [];
    for (const r of escalationRows.slice(0, 20)) {
      const property = (await L.property(r.propertyId)) ?? "";
      const unit = (await L.unit(r.unitId))?.unitNumber ?? "";
      escalations.push({
        id: r._id,
        number: r.number,
        title: shortTitle(r.description),
        where: [property, unit && `Unit ${unit}`].filter(Boolean).join(" · "),
        severity: r.severity,
        severityScore: r.severityScore ?? null,
        createdAt: r.createdAt,
        outcome: REQUEST_STATUS_TEXT[r.status],
        status: r.status,
      });
    }

    // --- In progress: forwarded requests + active work orders (managed + covered, flagged) ---
    const forwarded = requests.filter((r) => r.status === "forwarded_to_pat");
    const inProgress = [];
    for (const r of forwarded) {
      const c = await requestCard(L, r);
      inProgress.push({
        kind: "request" as const,
        id: c.id,
        number: c.number,
        title: c.title,
        propertyName: c.propertyName,
        unitNumber: c.unitNumber,
        stageLabel: c.stagePill,
        techName: undefined as string | undefined,
        covering: !mine(r.unitId),
      });
    }
    for (const w of wos) {
      const c = await workOrderCard(ctx, L, w);
      inProgress.push({
        kind: "work_order" as const,
        id: c.id,
        number: c.number,
        title: c.title,
        propertyName: c.propertyName,
        unitNumber: c.unitNumber,
        stageLabel: c.stagePill,
        techName: c.avatar?.role === "technician" ? c.avatar.name : undefined,
        covering: !mine(w.unitId),
      });
    }
    const managedInProgress = inProgress.filter((i) => !i.covering).length;

    // --- Tours: this AM's own bookings ---
    const week = weekBounds(now, timeZone);
    const myTours = await ctx.db
      .query("tours")
      .withIndex("by_assignee_and_start", (q) => q.eq("assignedUserId", org.user._id).gte("start", week.start).lt("start", Math.max(week.end, now + WEEK_MS)))
      .take(200);
    const booked = myTours.filter((t) => t.status === "booked" && t.orgId === org.orgId);
    const toursThisWeek = booked.filter((t) => t.start >= week.start && t.start < week.end).length;
    const firstProperty = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .first();
    const tours = booked
      .filter((t) => t.start >= now && t.start < now + WEEK_MS)
      .sort((a, b) => a.start - b.start)
      .map((t) => ({
        id: t._id,
        start: t.start,
        end: t.end,
        timeZone: t.timeZone,
        callerName: t.callerName?.trim().split(/\s+/)[0] ?? null,
        propertyName: firstProperty?.name ?? organization?.name ?? "",
      }));

    // --- Properties (managed units only) ---
    const unitDocs: Doc<"units">[] = [];
    for (const id of managed) {
      const u = await ctx.db.get(id);
      if (u && u.orgId === org.orgId) unitDocs.push(u);
    }
    const byProperty = new Map<Id<"properties">, number>();
    for (const u of unitDocs) byProperty.set(u.propertyId, (byProperty.get(u.propertyId) ?? 0) + 1);
    const properties = [];
    for (const [propertyId, yourUnits] of byProperty) {
      const p = await ctx.db.get(propertyId);
      if (!p || p.orgId !== org.orgId) continue;
      const all = await ctx.db
        .query("units")
        .withIndex("by_property", (q) => q.eq("propertyId", propertyId))
        .collect();
      properties.push({
        propertyId,
        name: p.name,
        address: p.address?.formatted ?? null,
        yourUnits,
        totalUnits: all.length,
        openRequests: requests.filter((r) => r.propertyId === propertyId && mine(r.unitId)).length,
      });
    }
    properties.sort((a, b) => a.name.localeCompare(b.name));

    // --- Covering: out-of-office colleagues whose units this person reads ---
    const covering = [];
    for (const ownerId of scope.coveringFor) {
      const ownerUnits = new Set(await managedUnitIds(ctx, org.orgId, ownerId));
      covering.push({
        forName: (await L.user(ownerId)) ?? "Unknown",
        units: ownerUnits.size,
        openRequests: requests.filter((r) => r.unitId !== undefined && ownerUnits.has(r.unitId)).length,
      });
    }

    return {
      firstName: org.user.firstName ?? null,
      unitCount: managed.size,
      propertyNames: properties.map((p) => p.name),
      kpis: {
        toReview: reviewReqs.length,
        oldestReviewCreatedAt: reviewReqs.length ? Math.min(...reviewReqs.map((r) => r.createdAt)) : null,
        escalationsThisWeek: escalationRows.length,
        inProgress: managedInProgress,
        toursThisWeek,
      },
      reviewQueue,
      inProgress,
      escalations,
      tours,
      properties,
      covering,
    };
  },
});

const RANK = { emergency: 0, urgent: 1, routine: 2, informational: 3 } as const;
