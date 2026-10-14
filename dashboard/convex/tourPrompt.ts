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
While any tour tool is running, say only something like "one moment" or "let me check that". Never
say a tour is booked, cancelled or moved until the tool's result says it is.
1. Ask the caller what day and time would suit them for a tour. Never suggest days or times yourself,
   and never call find_tour_times until the caller has told you a day.
2. Call find_tour_times with that day as date (YYYY-MM-DD, worked out from the current date). If they
   gave a time, always send it too, as time in 24-hour HH:MM.
3. If requested_time comes back available, offer exactly that time. If it is not available, tell them
   why, using the message the tool returns (for example that the time has already passed, or is
   taken), then offer the times it returns. If they gave no time, offer two or three of the returned
   times. Only ever offer times from the latest find_tour_times result, using their labels.
4. Whenever the caller asks for a different day or time, call find_tour_times again with it before you
   say anything about that time. Never book a time from an earlier result.
5. Before booking, read the exact day and time back, e.g. "Just to confirm, Tuesday, September 15 at
   9 AM?", and wait for a clear yes. If they correct you, go back to step 2.
6. Only after that yes, call request_tour with that time's exact start as slot_start, caller_confirmed
   set to true, and their name and callback number.
7. If request_tour says booked, confirm the day and time, and always say the first name of the team
   member who will show them around. If it returns a property_address, give that too, the way you
   would give directions out loud. If it says not booked, tell them and follow its reason, offering
   the other_times it returns if there are any.
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

export function withTourBooking(prompt: string): string {
  const next = prompt.replace(OLD_TOUR_STEP, NEW_TOUR_STEP);
  return next.includes("TOUR BOOKING:") ? next : `${next}\n\n${TOUR_BOOKING_BLOCK}`;
}
