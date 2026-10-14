import { httpRouter, type GenericActionCtx } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { clampSeverity } from "./severity";
import {
  coerceScreeningAnswers,
  evaluateQualification,
  missingScreeningKeys,
  type ScreeningQuestion,
} from "./qualifyRules";
import * as waha from "./wahaApi";
import { realPhone } from "./sanitize";
import { handleClerkWebhook } from "./clerkWebhook";
import { handleOAuthCallback as handleGoogleOAuthCallback } from "./googleCalendar";
import type { FunctionReturnType } from "convex/server";
import { bookTour, cancelTourNow, findTourTimes, rescheduleTour, type IgnoredTour } from "./tours";
import { formatLocalDateTime, phoneKey, spokenLabel } from "./tourSchedule";

const http = httpRouter();

/**
 * Resolves which team a mid-call tool request belongs to, from the ElevenLabs conversation id
 * every tool call carries. Returns undefined whenever it can't yet be resolved — the public
 * landing-page demo, or a phone call whose Convex conversations row hasn't been created yet
 * (see conversations.orgByElevenLabsId) — and every caller below already falls back to the
 * shared default in that case.
 */
async function resolveOrg(
  ctx: GenericActionCtx<DataModel>,
  conversationId: string | undefined,
): Promise<string | undefined> {
  if (!conversationId) return undefined;
  // Convex queries can't return `undefined` over the wire — a query handler returning it comes
  // back as `null` here, so this normalizes back to `undefined` for the rest of this file.
  const orgId = await ctx.runQuery(internal.conversations.orgByElevenLabsId, {
    elevenLabsConversationId: conversationId,
  });
  return orgId ?? undefined;
}

/**
 * resolveOrg, with the agent's own id as a second route. Booking cannot use resolveOrg's
 * shared-default fallback — that would put a tour in the wrong team's calendars — and a phone
 * call has no conversations row until it ends. But every team has its own ElevenLabs agent,
 * so the agent id identifies the team mid-call on any channel.
 */
async function resolveBookingOrg(
  ctx: GenericActionCtx<DataModel>,
  conversationId: string | undefined,
  agentId: string | undefined,
): Promise<string | undefined> {
  const byConversation = await resolveOrg(ctx, conversationId);
  if (byConversation) return byConversation;
  if (!agentId) return undefined;
  const orgId = await ctx.runQuery(internal.agents.orgByElevenLabsAgentId, { elevenLabsAgentId: agentId });
  return orgId ?? undefined;
}

/** Tool arguments arrive as JSON from the model; a boolean sometimes comes through as a string. */
function isConfirmed(value: unknown): boolean {
  return value === true || value === "true";
}

/** Every form of the caller's number we have — telephony caller ID and the number they said. */
function callerPhoneKeys(...phones: Array<string | undefined>): string[] {
  const keys = phones.map((p) => phoneKey(realPhone(p))).filter((k): k is string => k !== null);
  return [...new Set(keys)];
}

/**
 * callerPhoneKeys, plus the number already captured on this call's lead. A browser call has no
 * caller ID, and the model often leaves caller_phone off a follow-up tool call — a caller who
 * gave their number once (check_qualification records it) is recognized for the rest of the
 * call. Without this, cancel_tour refused a caller's own tours right after find_my_tour found them.
 */
async function conversationPhoneKeys(
  ctx: GenericActionCtx<DataModel>,
  conversationId: string | undefined,
  ...phones: Array<string | undefined>
): Promise<string[]> {
  const lead = conversationId
    ? await ctx.runQuery(internal.qualifications.byElevenLabsId, { elevenLabsConversationId: conversationId })
    : null;
  return callerPhoneKeys(...phones, lead?.callerPhone);
}

type CallerTourRow = FunctionReturnType<typeof internal.tours.upcomingForCaller>[number];

function tourSummary(t: CallerTourRow) {
  return { tour_id: t.id, when: spokenLabel(t.start, t.timeZone), team_member: t.memberFirstName };
}

/**
 * The tour a cancel or reschedule call is about, only if it really belongs to this caller: in
 * their team, still upcoming, and booked on this call or under their phone number.
 */
