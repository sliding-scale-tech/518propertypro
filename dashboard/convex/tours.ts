import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { currentOrg, requireOrg, requireOrgAdmin, requireOrgId } from "./authz";
import * as google from "./googleApi";
import { accessTokenFor } from "./googleCalendar";
import * as sched from "./tourSchedule";

/**
 * Tour availability and booking.
 *
 * The rules: a tour is 45 minutes with 15 minutes kept clear either side, inside the team
 * member's own tour hours, in the team's time zone. When several people are free, whoever has
 * the fewest tours that week (Monday to Sunday, local) gets it; ties go to whoever joined the
 * team first, so the outcome is predictable rather than random.
 */

// How far ahead find_tour_times looks, and how much it hands back. Three per day spread across
// the day, six in total — more than that is a list, and lists are unbearable on a phone call.
const SEARCH_DAYS = 7;
const TIMES_PER_DAY = 3;
const MAX_TIMES = 6;
// When the caller named a time: the open times closest to it, or two beside it if it is open.
const NEAREST_TIMES = 3;
const NEAREST_WITH_OPEN = 2;

const weeklyHoursValidator = v.array(v.object({ day: v.number(), start: v.string(), end: v.string() }));

// --- Availability page ------------------------------------------------------

export const availabilitySettings = query({
  args: {},
  handler: async (ctx) => {
    const org = await currentOrg(ctx);
    if (!org) return null;

    const organization = await ctx.db.get(org.orgId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
      .collect();

    const team = await Promise.all(
      memberships.map(async (m) => {
        const [user, connection, hours] = await Promise.all([
          ctx.db.get(m.userId),
          ctx.db
            .query("googleCalendarConnections")
            .withIndex("by_user", (q) => q.eq("userId", m.userId))
            .unique(),
          ctx.db
            .query("tourAvailability")
            .withIndex("by_user", (q) => q.eq("userId", m.userId))
            .unique(),
        ]);
        const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
        return {
          userId: m.userId,
          name: name || user?.email || "Unknown",
          isSelf: m.userId === org.user._id,
          calendar: !connection
            ? ("not_connected" as const)
            : connection.invalidAt
              ? ("needs_reconnect" as const)
              : ("connected" as const),
          availableForTours: hours?.availableForTours ?? true,
        };
      }),
    );

    const mine = await ctx.db
      .query("tourAvailability")
      .withIndex("by_user", (q) => q.eq("userId", org.user._id))
      .unique();
    // A coarse UTC-day cutoff — good enough for hiding stale days off from the manager list, and
    // simpler than resolving a time zone that may not be set yet.
    const today = new Date().toISOString().slice(0, 10);

    return {
      isAdmin: org.isAdmin,
      timeZone: organization?.timeZone ?? null,
      mine: {
        // False until they have saved hours once — the Calendar page asks them on first visit.
        saved: mine?.hoursSavedAt !== undefined,
        availableForTours: mine?.availableForTours ?? true,
        weeklyHours: mine?.weeklyHours ?? sched.DEFAULT_WEEKLY_HOURS,
        // A date already passed is no longer worth showing in the manager list. String comparison
        // is exact for this — "YYYY-MM-DD" sorts the same lexically as chronologically.
        daysOff: (mine?.daysOff ?? []).filter((d) => d >= today).sort(),
      },
      team,
    };
  },
});

export const setTimeZone = mutation({
  args: { timeZone: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrgAdmin(ctx);
    if (!sched.isValidTimeZone(args.timeZone)) throw new Error("That is not a time zone we recognize.");
    await ctx.db.patch(org.orgId, { timeZone: args.timeZone, updatedAt: Date.now() });
  },
});

/** Your own tour hours, from the Calendar page. Whether you take tours at all is setTakingTours. */
export const saveMyHours = mutation({
  args: { weeklyHours: weeklyHoursValidator },
  handler: async (ctx, args) => {
    const { user } = await requireOrg(ctx);
    const weeklyHours = sched.validateWeeklyHours(args.weeklyHours);
    if (weeklyHours.length === 0) {
      throw new Error("Pick at least one day. To stop taking tours, switch tours off on the Team page.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("tourAvailability")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { weeklyHours, hoursSavedAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("tourAvailability", {
        userId: user._id,
        availableForTours: true,
        weeklyHours,
        hoursSavedAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Switches someone's tours on or off, from the Team page. Anyone may switch their own; only an
 * admin may switch a teammate's. Enforced here — the page disables the other switches for a
 * member, but that is a courtesy, not the boundary.
 */
export const setTakingTours = mutation({
  args: { userId: v.id("users"), takingTours: v.boolean() },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (args.userId !== org.user._id && !org.isAdmin) {
      throw new Error("Only a team admin can change a teammate's tours.");
    }

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!membership || membership.orgId !== org.orgId) throw new Error("That person is not on your team.");

    const now = Date.now();
    const existing = await ctx.db
      .query("tourAvailability")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { availableForTours: args.takingTours, updatedAt: now });
    } else {
      // Default hours and no hoursSavedAt: they still get asked for their own hours on Calendar.
      await ctx.db.insert("tourAvailability", {
        userId: args.userId,
        availableForTours: args.takingTours,
        weeklyHours: sched.DEFAULT_WEEKLY_HOURS,
        updatedAt: now,
      });
    }
  },
});

/**
 * Turns off one specific date — a one-off exception separate from your recurring weekly hours
 * (a holiday, an appointment), from the Calendar page's "Need a day off?" prompt. Self-service
 * only, same as saveMyHours: an admin manages whether someone takes tours at all, not which
 * individual days they take off.
 *
 * Refused when a tour is already booked for you that day — turning the day off would otherwise
 * silently orphan it. Move or cancel it first, then the day can be turned off.
 */
export const addDayOff = mutation({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    if (!sched.isDateKey(args.date)) throw new Error("date must be YYYY-MM-DD.");

    const organization = await ctx.db.get(org.orgId);
    if (organization?.timeZone) {
      const from = sched.startOfLocalDay(args.date, organization.timeZone);
      const to = sched.startOfLocalDay(sched.addDays(args.date, 1), organization.timeZone);
      const clash = await ctx.db
        .query("tours")
        .withIndex("by_assignee_and_start", (q) =>
          q.eq("assignedUserId", org.user._id).gte("start", from).lt("start", to),
        )
        .filter((q) => q.eq(q.field("status"), "booked"))
        .first();
      if (clash) {
        throw new Error("You already have a tour booked that day. Move or cancel it first, then turn the day off.");
      }
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("tourAvailability")
      .withIndex("by_user", (q) => q.eq("userId", org.user._id))
      .unique();
    const daysOff = [...new Set([...(existing?.daysOff ?? []), args.date])].sort();
    if (existing) {
      await ctx.db.patch(existing._id, { daysOff, updatedAt: now });
    } else {
      await ctx.db.insert("tourAvailability", {
        userId: org.user._id,
        availableForTours: true,
        weeklyHours: sched.DEFAULT_WEEKLY_HOURS,
        daysOff,
        updatedAt: now,
      });
    }
  },
});

export const removeDayOff = mutation({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireOrg(ctx);
    const existing = await ctx.db
      .query("tourAvailability")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      daysOff: (existing.daysOff ?? []).filter((d) => d !== args.date),
      updatedAt: Date.now(),
    });
  },
});

