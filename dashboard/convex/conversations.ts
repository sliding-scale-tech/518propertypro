import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isOtlpPayload, parseOtlp } from "./otlp";
import { computeLeadScore } from "./leadScoring";
import { currentOrg, requireAdminView, viewFor } from "./authz";
import { amScope, canSeeUnit } from "./amScope";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./audit";
import { stripAudioTags } from "./sanitize";
import { flagUnverifiedTransfer } from "./ownerRouting";

// Disabled: the 15-min/month free-tier cap no longer applies now that ElevenLabs is upgraded.
// Usage is still tracked below (secondsUsed) for visibility; it just isn't enforced as a limit
// anymore. Re-enable by uncommenting this and the limitSec/remainingSec fields below.
// export const MONTHLY_LIMIT_SEC = 15 * 60;

// A real call here runs a few minutes at most (see leadScoring/tour-length assumptions
// elsewhere) — anything still "active" this long after it started didn't end cleanly: a
// crashed tab, a dropped connection before onDisconnect fired, or (on phone calls, or in an
// environment where the post-call webhook isn't reaching this deployment) no reconciliation
// ever arriving at all. reconcileStaleActive below is the last-resort net under both the
// client-side end() calls and the webhook, so nothing shows as an open call forever.
const STALE_ACTIVE_MS = 30 * 60 * 1000;