async function findCallerTour(
  ctx: GenericActionCtx<DataModel>,
  body: { conversation_id?: string; agent_id?: string; tour_id?: unknown; caller_id?: string; caller_phone?: string },
): Promise<{ orgId: string; tour: CallerTourRow } | null> {
  const orgId = await resolveBookingOrg(ctx, body.conversation_id, body.agent_id);
  if (!orgId || typeof body.tour_id !== "string") return null;
  const tours = await ctx.runQuery(internal.tours.upcomingForCaller, {
    orgId,
    elevenLabsConversationId: body.conversation_id,
    phoneKeys: await conversationPhoneKeys(ctx, body.conversation_id, body.caller_id, body.caller_phone),
  });
  const tour = tours.find((t) => t.id === body.tour_id);
  return tour ? { orgId, tour } : null;
}

// Clerk → Convex user sync. Endpoint configured in the Clerk dashboard as
// https://<deployment>.convex.site/auth
http.route({
  path: "/auth",
  method: "POST",
  handler: httpAction(handleClerkWebhook),
});

// Google Calendar OAuth redirect. Registered on the Google OAuth client as an Authorized
// redirect URI: https://<deployment>.convex.site/google/oauth/callback
http.route({
  path: "/google/oauth/callback",
  method: "GET",
  handler: httpAction(handleGoogleOAuthCallback),
});

// --- Server tools (webhooks the ElevenLabs agent calls mid-conversation) --

/**
 * A lightweight, no-capture lookup so the agent can answer a standalone question like
 * "what's the rent for a 2BR?" at any point in the call, without first needing all five
 * qualification fields. check_qualification (below) is the one that captures a lead and
 * makes the qualify/disqualify decision — this tool never does either.
 */
http.route({
  path: "/tools/check-availability",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const bedrooms: string | undefined = body.bedrooms;
    const conversationId: string | undefined = body.conversation_id;

    const orgId = await resolveOrg(ctx, conversationId);
    const property = await ctx.runQuery(internal.properties.currentInternal, { orgId });
    const unit = bedrooms
      ? property.units.find((u: { bedrooms: string }) => u.bedrooms === bedrooms)
      : undefined;

    return Response.json({
      property_name: property.name,
      // currentInternal can return the coded default, which has no address field at all.
      property_address: (property as { address?: { formatted: string } }).address?.formatted ?? null,
      pets_allowed: property.petsAllowed,
      move_in_window_days: property.moveInWindowDays,
      requested_unit: unit
        ? { bedrooms: unit.bedrooms, rent_min: unit.rentMin, rent_max: unit.rentMax, available: unit.available }
        : null,
      all_units: property.units.map((u: { bedrooms: string; rentMin: number; rentMax: number; available: boolean }) => ({
        bedrooms: u.bedrooms,
        rent_min: u.rentMin,
        rent_max: u.rentMax,
        available: u.available,
      })),
    });
  }),
});

/**
 * The agent has gathered the five qualification fields; apply the property's actual rules
 * and tell it whether to offer a tour. Deterministic on purpose — this is the fair-housing
 * boundary (PRD §8): the model never decides qualification, this code does.
 */