// --- Tour details (the Calendar page's dialog) ---------------------------------

/**
 * Everything a property manager needs about one booked tour: the renter's contact details, the
 * team member giving it, and — when it came from a call — what the renter told Sarah.
 *
 * Same visibility as the calendar itself: your own tours, or any tour on your team if you are
 * an admin (calendarView.week draws the same line for viewing a teammate's whole calendar).
 * Tours are the team's own business data, not the assigned member's personal information — that
 * is also why toursFor already sends full caller details for a teammate's calendar, unlike their
 * personal Google events.
 */
export const tourDetails = query({
  args: { tourId: v.id("tours") },
  handler: async (ctx, args) => {
    const org = await requireOrg(ctx);
    const tour = await ctx.db.get(args.tourId);
    if (!tour || tour.orgId !== org.orgId) return null;
    if (tour.assignedUserId !== org.user._id && !org.isAdmin) {
      throw new Error("Only a team admin can view a teammate's tour.");
    }

    const member = await ctx.db.get(tour.assignedUserId);
    const qualification = tour.elevenLabsConversationId
      ? await ctx.db
          .query("qualifications")
          .withIndex("by_elevenlabs_conversation_id", (q) =>
            q.eq("elevenLabsConversationId", tour.elevenLabsConversationId!),
          )
          .first()
      : null;

    return {
      status: tour.status,
      start: tour.start,
      end: tour.end,
      timeZone: tour.timeZone,
      callerName: tour.callerName ?? qualification?.callerName,
      callerPhone: tour.callerPhone ?? qualification?.callerPhone,
      memberName:
        [member?.firstName, member?.lastName].filter(Boolean).join(" ") || member?.email || "Team member",
      // Present only when the tour came from a call Sarah handled — a manually recorded lead
      // has no elevenLabsConversationId and so nothing further to show here.
      fromCall: qualification
        ? {
            bedrooms: qualification.bedrooms,
            moveInDate: qualification.moveInDate,
            budget: qualification.budget,
            petsWanted: qualification.petsWanted,
            petType: qualification.petType,
            qualifies: qualification.qualifies,
            screeningAnswers: qualification.screeningAnswers ?? [],
          }
        : null,
    };
  },
});

/** The name shown for who a tour is with — reused by markLeadCancelled below. */
export const memberDisplayName = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email?.split("@")[0] || null;
  },
});

/**
 * Marks the lead's tour as cancelled, when the tour came from a call — a manually recorded lead
 * has nothing to update. Shared by every place a tour gets cancelled, so the lead always reflects
 * it the same way regardless of who cancelled it or how.
 */