function monthKey(at: number) {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * True when a conversation belongs on the Tenants page rather than in the lead list. Checked
 * two ways because neither alone is sufficient: a severity-8+ resident call has its intent
 * overwritten to "escalation" by markEscalation, and an issue deleted from the Tenants page
 * leaves its conversation row behind with intent "maintenance".
 */
function isResidentCall(
  conversation: { elevenLabsConversationId?: string; intent?: string },
  residentCallIds: Set<string>,
): boolean {
  if (conversation.intent === "maintenance") return true;
  return Boolean(
    conversation.elevenLabsConversationId &&
      residentCallIds.has(conversation.elevenLabsConversationId),
  );
}

/**
 * A leasing lead: someone actually inquiring about an apartment. Resident/maintenance calls
 * and "I'm not looking for an apartment" (or otherwise unclassified) calls are not leads —
 * they must not appear in the Leads list or its top-line stats.
 */
export function isLeasingLead(
  conversation: {
    _id: Id<"conversations">;
    elevenLabsConversationId?: string;
    intent?: string;
  },
  residentCallIds: Set<string>,
  qualificationConversationIds: Set<Id<"conversations">>,
  qualificationElevenLabsIds: Set<string>,
): boolean {
  if (isResidentCall(conversation, residentCallIds)) return false;
  if (conversation.intent === "leasing") return true;
  if (qualificationConversationIds.has(conversation._id)) return true;
  return Boolean(
    conversation.elevenLabsConversationId &&
      qualificationElevenLabsIds.has(conversation.elevenLabsConversationId),
  );
}

// --- Access helpers -------------------------------------------------------

/**
 * Who may READ a conversation's transcript / qualification.
 *  - Org conversation: same org only. Admin view reads all; asset_manager only leasing leads
 *    (team-wide) or resident calls whose maintenance request sits on a unit in their scope;
 *    technician / accountant / none are denied.
 *  - No-org conversation: only the public landing-page demo (channel "browser"; its id is an
 *    unguessable Convex id handed only to the demo visitor). Phone placeholders awaiting the
 *    post-call backfill are denied.
 */
export async function canReadConversation(
  ctx: QueryCtx | MutationCtx,
  conv: Doc<"conversations">,
): Promise<boolean> {
  if (!conv.orgId) return conv.channel === "browser";
  const org = await currentOrg(ctx);
  if (!org || org.orgId !== conv.orgId) return false;
  const view = viewFor(org.isAdmin, org.jobRoles);
  if (view === "admin") return true;
  if (view !== "asset_manager") return false;

  const elId = conv.elevenLabsConversationId;
  const requests = elId
    ? await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", elId))
        .collect()
    : [];
  if (requests.length > 0) {
    const scope = await amScope(ctx, org);
    return requests.some((r) => r.orgId === String(conv.orgId) && canSeeUnit(scope, r.unitId));
  }
  // Other resident calls (tenantIssue only, unit not resolvable to an id): deny.
  if (conv.intent === "maintenance") return false;
  if (elId) {
    const issue = await ctx.db
      .query("tenantIssues")
      .withIndex("by_elevenlabs_conversation_id", (q) => q.eq("elevenLabsConversationId", elId))
      .first();
    if (issue) return false;
  }
  if (conv.intent === "leasing") return true;
  const qual = elId
    ? await ctx.db
        .query("qualifications")
        .withIndex("by_elevenlabs_conversation_id", (q) => q.eq("elevenLabsConversationId", elId))
        .first()
    : null;
  return Boolean(qual);
}

/** Who may WRITE to a conversation from the client (append / end / attach id). */
async function canWriteConversation(
  ctx: MutationCtx,
  conv: Doc<"conversations">,
): Promise<boolean> {
  if (!conv.orgId) return conv.channel === "browser"; // anonymous demo only
  const org = await currentOrg(ctx);
  if (!org || org.orgId !== conv.orgId) return false;
  // Within the team: the admin view, or the person who started this call. Any other member
  // knowing the id must not be able to append to, end, or re-point someone else's call.
  return viewFor(org.isAdmin, org.jobRoles) === "admin" || conv.userId === org.user._id;
}

// --- Reads ----------------------------------------------------------------

/**
 * The lead log. Only leasing inquiries belong here — resident/maintenance calls go on the
 * Tenants page, and a caller who is not looking for an apartment is not a lead.
 *
 * Membership is decided by leasing intent or a captured qualification, plus an exclusion for
 * tenant issues. A severity-8+ resident call gets its intent overwritten to "escalation" by
 * markEscalation, so filtering on intent alone would let those leak back in here.
 *
 * intent === "maintenance" is checked as well, so that deleting an issue from the Tenants page
 * doesn't pop its call back into the lead list as an orphan.
 *
 * Caveat inherited from filtering after pagination: a page of 15 can come back shorter when
 * some of those 15 were not leads. Fine at this volume, and the same thing the page's
 * own intent/outcome filters already do.
 */
// TODO(★ leads scoping): revisit whether AMs should only see leads for their properties.
export const history = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    // Lead history is not for technicians or accountants.
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const result = await ctx.db
      .query("conversations")
      .withIndex("by_org_and_started", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .paginate(args.paginationOpts);

    // Read across every team's rows rather than joining per-conversation — safe because the
    // .find() below only ever matches against `page`, which is already scoped to this team's
    // own conversations by the indexed query above.
    const allQualifications = await ctx.db.query("qualifications").collect();
    const qualificationConversationIds = new Set(
      allQualifications.flatMap((q) => (q.conversationId ? [q.conversationId] : [])),
    );
    const qualificationElevenLabsIds = new Set(
      allQualifications.map((q) => q.elevenLabsConversationId),
    );
    const residentCallIds = new Set(
      (await ctx.db.query("tenantIssues").collect()).map((i) => i.elevenLabsConversationId),
    );

    const page = await Promise.all(
      result.page
        .filter((c) =>
          isLeasingLead(c, residentCallIds, qualificationConversationIds, qualificationElevenLabsIds),
        )
        .map(async (c) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversationId", c._id))
          .collect();
        const qualification = allQualifications.find((q) => q.conversationId === c._id);

        // Who the lead is assigned to, and the tour if one is booked (both admin and AM views).
        // AMs still see every lead; assignedToMe lets the UI highlight theirs.
        const assignee = qualification?.assignedUserId ? await ctx.db.get(qualification.assignedUserId) : null;
        const assignedUser =
          qualification?.assignedUserId && assignee
            ? {
                userId: qualification.assignedUserId,
                name: [assignee.firstName, assignee.lastName].filter(Boolean).join(" ").trim() || assignee.email || "Team member",
              }
            : null;
        const tourRow = c.elevenLabsConversationId
          ? (
              await ctx.db
                .query("tours")
                .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", c.elevenLabsConversationId))
                .take(5)
            )
              .filter((t) => t.orgId === org.orgId && t.status === "booked")
              .sort((a, b) => b.start - a.start)[0]
          : undefined;
        const tourUser = tourRow ? await ctx.db.get(tourRow.assignedUserId) : null;
        const tour = tourRow
          ? {
              start: tourRow.start,
              timeZone: tourRow.timeZone,
              assignedUserId: tourRow.assignedUserId,
              assignedName: tourUser
                ? [tourUser.firstName, tourUser.lastName].filter(Boolean).join(" ").trim() || tourUser.email || "Team member"
                : "Team member",
            }
          : null;
        return {
          ...c,
          messageCount: messages.length,
          leadScore: computeLeadScore(qualification),
          assignedUser,
          assignedToMe:
            qualification?.assignedUserId === org.user._id || tourRow?.assignedUserId === org.user._id,
          tour,
        };
      }),
    );

    return { ...result, page };
  },
});