http.route({
  path: "/tools/check-qualification",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      bedrooms,
      move_in_date: moveInDate,
      budget,
      pets_wanted: petsWanted,
      pet_type: petType,
      caller_name: callerName,
      caller_phone: callerPhone,
      screening_answers: screeningAnswersRaw,
    } = body;

    if (!conversationId) {
      return Response.json({ error: "missing conversation_id" }, { status: 400 });
    }

    const orgId = await resolveOrg(ctx, conversationId);
    const property = await ctx.runQuery(internal.properties.currentInternal, { orgId });

    const questions: ScreeningQuestion[] = await ctx.runQuery(
      internal.screening.activeForOrg,
      { orgId },
    );
    const screeningAnswers = coerceScreeningAnswers(questions, screeningAnswersRaw);

    // A question that decides qualification but has no usable answer is not a "no" — it is a
    // question that still needs asking. Deciding here would let a caller qualify purely
    // because the agent skipped something, so send the agent back rather than ruling.
    const missing = missingScreeningKeys(questions, screeningAnswers);
    if (missing.length > 0) {
      const stillNeeded = questions
        .filter((q) => missing.includes(q.key))
        .map((q) => q.question);
      return Response.json({
        qualifies: null,
        needs_more_info: true,
        still_needed: stillNeeded,
        message:
          "Do not state a qualification result yet. Ask the caller the questions in " +
          "still_needed, then call this tool again with those answers included.",
      });
    }

    // Shared with the WhatsApp bot on purpose — see convex/qualifyRules.ts. Two copies of
    // this decision would let the same person be told "yes" on one channel and "no" on the
    // other.
    const { qualifies, disqualifyReason, nearMiss, nearMissBudgetTarget } = evaluateQualification(
      property,
      {
        bedrooms,
        budget: typeof budget === "number" ? budget : undefined,
        petsWanted: typeof petsWanted === "boolean" ? petsWanted : undefined,
      },
      questions,
      screeningAnswers,
    );

    await ctx.runMutation(internal.qualifications.upsertByConversationId, {
      elevenLabsConversationId: conversationId,
      bedrooms,
      moveInDate,
      budget: typeof budget === "number" ? budget : undefined,
      petsWanted: typeof petsWanted === "boolean" ? petsWanted : undefined,
      petType,
      callerName,
      callerPhone,
      qualifies,
      disqualifyReason,
      nearMiss,
      // Every answer, criteria or not — the capture-only ones exist precisely so the manager
      // can read them on the lead.
      screeningAnswers: screeningAnswers.map((a) => ({
        key: a.key,
        question: questions.find((q) => q.key === a.key)?.question ?? a.key,
        value: a.value,
      })),
    });

    return Response.json({
      qualifies,
      reason: disqualifyReason ?? null,
      // Only meaningful alongside qualifies: false. Never changes the decision, only how you
      // talk about it — see the TONE FOR DISQUALIFICATIONS block in your instructions.
      near_miss: qualifies === false ? (nearMiss ?? false) : false,
      // Set only for a near miss on budget specifically. The exact real minimum for that unit —
      // ask if they can go up to this number before anything else, never a different figure.
      near_miss_budget_target: qualifies === false && nearMiss ? (nearMissBudgetTarget ?? null) : null,
      property_name: property.name,
      available_units: property.units
        .filter((u: { available: boolean }) => u.available)
        .map((u: { bedrooms: string; rentMin: number; rentMax: number }) => ({
          bedrooms: u.bedrooms,
          rent_min: u.rentMin,
          rent_max: u.rentMax,
        })),
    });
  }),
});

/**
 * Real open tour times, for the agent to offer. Read-only: nothing is held or booked until
 * request_tour, so a time offered here can still be gone by then — request_tour handles that.
 */
http.route({
  path: "/tools/find-tour-times",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const conversationId: string | undefined = body.conversation_id;
    const date = typeof body.date === "string" && body.date.trim() ? body.date.trim() : undefined;

    // No day yet means the caller has not been asked. Return no times at all, so there is
    // nothing to read out — only the instruction to ask.
    if (!date) {
      return Response.json({
        needs_date: true,
        times: [],
        message:
          "Do not suggest any days or times. Ask the caller what day and time would suit them, " +
          "then call find_tour_times again with that date, and time if they gave one.",
      });
    }

    const orgId = await resolveBookingOrg(ctx, conversationId, body.agent_id);

    // Moving an existing tour: it must not block the times around it.
    let ignoreTour: IgnoredTour | undefined;
    if (orgId && typeof body.tour_id === "string" && body.tour_id) {
      const tour = await ctx.runQuery(internal.tours.byIdString, { tourId: body.tour_id });
      if (tour && tour.orgId === orgId && tour.status === "booked") {
        ignoreTour = { id: tour._id, assignedUserId: tour.assignedUserId, start: tour.start, end: tour.end };
      }
    }

    const result = await findTourTimes(
      ctx,
      orgId,
      date,
      typeof body.time === "string" ? body.time : undefined,
      ignoreTour,
    );

    if (!result.available) {
      return Response.json({
        booking_available: false,
        message:
          "Booking isn't available right now. Ask for their preferred day and time and call " +
          "request_tour with it as preferred_slot; the team will confirm with them.",
      });
    }

    if (conversationId) {
      await ctx.runMutation(internal.tours.recordTimeCheck, {
        elevenLabsConversationId: conversationId,
        starts: result.times.map((t) => t.start),
      });
    }

    const requested = result.requested;

    // "Taken" by their own tour is a different conversation from "taken" by someone else.
    let ownTour: CallerTourRow | undefined;
    if (requested && !requested.open && orgId) {
      const mine = await ctx.runQuery(internal.tours.upcomingForCaller, {
        orgId,
        elevenLabsConversationId: conversationId,
        phoneKeys: await conversationPhoneKeys(ctx, conversationId),
      });
      ownTour = mine.find((t) => t.id !== ignoreTour?.id && formatLocalDateTime(t.start, t.timeZone) === requested.start);
    }

    const why: Record<string, string> = {
      passed: "That time has already passed.",
      too_soon: "Tours need at least two hours' notice, so that time is too soon.",
      outside_hours: "That time is outside the team's tour hours.",
      taken: "That time is already taken.",
    };
    const offer =
      result.times.length === 0
        ? "Nothing else is open in the next week, so offer to have the team call them back."
        : result.sameDay
          ? "Offer the times listed, which are on the day they asked for."
          : "Nothing is open on the day they asked for, so say that, then offer the times listed and say which day each is on.";

    return Response.json({
      booking_available: true,
      time_zone: result.timeZone,
      requested_time: requested
        ? { start: requested.start, label: requested.label, available: requested.open, reason: requested.reason }
        : null,
      callers_own_tour: ownTour ? tourSummary(ownTour) : null,
      same_day: result.sameDay,
      times: result.times,
      message: requested?.open
        ? "The exact time they asked for is open. Read it back and get a yes, then book requested_time.start."
        : requested
          ? ownTour
            ? "The caller already has their own tour booked at exactly that time (callers_own_tour). Tell them " +
              "that, and ask whether they want to keep it or pick a different time."
            : `${why[requested.reason]} Tell them that. ${offer}`
          : offer,
    });
  }),
});

