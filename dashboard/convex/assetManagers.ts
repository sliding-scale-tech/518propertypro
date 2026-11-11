import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { managedUnitIds } from "./amScope";
import { appBaseUrl } from "./appUrl";
import { writeAudit } from "./audit";
import { isAdminView, requireAdminView, requireAdminViewId } from "./authz";
import type { OrgContext } from "./authz";
import { userName, workOrderRowsForAm } from "./board";
import { toReviewFor } from "./dashboard";
import { sendEmail } from "./resendApi";
import { assertE164, createAndSendInvite } from "./team";
import { saveWeeklyHours } from "./tours";
import * as sched from "./tourSchedule";
import { reassignUnitWithReason } from "./units";
import { PHOTO_EMAIL_INVALID, speakablePhotoEmail } from "./sarahReplies";

/**
 * Admin "Asset Managers" management flow (table, invite, profile, availability, work orders,
 * unit ownership, reassignment, calendar, password-reset email).
 *
 * EVERY function here is admin-view only (authz.requireAdminView / requireAdminViewId): an asset
 * manager, technician or accountant cannot call any of it, whatever the UI hides. The org always
 * comes from the session; every client-supplied Id is re-checked against that org and answers
 * with the same "not found" whether it is missing or another team's. Text inputs are trimmed,
 * stripped of control characters and length-capped. Writes are audited without PII or secrets.
 *
 * The hard rule (every unit has exactly one designated asset manager) is not re-implemented
 * here: ownership only ever changes through units.reassignUnitWithReason, which shares the
 * reassign() path used by every other AM change. Nothing in this module can clear a manager.
 */

const OPEN_REQUEST_STATUSES = ["new", "under_review", "more_info_needed", "forwarded_to_pat"] as const;
const ACTIVE_WO_STATUSES = ["created", "assigned", "in_progress", "completed"] as const;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NAME = 80;
const MAX_EMAIL = 254;
const MAX_NOTES = 2000;
const MAX_REASON = 500;
const MAX_SEARCH = 100;
const MAX_CALENDAR_DAYS = 62;
const RESET_LIMIT_PER_DAY = 3;
const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;

// --- Helpers --------------------------------------------------------------

/** Trim, drop control characters, enforce a max length. Throws a message fit to show a person. */
export function cleanText(raw: string, label: string, max: number, min = 0): string {
  const out = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (out.length > max) throw new ConvexError(`${label} is too long (max ${max} characters).`);
  if (out.length < min) throw new ConvexError(`${label} is too short (min ${min} characters).`);
  return out;
}

export function cleanEmail(raw: string, label: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) throw new ConvexError(`Enter a valid ${label}.`);
  return email;
}

export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

function isAm(m: Doc<"memberships">): boolean {
  return (m.jobRoles ?? []).includes("asset_manager");
}

type AmStatus = "active" | "on_leave" | "inactive";
// "inactive" is part of the contract for the UI, but nothing in the data model suspends a member
// today, so it is never returned.
function statusOf(m: Doc<"memberships">, now: number): AmStatus {
  return m.unavailableUntil !== undefined && m.unavailableUntil > now ? "on_leave" : "active";
}

/** The asset-manager membership for `userId` on this team, or the one generic "not found". */
async function requireAmMember(ctx: QueryCtx | MutationCtx, org: OrgContext, userId: Id<"users">) {
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!membership || membership.orgId !== org.orgId || !isAm(membership)) {
    throw new ConvexError("Asset manager not found.");
  }
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Asset manager not found.");
  return { membership, user };
}

async function orgUnits(ctx: QueryCtx, orgId: Id<"organizations">) {
  return await ctx.db
    .query("units")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
}

async function orgProperties(ctx: QueryCtx, orgId: Id<"organizations">) {
  const rows = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return new Map(rows.map((p) => [p._id as string, p]));
}

async function openRequests(ctx: QueryCtx, orgId: Id<"organizations">) {
  const out: Doc<"maintenanceRequests">[] = [];
  for (const status of OPEN_REQUEST_STATUSES) {
    out.push(
      ...(await ctx.db
        .query("maintenanceRequests")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect()),
    );
  }
  return out;
}