export const transcript = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return [];
    if (!(await canReadConversation(ctx, conv))) return [];
    const lines = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    // Every transcript view reads this, and rows from before tags were stripped on write still have them.
    return lines.flatMap((line) => {
      const text = line.role === "agent" ? stripAudioTags(line.text) : line.text;
      return text ? [{ ...line, text }] : [];
    });
  },
});

/**
 * Resolves which team a mid-call tool webhook belongs to, from the same
 * system__conversation_id every tool call already carries (convex/http.ts).
 *
 * Only ever succeeds once a conversations row exists for this call — true from the very
 * start of a browser call (created before the ElevenLabs session even connects), but not
 * necessarily yet for a phone call's first tool invocation. Callers fall back to the default
 * agent/property when this returns undefined.
 */
export const orgByElevenLabsId = internalQuery({
  args: { elevenLabsConversationId: v.string() },
  handler: async (ctx, args) => {
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();
    return conv?.orgId;
  },
});

export const usage = query({
  args: {},
  handler: async (ctx) => {
    const key = monthKey(Date.now());
    const org = await currentOrg(ctx);

    // secondsUsed still rolls up globally (the `usage` table has no per-team split — it's
    // the account's ElevenLabs minute meter, not a per-tenant one, and splitting billing
    // tracking is a separate decision from scoping the Leads list itself). callCount and
    // avgDurationSec below are this team's leasing leads only, matching the Leads page.
    const row = await ctx.db
      .query("usage")
      .withIndex("by_month", (q) => q.eq("monthKey", key))
      .first();
    const secondsUsed = row?.secondsUsed ?? 0;

    const conversations = org
      ? await ctx.db
          .query("conversations")
          .withIndex("by_org_and_started", (q) => q.eq("orgId", org.orgId))
          .collect()
      : [];
    const allQualifications = await ctx.db.query("qualifications").collect();
    const qualificationConversationIds = new Set(
      allQualifications.flatMap((q) => (q.conversationId ? [q.conversationId] : [])),
    );
    const qualificationElevenLabsIds = new Set(
      allQualifications.map((q) => q.elevenLabsConversationId),
    );
    const residentCallIds = new Set(
      (await ctx.db.query("tenantIssues").collect()).map((i) => i.elevenLabsConversationId),
    );
    const leadsThisMonth = conversations.filter(
      (c) =>
        monthKey(c.startedAt) === key &&
        isLeasingLead(c, residentCallIds, qualificationConversationIds, qualificationElevenLabsIds),
    );
    return {
      monthKey: key,
      secondsUsed,
      // limitSec: MONTHLY_LIMIT_SEC,
      // remainingSec: Math.max(0, MONTHLY_LIMIT_SEC - secondsUsed),
      callCount: leadsThisMonth.length,
      avgDurationSec:
        leadsThisMonth.length > 0
          ? Math.round(
              leadsThisMonth.reduce((s, c) => s + (c.durationSec ?? 0), 0) /
                leadsThisMonth.length,
            )
          : 0,
    };
  },
});

// --- Writes ---------------------------------------------------------------

export const start = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    // No sign-in requirement here on purpose: this is also the entry point for the public
    // landing-page demo. Signed in → the call is stamped with this team, and only they will
    // ever see it on their Leads page. Not signed in → orgId stays undefined.
    const org = await currentOrg(ctx);
    return ctx.db.insert("conversations", {
      userId: org?.user._id,
      orgId: org?.orgId,
      agentId: args.agentId,
      channel: "browser",
      startedAt: Date.now(),
      status: "active",
    });
  },
});

