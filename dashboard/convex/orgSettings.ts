import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { currentOrg, requireAdminView, requireOrgAdmin } from "./authz";
import type { OrgContext } from "./authz";
import { writeAudit } from "./audit";

// --- Reads ----------------------------------------------------------------

export const current = query({
  args: {},
  handler: async (ctx) => {
    // Signed-in team members only: the staff phone number must not be readable by anonymous callers.
    const org = await currentOrg(ctx);
    if (!org) return { staffPhoneNumber: "" };
    const row = await ctx.db.query("orgSettings").first();
    return { staffPhoneNumber: row?.staffPhoneNumber ?? process.env.STAFF_PHONE_NUMBER ?? "" };
  },
});

/** Resolves the staff phone number: dashboard-saved value wins, env var is the fallback. */
export const staffPhoneNumberInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | undefined> => {
    const row = await ctx.db.query("orgSettings").first();
    return row?.staffPhoneNumber || process.env.STAFF_PHONE_NUMBER || undefined;
  },
});

// --- Writes ---------------------------------------------------------------

export const save = mutation({
  args: { staffPhoneNumber: v.string() },
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx);
    const existing = await ctx.db.query("orgSettings").first();
    if (existing) await ctx.db.patch(existing._id, { staffPhoneNumber: args.staffPhoneNumber });
    else await ctx.db.insert("orgSettings", { staffPhoneNumber: args.staffPhoneNumber });
  },
});

// --- Business line forwarding (optional) -------------------------------------------------------
//
// The admin stores their office number here; THEY set up forwarding to our Twilio number at their
// carrier. No API can do that for them, so this only stores the number, tells them what to do,
// and observes calls. SINGLE-TENANT: orgSettings has no orgId (see schema.ts); every function
// below reads/writes the one row. Full numbers are never logged; audit rows and last-seen carry
// the last 4 digits only.

const lineTypeValidator = v.union(
  v.literal("verizon_mobile"),
  v.literal("other_mobile"),
  v.literal("landline_office"),
  v.literal("phone_system"),
  v.literal("unknown"),
);