async function activeWorkOrders(ctx: QueryCtx, orgId: Id<"organizations">) {
  const out: Doc<"workOrders">[] = [];
  for (const status of ACTIVE_WO_STATUSES) {
    out.push(
      ...(await ctx.db
        .query("workOrders")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .collect()),
    );
  }
  return out;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "2" / "1br" / "Studio" -> what the Figma shows in "Beds / baths". */
function bedsLabel(raw: string): string {
  const t = raw.trim();
  const m = /^(\d+(?:\.\d+)?)\s*(?:br|bd|bed|beds|bedroom|bedrooms)?\+?$/i.exec(t);
  return m ? m[1] : t;
}

function bedroomsSentence(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().slice(0, 30);
  if (!t) return null;
  if (/^studio$/i.test(t)) return "Studio";
  const m = /^(\d+)/.exec(t);
  if (m) {
    const n = Number(m[1]);
    return `${n} Bedroom${n === 1 ? "" : "s"}`;
  }
  return t;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Display order Monday..Sunday.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "Monday–Friday, 11 AM – 10 PM"; several groups join with "; ". */
export function summarizeHours(weeklyHours: sched.DayHours[]): string {
  const byDay = new Map(weeklyHours.map((h) => [h.day, h]));
  const groups: Array<{ days: number[]; start: string; end: string }> = [];
  for (const day of WEEK_ORDER) {
    const h = byDay.get(day);
    if (!h) continue;
    const last = groups[groups.length - 1];
    const prevDay = last ? last.days[last.days.length - 1] : undefined;
    const adjacent = prevDay !== undefined && WEEK_ORDER.indexOf(prevDay) + 1 === WEEK_ORDER.indexOf(day);
    if (last && adjacent && last.start === h.start && last.end === h.end) last.days.push(day);
    else groups.push({ days: [day], start: h.start, end: h.end });
  }
  if (groups.length === 0) return "Not set";
  return groups
    .map((g) => {
      const days =
        g.days.length === 1
          ? DAY_NAMES[g.days[0]]
          : `${DAY_NAMES[g.days[0]]}–${DAY_NAMES[g.days[g.days.length - 1]]}`;
      return `${days}, ${clock12(g.start)} – ${clock12(g.end)}`;
    })
    .join("; ");
}

/** Always seven entries, Monday first; a day off has start/end null. */
function tourHoursFor(weeklyHours: sched.DayHours[]) {
  const byDay = new Map(weeklyHours.map((h) => [h.day, h]));
  return WEEK_ORDER.map((day) => {
    const h = byDay.get(day);
    return { day, dayName: DAY_NAMES[day], off: !h, start: h?.start ?? null, end: h?.end ?? null };
  });
}

async function tourAvailabilityFor(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("tourAvailability")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// --- 1. Overview ----------------------------------------------------------

export const overview = query({
  args: {
    search: v.optional(v.string()),
    propertyId: v.optional(v.id("properties")),
    status: v.optional(v.union(v.literal("all"), v.literal("active"), v.literal("on_leave"), v.literal("inactive"))),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const now = Date.now();
    const cutoff = now - MONTH_MS;
    const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 10)));

    const [memberships, units, properties, requests, wos] = await Promise.all([
      ctx.db
        .query("memberships")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .collect(),
      orgUnits(ctx, org.orgId),
      orgProperties(ctx, org.orgId),
      openRequests(ctx, org.orgId),
      activeWorkOrders(ctx, org.orgId),
    ]);
    const ams = memberships.filter(isAm);

    const unitsByAm = new Map<string, Doc<"units">[]>();
    for (const u of units) {
      const list = unitsByAm.get(u.assetManagerUserId) ?? [];
      list.push(u);
      unitsByAm.set(u.assetManagerUserId, list);
    }
    const amOfUnit = new Map<string, string>(units.map((u) => [u._id as string, u.assetManagerUserId as string]));
    const requestsByAm = new Map<string, number>();
    for (const r of requests) {
      const am = r.unitId ? amOfUnit.get(r.unitId) : undefined;
      if (am) requestsByAm.set(am, (requestsByAm.get(am) ?? 0) + 1);
    }
    const wosByAm = new Map<string, number>();
    for (const w of wos) {
      const am = amOfUnit.get(w.unitId);
      if (am) wosByAm.set(am, (wosByAm.get(am) ?? 0) + 1);
    }

    const all = await Promise.all(
      ams.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const name = userName(user);
        const mine = unitsByAm.get(m.userId) ?? [];
        const managedSet = new Set(mine.map((u) => u._id));
        const propIds = [...new Set(mine.map((u) => u.propertyId as string))];
        const props = propIds
          .map((id) => ({ propertyId: id as Id<"properties">, name: properties.get(id)?.name ?? "Unknown" }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          userId: m.userId,
          name,
          email: user?.email ?? "",
          initials: initialsOf(name),
          imageUrl: user?.imageUrl ?? null,
          assignedUnits: mine.length,
          openRequests: requestsByAm.get(m.userId) ?? 0,
          // Same helper as the dashboard's "Asset managers" rows: new / under review / more info.
          toReview: toReviewFor(requests, managedSet).length,
          activeWorkOrders: wosByAm.get(m.userId) ?? 0,
          properties: props,
          moreCount: Math.max(0, props.length - 1),
          status: statusOf(m, now),
          joinedAt: m.createdAt,
        };
      }),
    );

    // KPIs are team-wide (not narrowed by search/filters) and are the sums of the table rows, so
    // the cards always equal the table.
    const assignedUnitsTotal = all.reduce((n, r) => n + r.assignedUnits, 0);
    const amUnitIds = new Set(ams.map((m) => m.userId as string));
    const unitsThen = units.filter((u) => amUnitIds.has(u.assetManagerUserId) && u.createdAt <= cutoff).length;
    const amsThen = ams.filter((m) => m.createdAt <= cutoff).length;
    const kpis = {
      totalAssetManagers: all.length,
      assignedUnits: assignedUnitsTotal,
      openRequests: all.reduce((n, r) => n + r.openRequests, 0),
      activeWorkOrders: all.reduce((n, r) => n + r.activeWorkOrders, 0),
      // Percent change vs 30 days ago. Only AM headcount (membership.createdAt) and units
      // (units.createdAt) can be reconstructed; requests and work orders keep no close
      // timestamps, so a past "open" count is unknowable and those deltas are null. A null also
      // means "no baseline" (previous value 0).
      deltas: {
        totalAssetManagers: pctChange(all.length, amsThen),
        assignedUnits: pctChange(assignedUnitsTotal, unitsThen),
        openRequests: null as number | null,
        activeWorkOrders: null as number | null,
      },
    };

    const needle = args.search?.trim().toLowerCase().slice(0, MAX_SEARCH);
    const status = args.status ?? "all";
    const filtered = all
      .filter((r) => {
        if (status !== "all" && r.status !== status) return false;
        if (args.propertyId && !r.properties.some((p) => p.propertyId === args.propertyId)) return false;
        if (needle) {
          const hay = [r.name, r.email, ...r.properties.map((p) => p.name)];
          if (!hay.some((h) => h.toLowerCase().includes(needle))) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, Math.floor(args.page ?? 1)));
    const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

    const propertyOptions = [...properties.values()]
      .map((p) => ({ propertyId: p._id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { kpis, rows, total, page, pageSize, pageCount, propertyOptions };
  },
});

// --- 2. Invite ------------------------------------------------------------

/**
 * Invites a new asset manager through the existing team invite mechanism (token hash, 7-day
 * expiry, Resend email). Dedupe: someone already on a team is rejected; a still-live invite for
 * the same address is superseded (the old link stops working) and `status` says "resent".
 */
export const invite = action({
  args: { fullName: v.string(), email: v.string() },
  handler: async (ctx, args): Promise<{ email: string; status: "invited" | "resent" }> => {
    await requireAdminViewId(ctx);
    const fullName = cleanText(args.fullName, "Full name", MAX_NAME, 1);
    const email = cleanEmail(args.email, "email address");
    const sent = await createAndSendInvite(ctx, { email, appRole: "asset_manager", fullName });
    return { email: sent.email, status: sent.resent ? "resent" : "invited" };
  },
});

// --- 3. Profile -----------------------------------------------------------

export const profile = query({
  args: { userId: v.id("users"), fallbackTimeZone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const { membership, user } = await requireAmMember(ctx, org, args.userId);
    const now = Date.now();

    const [units, properties, requests, wos, hours, organization] = await Promise.all([
      managedUnitIds(ctx, org.orgId, args.userId).then((ids) => Promise.all(ids.map((id) => ctx.db.get(id)))),
      orgProperties(ctx, org.orgId),
      openRequests(ctx, org.orgId),
      activeWorkOrders(ctx, org.orgId),
      tourAvailabilityFor(ctx, args.userId),
      ctx.db.get(org.orgId),
    ]);
    const mine = units.filter((u): u is Doc<"units"> => u !== null);
    const managed = new Set(mine.map((u) => u._id));
    const countByProperty = new Map<string, number>();
    for (const u of mine) countByProperty.set(u.propertyId, (countByProperty.get(u.propertyId) ?? 0) + 1);

    const weeklyHours = hours?.weeklyHours ?? sched.DEFAULT_WEEKLY_HOURS;
    const props = [...countByProperty.entries()]
      .map(([id, unitCount]) => ({
        propertyId: id as Id<"properties">,
        name: properties.get(id)?.name ?? "Unknown",
        unitCount,
        // Properties carry no image today; the UI shows a placeholder.
        imageUrl: null as string | null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Today's tours, in the team's time zone (fallback only until an admin has set one).
    const tz =
      organization?.timeZone ??
      (args.fallbackTimeZone && sched.isValidTimeZone(args.fallbackTimeZone) ? args.fallbackTimeZone : "UTC");
    const todayKey = sched.localDateKey(now, tz);
    const from = sched.startOfLocalDay(todayKey, tz);
    const to = sched.startOfLocalDay(sched.addDays(todayKey, 1), tz);
    const tours = await toursBetween(ctx, org, args.userId, from, to, tz);
    const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });

    return {
      userId: args.userId,
      name: userName(user),
      initials: initialsOf(userName(user)),
      imageUrl: user.imageUrl ?? null,
      workEmail: user.email ?? "",
      personalEmail: membership.personalEmail ?? null,
      photoEmail: membership.photoEmail ?? null,
      phone: membership.phone ?? null,
      status: statusOf(membership, now),
      unavailableUntil: membership.unavailableUntil ?? null,
      takingTours: hours?.availableForTours ?? true,
      availabilitySummary: summarizeHours(weeklyHours),
      counts: {
        assignedUnits: mine.length,
        openRequests: requests.filter((r) => r.unitId !== undefined && managed.has(r.unitId)).length,
        activeWorkOrders: wos.filter((w) => managed.has(w.unitId)).length,
        properties: props.length,
      },
      properties: props,
      internalNotes: membership.internalNotes ?? "",
      timeZone: tz,
      todaySchedule: tours.map((t) => ({
        id: t.id,
        time: clock.format(t.start),
        start: t.start,
        title: t.title,
        sub: [t.bedroomsLabel, t.propertyName].filter(Boolean).join(" • "),
      })),
      tourHours: tourHoursFor(weeklyHours),
    };
  },
});

/**
 * Booked tours for one assignee in [from, to). Tours are not tied to a property or unit in the
 * data model (Sarah books into the person's calendar), so the property shown is the team's first
 * one, the same convention as tours.upcoming; the bedroom count comes from the lead's
 * qualification when the tour came from a call.
 */
async function toursBetween(
  ctx: QueryCtx,
  org: OrgContext,
  userId: Id<"users">,
  from: number,
  to: number,
  timeZone: string,
) {
  const rows = await ctx.db
    .query("tours")
    .withIndex("by_assignee_and_start", (q) => q.eq("assignedUserId", userId).gte("start", from).lt("start", to))
    .take(500);
  const property = await ctx.db
    .query("properties")
    .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
    .first();
  const propertyName = property?.name ?? (await ctx.db.get(org.orgId))?.name ?? "";
  const out = [];
  for (const t of rows) {
    if (t.status !== "booked" || t.orgId !== org.orgId) continue;
    const qualification = t.elevenLabsConversationId
      ? await ctx.db
          .query("qualifications")
          .withIndex("by_elevenlabs_conversation_id", (q) =>
            q.eq("elevenLabsConversationId", t.elevenLabsConversationId!),
          )
          .first()
      : null;
    out.push({
      id: t._id,
      start: t.start,
      end: t.end,
      timeZone: t.timeZone || timeZone,
      title: propertyName ? `Tour – ${propertyName}` : "Tour",
      bedrooms: qualification?.bedrooms ?? null,
      bedroomsLabel: bedroomsSentence(qualification?.bedrooms),
      propertyName,
    });
  }
  return out;
}

// --- 4. Update profile ----------------------------------------------------

/**
 * Edits the admin-managed profile fields. The NAME is read-only: it mirrors the person's Clerk
 * profile (users.firstName/lastName, rewritten by the Clerk webhook), and there is no clean
 * membership-level override, so a name edit here would be silently reverted. The WORK EMAIL is
 * the Clerk sign-in identity and is read-only too. "" clears personalEmail / photoEmail / phone /
 * notes. photoEmail is the address Sarah dictates to tenants for photos of repairs in this person's
 * units, so it must also be one she can read out (sarahReplies.speakablePhotoEmail).
 */
export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    personalEmail: v.optional(v.string()),
    photoEmail: v.optional(v.string()),
    phone: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const { membership } = await requireAmMember(ctx, org, args.userId);

    // Fields are picked one by one; nothing else can reach the row.
    const patch: { personalEmail?: string; photoEmail?: string; phone?: string; internalNotes?: string } = {};
    const changed: string[] = [];
    if (args.personalEmail !== undefined) {
      const raw = args.personalEmail.trim();
      patch.personalEmail = raw === "" ? undefined : cleanEmail(raw, "personal email");
      changed.push("personalEmail");
    }
    if (args.photoEmail !== undefined) {
      const raw = args.photoEmail.trim();
      if (raw === "") {
        patch.photoEmail = undefined;
      } else {
        const email = speakablePhotoEmail(raw);
        if (!email) {
          throw new ConvexError(PHOTO_EMAIL_INVALID);
        }
        patch.photoEmail = email;
      }
      changed.push("photoEmail");
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
      action: "am_profile_updated",
      actorUserId: org.user._id,
      note: `fields: ${changed.join(", ")}`, // names only, never the values (PII)
    });
    return { updated: changed };
  },
});

