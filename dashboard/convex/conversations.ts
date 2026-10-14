import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isOtlpPayload, parseOtlp } from "./otlp";
import { computeLeadScore } from "./leadScoring";
import { currentOrg } from "./authz";

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
export const history = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) {
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
        return { ...c, messageCount: messages.length, leadScore: computeLeadScore(qualification) };
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
    // A conversation with no team is either the public landing-page demo (never signed in, so
    // nothing to compare against) or a phone call still waiting on the post-call webhook to
    // backfill it — both readable by anyone who already has the id. One that DOES belong to a
    // team is dashboard data: only that team reads it.
    if (conv.orgId) {
      const org = await currentOrg(ctx);
      if (!org || org.orgId !== conv.orgId) return [];
    }
    return ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
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
  handler: (ctx, args) =>
    ctx.db.patch(args.conversationId, {
      elevenLabsConversationId: args.elevenLabsConversationId,
    }),
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
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const lastOfRole = [...existing].reverse().find((m) => m.role === args.role);
    if (lastOfRole && !lastOfRole.isFinal) {
      await ctx.db.patch(lastOfRole._id, { text: args.text, isFinal: args.isFinal });
      return lastOfRole._id;
    }

    return ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      text: args.text,
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
      summary: `Tenant issue (severity ${args.severity}): ${args.reason}`.slice(0, 300),
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
 * The post-call webhook payload shape is not confirmed against real docs (ElevenLabs' pages
 * 404'd throughout this build) — field access here is defensive with fallbacks, and gets
 * corrected against the first real webhook delivery once configured.
 */
export const logDebugWebhook = internalMutation({
  args: { body: v.string() },
  handler: (ctx, args) => ctx.db.insert("debugWebhookLogs", { body: args.body, at: Date.now() }),
});

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
          if (!line.message) continue;
          await ctx.db.insert("messages", {
            conversationId: conv._id,
            role: line.role === "user" ? "user" : "agent",
            text: line.message,
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
    if (!conv || conv.status !== "active") return;

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
