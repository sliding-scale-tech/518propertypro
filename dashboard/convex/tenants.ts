import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { clampSeverity } from "./severity";
import { realValue, realPhone } from "./sanitize";
import { currentOrg, requireAdminView, requireOrgAdmin, viewFor } from "./authz";
import type { OrgContext } from "./authz";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { amScope, canSeeUnit } from "./amScope";
import { findResidentsByPhone } from "./residents";
import { STATUS_LABEL, requestStatusKey, workOrderStatusKey, type StatusKey } from "./board";
import { CALL_SORT_DEFAULT, callTypeOf, callsView, pageOf } from "./tenantViews";

/**
 * A resident-call row is either a maintenance request raised from a phone call (the normal
 * path: Sarah's log_maintenance_request) or a legacy/non-maintenance tenantIssues row
 * (log_tenant_issue, escalation safety net). One row per call: when a request exists for a
 * conversation it wins and the tenantIssues row for the same conversation is hidden.
 */
const LEVEL_SCORE: Record<string, number> = { emergency: 10, urgent: 7, routine: 4, informational: 2 };

const CLOSED_STATUS_KEYS = new Set<StatusKey>(["completed", "closed", "rejected"]);

/**
 * For an asset manager, resident calls are limited to residents of their units (managed or
 * covered). A call counts as theirs when its maintenance request is on one of those units, or
 * when the trusted caller ID matches a resident of one. The unit the caller SAID is free text
 * and is never used for scoping. Everyone else sees the team's calls as before.
 */
async function loadCallRows(ctx: QueryCtx, org: OrgContext) {
  const isAm = viewFor(org.isAdmin, org.jobRoles) === "asset_manager";
  const scope = isAm ? await amScope(ctx, org) : null;

  const visibleByPhone = async (unitId: Doc<"units">["_id"] | undefined, callerNumber?: string) => {
    if (!scope) return true;
    if (canSeeUnit(scope, unitId)) return true;
    if (!unitId && callerNumber) {
      const matches = await findResidentsByPhone(ctx, org.orgId, callerNumber);
      return matches.some((m) => canSeeUnit(scope, m.unitId));
    }
    return false;
  };

  const requests = (
    await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_org_and_created", (q) => q.eq("orgId", org.orgId))
      .collect()
  ).filter((r) => r.source === "phone");
  const requestConvIds = new Set(requests.map((r) => r.elevenLabsConversationId).filter(Boolean));

  const issues = await ctx.db
    .query("tenantIssues")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .collect();

  const rows: CallRow[] = [];

  for (const r of requests) {
    if (!(await visibleByPhone(r.unitId, r.callerNumber))) continue;
    const wo = (await ctx.db.query("workOrders").withIndex("by_request", (q) => q.eq("requestId", r._id)).collect())
      .filter((w) => w.orgId === org.orgId)
      .sort((x, y) => y.createdAt - x.createdAt)[0];
    const key: StatusKey = wo ? workOrderStatusKey(wo) : (requestStatusKey(r) ?? "in_progress");
    const unit = r.unitId ? await ctx.db.get(r.unitId) : null;
    const conv = r.conversationId ? await ctx.db.get(r.conversationId) : null;
    rows.push({
      kind: "request",
      key: `request:${r._id}`,
      requestId: r._id,
      workOrderId: wo?._id,
      mrNumber: `MR-${r.number}`,
      woNumber: wo ? `WO-${wo.number}` : undefined,
      conversationId: r.conversationId,
      callerName: r.callerName,
      unit: unit?.unitNumber ?? r.spokenUnit,
      callerNumber: r.callerNumber,
      callbackNumber: r.callbackNumber,
      reason: r.title?.trim() || r.description,
      description: r.description,
      category: r.issueType,
      severity: r.severityScore ?? LEVEL_SCORE[r.severity] ?? 4,
      severityLevel: r.severity,
      severityReason: r.severityReason,
      status: CLOSED_STATUS_KEYS.has(key) ? "resolved" : "open",
      statusLabel: STATUS_LABEL[key],
      createdAt: r.createdAt,
      channel: conv?.channel ?? null,
      durationSec: conv?.durationSec ?? null,
      messageCount: 0,
    });
  }

  for (const issue of issues) {
    if (requestConvIds.has(issue.elevenLabsConversationId)) continue;
    if (scope) {
      // Legacy rows have no request; scope on the caller ID only (never the spoken unit).
      const matches = issue.callerNumber ? await findResidentsByPhone(ctx, org.orgId, issue.callerNumber) : [];
      if (!matches.some((m) => canSeeUnit(scope, m.unitId))) continue;
    }
    const conv = issue.conversationId ? await ctx.db.get(issue.conversationId) : null;
    rows.push({
      kind: "issue",
      key: `issue:${issue._id}`,
      issueId: issue._id,
      conversationId: issue.conversationId,
      callerName: issue.callerName,
      unit: issue.unit,
      callerNumber: issue.callerNumber,
      callbackNumber: issue.callbackNumber,
      reason: issue.reason,
      category: issue.category,
      callType: issue.callType,
      severity: issue.severity,
      severityReason: issue.severityReason,
      originalSeverity: issue.originalSeverity,
      status: issue.status,
      statusLabel: issue.status === "open" ? "Open" : "Resolved",
      createdAt: issue.createdAt,
      channel: conv?.channel ?? null,
      durationSec: conv?.durationSec ?? null,
      messageCount: 0,
    });
  }

  return rows;
}

