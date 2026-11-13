import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { appBaseUrl } from "./appUrl";
import { toE164 } from "./phone";
import { isSmsAllowed, sendSms } from "./twilioApi";
import { publishedConfig } from "./sarahConfigRead";
import { writeAudit } from "./audit";

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
 *
 * TEXTING POLICY: only templates in SMS_ALLOWED_TEMPLATES (twilioApi.ts) may produce a text:
 * "emergency_alert" to admins, plus the technician templates when SMS_TECHNICIAN_ENABLED is
 * true. Every other template is dropped in scheduleNotify and again in send. Callers and their
 * in-app records are untouched; only the outbound SMS is suppressed.
 */

export const TEMPLATES = [
  "emergency_alert",
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
  "units_reassigned",
  "request_new",
  "lead_assigned",
  "tour_booked",
  "unmatched_caller",
  "task_new",
  "photo_request",
] as const;
export type NotifyTemplate = (typeof TEMPLATES)[number];

const templateValidator = v.union(
  v.literal("emergency_alert"),
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
  v.literal("units_reassigned"),
  v.literal("request_new"),
  v.literal("lead_assigned"),
  v.literal("tour_booked"),
  v.literal("unmatched_caller"),
  v.literal("task_new"),
  v.literal("photo_request"),
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
  // lead_assigned / tour_booked / unmatched_caller: the caller's phone (digits, + - ( ) only).
  phone: v.optional(v.string()),
  // tour_booked: spoken tour time, e.g. "Tuesday, October 20 at 3:00 PM".
  when: v.optional(v.string()),
  // lead_assigned / tour_booked: first name of the asset manager the lead is assigned to.
  assignee: v.optional(v.string()),
  // units_reassigned (bulk asset manager change): how many units / open leads moved, the building
  // or team name, and the first name of the admin who made the change.
  units: v.optional(v.number()),
  leads: v.optional(v.number()),
  scope: v.optional(v.string()),
  by: v.optional(v.string()),
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
    phone?: string;
    when?: string;
    assignee?: string;
    units?: number;
    leads?: number;
    scope?: string;
    by?: string;
  };
};

const MAX_RECIPIENTS = 25;

