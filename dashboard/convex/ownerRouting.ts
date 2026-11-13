import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./audit";
import { publishedConfig } from "./sarahConfigRead";
import { ownerRoutingMenu } from "./sarahConfigLib";
import { findMenuEntry, MENU_OFF_SAY, OWNER_DIAL_TIMEOUT_SECS, STAFF_MESSAGE_PREFIX, staffCheck } from "./ownerRoutingLib";
import type { StaffCheck } from "./ownerRoutingLib";
import {
  callCleared,
  hasLiveVerification,
  maskEmail,
  MAX_EMAIL_ATTEMPTS_PER_CALL,
  ownerEmailsOf,
  PROPERTY_FAILURE_WINDOW_MS,
  spokenEmailToAddress,
  addressInputKind,
  VERIFICATION_RETENTION_MS,
  VERIFY_SAY,
  verifyDecision,
} from "./ownerVerifyLib";
import { lookupAddress, streetLine } from "./sarahTools";

/**
 * The mid-call tools behind the owner call menu (Sarah Configuration section 13). They are only
 * attached to the agent while the menu is live (see agents.ts), and they read the PUBLISHED config,
 * so a draft never changes what a caller gets.
 *
 *   verify_owner: the caller's property (matched like find_unit) and the email on file for it, checked
 *   against every owner email of that property. The result is stored per call (ownerVerifications).
 *   check_staff_availability: refuses (verify_first) unless this call has a verified owner, or a new
 *   owner route_owner_prospect recorded (B46: wants us to manage a property; no email check). Then it
 *   decides from the directory and the clock, never the model, whether the person can be put through
 *   now, and gives Sarah the number to transfer to and the line to say. That number is also what the
 *   transfer tool dials (a dynamic variable set from this result), so nothing else can reach a phone.
 *   take_staff_message: records a message for someone who cannot be reached, on the team's callback
 *   list, assigned to that person's team member when the directory names one. No text is sent.
 *
 * Every check and every message is written to the audit trail against the conversation.
 */

/**
 * Sarah's own phone line(s), from server env. A routing entry may never be one of these: a transfer
 * there would ring straight back to Sarah.
 */
export function ownLines(): string[] {
  const n = process.env.TWILIO_SMS_FROM_NUMBER?.trim();
  return n ? [n] : [];
}

export type { StaffCheck } from "./ownerRoutingLib";

/** This call's verification rows (one per property tried), this team's only. */
async function verificationsFor(ctx: QueryCtx, orgId: string, elevenLabsConversationId: string): Promise<Doc<"ownerVerifications">[]> {
  return (
    await ctx.db
      .query("ownerVerifications")
      .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", elevenLabsConversationId))
      .collect()
  ).filter((r) => r.orgId === orgId);
}

/** Audit action route_owner_prospect writes on the call (B46): a NEW owner recorded on this call. */
export const NEW_OWNER_RECORDED = "owner_prospect_logged";
const TRANSFER_DIALING = "owner_transfer_dialing";

/** This call's audit events with one of `actions`, this team's only, newest first. */
async function callEvents(ctx: QueryCtx, orgId: string, elevenLabsConversationId: string, actions: string[]): Promise<Doc<"auditEvents">[]> {
  return (
    await ctx.db
      .query("auditEvents")
      .withIndex("by_entity", (q) => q.eq("entity", "conversation").eq("entityId", elevenLabsConversationId))
      .order("desc")
      .collect()
  ).filter((e) => e.orgId === orgId && actions.includes(e.action));
}

/** Whether route_owner_prospect recorded a new owner on this call (server-side, never the model). */
async function newOwnerRecorded(ctx: QueryCtx, orgId: string, elevenLabsConversationId: string): Promise<boolean> {
  return (await callEvents(ctx, orgId, elevenLabsConversationId, [NEW_OWNER_RECORDED])).length > 0;
}

/**
 * The one gate on putting a call through: a verified existing owner on this call, or a new owner
 * route_owner_prospect recorded on it (ownerVerifyLib.callCleared).
 */