/** Same rule as agents:connectPhoneNumber: 10-15 digits, a bare 10-digit number is North American. */
function toE164(raw: string): string | null {
  if (!/^[\d\s().+-]+$/.test(raw)) return null; // letters and other junk are not a number
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits.length === 10 ? `1${digits}` : digits}`;
}

const EMERGENCY_DIGITS = new Set(["911", "933", "112", "999", "988"]);
const TOLL_FREE_PREFIXES = ["800", "833", "844", "855", "866", "877", "888"];

function isTollFreeOrPremium(e164: string): boolean {
  if (!e164.startsWith("+1") || e164.length !== 12) return false;
  const area = e164.slice(2, 5);
  return TOLL_FREE_PREFIXES.includes(area) || area === "900";
}

/** Our Twilio number from server env (never logged). */
function ourTwilioNumber(): string | null {
  const raw = process.env.TWILIO_SMS_FROM_NUMBER;
  return raw ? toE164(raw) : null;
}

type ForwardingStatus = "not_set" | "saved" | "waiting" | "call_seen";

function forwardingStatus(
  row: { forwardingNumber?: string; forwardingConfirmedAt?: number; forwardingLastSeenAt?: number } | null,
): ForwardingStatus {
  if (!row?.forwardingNumber) return "not_set";
  if (!row.forwardingConfirmedAt) return "saved";
  // "Call seen" only when a call arrived after the admin confirmed the setup.
  if (row.forwardingLastSeenAt && row.forwardingLastSeenAt >= row.forwardingConfirmedAt) return "call_seen";
  return "waiting";
}

export const forwardingGet = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const row = await ctx.db.query("orgSettings").first();
    const ours = ourTwilioNumber();
    // "Connected" = agents:connectPhoneNumber has bound a number to the agent (it writes this audit row).
    const connected = await ctx.db
      .query("auditEvents")
      .withIndex("by_entity", (q) => q.eq("entity", "config").eq("entityId", "phone_number"))
      .order("desc")
      .first();
    const isConnected = !!ours && !!connected && connected.orgId === (org.orgId as string);
    return {
      number: row?.forwardingNumber ?? null,
      lineType: row?.forwardingLineType ?? "unknown",
      status: forwardingStatus(row),
      confirmedAt: row?.forwardingConfirmedAt ?? null,
      lastSeenAt: row?.forwardingLastSeenAt ?? null,
      lastSeenLast4: row?.forwardingLastSeenFrom ?? null,
      ourNumber: isConnected ? ours : null,
      ourNumberMessage: isConnected ? null : "Connect your Twilio number first",
    };
  },
});

export const forwardingSave = mutation({
  args: { number: v.optional(v.string()), lineType: v.optional(lineTypeValidator) },
  handler: async (ctx, args): Promise<{ cleared: boolean; warnings: string[] }> => {
    const org = await requireAdminView(ctx);
    const existing = await ctx.db.query("orgSettings").first();
    const raw = (args.number ?? "").trim();

    // Empty clears the whole setting.
    if (!raw) {
      if (existing?.forwardingNumber) await clearForwarding(ctx, existing._id, org);
      return { cleared: true, warnings: [] };
    }
    if (raw.length > 40) throw new Error("That is not a valid phone number.");

    if (EMERGENCY_DIGITS.has(raw.replace(/\D/g, ""))) {
      throw new Error("Emergency numbers can never be forwarded to Sarah.");
    }
    const e164 = toE164(raw);
    if (!e164) throw new Error("That is not a valid phone number. Use 10 digits, for example 518 555 0100.");
    if (isTollFreeOrPremium(e164)) {
      throw new Error("Toll-free and premium-rate numbers (800, 833, 844, 855, 866, 877, 888, 900) cannot be used here.");
    }
    if (e164 === ourTwilioNumber()) {
      throw new Error("That is Sarah's own number. Forwarding it to itself would loop.");
    }

    const warnings: string[] = [];
    const staff = toE164(existing?.staffPhoneNumber || process.env.STAFF_PHONE_NUMBER || "");
    if (staff && staff === e164) {
      warnings.push(
        "This is also your staff transfer number. If Sarah transfers a call to it, the call could forward straight back to Sarah.",
      );
    }

    const lineType = args.lineType ?? "unknown";
    // Changing the number invalidates the earlier confirmation and last-seen call.
    const same = existing?.forwardingNumber === e164;
    const fields = {
      forwardingNumber: e164,
      forwardingLineType: lineType,
      forwardingSetUpAt: same ? (existing?.forwardingSetUpAt ?? Date.now()) : Date.now(),
      forwardingConfirmedAt: same ? existing?.forwardingConfirmedAt : undefined,
      forwardingLastSeenAt: same ? existing?.forwardingLastSeenAt : undefined,
      forwardingLastSeenFrom: same ? existing?.forwardingLastSeenFrom : undefined,
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("orgSettings", { staffPhoneNumber: "", ...fields });

    await writeAudit(ctx, {
      orgId: org.orgId as string,
      entity: "config",
      entityId: "forwarding_number",
      action: "forwarding_number_saved",
      actorUserId: org.user._id,
      note: `...${e164.slice(-4)} (${lineType})`,
    });
    return { cleared: false, warnings };
  },
});

export const forwardingConfirm = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const row = await ctx.db.query("orgSettings").first();
    if (!row?.forwardingNumber) throw new Error("Save your office number first.");
    await ctx.db.patch(row._id, { forwardingConfirmedAt: Date.now() });
    await writeAudit(ctx, {
      orgId: org.orgId as string,
      entity: "config",
      entityId: "forwarding_number",
      action: "forwarding_confirmed",
      actorUserId: org.user._id,
      note: `...${row.forwardingNumber.slice(-4)}`,
    });
  },
});

export const forwardingClear = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const row = await ctx.db.query("orgSettings").first();
    if (row?.forwardingNumber) await clearForwarding(ctx, row._id, org);
  },
});

async function clearForwarding(ctx: MutationCtx, id: Id<"orgSettings">, org: OrgContext) {
  const row = await ctx.db.get(id);
  await ctx.db.patch(id, {
    forwardingNumber: undefined,
    forwardingLineType: undefined,
    forwardingSetUpAt: undefined,
    forwardingConfirmedAt: undefined,
    forwardingLastSeenAt: undefined,
    forwardingLastSeenFrom: undefined,
  });
  await writeAudit(ctx, {
    orgId: org.orgId as string,
    entity: "config",
    entityId: "forwarding_number",
    action: "forwarding_cleared",
    actorUserId: org.user._id,
    note: row?.forwardingNumber ? `...${row.forwardingNumber.slice(-4)}` : undefined,
  });
}

/**
 * Called from the post-call webhook for every phone call. A no-op unless forwarding is
 * configured. We CANNOT tell a forwarded call from a direct call to Sarah's number; this only
 * records that a call arrived. Stores the last 4 digits of the caller, never the full number.
 */
export const forwardingRecordCall = internalMutation({
  args: { startedAtMs: v.number(), callerNumber: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("orgSettings").first();
    if (!row?.forwardingNumber) return;
    const at = Number.isFinite(args.startedAtMs) ? Math.min(args.startedAtMs, Date.now()) : Date.now();
    if (row.forwardingLastSeenAt && row.forwardingLastSeenAt >= at) return; // keep the latest
    const digits = (args.callerNumber ?? "").replace(/\D/g, "");
    await ctx.db.patch(row._id, {
      forwardingLastSeenAt: at,
      forwardingLastSeenFrom: digits.length >= 4 ? digits.slice(-4) : undefined,
    });
  },
});