export async function markLeadCancelled(
  ctx: ActionCtx,
  tour: { elevenLabsConversationId?: string; start: number; timeZone: string; assignedUserId: Id<"users"> },
): Promise<void> {
  if (!tour.elevenLabsConversationId) return;
  const memberName = await ctx.runQuery(internal.tours.memberDisplayName, { userId: tour.assignedUserId });
  const label = sched.spokenLabel(tour.start, tour.timeZone);
  await ctx.runMutation(internal.qualifications.upsertByConversationId, {
    elevenLabsConversationId: tour.elevenLabsConversationId,
    tourSlot: `${label}${memberName ? ` with ${memberName}` : ""} (cancelled)`,
    tourConfirmed: false,
  });
}

/**
 * Cancels a tour from the dashboard: any team member may cancel their own, an admin may cancel
 * anyone's on the team — the same line calendarView.week draws for viewing a whole calendar.
 */
export const cancelBookedTour = action({
  args: { tourId: v.id("tours") },
  handler: async (ctx, args): Promise<void> => {
    const org = await requireOrgId(ctx);
    const tour = await ctx.runQuery(internal.tours.byId, { tourId: args.tourId });
    if (!tour || tour.orgId !== org.orgId) throw new Error("That tour was not found.");
    if (tour.assignedUserId !== org.userId && !org.isAdmin) {
      throw new Error("Only a team admin can cancel a teammate's tour.");
    }
    if (tour.status === "cancelled") return;

    await cancelTourNow(ctx, args.tourId);
    await markLeadCancelled(ctx, tour);
  },
});

// --- Booking data -------------------------------------------------------------

/**
 * Everyone on the team who can be booked right now: taking tours, with a calendar connected
 * that Google still accepts. Someone who needs to reconnect is left out rather than booked
 * blind — we cannot see their calendar, so we cannot know they are free.
 */
export const bookingContext = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const orgId = ctx.db.normalizeId("organizations", args.orgId);
    const org = orgId ? await ctx.db.get(orgId) : null;
    if (!orgId || !org) return null;

    const property = await ctx.db
      .query("properties")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const members = [];
    for (const m of memberships) {
      const hours = await ctx.db
        .query("tourAvailability")
        .withIndex("by_user", (q) => q.eq("userId", m.userId))
        .unique();
      if (hours && !hours.availableForTours) continue;

      const connection = await ctx.db
        .query("googleCalendarConnections")
        .withIndex("by_user", (q) => q.eq("userId", m.userId))
        .unique();
      if (!connection || connection.invalidAt) continue;

      const user = await ctx.db.get(m.userId);
      if (!user) continue;
      members.push({
        userId: m.userId,
        firstName: user.firstName || user.email?.split("@")[0] || "a member of our team",
        fullName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Team member",
        weeklyHours: hours?.weeklyHours ?? sched.DEFAULT_WEEKLY_HOURS,
        daysOff: hours?.daysOff ?? [],
        joinedAt: m.createdAt,
      });
    }

    return {
      timeZone: org.timeZone ?? null,
      propertyName: property?.name ?? org.name,
      propertyAddress: property?.address?.formatted ?? null,
      members,
    };
  },
});

/** Booked tours starting in [start, end), across the team. */
export const bookedInRange = internalQuery({
  args: { orgId: v.string(), start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("tours")
      .withIndex("by_org_and_start", (q) =>
        q.eq("orgId", args.orgId).gte("start", args.start).lt("start", args.end),
      )
      .collect();
    return rows
      .filter((t) => t.status === "booked")
      .map((t) => ({ id: t._id, assignedUserId: t.assignedUserId, start: t.start, end: t.end }));
  },
});

/**
 * Claims the slot in our own database before anything is written to Google.
 *
 * Google's free/busy check happens in an action and cannot be made atomic, so two calls
 * landing on the same person at the same moment could both see them free. This mutation is
 * the tiebreak: Convex runs it serializably, and the second caller finds the first one's row.
 */
