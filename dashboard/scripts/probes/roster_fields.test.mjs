// Unit tests for convex/rosterFields.ts (roster address and owner email rules). No packages:
// Node's own test runner loads the .ts file directly. From dashboard/:
//   node --test scripts/probes/roster_fields.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskEmail, parseOwnerEmails, rosterAddressFormatted } from "../../convex/rosterFields.ts";

test("Make Up Property text with the city: the city is written once", () => {
  assert.equal(rosterAddressFormatted("19 Spring St, Troy", "Troy"), "19 Spring St, Troy, NY");
  assert.equal(rosterAddressFormatted("53 - 57 Broad St, Waterford", "Waterford"), "53 - 57 Broad St, Waterford, NY");
  assert.equal(rosterAddressFormatted("21 Vanderheyden St, Glens Falls", "Glens Falls"), "21 Vanderheyden St, Glens Falls, NY");
});

test("Make Up quirks: no comma before the city, and no city in Property", () => {
  assert.equal(rosterAddressFormatted("86 - 88 4th St. Waterford", "Waterford"), "86 - 88 4th St., Waterford, NY");
  assert.equal(rosterAddressFormatted("17 Harrison Ave", "Rensselaer"), "17 Harrison Ave, Rensselaer, NY");
});

test("Gold and Silver are unchanged", () => {
  assert.equal(rosterAddressFormatted("184 Remsen Street", "Albany"), "184 Remsen Street, Albany, NY");
  assert.equal(rosterAddressFormatted("9 Main Street", undefined), "9 Main Street, NY");
});

test("a street that only looks like the city is kept", () => {
  // "Troy Road" does not END with the city, and a Property that is only the city is kept whole.
  assert.equal(rosterAddressFormatted("5 Troy Road", "Troy"), "5 Troy Road, Troy, NY");
  assert.equal(rosterAddressFormatted("Troy", "Troy"), "Troy, Troy, NY");
  // A word ending in the city's letters is not the city.
  assert.equal(rosterAddressFormatted("12 Fairtroy", "Troy"), "12 Fairtroy, Troy, NY");
});

test("owner emails: one or two, lowercased, trimmed", () => {
  assert.deepEqual(parseOwnerEmails("Pat@Example.com"), { emails: ["pat@example.com"] });
  assert.deepEqual(parseOwnerEmails(" a@x.com, B@y.org "), { emails: ["a@x.com", "b@y.org"] });
});

test("owner emails: bad separators and addresses fail, with the address masked", () => {
  for (const bad of ["a@x.com,b@y.org", "a@x.com; b@y.org", "a@x.com,  b@y.org", "not-an-email", "a@x.com, a@x.com", "a@x.com, "]) {
    const r = parseOwnerEmails(bad);
    assert.ok("error" in r, bad);
    assert.ok(!r.error.includes("a@x.com"), `full address leaked for ${bad}`);
  }
});

test("maskEmail", () => {
  assert.equal(maskEmail("jane@domain.com"), "j***@domain.com");
  assert.equal(maskEmail("nope"), "***");
});