/**
 * Once the browser's WebRTC session connects, it learns its ElevenLabs conversation id
 * (conversation.getId()). Stamping it here lets the post-call webhook find and reconcile this
 * row instead of creating a duplicate for the same call.
 */
export const attachElevenLabsId = mutation({
  args: {
    conversationId: v.id("conversations"),
    elevenLabsConversationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || !(await canWriteConversation(ctx, conv))) throw new ConvexError("Call not found.");
    // Set once: a later call must not re-point a conversation at another ElevenLabs id.
    if (conv.elevenLabsConversationId) return;
    await ctx.db.patch(args.conversationId, {
      elevenLabsConversationId: args.elevenLabsConversationId,
    });
  },
});

/**
 * Appends a transcript line, or overwrites the trailing tentative line for the same role.
 * The SDK emits tentative transcripts that get superseded; appending them verbatim makes the
 * transcript stutter and duplicate.
 */
export const appendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("agent")),
    text: v.string(),
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || !(await canWriteConversation(ctx, conv))) throw new ConvexError("Call not found.");
    const text = args.role === "agent" ? stripAudioTags(args.text) : args.text;
    if (!text) return null;
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const lastOfRole = [...existing].reverse().find((m) => m.role === args.role);
    if (lastOfRole && !lastOfRole.isFinal) {
      await ctx.db.patch(lastOfRole._id, { text, isFinal: args.isFinal });
      return lastOfRole._id;
    }

    return ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      text,
      isFinal: args.isFinal,
      at: Date.now(),
    });
  },
});

/** Lead funnel — same leasing-lead set as `history` and the top stat cards. */
export const funnel = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return { callsAnswered: 0, leadsQualified: 0, toursBooked: 0 };
    const view = viewFor(org.isAdmin, org.jobRoles);
    if (view !== "admin" && view !== "asset_manager") {
      return { callsAnswered: 0, leadsQualified: 0, toursBooked: 0 };
    }

    const residentCallIds = new Set(
      (await ctx.db.query("tenantIssues").collect()).map((i) => i.elevenLabsConversationId),
    );
    const allQualifications = await ctx.db.query("qualifications").collect();
    const qualificationConversationIds = new Set(
      allQualifications.flatMap((q) => (q.conversationId ? [q.conversationId] : [])),
    );
    const qualificationElevenLabsIds = new Set(
      allQualifications.map((q) => q.elevenLabsConversationId),
    );
    const rows = (
      await ctx.db
        .query("conversations")
        .withIndex("by_org_and_started", (q) => q.eq("orgId", org.orgId))
        .collect()
    ).filter((c) =>
      isLeasingLead(c, residentCallIds, qualificationConversationIds, qualificationElevenLabsIds),
    );
    return {
      callsAnswered: rows.length,
      leadsQualified: rows.filter(
        (r) => r.intent === "leasing" && r.outcome !== "disqualified",
      ).length,
      toursBooked: rows.filter((r) => r.outcome === "tour_booked").length,
    };
  },
});

/**
 * Guarantees a conversations row (with the team on it) exists for a phone call that has just
 * captured a leasing lead. A phone call has no conversations row until the post-call webhook, and
 * the Leads page lists conversations, so without this a lead would be invisible until the webhook
 * arrives -- and forever if it never does. The row is a placeholder like markEscalation's: no
 * intent/outcome (the webhook still classifies it from the qualification), status "active"
 * (the webhook ends it; reconcileStaleActive is the net under that). Never creates a second row
 * for a call that already has one; an existing row with no team just gets the team stamped on.
 */
export async function ensureLeadConversation(
  ctx: MutationCtx,
  orgId: string,
  elevenLabsConversationId: string,
): Promise<Id<"conversations"> | null> {
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_elevenlabs_conversation_id", (q) =>
      q.eq("elevenLabsConversationId", elevenLabsConversationId),
    )
    .first();
  const agent = await ctx.db
    .query("agents")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (existing) {
    // Never hand back (or link a lead to) another team's conversation row.
    if (existing.orgId && existing.orgId !== orgId) return null;
    if (!existing.orgId && agent) {
      await ctx.db.patch(existing._id, { orgId, userId: existing.userId ?? agent.userId });
    }
    return existing._id;
  }
  if (!agent) return null;
  return await ctx.db.insert("conversations", {
    userId: agent.userId,
    orgId,
    agentId: agent._id,
    elevenLabsConversationId,
    channel: "phone",
    startedAt: Date.now(),
    status: "active",
  });
}