/**
 * Books a tour for a qualified caller: slot_start (a time find_tour_times offered) goes straight
 * into the calendar of whoever on the team is free and has the fewest tours that week.
 *
 * preferred_slot without slot_start is the fallback for a team that has not set booking up —
 * the time is captured on the lead for someone to confirm, exactly as before booking existed.
 * No SMS in either case: confirmation texts are still switched off.
 */
http.route({
  path: "/tools/request-tour",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      agent_id: agentId,
      slot_start: slotStart,
      preferred_slot: preferredSlot,
      caller_name: callerName,
      caller_phone: callerPhone,
      caller_id: callerId,
    } = body;

    if (!conversationId || (!slotStart && !preferredSlot) || !callerPhone) {
      return Response.json(
        { error: "missing conversation_id, caller_phone, or one of slot_start / preferred_slot" },
        { status: 400 },
      );
    }

    if (slotStart) {
      // Both checks run before anything touches a calendar. The model on a call does not get to
      // book a time the caller never heard read back, or one from an older list than the latest.
      if (!isConfirmed(body.caller_confirmed)) {
        return Response.json({
          booked: false,
          reason:
            "Not booked yet. Read the exact day and time back to the caller, wait for a clear yes, " +
            "then call request_tour again with caller_confirmed set to true.",
        });
      }
      const offered = await ctx.runQuery(internal.tours.lastTimeCheck, {
        elevenLabsConversationId: conversationId,
      });
      if (!offered || !offered.includes(slotStart)) {
        return Response.json({
          booked: false,
          reason:
            "Not booked. That time is not in your latest find_tour_times result. Call find_tour_times " +
            "with the day and time the caller wants, then book one of the times it returns.",
        });
      }

      const orgId = await resolveBookingOrg(ctx, conversationId, agentId);

      // A caller may have more than one tour, but never without knowing about the ones they already
      // have: the first attempt stops here so the agent has to mention them. Most people who hear
      // "you already have one on Tuesday" decide to move or cancel it; the rest say yes, book
      // this one as well, and the agent calls again with also_book.
      if (orgId && !isConfirmed(body.also_book)) {
        const existing = await ctx.runQuery(internal.tours.upcomingForCaller, {
          orgId,
          elevenLabsConversationId: conversationId,
          phoneKeys: await conversationPhoneKeys(ctx, conversationId, callerId, callerPhone),
        });
        if (existing.length > 0) {
          return Response.json({
            booked: false,
            existing_tours: existing.slice(0, 3).map(tourSummary),
            reason:
              "Not booked yet. This caller already has the upcoming tours in existing_tours. Tell them when " +
              "they are, then ask whether they want to book this new tour as well. If yes, call request_tour " +
              "again with also_book set to true. If they would rather move or cancel an existing tour, use " +
              "reschedule_tour or cancel_tour instead.",
          });
        }
      }

      const result = await bookTour(ctx, orgId, {
        slotStart,
        callerName,
        callerPhone,
        elevenLabsConversationId: conversationId,
      });

      if (result.status === "booked") {
        await ctx.runMutation(internal.qualifications.upsertByConversationId, {
          elevenLabsConversationId: conversationId,
          callerName,
          callerPhone,
          tourSlot: `${result.label} with ${result.memberFirstName}`,
          tourConfirmed: true,
        });
        return Response.json({
          booked: true,
          when: result.label,
          team_member: result.memberFirstName,
          property_name: result.propertyName,
          property_address: result.propertyAddress,
        });
      }
      if (result.status === "taken") {
        await ctx.runMutation(internal.tours.recordTimeCheck, {
          elevenLabsConversationId: conversationId,
          starts: result.otherTimes.map((t) => t.start),
        });
        return Response.json({
          booked: false,
          reason: "That time is no longer open.",
          other_times: result.otherTimes,
        });
      }
      if (result.status === "invalid") {
        return Response.json({ booked: false, reason: result.reason });
      }
      // "unavailable": booking is not set up for this team. Capture it instead, if the agent
      // gave us a spoken time to capture.
      if (!preferredSlot) {
        return Response.json({
          booked: false,
          booking_available: false,
          message: "Ask for their preferred day and time and call request_tour again with preferred_slot.",
        });
      }
    }

    await ctx.runMutation(internal.qualifications.upsertByConversationId, {
      elevenLabsConversationId: conversationId,
      callerName,
      callerPhone,
      tourSlot: preferredSlot,
      tourConfirmed: true,
    });

    // Disabled: tour confirmation SMS to the customer — turned off per request. The tour is
    // still captured above and visible in the dashboard; only the outbound text is skipped.
    // Re-enable by uncommenting this block (and the property lookup it needs).
    // const property = await ctx.runQuery(internal.properties.currentInternal, {});
    const smsSent = false;
    try {
      // await ctx.runAction(internal.notifications.sendTourConfirmation, {
      //   to: callerPhone,
      //   propertyName: property.name,
      //   slot: preferredSlot,
      // });
    } catch {
      // The tour is still captured even if the SMS fails to send — the agent should not
      // tell the caller the request failed over a texting problem.
    }

    return Response.json({
      booked: false,
      captured: true,
      sms_sent: smsSent,
      message: "Their preferred time is noted. Tell them the team will confirm the tour with them.",
    });
  }),
});

