import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appBaseUrl } from "./appUrl";
import { cleanEmail, cleanText, initialsOf, reserveResetFor, resetEmailHtml, resetEmailText } from "./assetManagers";
import { writeAudit } from "./audit";
import { requireAdminView, requireAdminViewId } from "./authz";
import type { OrgContext } from "./authz";
import { makeLookups, userName } from "./board";
import { sendEmail } from "./resendApi";
import { assertE164, createAndSendInvite } from "./team";
import { countOwnedBy } from "./units";

/**
 * Admin "Technicians" flow (Figma TC-Technicians Flow): table with workload counts, invite,
 * profile, edit, work orders, password-reset email, and removal. Reassigning work orders lives in
 * workOrders.reassignMany so it shares assign()'s audit and notify path.
 *
 * EVERY function here is admin-view only (authz.requireAdminView / requireAdminViewId), the same
 * rule as assetManagers.ts. The org always comes from the session; every client-supplied Id is
 * re-checked against that org and answers with the same "not found" whether it is missing or
 * another team's. Writes are audited without PII.
 *
 * Workload metrics (not defined by the client; chosen here and used everywhere in this module):
 *   Pending        work orders assigned to them and not started (status created / assigned)
 *   Active         in progress (status in_progress)
 *   Needs Sign Off completed by them, awaiting office review (status completed)
 *   Busy           at least one in-progress work order; otherwise Idle
 */

type WoStatus = Doc<"workOrders">["status"];
type TechStatus = "busy" | "idle";
type StatusGroup = "pending" | "in_progress" | "needs_sign_off" | "closed" | "cancelled";

const OPEN_STATUSES: WoStatus[] = ["created", "assigned", "in_progress", "completed"];
const ALL_STATUSES: WoStatus[] = ["created", "assigned", "in_progress", "completed", "reviewed_closed", "cancelled"];
const REASSIGNABLE: WoStatus[] = ["created", "assigned", "in_progress"];
const MAX_NOTES = 2000;
const MAX_NAME = 80;
const MAX_SEARCH = 100;
const PER_STATUS_CAP = 300;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const STATUS_GROUP: Record<WoStatus, StatusGroup> = {
  created: "pending",
  assigned: "pending",
  in_progress: "in_progress",
  completed: "needs_sign_off",
  reviewed_closed: "closed",
  cancelled: "cancelled",
};

const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  pending: "Pending",
  in_progress: "Work in Progress",
  needs_sign_off: "Completed (Needs Sign Off)",
  closed: "Closed",
  cancelled: "Cancelled",
};

function isTech(m: Doc<"memberships">): boolean {
  return (m.jobRoles ?? []).includes("technician");
}

/** The technician membership for `userId` on this team, or the one generic "not found". */
async function requireTechMember(ctx: QueryCtx | MutationCtx, org: OrgContext, userId: Id<"users">) {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!membership || membership.orgId !== org.orgId || !isTech(membership)) {
    throw new ConvexError("Technician not found.");
  }
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Technician not found.");
  return { membership, user };
}

function countsOf(wos: Doc<"workOrders">[]) {
  let pending = 0;
  let active = 0;
  let needsSignOff = 0;
  for (const w of wos) {
    const g = STATUS_GROUP[w.status];
    if (g === "pending") pending += 1;
    else if (g === "in_progress") active += 1;
    else if (g === "needs_sign_off") needsSignOff += 1;
  }
  return { pending, active, needsSignOff, status: (active > 0 ? "busy" : "idle") as TechStatus };
}