/**
 * Called by the escalate server tool. The conversations row may not exist yet for a phone
 * call — the escalation still needs to be visible immediately, so a placeholder row is
 * created here and the post-call webhook fills in the rest later.
 *
 * That backfill is also what assigns userId on a phone call's placeholder row: unlike escalate
 * (or log_tenant_issue below), this route has no reliable way yet to tell which of our users
 * the call belongs to — only the post-call webhook, which gets the real agent_id straight from
 * ElevenLabs, can resolve that. See ingestFromWebhook.
 */
export const markEscalation = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    reason: v.string(),
    summary: v.string(),
    escalatedTo: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();

    const patch = {
      intent: "escalation" as const,
      outcome: "escalated" as const,
      escalatedTo: args.escalatedTo,
      summary: `Escalated (${args.reason}): ${args.summary}`.slice(0, 300),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return;
    }

    const agent = await ctx.db.query("agents").first();
    if (!agent) return;
    await ctx.db.insert("conversations", {
      agentId: agent._id,
      elevenLabsConversationId: args.elevenLabsConversationId,
      channel: "phone",
      startedAt: Date.now(),
      status: "active",
      ...patch,
    });
  },
});

/**
 * Called by the log_tenant_issue server tool. Same placeholder-row shape as markEscalation
 * above, with one deliberate difference: the intent is only claimed if nothing has claimed it
 * yet. On a severity-8+ call the agent calls this and then escalate, and escalate patching
 * unconditionally afterwards is what makes the escalation win — the same precedence
 * ingestFromWebhook already respects when it defers to a mid-call classification.
 *
 * This is the first code in the codebase to write intent: "maintenance", which has been
 * declared in the schema and rendered by the History page since the beginning without ever
 * being set.
 *
 * Known trade-off: claiming the intent here means ingestFromWebhook will skip its own
 * classification, so the call keeps this template summary rather than ElevenLabs' richer
 * transcript summary. Escalations already behave exactly this way.
 */
export const markTenantIssue = internalMutation({
  args: {
    elevenLabsConversationId: v.string(),
    reason: v.string(),
    severity: v.number(),
    callerNumber: v.optional(v.string()),
    // log_maintenance_request names its severity level rather than a 1-10 score, so it passes the
    // finished summary line; log_tenant_issue leaves this out and keeps the numeric wording.
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", args.elevenLabsConversationId),
      )
      .first();

    const classification = {
      intent: "maintenance" as const,
      outcome: "logged_only" as const,
      summary: (args.summary ?? `Tenant issue (severity ${args.severity}): ${args.reason}`).slice(0, 300),
    };

    if (existing) {
      const patch: Record<string, unknown> = {};
      if (!existing.intent) Object.assign(patch, classification);
      if (args.callerNumber && !existing.callerNumber) patch.callerNumber = args.callerNumber;
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return;
    }

    const agent = await ctx.db.query("agents").first();
    if (!agent) return;
    await ctx.db.insert("conversations", {
      agentId: agent._id,
      elevenLabsConversationId: args.elevenLabsConversationId,
      channel: "phone",
      callerNumber: args.callerNumber,
      startedAt: Date.now(),
      status: "active",
      ...classification,
    });
  },
});

/**
 * The post-call webhook payload shape is not confirmed against real docs; field access in
 * ingestFromWebhook is defensive with fallbacks. (The debugWebhookLogs writer was removed:
 * it stored raw call payloads, which contain PII.)
 */
