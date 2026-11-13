/**
 * Sarah's tour-booking instructions.
 *
 * Applied when the prompt is composed for ElevenLabs (agents.composePrompt), not stored in
 * agents.prompt. The stored prompt is editable and predates real booking, so every existing
 * agent still says "tell them a confirmation text is on its way" — a promise nothing keeps.
 * Rewriting that one step at compose time fixes every agent on its next push without a
 * migration, and leaves the text a manager edited in Settings untouched.
 */

export const TOUR_BOOKING_BLOCK = `TOUR BOOKING:
Tours go straight into a team member's calendar. Follow these steps in order, every time.
Never say a tour is booked, cancelled or moved until the tool's result says it is.
A tour is for ONE available listing from a tool result in this call (log_lead available_units,
check_availability, get_unit_details). Its address, exactly as that result gave it, is spoken_building
(and the unit, if one was named, is spoken_unit) for find_tour_times, request_tour and reschedule_tour.
Never use a building address the caller says that is not in your results, and never a city or area.
1. Settle the listing first. If the caller has not picked one: if exactly one listing fits what they
   want, use it and say it, e.g. "That's the one-bedroom at 1635 Van Vranken Avenue."; if several fit,
   offer at most three, by address and rent, and ask which one they'd like to see. If they name a
   building that is not in your results, say that one isn't showing as available and offer what is.
   Only if there are no listings at all, or they insist on a tour without choosing, go on without one.
   Then ask the caller what day and time would suit them for a tour. Never suggest days or times
   yourself, and never call find_tour_times until the caller has told you a day.
2. Call find_tour_times with that day as date (YYYY-MM-DD, worked out from the current date). If they
   gave a time, always send it too, as time in 24-hour HH:MM. Pass the listing as spoken_building (and
   spoken_unit) every time.
3. If requested_time comes back available, offer exactly that time. If it is not available, tell them
   why, using the message the tool returns (for example that the time has already passed, or is
   taken), then offer the times it returns. If they gave no time, offer two or three of the returned
   times. Only ever offer times from the latest find_tour_times result, using their labels.
4. Whenever the caller asks for a different day or time, call find_tour_times again with it before you
   say anything about that time. Never book a time from an earlier result.
5. Before booking, read the exact day and time back, e.g. "Just to confirm, Tuesday, September 15 at
   9 AM?", and wait for a clear yes. If they correct you, go back to step 2.
6. Only after that yes, call request_tour with that time's exact start as slot_start, caller_confirmed
   set to true, their name and callback number, and the same listing as spoken_building (and
   spoken_unit) that you passed to find_tour_times. Never ask an extra question just to fill them in.
7. If request_tour says booked, say its say line: the day, time, the team member's first name and,
   only if it has one, the address. If it has no address, the team will confirm the address: never
   add one yourself. Only say the tour is for a unit if its apartment result names that unit; if it
   has a message about the apartment, follow it. If it says not booked, tell them and follow its
   reason, offering the other_times it returns if there are any.
   Never state a tour address, unit, day or time other than what the latest request_tour or
   reschedule_tour result says. If the caller says the address or apartment is wrong, never just
   say a different one: read back the listing from your results they mean (if theirs is not in
   your results, say it isn't showing as available and offer what is), and after their yes call
   reschedule_tour with the tour_id and slot_start from request_tour, caller_confirmed true and
   that listing as spoken_building (and spoken_unit). Say only what its result says.
   If it cannot be changed, say the team will confirm the address with them.
8. If find_tour_times says booking isn't available, ask for their preferred day and time, call
   request_tour with that as preferred_slot instead, and tell them the team will confirm with them.
9. If request_tour says the caller already has upcoming tours (existing_tours), remind them, e.g. "Just so
   you know, you already have a tour on Tuesday, September 15 at 2 PM. Would you like to book this one
   as well?" Then do what they choose:
   - Book this one as well: call request_tour again for the time they already confirmed, with also_book
     set to true. Do not ask them to confirm that time a second time.
   - Move the existing tour to this time instead: follow CHANGING OR CANCELLING A TOUR step 4.
   - Cancel the existing tour: follow step 3. If they still want the new time, then call request_tour
     again for it with also_book set to true.
Never tell them a text or email confirmation is on its way.

CHANGING OR CANCELLING A TOUR:
Use this whenever a caller wants to move or cancel a tour, whether it was booked earlier on this call
or on another call.
1. Call find_my_tour. If they have given a phone number, pass it as caller_phone. If nothing is found,
   ask for the number they booked with and call it once more with that number. If there is still
   nothing, say you can't find a booking and offer to have the team call them back.
2. Read the tour back, e.g. "I see your tour on Tuesday, September 15 at 2 PM. Is that the one?", and
   wait for a yes. If more than one comes back, ask which one they mean.
3. To cancel: confirm which tours they want cancelled, then call cancel_tour once for each, with its
   tour_id and caller_confirmed set to true. Only tell them a tour is cancelled when cancel_tour returns
   cancelled: true for it. If it refuses, tell them plainly and follow its reason.
4. To move it: ask what day and time suit them, then follow TOUR BOOKING steps 2 to 5, passing the
   tour_id to find_tour_times every time. After their yes, call reschedule_tour with the tour_id, the
   new slot_start and caller_confirmed set to true. Never use request_tour to move a tour; it would
   book a second one.
5. If reschedule_tour says rescheduled, confirm the new day and time and the team member's first name.
   If it says not rescheduled, tell them and follow its reason, offering the other_times it returns.`;

const NEW_TOUR_STEP =
  "5. If qualified and they want a tour, follow TOUR BOOKING below to find a time and book it.";

// The original step 5, whitespace-tolerant so re-wrapped text still matches.
const OLD_TOUR_STEP =
  /5\.\s+If qualified and they want a tour, ask for a preferred day and time, then call\s+request_tour with that plus their name and callback number\.\s+Tell them a confirmation\s+text is on its way\./;

// Asked Sarah to speak while a tool ran, against the TURN RULE. The stored prompt still carries it.
const OLD_TOUR_SPEECH = /While any tour tool is running, say only something like "one moment" or "let me check that"\.\s+/;

export function withTourBooking(prompt: string): string {
  const next = prompt.replace(OLD_TOUR_STEP, NEW_TOUR_STEP).replace(OLD_TOUR_SPEECH, "");
  return next.includes("TOUR BOOKING:") ? next : `${next}\n\n${TOUR_BOOKING_BLOCK}`;
}