/** Letters, digits, space, dash and apostrophe only, short: safe to drop into a text message. */
function clean(s: string | undefined, max: number): string {
  return (s ?? "").replace(/[^\p{L}\p{N} '\-#]/gu, "").trim().slice(0, max);
}

/** A phone number for a staff text: digits and + - ( ) space only. */
function cleanPhone(s: string | undefined): string {
  return (s ?? "").replace(/[^0-9+() -]/g, "").trim().slice(0, 20);
}

/** A spoken time for a staff text: letters, digits, space and , : . - only. */
function cleanWhen(s: string | undefined): string {
  return (s ?? "").replace(/[^\p{L}\p{N} ,:.-]/gu, "").trim().slice(0, 60);
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
    case "emergency_alert":
      // Fixed wording: nothing a caller said can reach this text.
      return `EMERGENCY: ${data.number !== undefined ? `MR-${data.number}` : "Phone call"}${at}. Open the request.`;
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
    case "units_reassigned": {
      // Counts and a building/team name only: nothing about residents or leads' contact details.
      const n = Math.max(0, Math.floor(data.units ?? 0));
      const leads = Math.max(0, Math.floor(data.leads ?? 0));
      const scope = clean(data.scope, 40);
      const by = clean(data.by, 30);
      const what = n > 0 ? `${n} unit${n === 1 ? "" : "s"}` : leads > 0 ? `${leads} open lead${leads === 1 ? "" : "s"}` : "Units";
      const label = `${what}${scope ? ` in ${scope}` : ""}`;
      const withLeads = n > 0 && leads > 0 ? `, with ${leads} open lead${leads === 1 ? "" : "s"}` : "";
      const are = (n > 0 ? n === 1 : leads === 1) ? "is" : "are";
      return `${label} ${are} now yours${withLeads}${by ? ` (bulk change by ${by})` : ""}.`;
    }
    case "request_new":
      return `${mr}${at}${who} is ready for your review.`;
    case "lead_assigned": {
      const phone = cleanPhone(data.phone);
      const assignee = clean(data.assignee, 30);
      return `New lead${name ? `: ${name}` : ""}${phone ? `, ${phone}` : ""}.${assignee ? ` Assigned to ${assignee}.` : " Not assigned yet."}`;
    }
    case "tour_booked": {
      const phone = cleanPhone(data.phone);
      const when = cleanWhen(data.when);
      const assignee = clean(data.assignee, 30);
      return `Tour booked${name ? `: ${name}` : ""}${phone ? `, ${phone}` : ""}${when ? `, ${when}` : ""}${assignee ? ` with ${assignee}` : ""}.`;
    }
    case "unmatched_caller": {
      const phone = cleanPhone(data.phone);
      return `Caller we could not match to a unit needs a callback${name ? `: ${name}` : ""}${phone ? `, ${phone}` : ""}.`;
    }
    case "task_new":
      return `New task${at}${who} from a resident call.`;
    case "photo_request":
      // Fixed wording, no free text: what the caller said stays behind the login link.
      return `${mr}${at}: caller wants to send photos. Open the request.`;
    case "tenant_message":
      // Approved wording only; control characters stripped, one SMS-sized chunk.
      return (data.text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 320);
  }
}

/**
 * Sarah configuration (P17): for an emergency alert, adds the escalation contacts configured
 * for the emergency level (published config only) to whoever the caller already chose. The
 * caller's list is the fallback and is never replaced; configuring contacts can only add
 * recipients. Any failure here leaves the original recipients untouched.
 */
async function withEscalationContacts(ctx: MutationCtx, args: NotifyArgs): Promise<NotifyArgs> {
  if (args.template !== "emergency_alert") return args;
  try {
    const sev = "emergency";
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
 * mutation (which already did the real work) still commits. Returns true only when a send was
 * actually scheduled (allowed template and at least one recipient).
 */
export async function scheduleNotify(ctx: MutationCtx, args: NotifyArgs): Promise<boolean> {
  // Texting policy choke point: anything not allowlisted is dropped here and never scheduled.
  if (!isSmsAllowed(args.template)) {
    console.log(`notify: ${args.template} not sent, texting is off except emergency alerts`);
    return false;
  }
  args = await withEscalationContacts(ctx, args);
  if ((args.userIds?.length ?? 0) === 0 && (args.phones?.length ?? 0) === 0) return false;
  try {
    await ctx.scheduler.runAfter(0, internal.notify.send, args);
    return true;
  } catch (err) {
    console.error("notify: could not schedule", err);
    return false;
  }
}

/** Every Admin (team admin flag, executive, maintenance lead, simplr_admin): who gets the "needs a decision" texts. */
export async function staffRecipientIds(ctx: QueryCtx, orgId: string): Promise<Id<"users">[]> {
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId as Id<"organizations">))
    .collect();
  return members
    .filter(
      (m) =>
        m.role === "admin" ||
        (m.jobRoles ?? []).includes("executive") ||
        (m.jobRoles ?? []).includes("maintenance_lead") ||
        (m.jobRoles ?? []).includes("simplr_admin"),
    )
    .map((m) => m.userId);
}

/** Everyone who sees the admin view: team admins, executives, maintenance leads, simplr_admins. */
async function adminViewRecipientIds(ctx: QueryCtx, orgId: string): Promise<Id<"users">[]> {
  const members = await ctx.db
    .query("memberships")
    .withIndex("by_org", (q) => q.eq("orgId", orgId as Id<"organizations">))
    .collect();
  return members
    .filter((m) => {
      const roles = m.jobRoles ?? [];
      return (
        m.role === "admin" ||
        roles.includes("maintenance_lead") ||
        roles.includes("executive") ||
        roles.includes("simplr_admin")
      );
    })
    .map((m) => m.userId);
}

/**
 * The one way an emergency text is raised. At most one per request AND per call: each key
 * (the request, and the phone conversation when there is one) gets an audit row when the alert is
 * queued, and any key that already has one means "already alerted". Goes to every admin-view
 * person regardless of out-of-office or channel preference, plus the emergency escalation contacts
 * from the published Sarah config. The text is fixed wording built from the MR number and unit label.
 *
 * Returns true when admins have been alerted for this emergency (now or earlier), false when no
 * alert exists (no recipients, or scheduling failed). Callers use it to decide what Sarah may say.
 */
export async function scheduleEmergencyAlert(
  ctx: MutationCtx,
  args: {
    orgId: string;
    keys: Array<{ entity: "request" | "conversation"; id: string }>;
    number?: number;
    unit?: string;
    path: string;
  },
): Promise<boolean> {
  try {
    for (const k of args.keys) {
      const prior = await ctx.db
        .query("auditEvents")
        .withIndex("by_entity", (q) => q.eq("entity", k.entity).eq("entityId", k.id))
        .collect();
      if (prior.some((e) => e.action === "emergency_alert_sent")) return true;
    }
    const scheduled = await scheduleNotify(ctx, {
      orgId: args.orgId,
      userIds: await adminViewRecipientIds(ctx, args.orgId),
      template: "emergency_alert",
      data: { number: args.number, unit: args.unit, path: args.path },
    });
    if (!scheduled) return false;
    for (const k of args.keys) {
      await writeAudit(ctx, {
        orgId: args.orgId,
        entity: k.entity,
        entityId: k.id,
        action: "emergency_alert_sent",
        note: "Emergency text queued for admins",
      });
    }
    return true;
  } catch (err) {
    console.error("notify: could not raise emergency alert", err);
    return false;
  }
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
    // Defense in depth: a job scheduled before the policy, or by a stray caller, still stops here.
    if (!isSmsAllowed(args.template)) {
      console.log(`notify.send: ${args.template} not sent, texting is off except emergency alerts`);
      return;
    }
    const isEmergency = args.template === "emergency_alert";
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
        // An emergency goes out whatever the person's channel preference says.
        if (!t.wantsSms && !isEmergency) {
          await log({ userId: t.userId, phone: t.phone, status: "skipped", error: "sms not enabled" });
          continue;
        }
        // One retry covers a transient Twilio failure; a second failure is recorded, not thrown.
        let lastError = "";
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try {
            await sendSms(t.phone, `${body}${link}`, args.template);
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