export const ingestFromWebhook = internalMutation({
  args: { payload: v.any() },
  handler: async (ctx, args) => {
    const data = args.payload?.data ?? args.payload;

    // ElevenLabs sends OTLP rather than plain JSON on this workspace; parse whichever arrives.
    const otlp = isOtlpPayload(args.payload) ? parseOtlp(args.payload) : null;

    const conversationId: string | undefined = otlp?.conversationId ?? data?.conversation_id;
    if (!conversationId) return;

    // ElevenLabs includes which agent took the call right alongside conversation_id — verified
    // against a real captured payload (see debugWebhookLogs), both at data.agent_id and inside
    // the OTLP span attributes as elevenlabs.agent_id. This is what makes a phone call
    // attributable to the right user at all: nothing earlier in the call (the tool webhooks in
    // http.ts) has a reliable way to know that. Falls back to whichever agent exists first if
    // the id is missing or unrecognised — defensive, matching the rest of this function, and
    // exactly today's behavior for the one pre-multi-tenancy agent / the public demo agent.
    const agentId: string | undefined = data?.agent_id;
    const agent = agentId
      ? ((await ctx.db
          .query("agents")
          .withIndex("by_elevenlabs_id", (q) => q.eq("elevenLabsAgentId", agentId))
          .first()) ?? (await ctx.db.query("agents").first()))
      : await ctx.db.query("agents").first();
    if (!agent) return;

    const transcript: Array<{ role?: string; message?: string; time_in_call_secs?: number }> = otlp
      ? otlp.transcript.map((t) => ({ role: t.role === "user" ? "user" : "agent", message: t.text }))
      : (data?.transcript ?? []);
    const durationSec: number | undefined =
      otlp?.durationSec ?? data?.metadata?.call_duration_secs ?? data?.metadata?.duration_secs;
    const callerNumber: string | undefined =
      otlp?.callerNumber ??
      data?.metadata?.phone_call?.external_number ??
      data?.metadata?.caller_id ??
      data?.conversation_initiation_client_data?.caller_id;
    const startedAtSec: number | undefined =
      (otlp?.startedAt ? otlp.startedAt / 1000 : undefined) ?? data?.metadata?.start_time_unix_secs;

    let conv = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) =>
        q.eq("elevenLabsConversationId", conversationId),
      )
      .first();

    const startedAt = startedAtSec ? startedAtSec * 1000 : Date.now();
    const endedAt = durationSec ? startedAt + durationSec * 1000 : Date.now();

    // Only the transition into "ended" should ever roll usage — a webhook retry for a call
    // already marked ended must not re-add the same minutes a second time.
    const isFirstEnding = !conv || conv.status === "active";

    if (!conv) {
      const id = await ctx.db.insert("conversations", {
        userId: agent.userId,
        orgId: agent.orgId,
        agentId: agent._id,
        elevenLabsConversationId: conversationId,
        channel: "phone",
        callerNumber,
        startedAt,
        endedAt,
        durationSec,
        status: "ended",
      });
      conv = await ctx.db.get(id);
    } else if (conv.status === "active") {
      await ctx.db.patch(conv._id, {
        endedAt,
        durationSec: durationSec ?? Math.round((endedAt - conv.startedAt) / 1000),
        status: "ended",
        callerNumber: conv.callerNumber ?? callerNumber,
        // Backfills a phone call's placeholder row (markEscalation/markTenantIssue create one
        // with no team, since neither has a reliable agent_id to resolve one from) now that
        // the real owning agent is known. Never overwrites a browser call's orgId, which was
        // already set correctly the moment the call started.
        userId: conv.userId ?? agent.userId,
        orgId: conv.orgId ?? agent.orgId,
      });
    }
    if (!conv) return;

    // Phone calls have no live transcript stream — write it now. Browser calls already have
    // one from streaming, so skip to avoid duplicating every line.
    if (conv.channel === "phone") {
      const existingMessages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conv!._id))
        .collect();
      if (existingMessages.length === 0) {
        for (const line of transcript) {
          const text = line.role === "user" ? line.message : stripAudioTags(line.message ?? "");
          if (!text) continue;
          await ctx.db.insert("messages", {
            conversationId: conv._id,
            role: line.role === "user" ? "user" : "agent",
            text,
            isFinal: true,
            at: startedAt + (line.time_in_call_secs ?? 0) * 1000,
          });
        }
      }
    }

    // Link and copy over whatever a tool call captured mid-conversation.
    const qualification = await ctx.runQuery(internal.qualifications.byElevenLabsId, {
      elevenLabsConversationId: conversationId,
    });
    if (qualification) {
      await ctx.runMutation(internal.qualifications.linkConversation, {
        elevenLabsConversationId: conversationId,
        conversationId: conv._id,
      });
      // The caller often never states their number out loud — telephony already knows it, so
      // back-fill it rather than leaving the lead unreachable.
      if (!qualification.callerPhone && callerNumber) {
        await ctx.runMutation(internal.qualifications.upsertByConversationId, {
          elevenLabsConversationId: conversationId,
          callerPhone: callerNumber,
        });
      }
    }

    // Same idea for a resident issue logged mid-call. The back-fill matters more here than it
    // does for leads: the caller's number is the roster's only match key, so a browser call or
    // a call where caller ID was unavailable would otherwise never be recognised again.
    const tenantIssue = await ctx.runQuery(internal.tenants.issueByElevenLabsId, {
      elevenLabsConversationId: conversationId,
    });
    if (tenantIssue) {
      await ctx.runMutation(internal.tenants.linkConversation, {
        elevenLabsConversationId: conversationId,
        conversationId: conv._id,
        callerNumber,
        userId: conv.userId,
        orgId: conv.orgId,
      });
    }

    // Same back-fill for a maintenance request Sarah took mid-call (log_maintenance_request). On a
    // phone call no conversations row existed yet, so createFromCall stored it unlinked; without
    // this the request detail page could not show the call's transcript. Scoped to the call's own
    // team so a request is never attached to another team's conversation.
    const maintenanceRequests = await ctx.db
      .query("maintenanceRequests")
      .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", conversationId))
      .collect();
    for (const request of maintenanceRequests) {
      if (request.conversationId) continue;
      if (conv.orgId && request.orgId !== conv.orgId) continue;
      await ctx.db.patch(request._id, { conversationId: conv._id, updatedAt: Date.now() });
    }

    // Owner call menu safety net: a transfer to a staff phone on a call with no verified owner. The
    // transfer destination is only ever set for a verified owner, so this should never fire; if it
    // does, admins see it on the call's audit trail and the team's callback list.
    const transcriptTools = Array.isArray(data?.transcript)
      ? (data.transcript as Array<{ tool_calls?: Array<{ tool_name?: string; name?: string }> }>).flatMap((t) => t?.tool_calls ?? [])
      : [];
    const transferred =
      !!otlp?.transferred ||
      /transfer/i.test(String(otlp?.terminationReason ?? data?.metadata?.termination_reason ?? "")) ||
      transcriptTools.some((c) => c?.tool_name === "transfer_to_number" || c?.name === "transfer_to_number");
    if (transferred && conv.orgId) {
      await flagUnverifiedTransfer(ctx, {
        orgId: conv.orgId,
        elevenLabsConversationId: conversationId,
        conversationId: conv._id,
        callerNumber,
      });
    }

    // Only set intent/outcome/summary if a tool call during the call didn't already set them
    // (e.g. escalation) — this is the safety net for a silent or confused call the PRD
    // requires ("clean logged reason why not"), not an override of what actually happened.
    let finalSummary = conv.summary;
    if (!conv.intent) {
      const intent = qualification ? "leasing" : "unclear";
      const outcome = qualification?.tourConfirmed
        ? "tour_booked"
        : qualification?.qualifies === false
          ? "disqualified"
          : "logged_only";
      // ElevenLabs' own analysis summary is far richer than anything assembled from the
      // qualification fields, so prefer it and fall back to the template only if absent.
      const summary =
        otlp?.summary ??
        (qualification
          ? `${qualification.bedrooms ?? "unit"} inquiry, budget $${qualification.budget ?? "?"}, ` +
            `pets: ${qualification.petsWanted ? qualification.petType ?? "yes" : "no"} — ` +
            `${qualification.qualifies === false ? `disqualified (${qualification.disqualifyReason})` : qualification.tourConfirmed ? `tour requested ${qualification.tourSlot}` : "qualified"}`
          : "No qualification data captured for this call.");

      finalSummary = summary.slice(0, 600);
      await ctx.db.patch(conv._id, { intent, outcome, summary: finalSummary });
    }

    // Disabled: texting staff a summary after every call (not just escalations) — turned off
    // per request. Escalation alerts (notifications.sendEscalationAlert) are unaffected and
    // still fire. Re-enable by uncommenting this block.
    // await ctx.scheduler.runAfter(0, internal.notifications.sendCallSummary, {
    //   summary: finalSummary ?? "No summary available.",
    //   callerNumber: callerNumber ?? "unknown",
    //   durationSec: durationSec ?? Math.round((endedAt - startedAt) / 1000),
    // });

    // Roll usage the same way the browser path does on `end` — gated on isFirstEnding so a
    // webhook retry for a call already marked ended can't double-count minutes.
    if (isFirstEnding && durationSec !== undefined && conv.channel === "phone") {
      const key = monthKey(startedAt);
      const row = await ctx.db
        .query("usage")
        .withIndex("by_month", (q) => q.eq("monthKey", key))
        .first();
      if (row) await ctx.db.patch(row._id, { secondsUsed: row.secondsUsed + durationSec });
      else await ctx.db.insert("usage", { monthKey: key, secondsUsed: durationSec });
    }
  },
});