export async function callClearance(
  ctx: QueryCtx,
  orgId: string,
  elevenLabsConversationId: string,
  rows?: Doc<"ownerVerifications">[],
): Promise<{ cleared: boolean; newOwner: boolean }> {
  const r = rows ?? (await verificationsFor(ctx, orgId, elevenLabsConversationId));
  return callCleared(r, await newOwnerRecorded(ctx, orgId, elevenLabsConversationId), Date.now());
}

export const checkStaffAvailability = internalMutation({
  args: { orgId: v.string(), elevenLabsConversationId: v.string(), person: v.string() },
  handler: async (ctx, args): Promise<StaffCheck & { newOwner: boolean }> => {
    const config = await publishedConfig(ctx, args.orgId);
    const menu = config ? ownerRoutingMenu(config, ownLines()) : null;
    // The gate: a verified owner or a recorded new owner on THIS call (server-side rows), never
    // anything the model says.
    const gate = menu ? await callClearance(ctx, args.orgId, args.elevenLabsConversationId) : { cleared: false, newOwner: false };
    const who = gate.newOwner ? "New owner (wants us to manage a property)" : "Verified owner";
    const out: StaffCheck = staffCheck(menu, gate.cleared, args.person, Date.now(), {
      fallback: config?.routingDirectory.fallback,
      afterHours: config?.routingDirectory.afterHours,
    });
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "conversation",
      entityId: args.elevenLabsConversationId,
      action: out.status === "available" ? "owner_transfer_started" : "owner_transfer_unavailable",
      to: out.label ?? undefined,
      note:
        out.status === "available"
          ? `${who} asked for ${out.label} (key ${out.key}). Available now: Sarah was told to put the call through.`
          : `Owner asked for "${args.person.slice(0, 80)}": ${
              out.status === "verify_first"
                ? "refused, the caller was not verified as an owner (verify_owner) or recorded as a new owner (route_owner_prospect) on this call"
                : out.status === "after_hours"
                  ? `${out.label} is outside their hours`
                  : out.status === "no_number"
                    ? `${out.label} has no number in the directory`
                    : out.status === "not_found"
                      ? "no one in the directory matched"
                      : "the owner call menu is off"
            }.${out.status === "verify_first" ? " No number was given." : " Sarah takes a message."}`,
    });
    return { ...out, newOwner: gate.newOwner };
  },
});

/**
 * route_owner_prospect recorded a NEW owner (wants the company to manage a property) on this call
 * (B46). Writes the audit event that clears the call for the phone menu, once per call, and says
 * whether the menu is live: if not, Sarah tells them Alex will call them back and reads no menu.
 */
export const recordNewOwner = internalMutation({
  args: { orgId: v.string(), elevenLabsConversationId: v.string(), name: v.string() },
  handler: async (ctx, args): Promise<{ menuLive: boolean }> => {
    const config = await publishedConfig(ctx, args.orgId);
    const menu = config ? ownerRoutingMenu(config, ownLines()) : null;
    if (!(await newOwnerRecorded(ctx, args.orgId, args.elevenLabsConversationId))) {
      await writeAudit(ctx, {
        orgId: args.orgId,
        entity: "conversation",
        entityId: args.elevenLabsConversationId,
        action: NEW_OWNER_RECORDED,
        note:
          `New owner prospect recorded (${args.name.replace(/\s+/g, " ").trim().slice(0, 80)}); executives notified. ` +
          (menu ? "Sarah offers the owner phone menu (no email check: new owners get no owner data)." : "The owner phone menu is off: Sarah says Alex will call them back."),
      });
    }
    return { menuLive: menu !== null };
  },
});

