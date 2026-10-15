import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { appBaseUrl } from "./appUrl";
import { toE164 } from "./phone";
import { sendSms } from "./twilioApi";
import { publishedConfig } from "./sarahConfigRead";

/**
 * Notification service (F7). One internal action, `send`, resolves recipients, sends SMS and
 * logs every attempt.
 *
 * Callers never await it: they use scheduleNotify from inside their mutation, which only
 * enqueues. A Twilio outage, a bad phone number or an unset env var therefore can't roll back
 * or fail the request/work-order change that triggered it (a lost alert is bad; a lost
 * maintenance request because the alert failed would be worse).
 *
 * SMS bodies carry no PII beyond a first name and unit label; everything else sits behind the
 * login link (PRD section 9).
 */

export const TEMPLATES = [
  "request_emergency",
  "request_exception",
  "am_unavailable",
  "request_forwarded",
  "wo_assigned",
  "wo_changed",
  "wo_sent_back",
  "wo_submitted",
  "owner_prospect",
  "tenant_message",
  "request_media",
  "request_withdrawn",
  "request_note",
  "request_sent_back",
  "request_reassigned",
] as const;
export type NotifyTemplate = (typeof TEMPLATES)[number];

const templateValidator = v.union(
  v.literal("request_emergency"),
  v.literal("request_exception"),
  v.literal("am_unavailable"),
  v.literal("request_forwarded"),
  v.literal("wo_assigned"),
  v.literal("wo_changed"),
  v.literal("wo_sent_back"),
  v.literal("wo_submitted"),
  v.literal("owner_prospect"),
  v.literal("tenant_message"),
  v.literal("request_media"),
  v.literal("request_withdrawn"),
  v.literal("request_note"),
  v.literal("request_sent_back"),
  v.literal("request_reassigned"),
);

/** Deliberately narrow: nothing free-form from a tenant can reach an SMS body. */
export const notifyDataValidator = v.object({
  number: v.optional(v.number()), // MR / WO number
  unit: v.optional(v.string()), // unit label, e.g. "4B"
  firstName: v.optional(v.string()), // tenant or prospect first name only
  severity: v.optional(v.string()),
  path: v.optional(v.string()), // in-app path the link points at, e.g. /maintenance/abc
  // tenant_message only: the Sarah-config wording, already approved (sarahConfigRead.tenantMessage).
  // Never populated from anything a tenant typed.
  text: v.optional(v.string()),
});

export type NotifyArgs = {
  orgId: string;
  userIds?: Id<"users">[];
  phones?: string[];
  template: NotifyTemplate;
  data: {
    number?: number;
    unit?: string;
    firstName?: string;
    severity?: string;
    path?: string;
    text?: string;
  };
};

const MAX_RECIPIENTS = 25;

/** Letters, digits, space, dash and apostrophe only, short: safe to drop into a text message. */
function clean(s: string | undefined, max: number): string {
  return (s ?? "").replace(/[^\p{L}\p{N} '\-#]/gu, "").trim().slice(0, max);
}

function safePath(path: string | undefined): string {
  // Relative in-app paths only; anything else falls back to the dashboard root.
  if (path && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(path) && !path.startsWith("//")) return path;
  return "/";
}

function bodyFor(template: NotifyTemplate, data: NotifyArgs["data"]): string {
  const unit = clean(data.unit, 20);
  const name = clean(data.firstName, 30);
  const at = unit ? ` at ${unit}` : "";
  const who = name ? ` (${name})` : "";
  const mr = data.number !== undefined ? `MR-${data.number}` : "A request";
  const wo = data.number !== undefined ? `WO-${data.number}` : "A work order";
  switch (template) {
    case "request_emergency":
      return `${clean(data.severity, 12).toUpperCase() || "URGENT"}: ${mr}${at}${who}.`;
    case "request_exception":
      return `${mr} could not be routed and needs a decision.`;
    case "am_unavailable":
      return `${mr}${at} is assigned to an asset manager who is unavailable.`;
    case "request_forwarded":
      return `${mr}${at} was forwarded for a work order.`;
    case "wo_assigned":
      return `New job ${wo}${at}.`;
    case "wo_changed":
      return `${wo}${at} was updated.`;
    case "wo_sent_back":
      return `${wo}${at} was sent back for more work.`;
    case "wo_submitted":
      return `${wo}${at} was submitted as completed.`;
    case "owner_prospect":
      return `New owner prospect${name ? `: ${name}` : ""}.`;
    case "request_media":
      return `${mr}${at}${who} added photos.`;
    case "request_withdrawn":
      return `${mr}${at} was pulled back from the maintenance lead.`;
    case "request_note":
      return `${mr}${at} has a new note.`;
    case "request_sent_back":
      return `${mr}${at} was sent back to the asset manager.`;
    case "request_reassigned":
      return `${mr}${at} is now yours (unit reassigned to you).`;
    case "tenant_message":
      // Approved wording only; control characters stripped, one SMS-sized chunk.
      return (data.text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 320);
  }
}

/**
 * Sarah configuration (P17): for an emergency or urgent alert, adds the escalation contacts
 * configured for that level (published config only) to whoever the caller already chose. The
 * caller's list is the fallback and is never replaced, so an assigned AM and the staff from
 * staffRecipientIds are still told; configuring contacts can only add recipients. Any failure
 * here leaves the original recipients untouched.
 */
async function withEscalationContacts(ctx: MutationCtx, args: NotifyArgs): Promise<NotifyArgs> {
  if (args.template !== "request_emergency") return args;
  try {
    // "escalated" is what the escalate tool sends when no severity level is known: urgent.
    const sev = args.data.severity === "emergency" ? "emergency" : "urgent";
    const config = await publishedConfig(ctx, args.orgId);
    const entry = config?.escalationContacts.find((e) => e.level === sev);
    if (!entry || (entry.userIds.length === 0 && entry.externalPhones.length === 0)) return args;
    // Only people still on this team: a stale id must not reach a stranger.
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId as Id<"organizations">))
      .collect();
    const onTeam = new Set<string>(members.map((m) => m.userId));
    const userIds = [...new Set([...(args.userIds ?? []), ...entry.userIds.filter((id) => onTeam.has(id))])];
    const phones = [...new Set([...(args.phones ?? []), ...entry.externalPhones])];
    return { ...args, userIds, phones };
  } catch (err) {
    console.error("notify: could not read escalation contacts", err);
    return args;
  }
}