/**
 * Cron safety net (see crons.ts). Closes out any conversation still "active" long after it
 * must have actually ended, with a best-effort duration — capped at STALE_ACTIVE_MS rather than
 * "now", since a cron that runs every few minutes would otherwise inflate durationSec by however
 * long the row sat unnoticed. Marked "failed" rather than "ended": we don't know it wrapped up
 * cleanly, and callsHandled/history should still count it, just not read as a normal call.
 */
export const reconcileStaleActive = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_ACTIVE_MS;
    const stale = await ctx.db
      .query("conversations")
      .withIndex("by_started", (q) => q.lt("startedAt", cutoff))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    for (const conv of stale) {
      const endedAt = conv.startedAt + STALE_ACTIVE_MS;
      const durationSec = Math.round(STALE_ACTIVE_MS / 1000);
      await ctx.db.patch(conv._id, { endedAt, durationSec, status: "failed" });

      if (conv.channel === "phone") {
        const key = monthKey(conv.startedAt);
        const row = await ctx.db
          .query("usage")
          .withIndex("by_month", (q) => q.eq("monthKey", key))
          .first();
        if (row) await ctx.db.patch(row._id, { secondsUsed: row.secondsUsed + durationSec });
        else await ctx.db.insert("usage", { monthKey: key, secondsUsed: durationSec });
      }
    }
  },
});