/**
 * The caller's upcoming tours: booked earlier on this call, or on another call under the same
 * phone number (caller ID, or the number they give). What cancel_tour and reschedule_tour act on.
 */
http.route({
  path: "/tools/find-my-tour",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const orgId = await resolveBookingOrg(ctx, body.conversation_id, body.agent_id);
    if (!orgId) {
      return Response.json({
        found: false,
        tours: [],
        message: "Bookings can't be looked up on this call. Offer to have the team call them back.",
      });
    }

    const keys = await conversationPhoneKeys(ctx, body.conversation_id, body.caller_id, body.caller_phone);
    const tours = await ctx.runQuery(internal.tours.upcomingForCaller, {
      orgId,
      elevenLabsConversationId: body.conversation_id,
      phoneKeys: keys,
    });

    if (tours.length === 0) {
      return Response.json({
        found: false,
        tours: [],
        message: body.caller_phone
          ? "No upcoming tour under that number. Ask once whether they booked with a different number; " +
            "if not, say you can't find a booking and offer to have the team call them back."
          : "No booking found on this call. Ask for the phone number they booked with, then call " +
            "find_my_tour again with it as caller_phone.",
      });
    }

    return Response.json({
      found: true,
      tours: tours.slice(0, 3).map(tourSummary),
      message:
        tours.length === 1
          ? "Read this tour's day and time back and confirm it is the one they mean."
          : "Read these back and ask which one they mean.",
    });
  }),
});

/** Cancels the caller's own upcoming tour: its Google event goes, and the tour is marked cancelled. */
http.route({
  path: "/tools/cancel-tour",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    if (!body.conversation_id || !body.tour_id) {
      return Response.json({ error: "missing conversation_id or tour_id" }, { status: 400 });
    }
    if (!isConfirmed(body.caller_confirmed)) {
      return Response.json({
        cancelled: false,
        reason:
          "Not cancelled yet. Read the tour's day and time back, confirm they want it cancelled, then " +
          "call cancel_tour again with caller_confirmed set to true.",
      });
    }

    const target = await findCallerTour(ctx, body);
    if (!target) {
      return Response.json({
        cancelled: false,
        reason: "No upcoming tour with that tour_id belongs to this caller. Call find_my_tour and use a tour_id it returns.",
      });
    }

    const when = spokenLabel(target.tour.start, target.tour.timeZone);
    try {
      await cancelTourNow(ctx, target.tour.id);
    } catch (err) {
      console.error(`[cancel-tour] could not cancel ${target.tour.id}:`, err);
      return Response.json({
        cancelled: false,
        reason: "It could not be cancelled right now. Apologize and offer to have the team call them back.",
      });
    }

    // The lead the tour was booked on should no longer read as a booked tour.
    if (target.tour.elevenLabsConversationId) {
      await ctx.runMutation(internal.qualifications.upsertByConversationId, {
        elevenLabsConversationId: target.tour.elevenLabsConversationId,
        tourSlot: `${when} with ${target.tour.memberFirstName} (cancelled)`,
        tourConfirmed: false,
      });
    }

    return Response.json({ cancelled: true, when });
  }),
});