export type CallRow = {
  kind: "request" | "issue";
  key: string;
  issueId?: Doc<"tenantIssues">["_id"];
  requestId?: Doc<"maintenanceRequests">["_id"];
  workOrderId?: Doc<"workOrders">["_id"];
  mrNumber?: string;
  woNumber?: string;
  conversationId?: Doc<"conversations">["_id"];
  callerName?: string;
  unit?: string;
  callerNumber?: string;
  callbackNumber?: string;
  reason: string;
  description?: string;
  category?: string;
  callType?: string;
  severity: number;
  severityLevel?: string;
  severityReason?: string;
  originalSeverity?: number;
  status: "open" | "resolved";
  statusLabel: string;
  createdAt: number;
  channel: string | null;
  durationSec: number | null;
  messageCount: number;
};

// --- Reads ----------------------------------------------------------------

/**
 * Every resident call for the signed-in user, worst first: maintenance requests raised from
 * calls plus legacy/non-maintenance tenantIssues, one row per call.
 *
 * The severity-first sort lives here rather than in the page so no caller can get it wrong --
 * an urgent issue sinking below a routine one is the one failure mode that actually matters.
 */
export const issues = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return [];
    // Resident-call detail is not for technicians or accountants.
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") return [];
    const rows = await loadCallRows(ctx, org);
    return rows.sort((a, b) => b.severity - a.severity || b.createdAt - a.createdAt);
  },
});

/**
 * One page of the Resident calls tab. Same read scope as `issues` (admin and asset manager only,
 * the asset manager's units via loadCallRows), then status / severity / call-type filters, search
 * and a sort over the WHOLE set, so `total` is the true count. Newest first by default.
 * `types` lists every call type present (before filtering) for the type filter.
 */
export const issuesPage = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"), v.literal("all"))),
    severity: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    type: v.optional(v.string()),
    search: v.optional(v.string()),
    sortKey: v.optional(
      v.union(v.literal("when"), v.literal("caller"), v.literal("severity"), v.literal("duration"), v.literal("status")),
    ),
    sortDir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    const view = org ? viewFor(org.isAdmin, org.jobRoles) : null;
    // Resident-call detail is not for technicians or accountants.
    if (!org || (view !== "admin" && view !== "asset_manager")) {
      return { ...pageOf<CallRow>([], 1, args.pageSize), types: [] as string[], overall: 0 };
    }
    const rows = await loadCallRows(ctx, org);
    const filtered = callsView(rows, {
      q: args.search,
      status: args.status,
      severity: args.severity,
      type: args.type,
      sort: { key: args.sortKey ?? CALL_SORT_DEFAULT.key, dir: args.sortDir ?? CALL_SORT_DEFAULT.dir },
    });
    return {
      ...pageOf(filtered, args.page, args.pageSize),
      types: [...new Set(rows.map(callTypeOf).filter(Boolean))].sort(),
      // Every call the viewer can see, ignoring filters (tells "no calls yet" from "no match").
      overall: rows.length,
    };
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    const none = { openIssues: 0, highSeverityOpen: 0, resolvedIssues: 0 };
    if (!org) return none;
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") return none;
    const rows = await loadCallRows(ctx, org);
    const open = rows.filter((r) => r.status === "open");
    return {
      openIssues: open.length,
      highSeverityOpen: open.filter((r) => r.severity >= 7).length,
      resolvedIssues: rows.length - open.length,
    };
  },
});

export const issueByElevenLabsId = internalQuery({
  args: { elevenLabsConversationId: v.string() },
  handler: (ctx, args) =>
    ctx.db
      .query("tenantIssues")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first(),
});

// --- Writes ---------------------------------------------------------------