/** One technician's work orders in the given statuses (by index, capped per status, this org only). */
async function techWorkOrders(ctx: QueryCtx | MutationCtx, org: OrgContext, userId: Id<"users">, statuses: WoStatus[]) {
  const out: Doc<"workOrders">[] = [];
  for (const s of statuses) {
    const rows = await ctx.db
      .query("workOrders")
      .withIndex("by_technician_and_status", (q) => q.eq("technicianUserId", userId).eq("status", s))
      .order("desc")
      .take(PER_STATUS_CAP);
    for (const w of rows) if (w.orgId === org.orgId) out.push(w);
  }
  return out;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// --- 1. Overview (TC2) --------------------------------------------------------

export const overview = query({
  args: {
    search: v.optional(v.string()),
    propertyId: v.optional(v.string()),
    status: v.optional(v.union(v.literal("all"), v.literal("busy"), v.literal("idle"))),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const now = Date.now();
    const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 10)));

    const [memberships, propertyRows] = await Promise.all([
      ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect(),
      ctx.db
        .query("properties")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect(),
    ]);
    const techs = memberships.filter(isTech);
    const propertyName = new Map(propertyRows.map((p) => [p._id as string, p.name]));

    // Open work orders on the team, grouped by technician.
    const byTech = new Map<string, Doc<"workOrders">[]>();
    for (const s of OPEN_STATUSES) {
      const rows = await ctx.db
        .query("workOrders")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", org.orgId).eq("status", s))
        .collect();
      for (const w of rows) {
        if (!w.technicianUserId) continue;
        const list = byTech.get(w.technicianUserId) ?? [];
        list.push(w);
        byTech.set(w.technicianUserId, list);
      }
    }

    const all = await Promise.all(
      techs.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const name = userName(user);
        const mine = byTech.get(m.userId) ?? [];
        const propIds = [...new Set(mine.map((w) => w.propertyId as string))];
        const properties = propIds
          .map((id) => ({ propertyId: id as Id<"properties">, name: propertyName.get(id) ?? "Unknown" }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          userId: m.userId,
          name,
          email: user?.email ?? "",
          initials: initialsOf(name),
          imageUrl: user?.imageUrl ?? null,
          phone: m.phone ?? null,
          skill: m.skill ?? null,
          ...countsOf(mine),
          properties,
          joinedAt: m.createdAt,
        };
      }),
    );

    // KPIs are team-wide (not narrowed by search/filters), so the cards always equal the roster.
    const busy = all.filter((r) => r.status === "busy").length;
    const techsThen = techs.filter((m) => m.createdAt <= now - MONTH_MS).length;
    const kpis = {
      totalTechnicians: all.length,
      busyTechnicians: busy,
      idleTechnicians: all.length - busy,
      // Only headcount can be reconstructed for 30 days ago (membership.createdAt); null = no baseline.
      deltas: { totalTechnicians: pctChange(all.length, techsThen) },
    };

    const needle = args.search?.trim().toLowerCase().slice(0, MAX_SEARCH);
    const status = args.status ?? "all";
    // An unknown or foreign property id simply matches nobody (never an error, never a leak).
    const propertyId = args.propertyId?.trim() || undefined;
    const filtered = all
      .filter((r) => {
        if (status !== "all" && r.status !== status) return false;
        if (propertyId && !r.properties.some((p) => p.propertyId === propertyId)) return false;
        if (needle) {
          const hay = [r.name, r.email, r.skill ?? "", ...r.properties.map((p) => p.name)];
          if (!hay.some((h) => h.toLowerCase().includes(needle))) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.floor(args.page ?? 1)));
    const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const propertyOptions = propertyRows
      .map((p) => ({ propertyId: p._id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { kpis, rows, total, page, pageSize, pageCount, propertyOptions };
  },
});

/** Every technician on the team, for the "Select new technician" dropdown (names, never ids shown). */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const org = await requireAdminView(ctx);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();
    const now = Date.now();
    const out = [];
    for (const m of memberships.filter(isTech)) {
      out.push({
        userId: m.userId,
        name: userName(await ctx.db.get(m.userId)),
        onLeave: m.unavailableUntil !== undefined && m.unavailableUntil > now,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// --- 2. Invite ----------------------------------------------------------------

/** Same mechanism as assetManagers.invite (team invite: token hash, 7-day expiry, email). */
export const invite = action({
  args: { fullName: v.string(), email: v.string() },
  handler: async (ctx, args): Promise<{ email: string; status: "invited" | "resent" }> => {
    await requireAdminViewId(ctx);
    if (!args.fullName.trim()) throw new ConvexError("Enter the technician's full name.");
    if (!args.email.trim()) throw new ConvexError("Enter the technician's email address.");
    const fullName = cleanText(args.fullName, "Full name", MAX_NAME, 1);
    const email = cleanEmail(args.email, "email address");
    const sent = await createAndSendInvite(ctx, { email, appRole: "technician", fullName });
    return { email: sent.email, status: sent.resent ? "resent" : "invited" };
  },
});

// --- 3. Profile (TC3 drawer, TC4) ---------------------------------------------

export const profile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const { membership, user } = await requireTechMember(ctx, org, args.userId);
    const open = await techWorkOrders(ctx, org, args.userId, OPEN_STATUSES);
    const counts = countsOf(open);

    // Current work order: the most recently touched in-progress job, else the next pending one
    // (earliest appointment, then earliest due, then oldest).
    const inProgress = open.filter((w) => w.status === "in_progress").sort((a, b) => b.updatedAt - a.updatedAt);
    const pending = open
      .filter((w) => STATUS_GROUP[w.status] === "pending")
      .sort(
        (a, b) =>
          (a.windowStart ?? Infinity) - (b.windowStart ?? Infinity) ||
          (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) ||
          a.createdAt - b.createdAt,
      );
    const cur = inProgress[0] ?? pending[0] ?? null;
    let currentWorkOrder = null;
    if (cur) {
      const L = makeLookups(ctx);
      currentWorkOrder = {
        id: cur._id,
        number: `WO-${cur.number}`,
        title: cur.title,
        propertyName: (await L.property(cur.propertyId)) ?? null,
        unitNumber: (await L.unit(cur.unitId))?.unitNumber ?? null,
        window: cur.window ?? null,
        statusLabel: STATUS_GROUP_LABEL[STATUS_GROUP[cur.status]],
      };
    }

    return {
      userId: args.userId,
      name: userName(user),
      initials: initialsOf(userName(user)),
      imageUrl: user.imageUrl ?? null,
      workEmail: user.email ?? "",
      personalEmail: membership.personalEmail ?? null,
      phone: membership.phone ?? null,
      skill: membership.skill ?? null,
      internalNotes: membership.internalNotes ?? "",
      status: counts.status,
      isSelf: args.userId === org.user._id,
      counts: {
        pending: counts.pending,
        inProgress: counts.active,
        awaitingSignOff: counts.needsSignOff,
        // "Assigned work" in the drawer: everything still to do (pending + in progress).
        assigned: counts.pending + counts.active,
      },
      currentWorkOrder,
    };
  },
});

// --- 4. Update profile (TC5) --------------------------------------------------

/**
 * Same rules as assetManagers.updateProfile: the NAME and WORK EMAIL come from the person's
 * sign-in (Clerk) and are read-only here; "" clears personalEmail / phone / notes.
 */
export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    personalEmail: v.optional(v.string()),
    phone: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const { membership } = await requireTechMember(ctx, org, args.userId);

    const patch: { personalEmail?: string; phone?: string; internalNotes?: string } = {};
    const changed: string[] = [];
    if (args.personalEmail !== undefined) {
      const raw = args.personalEmail.trim();
      patch.personalEmail = raw === "" ? undefined : cleanEmail(raw, "personal email");
      changed.push("personalEmail");
    }
    if (args.phone !== undefined) {
      const raw = args.phone.replace(/[\s().-]/g, "");
      patch.phone = raw === "" ? undefined : assertE164(raw);
      changed.push("phone");
    }
    if (args.internalNotes !== undefined) {
      const notes = cleanText(args.internalNotes, "Internal notes", MAX_NOTES);
      patch.internalNotes = notes === "" ? undefined : notes;
      changed.push("internalNotes");
    }
    if (changed.length === 0) return { updated: [] as string[] };

    await ctx.db.patch(membership._id, patch);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: membership._id,
      action: "tech_profile_updated",
      actorUserId: org.user._id,
      note: `fields: ${changed.join(", ")}`, // names only, never the values (PII)
    });
    return { updated: changed };
  },
});