// --- 5. Availability ------------------------------------------------------

export const availability = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    await requireAmMember(ctx, org, args.userId);
    const [hours, organization] = await Promise.all([tourAvailabilityFor(ctx, args.userId), ctx.db.get(org.orgId)]);
    const weeklyHours = hours?.weeklyHours ?? sched.DEFAULT_WEEKLY_HOURS;
    return {
      userId: args.userId,
      timeZone: organization?.timeZone ?? null,
      takingTours: hours?.availableForTours ?? true,
      saved: hours?.hoursSavedAt !== undefined,
      summary: summarizeHours(weeklyHours),
      days: tourHoursFor(weeklyHours), // Monday first; day 0 = Sunday
    };
  },
});

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Sets an asset manager's weekly tour hours (same validation and storage as the member's own
 * Calendar page, via tours.saveWeeklyHours). A day with start/end null is a day off. Times are
 * "HH:MM" in the team's time zone on 15-minute steps, start before end; at least one day.
 */
export const setAvailability = mutation({
  args: {
    userId: v.id("users"),
    hours: v.array(v.object({ day: v.number(), start: v.union(v.string(), v.null()), end: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const { membership } = await requireAmMember(ctx, org, args.userId);
    if (args.hours.length > 7) throw new ConvexError("Send at most one entry per day.");

    const weekly: sched.DayHours[] = [];
    for (const h of args.hours) {
      if (h.start === null && h.end === null) continue; // day off
      if (h.start === null || h.end === null) throw new ConvexError("Set both a start and an end time, or turn the day off.");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h.end)) {
        throw new ConvexError("Times must look like 09:00.");
      }
      if (minutesOf(h.start) % 15 !== 0 || minutesOf(h.end) % 15 !== 0) {
        throw new ConvexError("Times must be in 15-minute steps.");
      }
      if (minutesOf(h.start) >= minutesOf(h.end)) throw new ConvexError("Each day must end after it starts.");
      weekly.push({ day: h.day, start: h.start, end: h.end });
    }
    // saveWeeklyHours re-validates days (0-6, no duplicates) and the minimum tour length.
    const saved = await saveWeeklyHours(ctx, args.userId, weekly);
    await writeAudit(ctx, {
      orgId: org.orgId,
      entity: "membership",
      entityId: membership._id,
      action: "am_availability_set",
      actorUserId: org.user._id,
      to: summarizeHours(saved),
    });
    return { summary: summarizeHours(saved), days: tourHoursFor(saved) };
  },
});

// --- 6. Work orders -------------------------------------------------------

export const workOrders = query({
  args: {
    userId: v.id("users"),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    await requireAmMember(ctx, org, args.userId);
    return await workOrderRowsForAm(ctx, org, args.userId, args);
  },
});

// --- 7. Units -------------------------------------------------------------

type UnitRow = {
  unitId: Id<"units">;
  propertyId: Id<"properties">;
  propertyName: string;
  unitNumber: string;
  label: string;
  bedrooms: string;
  bathrooms: number | null;
  bedsBaths: string;
  availability: "Occupied" | "Available";
  openRequests: number;
};

function unitRow(u: Doc<"units">, propertyName: string, openRequests: number): UnitRow {
  return {
    unitId: u._id,
    propertyId: u.propertyId,
    propertyName,
    unitNumber: u.unitNumber,
    label: `${propertyName} · ${u.unitNumber}`,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms ?? null,
    bedsBaths: `${bedsLabel(u.bedrooms)} / ${u.bathrooms ?? "-"}`,
    availability: u.available ? "Available" : "Occupied",
    openRequests,
  };
}

function openRequestsByUnit(requests: Doc<"maintenanceRequests">[]) {
  const map = new Map<string, number>();
  for (const r of requests) if (r.unitId) map.set(r.unitId, (map.get(r.unitId) ?? 0) + 1);
  return map;
}

const byLabel = (a: UnitRow, b: UnitRow) =>
  a.propertyName.localeCompare(b.propertyName) || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });

export const assignedUnits = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<UnitRow[]> => {
    const org = await requireAdminView(ctx);
    await requireAmMember(ctx, org, args.userId);
    const [units, properties, requests] = await Promise.all([
      ctx.db
        .query("units")
        .withIndex("by_org_and_asset_manager", (q) => q.eq("orgId", org.orgId).eq("assetManagerUserId", args.userId))
        .collect(),
      orgProperties(ctx, org.orgId),
      openRequests(ctx, org.orgId),
    ]);
    const counts = openRequestsByUnit(requests);
    return units
      .map((u) => unitRow(u, properties.get(u.propertyId)?.name ?? "Unknown", counts.get(u._id) ?? 0))
      .sort(byLabel);
  },
});

/**
 * Units managed by OTHER asset managers, for "Assign another unit". The Figma calls these
 * "unmanaged", but the hard rule means none exist: this lists units that can be moved TO this
 * manager, each with its current manager.
 */
export const otherUnits = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    await requireAmMember(ctx, org, args.userId);
    const [units, properties, requests] = await Promise.all([
      orgUnits(ctx, org.orgId),
      orgProperties(ctx, org.orgId),
      openRequests(ctx, org.orgId),
    ]);
    const counts = openRequestsByUnit(requests);
    const names = new Map<string, string>();
    const groups = new Map<string, { propertyId: Id<"properties">; propertyName: string; units: Array<UnitRow & { currentManager: { userId: Id<"users">; name: string } }> }>();
    for (const u of units) {
      if (u.assetManagerUserId === args.userId) continue;
      if (!names.has(u.assetManagerUserId)) names.set(u.assetManagerUserId, userName(await ctx.db.get(u.assetManagerUserId)));
      const propertyName = properties.get(u.propertyId)?.name ?? "Unknown";
      const group = groups.get(u.propertyId) ?? { propertyId: u.propertyId, propertyName, units: [] };
      group.units.push({
        ...unitRow(u, propertyName, counts.get(u._id) ?? 0),
        currentManager: { userId: u.assetManagerUserId, name: names.get(u.assetManagerUserId) ?? "Unknown" },
      });
      groups.set(u.propertyId, group);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, units: g.units.sort(byLabel) }))
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  },
});