/**
 * Upsert by conversation id so a second log_tenant_issue call in the same conversation
 * corrects the first rather than creating a duplicate row.
 *
 * Nothing here verifies that the caller is a resident, and nothing links them to a previous
 * call. The name and unit are stored exactly as the caller gave them.
 */
export const logIssue = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    callerNumber: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    reason: v.string(),
    category: v.optional(v.string()),
    severity: v.number(),
    severityReason: v.optional(v.string()),
    // Non-maintenance resident call type (rent, portal_login, ...); validated by the HTTP layer.
    callType: v.optional(v.string()),
    // Set by the escalate handler's safety net, which only needs a row to EXIST so the call is
    // classified as a resident call. Without this it reused the normal upsert and overwrote a
    // row Sarah had already written from log_tenant_issue -- replacing her reason, her unit and
    // her severity with the escalation's coarser values, so every escalated 8 or 9 was rewritten
    // to a 10 with boilerplate text.
    onlyIfAbsent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { elevenLabsConversationId, severity, onlyIfAbsent, ...fields } = args;
    const now = Date.now();

    const existing = await ctx.db
      .query("tenantIssues")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", elevenLabsConversationId),
      )
      .first();

    const cleaned = {
      ...fields,
      callerName: realValue(fields.callerName),
      unit: realValue(fields.unit),
      callerNumber: realPhone(fields.callerNumber),
      callbackNumber: realPhone(fields.callbackNumber),
    };

    const patch: Record<string, unknown> = {
      severity: clampSeverity(severity),
      updatedAt: now,
    };
    for (const [key, value] of Object.entries(cleaned)) {
      if (value !== undefined) patch[key] = value;
    }

    // Resolves the owner from the call's own conversations row, exactly like the qualification
    // side of the same tool call — reliable for a browser call (that row exists from the
    // start), not yet for a phone call's first mid-call tool invocation. linkConversation below
    // backfills the phone-call case once the post-call webhook resolves the real agent.
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", elevenLabsConversationId),
      )
      .first();

    if (existing && onlyIfAbsent) return existing._id;

    if (existing) {
      // Was created before conv existed (a phone call's first mid-call tool invocation) and
      // never got backfilled because the post-call webhook never ran — a second log_tenant_issue
      // call in the same conversation, or a browser call where conv now exists, catches it here
      // instead of leaving the transcript stuck behind linkConversation forever.
      if (conv && !existing.conversationId) patch.conversationId = conv._id;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return ctx.db.insert("tenantIssues", {
      userId: conv?.userId,
      orgId: conv?.orgId,
      conversationId: conv?._id,
      elevenLabsConversationId,
      reason: args.reason,
      severity: clampSeverity(severity),
      status: "open",
      createdAt: now,
      updatedAt: now,
      ...patch,
    });
  },
});

/**
 * Called by the post-call webhook. Links the Convex conversation, backfills the telephony
 * number (the only way a browser call — or a call where the agent never got a number out
 * loud — ends up with a usable callback number on the record), and backfills the owning team
 * for a phone call that wasn't yet resolvable when logIssue first ran.
 */
export const linkConversation = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    conversationId: v.id("conversations"),
    callerNumber: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db
      .query("tenantIssues")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();
    if (!issue) return;

    const patch: Record<string, unknown> = {
      conversationId: args.conversationId,
      updatedAt: Date.now(),
    };
    if (args.callerNumber && !issue.callerNumber) patch.callerNumber = args.callerNumber;
    if (args.userId && !issue.userId) patch.userId = args.userId;
    if (args.orgId && !issue.orgId) patch.orgId = args.orgId;

    await ctx.db.patch(issue._id, patch);
  },
});

export const updateIssue = mutation({
  args: {
    issueId: v.id("tenantIssues"),
    severity: v.optional(v.number()),
    reason: v.optional(v.string()),
    callerName: v.optional(v.string()),
    unit: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.orgId !== org.orgId) return;

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.reason !== undefined) patch.reason = args.reason;
    if (args.status !== undefined) patch.status = args.status;
    if (args.callerName !== undefined) patch.callerName = args.callerName;
    if (args.unit !== undefined) patch.unit = args.unit;

    if (args.severity !== undefined) {
      const next = clampSeverity(args.severity);
      if (next !== issue.severity) {
        // Keep the agent's original judgment the first time a human disagrees with it, so the
        // rubric can be audited against what staff actually thought.
        if (issue.originalSeverity === undefined) patch.originalSeverity = issue.severity;
        patch.severity = next;
      }
    }

    await ctx.db.patch(args.issueId, patch);
  },
});

export const removeIssue = mutation({
  args: { issueId: v.id("tenantIssues") },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.orgId !== org.orgId) return;
    await ctx.db.delete(args.issueId);
  },
});
