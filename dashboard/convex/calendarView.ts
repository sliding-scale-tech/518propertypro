import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { requireOrgId } from "./authz";
import * as google from "./googleApi";
import { accessTokenFor } from "./googleCalendar";
import * as sched from "./tourSchedule";

/**
 * The Calendar page's week view.
 *
 * Who sees what is the whole point of this file, and it matches the privacy policy:
 * - Your own calendar: your Google events with their titles, next to the tours booked for you.
 * - A teammate's calendar (admins only): their Google events as "busy" blocks with no title or
 *   detail, plus the tours Simplr booked for them in full — those are the team's own data.
 *
 * Nothing fetched from Google here is stored. It is read when the page asks and handed back.
 */

export type CalendarItem =
  | { kind: "event"; title: string; start: number; end: number }
  | { kind: "allDay"; title: string; startDate: string; endDate: string }
  | { kind: "busy"; start: number; end: number };

export type WeekTour = {
  id: Id<"tours">;
  start: number;
  end: number;
  callerName?: string;
  callerPhone?: string;
};

export type WeekView = {
  name: string;
  isSelf: boolean;
  // The first day shown — a week's Monday for the week view, the grid's first Monday (which may
  // fall in the previous month) for the month view. `rangeDays` says how many days follow it.
  rangeStart: string;
  rangeDays: number;
  timeZone: string;
  teamTimeZoneSet: boolean;
  // Their tour hours, so the grid can shade everything Sarah will never book into.
  hours: { availableForTours: boolean; weeklyHours: sched.DayHours[]; daysOff: string[] };
  calendar: "connected" | "needs_reconnect" | "not_connected";
  items: CalendarItem[];
  tours: WeekTour[];
};

/**
 * Shared by the week and month views: same permission check, same Google reads, same shape of
 * result — they differ only in how many days they cover and where that range starts.
 */
async function loadRange(
  ctx: ActionCtx,
  args: { rangeStart: string; rangeDays: number; userId?: Id<"users">; fallbackTimeZone: string },
): Promise<WeekView> {
  const me = await requireOrgId(ctx);
  const userId = args.userId ?? me.userId;
  const isSelf = userId === me.userId;
  // Checked here, server-side. The page only offers the member picker to admins, but that is
  // a courtesy — this is the boundary that stops a member reading a teammate's calendar.
  if (!isSelf && !me.isAdmin) throw new Error("Only a team admin can view a teammate's calendar.");
  if (!sched.isDateKey(args.rangeStart)) throw new Error("rangeStart must be a YYYY-MM-DD date.");

  const target = await ctx.runQuery(internal.calendarView.target, { orgId: me.orgId, userId });
  if (!target) throw new Error("That person is not on your team.");

  const timeZone = target.timeZone ?? (sched.isValidTimeZone(args.fallbackTimeZone) ? args.fallbackTimeZone : "UTC");
  const from = sched.startOfLocalDay(args.rangeStart, timeZone);
  const to = sched.startOfLocalDay(sched.addDays(args.rangeStart, args.rangeDays), timeZone);

  const tours: WeekTour[] = await ctx.runQuery(internal.calendarView.toursFor, { userId, from, to });
  const base = {
    name: target.name,
    isSelf,
    rangeStart: args.rangeStart,
    rangeDays: args.rangeDays,
    timeZone,
    teamTimeZoneSet: target.timeZone !== null,
    hours: target.hours,
    tours,
  };

  if (target.calendar !== "connected") return { ...base, calendar: target.calendar, items: [] };

  try {
    const token = await accessTokenFor(ctx, userId);
    const timeMin = new Date(from).toISOString();
    const timeMax = new Date(to).toISOString();

    if (isSelf) {
      const events = await google.listEvents(token, timeMin, timeMax);
      return {
        ...base,
        calendar: "connected",
        // Simplr's own tour events come from our tours table instead, with the renter's details.
        items: events
          .filter((e) => !e.simplrTour)
          .map((e): CalendarItem =>
            e.allDay
              ? { kind: "allDay", title: e.title, startDate: e.startDate, endDate: e.endDate }
              : { kind: "event", title: e.title, start: e.start, end: e.end },
          ),
      };
    }

    const busy = await google.freeBusy(token, timeMin, timeMax);
    // Free/busy has no way to tag "this block is Sarah's own tour" the way listEvents does for
    // isSelf above, so without this a tour showed up twice: once as a generic "Busy" chip from
    // Google, once as the real "Tour" chip from our own tours table. Cut each known tour's own
    // time out of the busy blocks — withoutInterval trims rather than requiring an exact match,
    // so a tour merged into a longer busy block (back-to-back with something else) still works.
    const withoutOwnTours = tours.reduce(
      (remaining, t) => sched.withoutInterval(remaining, { start: t.start, end: t.end }),
      busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })),
    );
    return {
      ...base,
      calendar: "connected",
      items: withoutOwnTours.map((b) => ({ kind: "busy" as const, start: b.start, end: b.end })),
    };
  } catch (err) {
    if (err instanceof google.GoogleAuthRevokedError) return { ...base, calendar: "needs_reconnect", items: [] };
    throw err;
  }
}

export const week = action({
  args: {
    weekStart: v.string(), // YYYY-MM-DD, the Monday the view starts on
    userId: v.optional(v.id("users")), // omitted = your own calendar
    // Only used until an admin sets the team's zone, so the grid still reads in local time.
    fallbackTimeZone: v.string(),
  },
  handler: (ctx, args): Promise<WeekView> =>
    loadRange(ctx, { rangeStart: args.weekStart, rangeDays: 7, userId: args.userId, fallbackTimeZone: args.fallbackTimeZone }),
});

export const month = action({
  args: {
    month: v.string(), // "YYYY-MM"
    userId: v.optional(v.id("users")), // omitted = your own calendar
    fallbackTimeZone: v.string(),
  },
  handler: (ctx, args): Promise<WeekView> => {
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw new Error("month must be YYYY-MM.");
    const { start, days } = sched.monthGridRange(args.month);
    return loadRange(ctx, { rangeStart: start, rangeDays: days, userId: args.userId, fallbackTimeZone: args.fallbackTimeZone });
  },
});

export const target = internalQuery({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!membership || membership.orgId !== args.orgId) return null;

    const [user, org, connection, hours] = await Promise.all([
      ctx.db.get(args.userId),
      ctx.db.get(args.orgId),
      ctx.db
        .query("googleCalendarConnections")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .unique(),
      ctx.db
        .query("tourAvailability")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .unique(),
    ]);

    return {
      name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Team member",
      timeZone: org?.timeZone ?? null,
      hours: {
        availableForTours: hours?.availableForTours ?? true,
        weeklyHours: hours?.weeklyHours ?? sched.DEFAULT_WEEKLY_HOURS,
        daysOff: hours?.daysOff ?? [],
      },
      calendar: !connection
        ? ("not_connected" as const)
        : connection.invalidAt
          ? ("needs_reconnect" as const)
          : ("connected" as const),
    };
  },
});

export const toursFor = internalQuery({
  args: { userId: v.id("users"), from: v.number(), to: v.number() },
  handler: async (ctx, args): Promise<WeekTour[]> => {
    const rows = await ctx.db
      .query("tours")
      .withIndex("by_assignee_and_start", (q) =>
        q.eq("assignedUserId", args.userId).gte("start", args.from).lt("start", args.to),
      )
      .collect();
    return rows
      .filter((t) => t.status === "booked")
      .map((t) => ({
        id: t._id,
        start: t.start,
        end: t.end,
        callerName: t.callerName,
        callerPhone: t.callerPhone,
      }));
  },
});