// --- 8. Reassign / assign -------------------------------------------------

async function portfolioCount(ctx: MutationCtx, orgId: Id<"organizations">, userId: Id<"users">): Promise<number> {
  return (await managedUnitIds(ctx, orgId, userId)).length;
}

async function unchangedWorkOrders(ctx: MutationCtx, orgId: Id<"organizations">, unitId: Id<"units">) {
  const rows = await ctx.db
    .query("workOrders")
    .withIndex("by_unit", (q) => q.eq("unitId", unitId))
    .collect();
  return rows
    .filter((w) => w.orgId === orgId && (ACTIVE_WO_STATUSES as readonly string[]).includes(w.status))
    .map((w) => ({ id: w._id, number: `WO-${w.number}` }));
}

/** Shared by reassignUnit and assignUnitToManager: one reassign, one audit trail, one report. */
async function moveUnit(
  ctx: MutationCtx,
  org: OrgContext,
  unitId: Id<"units">,
  to: Id<"users">,
  reason: string | undefined,
) {
  const unit = await ctx.db.get(unitId);
  if (!unit || unit.orgId !== org.orgId) throw new ConvexError("Unit not found.");
  // The target must be an asset manager on THIS team (also re-checked inside units.ts).
  await requireAmMember(ctx, org, to);

  const moved = await reassignUnitWithReason(ctx, org, unitId, to, reason);
  const at = Date.now();
  const [previousUser, newUser, previousCount, newCount, workOrdersUnchanged, property] = await Promise.all([
    ctx.db.get(moved.previousManagerUserId),
    ctx.db.get(to),
    portfolioCount(ctx, org.orgId, moved.previousManagerUserId),
    portfolioCount(ctx, org.orgId, to),
    unchangedWorkOrders(ctx, org.orgId, unitId),
    ctx.db.get(unit.propertyId),
  ]);
  return {
    at,
    unit: { unitId, unitNumber: unit.unitNumber, propertyName: property?.name ?? "Unknown", label: `${property?.name ?? "Unknown"} · ${unit.unitNumber}` },
    previousManager: { userId: moved.previousManagerUserId, name: userName(previousUser) },
    newManager: { userId: to, name: userName(newUser) },
    requestsMoved: moved.requestsMoved.map((r) => ({ requestId: r.requestId, number: `MR-${r.number}` })),
    workOrdersUnchanged,
    // Unit counts AFTER the move: "James now has 27 designated units" / "29 assigned units".
    previousPortfolioCount: previousCount,
    newPortfolioCount: newCount,
  };
}

