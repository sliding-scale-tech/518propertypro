import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { currentOrg } from "./authz";
import { isLeasingLead } from "./conversations";
import { localDateKey, startOfLocalDay, addDays, isValidTimeZone } from "./tourSchedule";

/**
 * Everything the home dashboard renders, in one query.
 *
 * Deliberately one round trip rather than a query per card: the cards share the same
 * conversations and tours rows, and fetching them three times would cost three full scans to
 * answer three questions about the same data.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Percent change against the previous week, or null when the previous week had nothing — a
 * jump from 0 to any number is not "+∞%" or "+100%", it's a figure with no baseline, and the
 * card omits the comparison entirely rather than inventing one.
 */
function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** The badge on a lead row. Ordered most-decided first: an outcome the agent recorded beats
 *  anything inferred from what it managed to capture along the way. */
function leadStatus(
  conversation: Doc<"conversations">,
  qualification: Doc<"qualifications"> | null,
): "tour_booked" | "escalated" | "disqualified" | "qualified" | "contacted" | "new" {
  if (conversation.outcome === "tour_booked") return "tour_booked";
  if (conversation.outcome === "escalated") return "escalated";
  if (conversation.outcome === "disqualified") return "disqualified";
  if (qualification?.qualifies) return "qualified";
  if (qualification) return "contacted";
  return "new";
}

export const overview = query({
  // Only used until an admin sets the team's zone, so "today" still means the viewer's today.
  // Same convention as calendarView.week — see that action's own arg.
  args: { fallbackTimeZone: v.string() },
  handler: async (ctx, args) => {
    const org = await currentOrg(ctx);
    if (!org) return null;

    const [organization, property] = await Promise.all([
      ctx.db.get(org.orgId),
      ctx.db
        .query("properties")
        .withIndex("by_org", (q) => q.eq("orgId", org.orgId))
        .first(),
    ]);
    // Same fallback chain as calendarView: the team's zone, else the viewer's — and never a
    // string the browser made up, which would throw inside Intl rather than just read oddly.
    const timeZone =
      organization?.timeZone ?? (isValidTimeZone(args.fallbackTimeZone) ? args.fallbackTimeZone : "UTC");
    const propertyName = property?.name ?? "—";

    const now = Date.now();
    const weekAgo = now - WEEK_MS;
    const twoWeeksAgo = now - 2 * WEEK_MS;

    // Read across every team's rows for these two, the same way conversations.history does —
    // safe because both are only ever matched against rows already scoped to this team.
    const [allQualifications, allTenantIssues] = await Promise.all([
      ctx.db.query("qualifications").collect(),
      ctx.db.query("tenantIssues").collect(),
    ]);
    const residentCallIds = new Set(allTenantIssues.map((i) => i.elevenLabsConversationId));
    const qualificationConversationIds = new Set(
      allQualifications.flatMap((q) => (q.conversationId ? [q.conversationId] : [])),
    );
    const qualificationElevenLabsIds = new Set(
      allQualifications.map((q) => q.elevenLabsConversationId),
    );
    const isLead = (c: Doc<"conversations">) =>
      isLeasingLead(c, residentCallIds, qualificationConversationIds, qualificationElevenLabsIds);
    const qualificationFor = (c: Doc<"conversations">) =>
      allQualifications.find(
        (q) =>
          q.conversationId === c._id ||
          (c.elevenLabsConversationId !== undefined &&
            q.elevenLabsConversationId === c.elevenLabsConversationId),
      ) ?? null;

    // --- Stat cards: this week against the one before it ---------------------
    const fortnight = await ctx.db
      .query("conversations")
      .withIndex("by_org_and_started", (q) =>
        q.eq("orgId", org.orgId).gte("startedAt", twoWeeksAgo),
      )
      .collect();
    const thisWeekCalls = fortnight.filter((c) => c.startedAt >= weekAgo);
    const lastWeekCalls = fortnight.filter((c) => c.startedAt < weekAgo);

    // Every tour this team has, not just upcoming ones: a booking made last week can be for a
    // tour months out, so the "booked" counts below have to look at createdAt, which no index
    // covers. Tours are low-volume per team, so a full scan of one team's rows is fine.
    const allTours = await ctx.db
      .query("tours")
      .withIndex("by_org_and_start", (q) => q.eq("orgId", org.orgId))
      .collect();
    const booked = allTours.filter((t) => t.status === "booked");
    const bookedThisWeek = booked.filter((t) => t.createdAt >= weekAgo).length;
    const bookedLastWeek = booked.filter(
      (t) => t.createdAt >= twoWeeksAgo && t.createdAt < weekAgo,
    ).length;

    const newLeadsThisWeek = thisWeekCalls.filter(isLead).length;
    const newLeadsLastWeek = lastWeekCalls.filter(isLead).length;

    const stats = {
      newLeads: {
        value: newLeadsThisWeek,
        changePct: changePct(newLeadsThisWeek, newLeadsLastWeek),
      },
      callsHandled: {
        value: thisWeekCalls.length,
        changePct: changePct(thisWeekCalls.length, lastWeekCalls.length),
      },
      toursBooked: {
        value: bookedThisWeek,
        changePct: changePct(bookedThisWeek, bookedLastWeek),
      },
    };

    // --- Recent leads --------------------------------------------------------
    // Taken from a wider slice than the five shown, because the filter to leasing leads runs
    // after the read — the same caveat conversations.history carries.
    const latest = await ctx.db
      .query("conversations")
      .withIndex("by_org_and_started", (q) => q.eq("orgId", org.orgId))
      .order("desc")
      .take(40);
    const recentLeads = latest
      .filter(isLead)
      .slice(0, 5)
      .map((c) => {
        const qualification = qualificationFor(c);
        return {
          id: c._id,
          name: qualification?.callerName ?? c.callerNumber ?? "Unknown caller",
          property: propertyName,
          source: c.channel === "phone" ? ("call" as const) : ("browser" as const),
          status: leadStatus(c, qualification),
          startedAt: c.startedAt,
        };
      });

    // --- Today's schedule ----------------------------------------------------
    const todayKey = localDateKey(now, timeZone);
    const dayStart = startOfLocalDay(todayKey, timeZone);
    const dayEnd = startOfLocalDay(addDays(todayKey, 1), timeZone);
    const todaysTours = booked
      .filter((t) => t.start >= dayStart && t.start < dayEnd)
      .sort((a, b) => a.start - b.start)
      .map((t) => {
        const qualification = t.elevenLabsConversationId
          ? (allQualifications.find(
              (q) => q.elevenLabsConversationId === t.elevenLabsConversationId,
            ) ?? null)
          : null;
        return {
          id: t._id,
          start: t.start,
          end: t.end,
          timeZone: t.timeZone,
          callerName: t.callerName ?? qualification?.callerName ?? null,
          bedrooms: qualification?.bedrooms ?? null,
          propertyName,
        };
      });

    return { timeZone, propertyName, stats, recentLeads, todaysTours };
  },
});