// --- 5. Work orders (TC6) -----------------------------------------------------

export const workOrders = query({
  args: {
    userId: v.id("users"),
    search: v.optional(v.string()),
    priority: v.optional(v.string()), // "" / "all" = any
    status: v.optional(v.string()), // "" / "all" = any; else a StatusGroup
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const { user } = await requireTechMember(ctx, org, args.userId);
    const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 10)));
    const priority = args.priority && args.priority !== "all" ? args.priority : null;
    const group = args.status && args.status !== "all" ? args.status : null;
    const statuses = group ? ALL_STATUSES.filter((s) => STATUS_GROUP[s] === group) : ALL_STATUSES;

    const wos = await techWorkOrders(ctx, org, args.userId, statuses);
    const L = makeLookups(ctx);
    const needle = args.search?.trim().toLowerCase().slice(0, MAX_SEARCH);
    const built = [];
    for (const w of wos) {
      if (priority && w.priority !== priority) continue;
      const unit = await L.unit(w.unitId);
      const propertyName = (await L.property(w.propertyId)) ?? null;
      const number = `WO-${w.number}`;
      if (needle) {
        const hay = [number, String(w.number), w.title, unit?.unitNumber ?? "", propertyName ?? ""];
        if (!hay.some((h) => h.toLowerCase().includes(needle))) continue;
      }
      const amId = unit?.assetManagerUserId;
      const g = STATUS_GROUP[w.status];
      built.push({
        id: w._id,
        number,
        unitNumber: unit?.unitNumber ?? null,
        propertyName,
        issue: w.title,
        priority: w.priority,
        statusGroup: g,
        statusLabel: STATUS_GROUP_LABEL[g],
        assetManager: amId ? { userId: amId, name: (await L.user(amId)) ?? "Unknown" } : null,
        createdAt: w.createdAt,
        reassignable: REASSIGNABLE.includes(w.status),
      });
    }
    built.sort((a, b) => b.createdAt - a.createdAt);

    const total = built.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.floor(args.page ?? 1)));
    return {
      technician: { userId: args.userId, name: userName(user) },
      rows: built.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
      pageCount,
    };
  },
});