/**
 * Enqueues a send. Never throws: an enqueue failure is logged and swallowed so the calling
 * mutation (which already did the real work) still commits.
 */
export async function scheduleNotify(ctx: MutationCtx, args: NotifyArgs): Promise<void> {
  args = await withEscalationContacts(ctx, args);
  if ((args.userIds?.length ?? 0) === 0 && (args.phones?.length ?? 0) === 0) return;
  try {
    await ctx.scheduler.runAfter(0, internal.notify.send, args);
  } catch (err) {
    console.error("notify: could not schedule", err);
  }
}

/** Team admins plus maintenance leads (Pat) and simplr_admins: who gets the "needs a decision" texts. */
export async function staffRecipientIds(ctx: QueryCtx, orgId: string): Promise<Id<"users">[]> {
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId as Id<"organizations">))
    .collect();
  return members
    .filter(
      (m) =>
        m.role === "admin" ||
        (m.jobRoles ?? []).includes("maintenance_lead") ||
        (m.jobRoles ?? []).includes("simplr_admin"),
    )
    .map((m) => m.userId);
}

/** Phone + preferences for each requested user, restricted to members of `orgId`. */
export const recipientsFor = internalQuery({
  args: { orgId: v.string(), userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const out: Array<{ userId: Id<"users">; phone?: string; wantsSms: boolean }> = [];
    for (const userId of new Set(args.userIds)) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      // A user id from another team must never receive this team's alerts.
      if (!membership || membership.orgId !== args.orgId) continue;
      out.push({
        userId,
        phone: membership.phone,
        // notifyBy absent means "never chosen": default to SMS, the pilot's channel.
        wantsSms: membership.notifyBy === undefined || membership.notifyBy.includes("sms"),
      });
    }
    return out;
  },
});

export const logAttempt = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.optional(v.id("users")),
    phone: v.optional(v.string()),
    template: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notificationLog", {
      orgId: args.orgId,
      userId: args.userId,
      phoneLast4: args.phone ? args.phone.slice(-4) : undefined,
      template: args.template,
      channel: "sms",
      status: args.status,
      error: args.error?.slice(0, 300),
      createdAt: Date.now(),
    });
  },
});

export const send = internalAction({
  args: {
    orgId: v.string(),
    userIds: v.optional(v.array(v.id("users"))),
    phones: v.optional(v.array(v.string())),
    template: templateValidator,
    data: notifyDataValidator,
  },
  handler: async (ctx, args): Promise<void> => {
    const log = (entry: {
      userId?: Id<"users">;
      phone?: string;
      status: "sent" | "failed" | "skipped";
      error?: string;
    }) => ctx.runMutation(internal.notify.logAttempt, { orgId: args.orgId, template: args.template, ...entry });

    try {
      const targets: Array<{ userId?: Id<"users">; phone?: string; wantsSms: boolean }> = [];
      if (args.userIds?.length) {
        const rows: Array<{ userId: Id<"users">; phone?: string; wantsSms: boolean }> =
          await ctx.runQuery(internal.notify.recipientsFor, {
            orgId: args.orgId,
            userIds: args.userIds.slice(0, MAX_RECIPIENTS),
          });
        targets.push(...rows);
      }
      for (const raw of (args.phones ?? []).slice(0, MAX_RECIPIENTS)) {
        const phone = toE164(raw);
        if (phone) targets.push({ phone, wantsSms: true });
      }

      // Tenant texts are the company's approved wording, so no staff-tool "Simplr:" prefix, and
      // a link only when the caller gave one (the photo-upload page).
      const isTenant = args.template === "tenant_message";
      const text = bodyFor(args.template, args.data);
      if (isTenant && !text) return; // never send an empty tenant text
      const body = isTenant ? text : `Simplr: ${text}`;
      let link = "";
      try {
        if (!isTenant || args.data.path) link = ` ${appBaseUrl()}${safePath(args.data.path)}`;
      } catch (err) {
        // A missing APP_BASE_URL should not stop the alert itself; the text still goes out.
        console.error("notify: no app url", err);
      }

      for (const t of targets) {
        if (!t.phone) {
          await log({ userId: t.userId, status: "skipped", error: "no phone on file" });
          continue;
        }
        if (!t.wantsSms) {
          await log({ userId: t.userId, phone: t.phone, status: "skipped", error: "sms not enabled" });
          continue;
        }
        // One retry covers a transient Twilio failure; a second failure is recorded, not thrown.
        let lastError = "";
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            await sendSms(t.phone, `${body}${link}`);
            ok = true;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
          }
        }
        await log(
          ok
            ? { userId: t.userId, phone: t.phone, status: "sent" }
            : { userId: t.userId, phone: t.phone, status: "failed", error: lastError },
        );
      }
    } catch (err) {
      console.error("notify.send failed", err);
      await log({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  },
});
