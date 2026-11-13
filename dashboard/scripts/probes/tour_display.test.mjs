// Unit tests for convex/tourDisplay.ts: how a tour's apartment, phone number and lead answers read
// on the dashboard calendar, in the Tour details dialog and in the Google Calendar event. No
// packages, no network. From dashboard/:
//   node --test scripts/probes/tour_display.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const D = await import("../../convex/tourDisplay.ts");

const ADDRESS = "1 Washington Ave, Albany, NY 12210, USA";

test("apartment line: short for a calendar tile, long for the dialog, null without a building", () => {
  const t = { propertyAddress: ADDRESS, unitLabel: "1" };
  assert.equal(D.apartmentLine(t, "short"), "1 Washington Ave · Unit 1");
  assert.equal(D.apartmentLine(t, "long"), "1 Washington Ave, Unit 1");
  assert.equal(D.apartmentLine({ propertyAddress: ADDRESS }), "1 Washington Ave");
  assert.equal(D.apartmentLine({ propertyAddress: ADDRESS, unitLabel: "Apt 4B" }), "1 Washington Ave, Apt 4B");
  assert.equal(D.apartmentLine({ propertyAddress: undefined, unitLabel: "1" }), null);
  assert.equal(D.apartmentLine({}), null);
});

test("apartment link: the property page, narrowed to exactly that unit when there is one", () => {
  assert.equal(D.EXACT_UNIT_PARAM, "units_unit");
  assert.equal(D.apartmentHref("abc123", "1"), "/properties?property=abc123&units_unit=1");
  assert.equal(D.apartmentHref("abc123", "4 B"), "/properties?property=abc123&units_unit=4+B");
  assert.equal(D.apartmentHref("abc123", null), "/properties?property=abc123");
  assert.equal(D.apartmentHref(null, "1"), null);
});

test("exact unit: '1' is unit 1 only, never 10 or 1A; case and spacing do not matter", () => {
  assert.equal(D.isExactUnit("1", "1"), true);
  assert.equal(D.isExactUnit("10", "1"), false);
  assert.equal(D.isExactUnit("1A", "1"), false);
  assert.equal(D.isExactUnit("2b", "2B"), true);
  assert.equal(D.isExactUnit("4  B", "4 B"), true);
  // No exact unit asked for: every unit shows.
  assert.equal(D.isExactUnit("10", ""), true);
  assert.equal(D.isExactUnit("10", null), true);
});

test("phone: a valid number is formatted and dialable; anything else shows as stored, no link", () => {
  assert.deepEqual(D.phoneForDisplay("5185550123"), { text: "(518) 555-0123", tel: "+15185550123" });
  assert.deepEqual(D.phoneForDisplay("+1 (518) 555-0123"), { text: "(518) 555-0123", tel: "+15185550123" });
  assert.deepEqual(D.phoneForDisplay("+447700900123"), { text: "+447700900123", tel: "+447700900123" });
  // The garbled 11 digits from the real tour: not a number anyone can dial.
  assert.deepEqual(D.phoneForDisplay("75672562565"), { text: "75672562565", tel: null });
  assert.equal(D.phoneForDisplay(""), null);
  assert.equal(D.phoneForDisplay(undefined), null);
});

test("answers: booleans (and boolean strings) read Yes / No, everything else as given", () => {
  assert.equal(D.formatAnswer(false), "No");
  assert.equal(D.formatAnswer(true), "Yes");
  assert.equal(D.formatAnswer("false"), "No");
  assert.equal(D.formatAnswer("true"), "Yes");
  assert.equal(D.formatAnswer(720), "720");
  assert.equal(D.formatAnswer("My employer"), "My employer");
});

test("Google event: chosen apartment in the title, description and location", () => {
  const e = D.tourEventText({
    propertyName: "Washington Apartments",
    propertyAddress: ADDRESS,
    unitLabel: "1",
    apartmentChosen: true,
    callerName: "Omar",
    callerPhone: "+15185550123",
  });
  assert.equal(e.summary, "Property tour: Omar, 1 Washington Ave, Unit 1");
  assert.equal(e.location, ADDRESS);
  assert.equal(
    e.description,
    "Tour of Washington Apartments, booked by Sarah (Simplr).\nApartment: 1 Washington Ave, Unit 1\nRenter: Omar\nPhone: (518) 555-0123",
  );
});

test("Google event: no apartment chosen has NO location and never a default building", () => {
  // conv_0001m7acgw57fpwagbr0ydncsybk: a tour with no building was placed at the team's first property.
  const e = D.tourEventText({
    propertyName: null,
    propertyAddress: null,
    apartmentChosen: false,
    callerName: "",
  });
  assert.equal(e.summary, "Property tour: Prospective renter");
  assert.equal("location" in e, false);
  assert.equal(
    e.description,
    "Tour booked by Sarah (Simplr).\nApartment: none chosen yet. Confirm the address with the renter.",
  );
  // Even if an address slipped through, an unchosen apartment never becomes the event's location.
  const leaked = D.tourEventText({ propertyName: "Washington Apartments", propertyAddress: ADDRESS, apartmentChosen: false });
  assert.equal("location" in leaked, false);
  assert.ok(!leaked.description.includes("Washington"));
});

test("say lines: request_tour with and without a building, with a unit, and an apartment correction", () => {
  const when = "Tuesday, November 17 at 2:00 PM";
  const vv = "1635 Van Vranken Avenue, Schenectady, NY";
  assert.equal(
    D.tourBookedSay({ when, memberFirstName: "Nina" }),
    "You're all set for Tuesday, November 17 at 2:00 PM with Nina. The team will confirm the address with you.",
  );
  assert.equal(
    D.tourBookedSay({ when, memberFirstName: "Nina", address: null, unitLabel: "2B" }),
    "You're all set for Tuesday, November 17 at 2:00 PM with Nina. The team will confirm the address with you.",
  );
  assert.equal(
    D.tourBookedSay({ when, memberFirstName: "Nina", address: vv }),
    "You're all set for Tuesday, November 17 at 2:00 PM with Nina at 1635 Van Vranken Avenue, Schenectady, NY.",
  );
  assert.equal(
    D.tourBookedSay({ when, memberFirstName: "Nina", address: vv, unitLabel: "2B" }),
    "You're all set for Tuesday, November 17 at 2:00 PM with Nina to see Unit 2B at 1635 Van Vranken Avenue, Schenectady, NY.",
  );
  assert.equal(
    D.tourApartmentChangedSay({ when, address: vv }),
    "Thanks for catching that. Your tour on Tuesday, November 17 at 2:00 PM is now at 1635 Van Vranken Avenue, Schenectady, NY.",
  );
  assert.equal(
    D.tourApartmentChangedSay({ when, address: vv, unitLabel: "1" }),
    "Thanks for catching that. Your tour on Tuesday, November 17 at 2:00 PM is now to see Unit 1 at 1635 Van Vranken Avenue, Schenectady, NY.",
  );
  assert.equal(D.TOUR_ADDRESS_NOT_CHANGED_SAY, "Sorry about that. The team will confirm the address with you before the tour.");
});