export const takeStaffMessage = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    person: v.string(),
    callerName: v.optional(v.string()),
    callerNumber: v.optional(v.string()),
    callbackNumber: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<{ label: string | null; assigned: boolean }> => {
    const config = await publishedConfig(ctx, args.orgId);
    const menu = config ? (ownerRoutingMenu(config, ownLines()) ?? []) : [];
    const entry = findMenuEntry(menu, args.person);
    const label = entry?.label ?? null;

    // Only someone still on this team can be assigned; a stale id falls back to the admins' list.
    let assignee: Id<"users"> | undefined;
    if (entry?.userId) {
      const id = ctx.db.normalizeId("users", entry.userId);
      const m = id
        ? await ctx.db
            .query("memberships")
            .withIndex("by_user", (q) => q.eq("userId", id))
            .first()
        : null;
      if (id && m && m.orgId === args.orgId) assignee = id;
    }

    const reason = `${STAFF_MESSAGE_PREFIX}${label ?? args.person.slice(0, 80)} (owner call)`.slice(0, 300);
    const now = Date.now();
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_elevenlabs_conversation_id", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
      .first();
    // One row per person per call: a second call of the tool updates it.
    const existing = (
      await ctx.db
        .query("callbackContacts")
        .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
        .collect()
    ).find((r) => r.orgId === args.orgId && r.reason === reason);

    const fields = {
      callerName: args.callerName?.slice(0, 120),
      callerNumber: args.callerNumber?.slice(0, 40),
      callbackNumber: args.callbackNumber?.slice(0, 40),
      issueSummary: args.message.slice(0, 2000),
    };
    if (existing) {
      const patch: Record<string, unknown> = { issueSummary: fields.issueSummary, updatedAt: now };
      for (const k of ["callerName", "callerNumber", "callbackNumber"] as const) if (fields[k]) patch[k] = fields[k];
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("callbackContacts", {
        orgId: args.orgId,
        elevenLabsConversationId: args.elevenLabsConversationId,
        conversationId: conv?._id,
        ...fields,
        reason,
        assignedUserId: assignee,
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "conversation",
      entityId: args.elevenLabsConversationId,
      action: "owner_message_taken",
      to: label ?? undefined,
      note: `${existing ? "Updated the" : "Took a"} message for ${label ?? `"${args.person.slice(0, 80)}"`}${
        assignee ? ", on their callback list" : ", on the team's callback list (unassigned)"
      }.`,
    });
    return { label, assigned: !!assignee };
  },
});

// --- verify_owner ------------------------------------------------------------------------------

export type VerifyOwnerResult =
  | { status: "ask_property"; say: string }
  | { status: "verified"; say: string }
  | { status: "needs_property_confirmation"; candidates: string[]; say: string }
  | { status: "not_verified"; attemptsLeft: number; say: string }
  | { status: "no_match_take_message"; say: string };

/**
 * verify_owner. With an address only: the property, matched exactly as find_unit matches it (an exact
 * match, or options the caller confirms; never a guess), returned for Sarah to confirm. With an
 * address and an email: the email is checked against EVERY owner email of that property (exact,
 * case-insensitive), at most MAX_EMAIL_ATTEMPTS_PER_CALL times per call, and the result is stored for
 * this call. Returns nothing about any stored email, and behaves the same whether or not the property
 * has emails on file.
 */