export const reassignUnit = mutation({
  args: { unitId: v.id("units"), newManagerUserId: v.id("users"), reason: v.string() },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const reason = cleanText(args.reason, "Reason", MAX_REASON, 3);
    return await moveUnit(ctx, org, args.unitId, args.newManagerUserId, reason);
  },
});

/** "Assign another unit": the same reassign, from the target manager's side. */
export const assignUnitToManager = mutation({
  args: { unitId: v.id("units"), managerUserId: v.id("users"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    const reason = args.reason === undefined || args.reason.trim() === "" ? undefined : cleanText(args.reason, "Reason", MAX_REASON, 3);
    const r = await moveUnit(ctx, org, args.unitId, args.managerUserId, reason);
    return {
      at: r.at,
      unit: r.unit,
      designatedManager: r.newManager,
      portfolioTotal: r.newPortfolioCount,
      previousManager: r.previousManager,
      previousPortfolioCount: r.previousPortfolioCount,
      requestsMoved: r.requestsMoved,
      workOrdersUnchanged: r.workOrdersUnchanged,
    };
  },
});

// --- 9. Password reset email ----------------------------------------------

/**
 * Passwords live in Clerk and the code base never reads CLERK_SECRET_KEY; Clerk's Backend API has
 * no "send a reset email" call (only setting a password directly, which an admin must never
 * do). So this emails the member's WORK email, via Resend, a branded note pointing at the app's
 * sign-in page where "Forgot password?" starts Clerk's own reset. The link is fixed to
 * {APP_BASE_URL}/sign-in and carries no token, so nothing in the email can be replayed or
 * redirected. Max 3 per target per rolling 24h (passwordResetRequests), audited.
 */
export const sendPasswordReset = action({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ sent: true; method: "email_link" }> => {
    const org = await requireAdminViewId(ctx);
    const target: { reservationId: Id<"passwordResetRequests">; email: string; name: string } = await ctx.runMutation(
      internal.assetManagers.reservePasswordReset,
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
      console.error("assetManagers.sendPasswordReset: email failed", err instanceof Error ? err.message.slice(0, 200) : "unknown");
      throw new ConvexError("Could not send the email. Try again in a moment.");
    }
    return { sent: true, method: "email_link" };
  },
});