/**
 * Moves the caller's own upcoming tour to a new time. The same guards as booking: the caller
 * heard the new time read back and said yes, and it came from the latest find_tour_times result.
 */
http.route({
  path: "/tools/reschedule-tour",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { conversation_id: conversationId, tour_id: tourId, slot_start: slotStart } = body;
    if (!conversationId || !tourId || !slotStart) {
      return Response.json({ error: "missing conversation_id, tour_id or slot_start" }, { status: 400 });
    }
    if (!isConfirmed(body.caller_confirmed)) {
      return Response.json({
        rescheduled: false,
        reason:
          "Not moved yet. Read the new day and time back to the caller, wait for a clear yes, then call " +
          "reschedule_tour again with caller_confirmed set to true.",
      });
    }
    const offered = await ctx.runQuery(internal.tours.lastTimeCheck, { elevenLabsConversationId: conversationId });
    if (!offered || !offered.includes(slotStart)) {
      return Response.json({
        rescheduled: false,
        reason:
          "Not moved. That time is not in your latest find_tour_times result. Call find_tour_times with " +
          "the day and time they want and this tour_id, then use a time it returns.",
      });
    }

    const target = await findCallerTour(ctx, body);
    if (!target) {
      return Response.json({
        rescheduled: false,
        reason: "No upcoming tour with that tour_id belongs to this caller. Call find_my_tour and use a tour_id it returns.",
      });
    }

    const previousTime = spokenLabel(target.tour.start, target.tour.timeZone);
    const result = await rescheduleTour(ctx, target.orgId, { tour: target.tour, slotStart });

    if (result.status === "booked") {
      if (target.tour.elevenLabsConversationId) {
        await ctx.runMutation(internal.qualifications.upsertByConversationId, {
          elevenLabsConversationId: target.tour.elevenLabsConversationId,
          tourSlot: `${result.label} with ${result.memberFirstName}`,
          tourConfirmed: true,
        });
      }
      return Response.json({
        rescheduled: true,
        previous_time: previousTime,
        when: result.label,
        team_member: result.memberFirstName,
        property_address: result.propertyAddress,
      });
    }
    if (result.status === "taken") {
      await ctx.runMutation(internal.tours.recordTimeCheck, {
        elevenLabsConversationId: conversationId,
        starts: result.otherTimes.map((t) => t.start),
      });
      return Response.json({ rescheduled: false, reason: "That time is no longer open.", other_times: result.otherTimes });
    }
    return Response.json({ rescheduled: false, reason: result.reason });
  }),
});

/**
 * Hands the call to a human: texts the on-call staff number with the reason and a short
 * summary, and marks the call so it's unmissable in the dashboard.
 */