export const verifyOwner = internalMutation({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.string(),
    spokenAddress: v.string(),
    email: v.optional(v.string()),
    /** Optional, as the caller gave it. Only written to the audit note; never used to verify. */
    callerName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<VerifyOwnerResult> => {
    const spoken = args.spokenAddress.trim();
    // No address, or only a keypad digit: ask for the property first. Nothing is looked up or
    // counted, and a one-building team never "matches" an address the caller did not say.
    const kind = addressInputKind(spoken);
    if (kind !== "lookup") return { status: "ask_property", say: kind === "keypad_first" ? VERIFY_SAY.keypadFirst : VERIFY_SAY.noAddress };
    const found = await lookupAddress(ctx, args.orgId, spoken);
    if (found.status !== "matched") {
      const options = found.options;
      return {
        status: "needs_property_confirmation",
        candidates: options,
        say: options.length
          ? options.length === 1
            ? VERIFY_SAY.confirmOne(options[0])
            : VERIFY_SAY.confirmMany(options)
          : found.status === "ambiguous" || found.status === "suggestions"
            ? VERIFY_SAY.needNumber
            : VERIFY_SAY.notFound,
      };
    }
    const property = found.property;
    const address = streetLine(property);
    const emailRaw = (args.email ?? "").trim();
    if (!emailRaw) return { status: "needs_property_confirmation", candidates: [address], say: VERIFY_SAY.confirmOne(address) };

    const now = Date.now();
    const rows = await verificationsFor(ctx, args.orgId, args.elevenLabsConversationId);
    const row = rows.find((r) => r.propertyId === property._id) ?? null;
    const recent = await ctx.db
      .query("ownerVerifications")
      .withIndex("by_property_and_last_attempt", (q) => q.eq("propertyId", property._id).gt("lastAttemptAt", now - PROPERTY_FAILURE_WINDOW_MS))
      .collect();
    const email = spokenEmailToAddress(emailRaw);
    const ownerEmails = ownerEmailsOf(property);
    const d = verifyDecision(
      {
        callAttempts: rows.reduce((n, r) => n + r.attempts, 0),
        propertyFailures: recent.filter((r) => r.orgId === args.orgId).reduce((n, r) => n + r.failures, 0),
        alreadyVerified: !!row && hasLiveVerification([row], now),
      },
      email,
      ownerEmails,
    );

    if (d.counts) {
      const ok = d.status === "verified";
      if (row) {
        await ctx.db.patch(row._id, {
          attempts: row.attempts + 1,
          failures: row.failures + (ok ? 0 : 1),
          verified: row.verified || ok,
          ...(ok ? { verifiedAt: now } : {}),
          lastAttemptAt: now,
        });
      } else {
        await ctx.db.insert("ownerVerifications", {
          orgId: args.orgId,
          elevenLabsConversationId: args.elevenLabsConversationId,
          propertyId: property._id,
          verified: ok,
          attempts: 1,
          failures: ok ? 0 : 1,
          ...(ok ? { verifiedAt: now } : {}),
          lastAttemptAt: now,
          createdAt: now,
        });
      }
    }
    if (d.audit) {
      const used = rows.reduce((n, r) => n + r.attempts, 0) + (d.counts ? 1 : 0);
      const name = (args.callerName ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      const gaveName = name ? ` Caller gave the name "${name}" (not used to verify).` : "";
      await writeAudit(ctx, {
        orgId: args.orgId,
        entity: "conversation",
        entityId: args.elevenLabsConversationId,
        action: d.audit,
        to: address,
        note:
          (d.audit === "owner_verify_ok"
            ? `Owner verified for ${address} with ${maskEmail(email)} (attempt ${used} of ${MAX_EMAIL_ATTEMPTS_PER_CALL}).`
            : d.audit === "owner_verify_failed"
              ? `Owner verification failed for ${address} with ${maskEmail(email)} (attempt ${used} of ${MAX_EMAIL_ATTEMPTS_PER_CALL})${
                  ownerEmails.length === 0 ? "; this property has no owner emails on file" : ""
                }.${d.status === "no_match_take_message" ? " No attempts left: Sarah takes a message, no transfer." : ""}`
              : `Owner verification refused for ${address}: ${
                  rows.reduce((n, r) => n + r.attempts, 0) >= MAX_EMAIL_ATTEMPTS_PER_CALL
                    ? "no attempts left on this call"
                    : "too many failed attempts on this property in the last 24 hours"
                }. Sarah takes a message, no transfer.`) + gaveName,
      });
    }

    if (d.status === "verified") return { status: "verified", say: VERIFY_SAY.verified };
    if (d.status === "not_verified") {
      return { status: "not_verified", attemptsLeft: d.attemptsLeft, say: d.counts ? VERIFY_SAY.retry : VERIFY_SAY.unclear };
    }
    return { status: "no_match_take_message", say: VERIFY_SAY.takeMessage };
  },
});

// --- transfer_owner_call (ownerRoutingLib.TRANSFER_MECHANISM "twilio_dial") ---------------------

export type BeginTransfer =
  | { ok: true; label: string; number: string; digits: string }
  | { ok: false; reason: StaffCheck["status"] | "already"; label: string | null; say: string };

/**
 * transfer_owner_call: the same gate as check_staff_availability, decided again on the server (a
 * verified owner on THIS call, the person available right now), never on what the model passes.
 * Once per call: the verified row is stamped, so a second call of the tool never dials twice.
 */
export const beginOwnerTransfer = internalMutation({
  args: { orgId: v.string(), elevenLabsConversationId: v.string(), person: v.string() },
  handler: async (ctx, args): Promise<BeginTransfer> => {
    const config = await publishedConfig(ctx, args.orgId);
    const menu = config ? ownerRoutingMenu(config, ownLines()) : null;
    const rows = menu ? await verificationsFor(ctx, args.orgId, args.elevenLabsConversationId) : [];
    const now = Date.now();
    const gate = menu ? await callClearance(ctx, args.orgId, args.elevenLabsConversationId, rows) : { cleared: false, newOwner: false };
    const out = staffCheck(menu, gate.cleared, args.person, now, {
      fallback: config?.routingDirectory.fallback,
      afterHours: config?.routingDirectory.afterHours,
    });
    if (out.status !== "available" || !out.transferNumber) {
      await writeAudit(ctx, {
        orgId: args.orgId,
        entity: "conversation",
        entityId: args.elevenLabsConversationId,
        action: "owner_transfer_refused",
        to: out.label ?? undefined,
        note: `transfer_owner_call for "${args.person.slice(0, 80)}" refused (${out.status}). Nothing was dialled; Sarah takes a message.`,
      });
      return { ok: false, reason: out.status, label: out.label, say: out.say || MENU_OFF_SAY };
    }
    // Once per call. A verified owner's row is stamped; a new owner has no row, so the dialing audit
    // event written below is the stamp (same mutation, so two tool calls never both dial).
    const verified = rows.filter((r) => r.verified).sort((a, b) => (b.verifiedAt ?? 0) - (a.verifiedAt ?? 0));
    if (verified.some((r) => r.transferStartedAt)) {
      return { ok: false, reason: "already", label: out.label, say: "" };
    }
    if (gate.newOwner) {
      if ((await callEvents(ctx, args.orgId, args.elevenLabsConversationId, [TRANSFER_DIALING])).length > 0) {
        return { ok: false, reason: "already", label: out.label, say: "" };
      }
    } else {
      await ctx.db.patch(verified[0]._id, { transferStartedAt: now, transferTo: out.label ?? args.person.slice(0, 120) });
    }
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "conversation",
      entityId: args.elevenLabsConversationId,
      action: TRANSFER_DIALING,
      to: out.label ?? undefined,
      note: `Handing the call${gate.newOwner ? " (a new owner)" : ""} to Twilio to ring ${out.label} (key ${out.key}). If they do not pick up within ${OWNER_DIAL_TIMEOUT_SECS} seconds, the caller stays on the line and can leave a voicemail.`,
    });
    return { ok: true, label: out.label ?? args.person.slice(0, 120), number: out.transferNumber, digits: out.transferDigits };
  },
});