// --- 6. Password reset email (TC5) --------------------------------------------

/** Same email and limits as assetManagers.sendPasswordReset (see the notes there). */
export const sendPasswordReset = action({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ sent: true; method: "email_link" }> => {
    const org = await requireAdminViewId(ctx);
    const target: { reservationId: Id<"passwordResetRequests">; email: string; name: string } = await ctx.runMutation(
      internal.technicians.reservePasswordReset,
      { orgId: org.orgId, actorUserId: org.userId, targetUserId: args.userId },
    );
    const link = `${appBaseUrl()}/sign-in`;
    try {
      await sendEmail({
        to: target.email,
        subject: "Reset your Simplr password",
        html: resetEmailHtml(target.name, link),
        text: resetEmailText(target.name, link),
      });
    } catch (err) {
      // Give the attempt back: a failed send must not burn one of the three daily tries.
      await ctx.runMutation(internal.assetManagers.releasePasswordReset, { reservationId: target.reservationId });
      console.error("technicians.sendPasswordReset: email failed", err instanceof Error ? err.message.slice(0, 200) : "unknown");
      throw new ConvexError("Could not send the email. Try again in a moment.");
    }
    return { sent: true, method: "email_link" };
  },
});

export const reservePasswordReset = internalMutation({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), targetUserId: v.id("users") },
  handler: async (ctx, args) => await reserveResetFor(ctx, args, isTech, "Technician not found."),
});

// --- 7. Remove (TC4 Danger Zone) ----------------------------------------------

/**
 * "Delete user": removes the technician from the team (their membership), the same effect as
 * team.removeMember. Their sign-in account is not deleted. Refused while they still hold active
 * work orders, because a work order must always keep a technician: reassign those first.
 * Completed work awaiting sign-off keeps their name on it and does not block removal.
 */
export const remove = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const { membership, user } = await requireTechMember(ctx, org, args.userId);
    if (args.userId === org.user._id) throw new ConvexError("You cannot remove yourself from your own team.");

    const owned = await countOwnedBy(ctx, args.userId);
    if (owned > 0) {
      throw new ConvexError(`${userName(user)} still manages ${owned} unit${owned === 1 ? "" : "s"}. Reassign them first.`);
    }
    const active = await techWorkOrders(ctx, org, args.userId, REASSIGNABLE);
    if (active.length > 0) {
      throw new ConvexError(
        `Reassign ${userName(user)}'s ${active.length} open work order${active.length === 1 ? "" : "s"} to another technician before deleting them.`,
      );
    }

    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: membership._id,
      action: "member_removed",
      actorUserId: org.user._id,
      from: (membership.jobRoles ?? []).join(","),
    });
    await ctx.db.delete(membership._id);
    return { removed: true as const };
  },
});