export const reserve = internalMutation({
  args: {
    orgId: v.string(),
    assignedUserId: v.id("users"),
    start: v.number(),
    end: v.number(),
    timeZone: v.string(),
    callerName: v.optional(v.string()),
    callerPhone: v.optional(v.string()),
    elevenLabsConversationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"tours"> | null> => {
    const nearby = await ctx.db
      .query("tours")
      .withIndex("by_assignee_and_start", (q) =>
        q
          .eq("assignedUserId", args.assignedUserId)
          .gte("start", args.start - sched.TOUR_MS - 2 * sched.BUFFER_MS)
          .lt("start", args.end + sched.BUFFER_MS),
      )
      .collect();
    const clash = nearby.some(
      (t) =>
        t.status === "booked" &&
        t.start < args.end + sched.BUFFER_MS &&
        t.end > args.start - sched.BUFFER_MS,
    );
    if (clash) return null;

    const now = Date.now();
    return ctx.db.insert("tours", { ...args, status: "booked", createdAt: now, updatedAt: now });
  },
});

export const attachEvent = internalMutation({
  args: { tourId: v.id("tours"), googleEventId: v.string() },
  handler: (ctx, args) =>
    ctx.db.patch(args.tourId, { googleEventId: args.googleEventId, updatedAt: Date.now() }),
});

/** Undoes a reservation whose calendar event could not be created. */
export const release = internalMutation({
  args: { tourId: v.id("tours") },
  handler: (ctx, args) => ctx.db.delete(args.tourId),
});

/**
 * One caller's upcoming booked tours: booked earlier on this call, or under the same phone
 * number (see tourSchedule.phoneKey). This is what cancel_tour and reschedule_tour may act on —
 * a tour_id that is not in here is refused, so nobody changes a booking that is not theirs by
 * guessing an id.
 */
export const upcomingForCaller = internalQuery({
  args: {
    orgId: v.string(),
    elevenLabsConversationId: v.optional(v.string()),
    phoneKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("tours")
      .withIndex("by_org_and_start", (q) => q.eq("orgId", args.orgId).gte("start", Date.now()))
      .collect();
    const mine = rows.filter((t) => {
      if (t.status !== "booked") return false;
      if (args.elevenLabsConversationId && t.elevenLabsConversationId === args.elevenLabsConversationId) {
        return true;
      }
      const key = sched.phoneKey(t.callerPhone);
      return key !== null && args.phoneKeys.includes(key);
    });
    return Promise.all(
      mine.map(async (t) => {
        const member = await ctx.db.get(t.assignedUserId);
        return {
          id: t._id,
          start: t.start,
          end: t.end,
          timeZone: t.timeZone,
          assignedUserId: t.assignedUserId,
          googleEventId: t.googleEventId,
          callerName: t.callerName,
          callerPhone: t.callerPhone,
          elevenLabsConversationId: t.elevenLabsConversationId,
          memberFirstName: member?.firstName || member?.email?.split("@")[0] || "a member of our team",
        };
      }),
    );
  },
});

/** A tour by an id that arrived as a string from the agent, which may not be a valid id at all. */
export const byIdString = internalQuery({
  args: { tourId: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("tours", args.tourId);
    return id ? ctx.db.get(id) : null;
  },
});

type PreviousSlot = {
  assignedUserId: Id<"users">;
  start: number;
  end: number;
  googleEventId?: string;
};

/**
 * Moves a booked tour to a new time and team member in our database, before Google is touched —
 * the same serializable claim as reserve, ignoring the tour itself. Returns what it replaced so a
 * failed calendar update can put it back; null if the new slot clashes.
 */
export const moveReservation = internalMutation({
  args: { tourId: v.id("tours"), assignedUserId: v.id("users"), start: v.number(), end: v.number() },
  handler: async (ctx, args): Promise<PreviousSlot | null> => {
    const tour = await ctx.db.get(args.tourId);
    if (!tour || tour.status !== "booked") return null;

    const nearby = await ctx.db
      .query("tours")
      .withIndex("by_assignee_and_start", (q) =>
        q
          .eq("assignedUserId", args.assignedUserId)
          .gte("start", args.start - sched.TOUR_MS - 2 * sched.BUFFER_MS)
          .lt("start", args.end + sched.BUFFER_MS),
      )
      .collect();
    const clash = nearby.some(
      (t) =>
        t._id !== args.tourId &&
        t.status === "booked" &&
        t.start < args.end + sched.BUFFER_MS &&
        t.end > args.start - sched.BUFFER_MS,
    );
    if (clash) return null;

    await ctx.db.patch(args.tourId, {
      assignedUserId: args.assignedUserId,
      start: args.start,
      end: args.end,
      updatedAt: Date.now(),
    });
    return {
      assignedUserId: tour.assignedUserId,
      start: tour.start,
      end: tour.end,
      googleEventId: tour.googleEventId,
    };
  },
});

/** Puts a tour back where it was when its calendar update failed. */
export const restoreReservation = internalMutation({
  args: {
    tourId: v.id("tours"),
    assignedUserId: v.id("users"),
    start: v.number(),
    end: v.number(),
    googleEventId: v.optional(v.string()),
  },
  handler: async (ctx, { tourId, ...previous }) => {
    await ctx.db.patch(tourId, { ...previous, updatedAt: Date.now() });
  },
});

export const byId = internalQuery({
  args: { tourId: v.id("tours") },
  handler: (ctx, args) => ctx.db.get(args.tourId),
});

export const markCancelled = internalMutation({
  args: { tourId: v.id("tours") },
  handler: (ctx, args) => ctx.db.patch(args.tourId, { status: "cancelled", updatedAt: Date.now() }),
});

/**
 * Cancels a booked tour: removes its event from the team member's Google Calendar, then marks
 * it cancelled. Calendar first, so a failure at Google leaves the tour still booked rather than
 * cancelled here while the event lingers in someone's calendar. Internal for now — there is no
 * cancel button yet.
 *
 * Run it with:  npx convex run tours:cancel '{"tourId":"..."}'
 */
export const cancel = internalAction({
  args: { tourId: v.id("tours") },
  handler: async (ctx, args): Promise<void> => {
    await cancelTourNow(ctx, args.tourId);
  },
});

/** Shared by the operator command above and the agent's cancel_tour webhook. */
export async function cancelTourNow(ctx: ActionCtx, tourId: Id<"tours">): Promise<void> {
  const tour = await ctx.runQuery(internal.tours.byId, { tourId });
  if (!tour || tour.status === "cancelled") return;
  if (tour.googleEventId) {
    await google.deleteEvent(await accessTokenFor(ctx, tour.assignedUserId), tour.googleEventId);
  }
  await ctx.runMutation(internal.tours.markCancelled, { tourId });
}

// --- Booking (called from the voice agent's webhooks in http.ts) ---------------

export type TourTime = { start: string; label: string };

type Member = {
  userId: Id<"users">;
  firstName: string;
  fullName: string;
  weeklyHours: sched.DayHours[];
  daysOff: string[];
  joinedAt: number;
};

/** Whether a member is working at all on a given local date — their weekly hours minus days off. */
function isWorkingDay(member: Member, day: string): boolean {
  return !member.daysOff.includes(day);
}
type Context =
  | { ok: true; timeZone: string; propertyName: string; propertyAddress: string | null; members: Member[] }
  | { ok: false; reason: string };

async function loadContext(ctx: ActionCtx, orgId: string | undefined): Promise<Context> {
  if (!orgId) return { ok: false, reason: "This call could not be matched to a team." };
  const context = await ctx.runQuery(internal.tours.bookingContext, { orgId });
  if (!context) return { ok: false, reason: "This call could not be matched to a team." };
  if (!context.timeZone) return { ok: false, reason: "The team has not set a time zone yet." };
  if (context.members.length === 0) {
    return { ok: false, reason: "Nobody on the team has a calendar connected and is taking tours." };
  }
  return {
    ok: true,
    timeZone: context.timeZone,
    propertyName: context.propertyName,
    propertyAddress: context.propertyAddress,
    members: context.members,
  };
}

/** A caller's own tour while it is being moved: it must not block the time it is moving to. */
export type IgnoredTour = { id: Id<"tours">; assignedUserId: Id<"users">; start: number; end: number };

/**
 * Busy blocks per member: Google free/busy plus our own booked tours (which are in Google too,
 * but a tour booked a second ago may not show up in free/busy yet).
 *
 * A member whose calendar cannot be read is left out of the map, which every caller treats as
 * "not free". Guessing they are free would book a tour on top of whatever we could not see.
 */
async function busyByMember(
  ctx: ActionCtx,
  orgId: string,
  members: Member[],
  from: number,
  to: number,
  ignore?: IgnoredTour,
): Promise<Map<Id<"users">, sched.Interval[]>> {
  const booked = await ctx.runQuery(internal.tours.bookedInRange, {
    orgId,
    start: from - sched.TOUR_MS - sched.BUFFER_MS,
    end: to,
  });

  const busy = new Map<Id<"users">, sched.Interval[]>();
  await Promise.all(
    members.map(async (m) => {
      try {
        const token = await accessTokenFor(ctx, m.userId);
        const blocks = await google.freeBusy(token, new Date(from).toISOString(), new Date(to).toISOString());
        const googleBusy = blocks.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
        busy.set(m.userId, [
          // The tour being moved is in its member's Google Calendar too; cut it out of theirs.
          ...(ignore && ignore.assignedUserId === m.userId ? sched.withoutInterval(googleBusy, ignore) : googleBusy),
          ...booked.filter((t) => t.assignedUserId === m.userId && t.id !== ignore?.id),
        ]);
      } catch (err) {
        console.warn(`[tours] skipping ${m.userId}, calendar unreadable:`, err);
      }
    }),
  );
  return busy;
}

export type RequestedTime = TourTime & {
  open: boolean;
  // Why it is not open, so the agent can say something true rather than a bare "no".
  reason: "open" | "passed" | "too_soon" | "outside_hours" | "taken";
};

/**
 * Open tour times on the day the caller asked for.
 *
 * `date` is required: the caller names a day first, and only then hears what is open on it.
 * Handing out times before they have said anything once had the agent reading a list of slots
 * at a caller who had not been asked what suited them.
 *
 * With `requestedTime` ("10:00") as well, the answer is about that exact time — whether it is
 * open and, if not, why — plus the open times closest to it. Without it, that day's times are
 * spread across the day. Other days are only returned when nothing is open on the day asked
 * for, and `sameDay` says so.
 */
export async function findTourTimes(
  ctx: ActionCtx,
  orgId: string | undefined,
  date: string,
  requestedTime?: string,
  ignoreTour?: IgnoredTour,
): Promise<
  | { available: true; timeZone: string; requested: RequestedTime | null; times: TourTime[]; sameDay: boolean }
  | { available: false; reason: string }
> {
  const context = await loadContext(ctx, orgId);
  if (!context.ok) return { available: false, reason: context.reason };
  const { timeZone, members } = context;

  const now = Date.now();
  const today = sched.localDateKey(now, timeZone);
  const asked = sched.isDateKey(date) ? date : today;
  // A day that has already gone cannot have anything open; search from today instead.
  const firstDay = asked < today ? today : asked;

  const busy = await busyByMember(
    ctx,
    orgId!,
    members,
    sched.startOfLocalDay(firstDay, timeZone),
    sched.startOfLocalDay(sched.addDays(firstDay, SEARCH_DAYS), timeZone),
    ignoreTour,
  );

  const toTime = (start: number): TourTime => ({
    start: sched.formatLocalDateTime(start, timeZone),
    label: sched.spokenLabel(start, timeZone),
  });

  /** Every open start on one day, across the team, in order. */
  const openOn = (day: string): number[] => {
    const open = new Set<number>();
    for (const m of members) {
      if (!isWorkingDay(m, day)) continue;
      const memberBusy = busy.get(m.userId);
      if (!memberBusy) continue;
      for (const start of sched.candidateStarts(day, m.weeklyHours, timeZone, now)) {
        if (sched.isFree(start, memberBusy)) open.add(start);
      }
    }
    return [...open].sort((a, b) => a - b);
  };

  // Any minute, not just the half-hour grid: "10:15" is a fair thing for a caller to ask for.
  const statusAt = (start: number): RequestedTime["reason"] => {
    if (start <= now) return "passed";
    if (start < now + sched.MIN_LEAD_MINUTES * 60 * 1000) return "too_soon";
    const day = sched.localDateKey(start, timeZone);
    const working = members.filter((m) => isWorkingDay(m, day) && sched.withinHours(start, m.weeklyHours, timeZone));
    if (working.length === 0) return "outside_hours";
    const free = working.some((m) => {
      const memberBusy = busy.get(m.userId);
      return memberBusy !== undefined && sched.isFree(start, memberBusy);
    });
    return free ? "open" : "taken";
  };

  const clock = requestedTime ? /^(\d{1,2}):(\d{2})$/.exec(requestedTime.trim()) : null;
  const parts = clock ? sched.parseLocalDateTime(`${asked}T${clock[1].padStart(2, "0")}:${clock[2]}`) : null;
  const at = parts ? sched.zonedToUtc(parts, timeZone) : null;
  let requested: RequestedTime | null = null;
  if (at !== null) {
    const reason = statusAt(at);
    requested = { ...toTime(at), open: reason === "open", reason };
  }

  const dayOpen = openOn(firstDay);
  let picks: number[];
  if (at !== null) {
    const nearest = dayOpen
      .filter((start) => start !== at)
      .sort((a, b) => Math.abs(a - at) - Math.abs(b - at))
      .slice(0, requested?.open ? NEAREST_WITH_OPEN : NEAREST_TIMES);
    picks = (requested?.open ? [at, ...nearest] : nearest).sort((a, b) => a - b);
  } else {
    picks = spread(dayOpen, TIMES_PER_DAY);
  }

  if (picks.length > 0) {
    return { available: true, timeZone, requested, times: picks.map(toTime), sameDay: asked === firstDay };
  }

  // Nothing open on the day asked for: offer the following days, flagged as other days.
  const times: TourTime[] = [];
  for (let i = 1; i < SEARCH_DAYS && times.length < MAX_TIMES; i++) {
    times.push(...spread(openOn(sched.addDays(firstDay, i)), TIMES_PER_DAY).map(toTime));
  }
  return { available: true, timeZone, requested, times: times.slice(0, MAX_TIMES), sameDay: false };
}

// --- What the agent was last offered on a call ----------------------------------

const TIME_CHECK_TTL_MS = 24 * 60 * 60 * 1000;

/** Replaces the times this call was last offered. request_tour books only from these. */
export const recordTimeCheck = internalMutation({
  args: { elevenLabsConversationId: v.string(), starts: v.array(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("tourTimeChecks")
      .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { starts: args.starts, updatedAt: now });
    else await ctx.db.insert("tourTimeChecks", { ...args, updatedAt: now });

    // Only meaningful while the call is live. Sweep a few old ones so the table stays small.
    const stale = await ctx.db
      .query("tourTimeChecks")
      .withIndex("by_updated", (q) => q.lt("updatedAt", now - TIME_CHECK_TTL_MS))
      .take(20);
    for (const row of stale) await ctx.db.delete(row._id);
  },
});

export const lastTimeCheck = internalQuery({
  args: { elevenLabsConversationId: v.string() },
  handler: async (ctx, args): Promise<string[] | null> => {
    const row = await ctx.db
      .query("tourTimeChecks")
      .withIndex("by_conversation", (q) => q.eq("elevenLabsConversationId", args.elevenLabsConversationId))
      .unique();
    return row?.starts ?? null;
  },
});

export type BookingResult =
  | {
      status: "booked";
      label: string;
      memberFirstName: string;
      propertyName: string;
      propertyAddress: string | null;
    }
  | { status: "taken"; otherTimes: TourTime[] }
  | { status: "invalid"; reason: string }
  | { status: "unavailable"; reason: string };

export async function bookTour(
  ctx: ActionCtx,
  orgId: string | undefined,
  args: {
    slotStart: string;
    callerName?: string;
    callerPhone?: string;
    elevenLabsConversationId?: string;
  },
): Promise<BookingResult> {
  const context = await loadContext(ctx, orgId);
  if (!context.ok) return { status: "unavailable", reason: context.reason };
  const { timeZone, members, propertyName, propertyAddress } = context;

  const parts = sched.parseLocalDateTime(args.slotStart);
  if (!parts) {
    return { status: "invalid", reason: "slot_start must be the exact start value from find_tour_times." };
  }
  const start = sched.zonedToUtc(parts, timeZone);
  const end = start + sched.TOUR_MS;

  // The times closest to the one they tried, not a spread across the day.
  const alternatives = async (): Promise<BookingResult> => {
    const found = await findTourTimes(
      ctx,
      orgId,
      sched.localDateKey(start, timeZone),
      sched.formatLocalDateTime(start, timeZone).slice(11),
    );
    return {
      status: "taken",
      otherTimes: found.available ? found.times.filter((t) => t.start !== args.slotStart) : [],
    };
  };

  if (start < Date.now() + sched.MIN_LEAD_MINUTES * 60 * 1000) return alternatives();

  const day = sched.localDateKey(start, timeZone);
  const eligible = members.filter((m) => isWorkingDay(m, day) && sched.withinHours(start, m.weeklyHours, timeZone));
  const busy = await busyByMember(ctx, orgId!, eligible, start - sched.BUFFER_MS, end + sched.BUFFER_MS);
  const free = eligible.filter((m) => {
    const memberBusy = busy.get(m.userId);
    return memberBusy !== undefined && sched.isFree(start, memberBusy);
  });
  if (free.length === 0) return alternatives();

  // Fewest tours that week wins; earliest to join breaks a tie.
  const week = sched.weekBounds(start, timeZone);
  const weekTours = await ctx.runQuery(internal.tours.bookedInRange, {
    orgId: orgId!,
    start: week.start,
    end: week.end,
  });
  const count = (userId: Id<"users">) => weekTours.filter((t) => t.assignedUserId === userId).length;
  free.sort((a, b) => count(a.userId) - count(b.userId) || a.joinedAt - b.joinedAt);

  const label = sched.spokenLabel(start, timeZone);
  for (const member of free) {
    const tourId = await ctx.runMutation(internal.tours.reserve, {
      orgId: orgId!,
      assignedUserId: member.userId,
      start,
      end,
      timeZone,
      callerName: args.callerName,
      callerPhone: args.callerPhone,
      elevenLabsConversationId: args.elevenLabsConversationId,
    });
    if (!tourId) continue; // someone else booked them a moment ago; try the next person

    try {
      const { id } = await google.insertEvent(
        await accessTokenFor(ctx, member.userId),
        tourEvent({ ...args, propertyName, propertyAddress, start, end, timeZone }),
      );
      await ctx.runMutation(internal.tours.attachEvent, { tourId, googleEventId: id });
      return { status: "booked", label, memberFirstName: member.firstName, propertyName, propertyAddress };
    } catch (err) {
      // A tour that is not in anyone's calendar is a tour nobody shows up to. Give the slot back
      // and try the next free person rather than confirming it to the caller.
      console.error(`[tours] could not add the event for ${member.userId}:`, err);
      await ctx.runMutation(internal.tours.release, { tourId });
    }
  }

  return alternatives();
}

function tourEvent(t: {
  propertyName: string;
  propertyAddress: string | null;
  callerName?: string;
  callerPhone?: string;
  start: number;
  end: number;
  timeZone: string;
}): google.EventInput {
  return {
    summary: `Property tour: ${t.callerName || "Prospective renter"}`,
    description: [
      `Tour of ${t.propertyName}, booked by Sarah (Simplr).`,
      t.callerName ? `Renter: ${t.callerName}` : null,
      t.callerPhone ? `Phone: ${t.callerPhone}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    // The street address turns the event's location into a tappable map link in Google
    // Calendar. The name is only a fallback for a property with no address saved yet.
    location: t.propertyAddress ?? t.propertyName,
    start: new Date(t.start).toISOString(),
    end: new Date(t.end).toISOString(),
    timeZone: t.timeZone,
  };
}

export type CallerTour = {
  id: Id<"tours">;
  start: number;
  end: number;
  assignedUserId: Id<"users">;
  googleEventId?: string;
  callerName?: string;
  callerPhone?: string;
};

/**
 * Moves a caller's existing tour to a new time, instead of booking them a second one.
 *
 * The same team member keeps it when they are free at the new time — their event is simply
 * moved. Otherwise it goes to whoever is free with the fewest tours that week: a new event on
 * that person's calendar first, then the old one deleted, so the tour is never in nobody's
 * calendar. The tour being moved never blocks its own new time, so 2:00 to 2:30 works.
 */
export async function rescheduleTour(
  ctx: ActionCtx,
  orgId: string | undefined,
  args: { tour: CallerTour; slotStart: string },
): Promise<BookingResult> {
  const context = await loadContext(ctx, orgId);
  if (!context.ok) return { status: "unavailable", reason: context.reason };
  const { timeZone, members, propertyName, propertyAddress } = context;
  const { tour } = args;

  const parts = sched.parseLocalDateTime(args.slotStart);
  if (!parts) {
    return { status: "invalid", reason: "slot_start must be the exact start value from find_tour_times." };
  }
  const start = sched.zonedToUtc(parts, timeZone);
  const end = start + sched.TOUR_MS;
  if (start === tour.start) {
    return { status: "invalid", reason: "The tour is already booked for that time. Nothing needs to change." };
  }

  const ignore: IgnoredTour = { id: tour.id, assignedUserId: tour.assignedUserId, start: tour.start, end: tour.end };
  const alternatives = async (): Promise<BookingResult> => {
    const found = await findTourTimes(
      ctx,
      orgId,
      sched.localDateKey(start, timeZone),
      sched.formatLocalDateTime(start, timeZone).slice(11),
      ignore,
    );
    return {
      status: "taken",
      otherTimes: found.available ? found.times.filter((t) => t.start !== args.slotStart) : [],
    };
  };

  if (start < Date.now() + sched.MIN_LEAD_MINUTES * 60 * 1000) return alternatives();

  const day = sched.localDateKey(start, timeZone);
  const eligible = members.filter((m) => isWorkingDay(m, day) && sched.withinHours(start, m.weeklyHours, timeZone));
  const busy = await busyByMember(ctx, orgId!, eligible, start - sched.BUFFER_MS, end + sched.BUFFER_MS, ignore);
  const free = eligible.filter((m) => {
    const memberBusy = busy.get(m.userId);
    return memberBusy !== undefined && sched.isFree(start, memberBusy);
  });
  if (free.length === 0) return alternatives();

  // Their current team member first; then fewest tours that week, not counting this one.
  const week = sched.weekBounds(start, timeZone);
  const weekTours = (
    await ctx.runQuery(internal.tours.bookedInRange, { orgId: orgId!, start: week.start, end: week.end })
  ).filter((t) => t.id !== tour.id);
  const count = (userId: Id<"users">) => weekTours.filter((t) => t.assignedUserId === userId).length;
  const current = (userId: Id<"users">) => (userId === tour.assignedUserId ? 1 : 0);
  free.sort(
    (a, b) => current(b.userId) - current(a.userId) || count(a.userId) - count(b.userId) || a.joinedAt - b.joinedAt,
  );

  const label = sched.spokenLabel(start, timeZone);
  for (const member of free) {
    const previous = await ctx.runMutation(internal.tours.moveReservation, {
      tourId: tour.id,
      assignedUserId: member.userId,
      start,
      end,
    });
    if (!previous) continue; // that slot was just taken for this person; try the next

    try {
      const token = await accessTokenFor(ctx, member.userId);
      if (member.userId === previous.assignedUserId && previous.googleEventId) {
        await google.patchEvent(token, previous.googleEventId, {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          timeZone,
        });
      } else {
        const { id } = await google.insertEvent(
          token,
          tourEvent({
            propertyName,
            propertyAddress,
            callerName: tour.callerName,
            callerPhone: tour.callerPhone,
            start,
            end,
            timeZone,
          }),
        );
        await ctx.runMutation(internal.tours.attachEvent, { tourId: tour.id, googleEventId: id });
        if (previous.googleEventId) {
          // Best effort. The tour already lives on the new calendar; a stale event left on the
          // old one is untidy, but failing a move the caller already heard confirmed is worse.
          try {
            await google.deleteEvent(await accessTokenFor(ctx, previous.assignedUserId), previous.googleEventId);
          } catch (err) {
            console.error(`[tours] moved ${tour.id} but could not remove its old event:`, err);
          }
        }
      }
      return { status: "booked", label, memberFirstName: member.firstName, propertyName, propertyAddress };
    } catch (err) {
      console.error(`[tours] could not move ${tour.id} to ${member.userId}:`, err);
      await ctx.runMutation(internal.tours.restoreReservation, { tourId: tour.id, ...previous });
    }
  }

  return alternatives();
}

/** Up to `n` items spread across the list (first, middle, last) rather than the first `n`. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const picks = new Set<number>();
  for (let i = 0; i < n; i++) picks.add(Math.round((i * (items.length - 1)) / (n - 1)));
  return [...picks].map((i) => items[i]);
}