http.route({
  path: "/tools/escalate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      reason,
      summary,
      caller_name: callerName,
      caller_phone: callerPhone,
      living_area: livingArea,
    } = body;

    if (!conversationId || !reason) {
      return Response.json({ error: "missing conversation_id or reason" }, { status: 400 });
    }

    const fullSummary = [
      summary ?? "",
      callerName ? `Name: ${callerName}.` : "",
      callerPhone ? `Phone: ${callerPhone}.` : "",
      livingArea ? `Area: ${livingArea}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Disabled: SMS alert to staff on escalation — turned off per request. The dashboard still
    // marks the call as escalated below; only the outbound text is skipped. Re-enable by
    // uncommenting this block.
    const staffNumber = await ctx.runQuery(internal.orgSettings.staffPhoneNumberInternal, {});
    const notified = false;
    if (staffNumber) {
      try {
        // await ctx.runAction(internal.notifications.sendEscalationAlert, {
        //   to: staffNumber,
        //   reason,
        //   summary: fullSummary,
        //   callerPhone: callerPhone ?? "unknown",
        // });
        // notified = true;
      } catch {
        // Logged via the dashboard regardless; SMS delivery failure shouldn't break the call.
      }
    }

    await ctx.runMutation(internal.qualifications.upsertByConversationId, {
      elevenLabsConversationId: conversationId,
      callerName,
      callerPhone,
    });
    await ctx.runMutation(internal.conversations.markEscalation, {
      elevenLabsConversationId: conversationId,
      reason,
      summary: fullSummary,
      escalatedTo: notified ? staffNumber! : "unassigned",
    });

    // A resident emergency (fire, gas leak, break-in) is escalated straight away rather than
    // going through log_tenant_issue first — that's by design, so the agent doesn't stop to ask
    // triage questions while someone's building is on fire. But without a tenantIssues row this
    // call has nothing to make isResidentCall recognise it as a resident call, so it fell into
    // the Leads list instead of the Tenants page. Logging it here, at max severity, is what puts
    // it on the right page.
    if (reason === "urgent_tenant_issue") {
      await ctx.runMutation(internal.tenants.logIssue, {
        elevenLabsConversationId: conversationId,
        callerName,
        unit: livingArea,
        callerNumber: realPhone(callerPhone),
        callbackNumber: realPhone(callerPhone),
        reason: summary ?? "Escalated as an urgent tenant issue.",
        category: "emergency",
        severity: 10,
        severityReason: "Escalated directly to a human as an urgent tenant issue.",
        // A fallback, not an overwrite: if Sarah already logged this call the row she wrote is
        // more specific than anything reconstructable here, so it wins.
        onlyIfAbsent: true,
      });
    }

    return Response.json({ escalated: true, staff_notified: notified });
  }),
});

// --- Resident triage ------------------------------------------------------

/**
 * Records that a resident called, why, and how bad it is. Nothing is verified and nothing is
 * matched against a roster — the name and unit are stored exactly as the caller gave them.
 *
 * Unlike check_qualification, the severity here is the model's judgment rather than a
 * deterministic rule — triage has to weigh what the caller describes. clampSeverity is the
 * guard on that trust, and staff can override the score on the Tenants page with the
 * original preserved.
 *
 * Deliberately sends no SMS: the product decision is to store and surface, and the existing
 * escalation alert stays commented out rather than gaining a second notification path here.
 */
http.route({
  path: "/tools/log-tenant-issue",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const {
      conversation_id: conversationId,
      caller_id: callerId,
      caller_name: callerName,
      unit,
      caller_phone: callerPhone,
      reason,
      category,
      severity,
      severity_reason: severityReason,
    } = body;

    if (!conversationId || !reason) {
      return Response.json({ error: "missing conversation_id or reason" }, { status: 400 });
    }

    // Kept apart rather than collapsed into one field. The telephony number is always
    // correct; a spoken one is what they actually want to be called back on but goes through
    // ASR, so digits get misheard. On a browser call there is no telephony leg at all, and
    // the spoken number is the only number we will ever have.
    const telephony = realPhone(callerId);
    const spoken = realPhone(callerPhone);

    const clamped = clampSeverity(severity);

    await ctx.runMutation(internal.tenants.logIssue, {
      elevenLabsConversationId: conversationId,
      callerName,
      unit,
      callerNumber: telephony ?? spoken,
      callbackNumber: spoken,
      reason,
      category,
      severity: clamped,
      severityReason,
    });

    await ctx.runMutation(internal.conversations.markTenantIssue, {
      elevenLabsConversationId: conversationId,
      reason,
      severity: clamped,
      callerNumber: telephony ?? spoken,
    });

    return Response.json({ logged: true, severity: clamped });
  }),
});

// --- WhatsApp (WAHA) ------------------------------------------------------

/**
 * Inbound WhatsApp messages from self-hosted WAHA.
 *
 * WAHA is configured to send our own WAHA_API_KEY back as X-Api-Key (see wahaApi.startSession).
 * Without that check anyone who knows this deployment's URL could inject fake WhatsApp
 * messages into the inbox, and the bot would answer them.
 *
 * The payload is parsed defensively: WAHA's engines (GOWS/WEBJS/NOWEB) do not agree on
 * shape, so an unrecognised body is logged in full rather than dropped silently. See
 * infra/waha/README.md.
 */
http.route({
  path: "/wa/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.WAHA_API_KEY;
    if (!expected || request.headers.get("x-api-key") !== expected) {
      return new Response("unauthorized", { status: 401 });
    }

    const raw = await request.text();

    let payload: {
      event?: string;
      session?: string;
      payload?: { from?: string; body?: string; fromMe?: boolean };
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      console.error("[wa webhook] invalid JSON:", raw.slice(0, 500));
      return new Response("bad request", { status: 400 });
    }

    // Our own outgoing messages echo back through the webhook. Without this the bot
    // replies to itself, forever.
    if (payload.event !== "message" || payload.payload?.fromMe) {
      return new Response(null, { status: 200 });
    }

    const from = payload.payload?.from;
    const text = payload.payload?.body;
    if (!from || !text) {
      console.error(
        `[wa webhook] unrecognized payload shape: ${JSON.stringify(payload).slice(0, 1000)}`,
      );
      return new Response(null, { status: 200 });
    }

    // WhatsApp is moving to LID identifiers, so `from` can be "123@lid" rather than a phone
    // number. Resolve it when we can. When we cannot, keep the FULL JID as the chat id — a
    // bare LID with "@c.us" appended is undeliverable, so replies would vanish silently.
    let chatId = from.replace(/@.*/, "");
    let displayName = `+${chatId}`;
    if (from.endsWith("@lid")) {
      const resolved = await waha.resolveLid(from);
      if (resolved) {
        chatId = resolved;
        displayName = `+${resolved}`;
      } else {
        chatId = from;
        displayName = from;
      }
    }

    await ctx.runMutation(internal.waBot.ingestInbound, { chatId, displayName, text });

    return new Response(null, { status: 200 });
  }),
});

// --- Inbound SMS / WhatsApp (Twilio "A message comes in" webhooks) --------

/**
 * Twilio POSTs form-encoded fields, not JSON. Returns empty TwiML so Twilio doesn't also send
 * its own auto-reply — every outbound message goes through our own Twilio REST API call
 * instead, so the bot and staff replies are the only things that ever get texted back.
 * Shared by both the SMS number's webhook and the WhatsApp Sandbox's webhook.
 */
async function handleInboundMessage(
  ctx: GenericActionCtx<DataModel>,
  request: Request,
  channel: "sms" | "whatsapp",
): Promise<Response> {
  const form = new URLSearchParams(await request.text());
  const from = form.get("From")?.replace(/^whatsapp:/, "");
  const body = form.get("Body");
  const sid = form.get("MessageSid") ?? undefined;

  if (from && body) {
    await ctx.runMutation(internal.threads.ingestInbound, {
      channel,
      customerPhone: from,
      text: body,
      twilioSid: sid,
    });
  }

  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

http.route({
  path: "/webhooks/twilio/sms",
  method: "POST",
  handler: httpAction((ctx, request) => handleInboundMessage(ctx, request, "sms")),
});

http.route({
  path: "/webhooks/twilio/whatsapp",
  method: "POST",
  handler: httpAction((ctx, request) => handleInboundMessage(ctx, request, "whatsapp")),
});

// --- Post-call webhook -----------------------------------------------------

/**
 * Fires when ElevenLabs finishes processing a call — the only path phone calls have into the
 * dashboard, since there is no browser to stream a live transcript from. Also reconciles
 * browser calls (already logged live) by conversation id rather than duplicating them.
 *
 * HMAC verification against ELEVENLABS_POST_CALL_WEBHOOK_SECRET — exact header name to be
 * confirmed against a real fired webhook once configured in the ElevenLabs dashboard.
 */
http.route({
  path: "/webhooks/elevenlabs/post-call",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.ELEVENLABS_POST_CALL_WEBHOOK_SECRET;
    const signature = request.headers.get("ElevenLabs-Signature");
    const rawBody = await request.text();

    // Temporary — see debugWebhookLogs in schema.ts. Captures the real payload shape so the
    // parser in ingestFromWebhook can be corrected against actual data instead of guesses.
    await ctx.runMutation(internal.conversations.logDebugWebhook, { body: rawBody });

    if (secret && signature) {
      const valid = await verifyHmacSignature(rawBody, signature, secret);
      if (!valid) return new Response("invalid signature", { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    await ctx.runMutation(internal.conversations.ingestFromWebhook, { payload });

    return new Response("ok", { status: 200 });
  }),
});

async function verifyHmacSignature(
  body: string,
  header: string,
  secret: string,
): Promise<boolean> {
  // ElevenLabs' documented format is "t=<timestamp>,v0=<hex hmac-sha256 of `${timestamp}.${body}`>".
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    }),
  );
  const timestamp = parts.t;
  const providedSig = parts.v0;
  if (!timestamp || !providedSig) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const computedHex = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedHex === providedSig;
}

export default http;