/** The team and staff member of a call handed to Twilio by transfer_owner_call, for the Dial callbacks. */
export const transferContext = internalQuery({
  args: { elevenLabsConversationId: v.string() },
  handler: async (ctx, args): Promise<{ orgId: string; label: string; newOwner: boolean } | null> => {
    const row = (
      await ctx.db
        .query("ownerVerifications")
        .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
        .collect()
    ).find((r) => r.verified && r.transferStartedAt);
    if (row) return { orgId: row.orgId, label: row.transferTo ?? "the team", newOwner: false };
    // A new owner's transfer (B46) has no verification row: its dialing audit event carries the team and person.
    const ev = (
      await ctx.db
        .query("auditEvents")
        .withIndex("by_entity", (q) => q.eq("entity", "conversation").eq("entityId", args.elevenLabsConversationId))
        .order("desc")
        .collect()
    ).find((e) => e.action === TRANSFER_DIALING);
    return ev ? { orgId: ev.orgId, label: ev.to ?? "the team", newOwner: true } : null;
  },
});

/** An audit event for the Twilio side of a transfer (ringing, connected, failed, voicemail). */
export const logOwnerTransfer = internalMutation({
  args: { orgId: v.string(), elevenLabsConversationId: v.string(), action: v.string(), to: v.optional(v.string()), note: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await writeAudit(ctx, {
      orgId: args.orgId,
      entity: "conversation",
      entityId: args.elevenLabsConversationId,
      action: args.action.slice(0, 60),
      to: args.to?.slice(0, 120),
      note: args.note.slice(0, 1000),
    });
  },
});