export const end = mutation({
  args: {
    conversationId: v.id("conversations"),
    status: v.optional(v.union(v.literal("ended"), v.literal("failed"))),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || !(await canWriteConversation(ctx, conv))) return;
    if (conv.status !== "active") return;

    const endedAt = Date.now();
    const durationSec = Math.round((endedAt - conv.startedAt) / 1000);
    await ctx.db.patch(args.conversationId, {
      endedAt,
      durationSec,
      status: args.status ?? "ended",
    });

    // Roll the minutes up as calls end, so the meter never depends on a later reconcile.
    const key = monthKey(conv.startedAt);
    const row = await ctx.db
      .query("usage")
      .withIndex("by_month", (q) => q.eq("monthKey", key))
      .first();
    if (row) await ctx.db.patch(row._id, { secondsUsed: row.secondsUsed + durationSec });
    else await ctx.db.insert("usage", { monthKey: key, secondsUsed: durationSec });
  },
});

/**
 * Calls nobody has dealt with yet: the call failed, or Sarah could not tell what it was about
 * (intent "unclear"), and no one has marked it followed up. Admin view only. Looks at the
 * latest 200 calls, which is far more than a week of volume for one team.
 */
export const needsFollowUp = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org || viewFor(org.isAdmin, org.jobRoles) !== "admin") return [];
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_org_and_started", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .take(200);
    return rows
      .filter((c) => !c.followedUpAt && (c.status === "failed" || c.intent === "unclear"))
      .map((c) => ({
        _id: c._id,
        callerNumber: c.callerNumber,
        channel: c.channel,
        startedAt: c.startedAt,
        durationSec: c.durationSec,
        status: c.status,
        intent: c.intent,
        summary: c.summary,
      }));
  },
});

export const markFollowedUp = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const conversation = await ctx.db.get(args.conversationId);
    // Same answer for missing and another team's call.
    if (!conversation || conversation.orgId !== org.orgId) throw new ConvexError("Call not found.");
    if (conversation.followedUpAt) return;
    await ctx.db.patch(conversation._id, { followedUpAt: Date.now(), followedUpBy: org.user._id });
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "conversation",
      entityId: conversation._id,
      action: "followed_up",
      actorUserId: org.user._id,
    });
  },
});