export const reservePasswordReset = internalMutation({
  args: { orgId: v.id("organizations"), actorUserId: v.id("users"), targetUserId: v.id("users") },
  handler: async (ctx, args) => await reserveResetFor(ctx, args, isAm, "Asset manager not found."),
});

/**
 * Shared by the Asset Managers and Technicians reset emails: re-checks the actor is Admin view on
 * the team, the target holds the right job role (`isTarget`), applies the 3-per-day limit, and
 * records + audits the attempt.
 */
export async function reserveResetFor(
  ctx: MutationCtx,
  args: { orgId: Id<"organizations">; actorUserId: Id<"users">; targetUserId: Id<"users"> },
  isTarget: (m: Doc<"memberships">) => boolean,
  notFound: string,
) {
  // Re-verify the actor here too: this is the boundary even though only the action calls it.
  const actor = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", args.actorUserId))
    .first();
  if (!actor || actor.orgId !== args.orgId || !isAdminView({ isAdmin: actor.role === "admin", jobRoles: actor.jobRoles ?? [] })) throw new ConvexError("You don't have access to that.");
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
    .first();
  const user = await ctx.db.get(args.targetUserId);
  if (!membership || membership.orgId !== args.orgId || !isTarget(membership) || !user?.email) {
    throw new ConvexError(notFound);
  }

  const since = Date.now() - DAY_MS;
  const recent = await ctx.db
    .query("passwordResetRequests")
    .withIndex("by_target_and_at", (q) => q.eq("targetUserId", args.targetUserId).gte("at", since))
    .collect();
  if (recent.length >= RESET_LIMIT_PER_DAY) {
    throw new ConvexError("Too many reset emails were sent to this person today. Try again tomorrow.");
  }

  const reservationId = await ctx.db.insert("passwordResetRequests", {
    orgId: args.orgId,
    targetUserId: args.targetUserId,
    requestedBy: args.actorUserId,
    at: Date.now(),
  });
  await writeAudit(ctx, {
    orgId: args.orgId,
    entity: "membership",
    entityId: membership._id,
    action: "password_reset_emailed",
    actorUserId: args.actorUserId,
    note: "method=email_link",
  });
  return { reservationId, email: user.email, name: userName(user) };
}