/** Whether a call ever verified an owner (for the post-call check on transfers). */
export const wasVerified = internalQuery({
  args: { orgId: v.string(), elevenLabsConversationId: v.string() },
  handler: async (ctx, args): Promise<boolean> =>
    (await verificationsFor(ctx, args.orgId, args.elevenLabsConversationId)).some((r) => r.verified),
});

/**
 * The post-call safety net: a call that was transferred without a verified owner on record. Should
 * never happen (the transfer destination is only set for a verified owner), so it is flagged loudly:
 * an audit event on the call and an unassigned item on the team's callback list (Tenants page), which
 * is what admins work from. Texting is off except emergency alerts, so no SMS. Once per call.
 */
export async function flagUnverifiedTransfer(
  ctx: MutationCtx,
  args: { orgId: string; elevenLabsConversationId: string; conversationId?: Id<"conversations">; callerNumber?: string },
): Promise<boolean> {
  const verified = (await verificationsFor(ctx, args.orgId, args.elevenLabsConversationId)).some((r) => r.verified);
  if (verified) return false;
  if ((await callClearance(ctx, args.orgId, args.elevenLabsConversationId)).newOwner) return false;
  const prior = await ctx.db
    .query("auditEvents")
    .withIndex("by_entity", (q) => q.eq("entity", "conversation").eq("entityId", args.elevenLabsConversationId))
    .collect();
  if (prior.some((e) => e.action === "owner_transfer_unverified")) return false;
  await writeAudit(ctx, {
    orgId: args.orgId,
    entity: "conversation",
    entityId: args.elevenLabsConversationId,
    action: "owner_transfer_unverified",
    note: "This call was transferred to a phone, but no owner was verified on it. Check the call and the routing setup.",
  });
  const now = Date.now();
  await ctx.db.insert("callbackContacts", {
    orgId: args.orgId,
    elevenLabsConversationId: args.elevenLabsConversationId,
    conversationId: args.conversationId,
    callerNumber: args.callerNumber?.slice(0, 40),
    reason: "Check: call transferred without owner verification",
    issueSummary:
      "Sarah's call was transferred to a staff phone, but the caller was never verified as an owner (property + email). Review the call.",
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  return true;
}

/** Daily: verification rows older than the retention window. The audit trail keeps the history. */
export const purgeOldVerifications = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const old = await ctx.db
      .query("ownerVerifications")
      .withIndex("by_created", (q) => q.lt("createdAt", Date.now() - VERIFICATION_RETENTION_MS))
      .take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});

/** Probe cleanup only (scripts/probes/owner_verify_probe.py): drops one probe call's rows. */
export const deleteProbeVerifications = internalMutation({
  args: { elevenLabsConversationId: v.string() },
  handler: async (ctx, args): Promise<number> => {
    if (!args.elevenLabsConversationId.startsWith("probe_")) return 0;
    const rows = await ctx.db
      .query("ownerVerifications")
      .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});