export const releasePasswordReset = internalMutation({
  args: { reservationId: v.id("passwordResetRequests") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.reservationId);
  },
});

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function resetEmailHtml(name: string, link: string): string {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8fafc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8fafc" style="background:#f8fafc;padding:40px 16px"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%">
<tr><td align="left" style="padding:0 4px 20px"><img src="https://www.simplr.pro/brand/simplr-logo.png" alt="Simplr" width="104" height="36" style="display:block;width:104px;height:36px;border:0" /></td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
<h1 style="font-family:${font};font-size:20px;line-height:28px;font-weight:700;color:#0f172a;margin:0 0 12px">Reset your password</h1>
<p style="font-family:${font};font-size:14px;line-height:22px;color:#64748b;margin:0 0 16px">Hi ${esc(name)}, an administrator on your team asked us to help you reset your Simplr password.</p>
<p style="font-family:${font};font-size:14px;line-height:22px;color:#64748b;margin:0 0 24px">Open the sign-in page and choose <strong>Forgot password?</strong>. Enter this email address and follow the steps we send you.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#2563eb" style="background:#2563eb;border-radius:12px"><a href="${link}" style="display:inline-block;font-family:${font};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px">Go to sign in</a></td></tr></table>
</td></tr>
<tr><td style="padding:20px 4px 0"><p style="font-family:${font};font-size:12px;line-height:20px;color:#94a3b8;margin:0">We never ask for your password by email. If you were not expecting this, you can ignore it and your password stays as it is.</p></td></tr>
</table></td></tr></table></body></html>`;
}

export function resetEmailText(name: string, link: string): string {
  return [
    "Reset your password",
    "",
    `Hi ${name}, an administrator on your team asked us to help you reset your Simplr password.`,
    "",
    'Open the sign-in page and choose "Forgot password?". Enter this email address and follow the steps we send you.',
    link,
    "",
    "We never ask for your password by email. If you were not expecting this, you can ignore it and your password stays as it is.",
    "",
    "Simplr",
  ].join("\n");
}

// --- 10. Calendar ---------------------------------------------------------

/** This manager's booked tours in [from, to) (epoch ms, at most 62 days) for the calendar. */
export const calendar = query({
  args: { userId: v.id("users"), from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const org = await requireAdminView(ctx);
    await requireAmMember(ctx, org, args.userId);
    if (!Number.isFinite(args.from) || !Number.isFinite(args.to) || args.to <= args.from) {
      throw new ConvexError("Pick a valid date range.");
    }
    if (args.to - args.from > MAX_CALENDAR_DAYS * DAY_MS) throw new ConvexError("Pick a date range of 62 days or fewer.");
    const organization = await ctx.db.get(org.orgId);
    const timeZone = organization?.timeZone ?? "UTC";
    const tours = await toursBetween(ctx, org, args.userId, args.from, args.to, timeZone);
    return {
      timeZone,
      teamTimeZoneSet: Boolean(organization?.timeZone),
      tours: tours.map((t) => ({
        id: t.id,
        start: t.start,
        end: t.end,
        title: t.title,
        bedrooms: t.bedrooms,
        propertyName: t.propertyName,
      })),
    };
  },
});
