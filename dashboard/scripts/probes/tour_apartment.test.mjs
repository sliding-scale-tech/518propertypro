// Unit tests for the leasing-call fixes from conv_0001m7acgw57fpwagbr0ydncsybk (2026-11-13): a tour booked
// with no building was placed at the team's first property; the building Sarah talked about was never
// passed; she looked up a city as a building; and she called log_lead after every answer.
//  - which building and unit a tour resolves to (sarahTools.tourApartmentFor), from the address strings
//    log_lead / check_availability return, org-scoped, available units only, never from a city;
//  - the available unit labels in available_units (sarahTools.groupOfferedUnits / offeredUnitForAgent);
//  - the composed prompt and tool descriptions carry the new rules.
// No packages, no network. From dashboard/:
//   node --test scripts/probes/tour_apartment.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        // convex/_generated is .js; everything else in convex/ is .ts.
        try {
          return next(`${specifier}.ts`, context);
        } catch {
          return next(`${specifier}.js`, context);
        }
      }
      throw err;
    }
  },
});

const T = await import("../../convex/sarahTools.ts");
const { unitKey } = await import("../../convex/unitMatch.ts");
const A = await import("../../convex/agents.ts");
const P = await import("../../convex/tourPrompt.ts");

const ORG = "org_518";
const OTHER = "org_other";
const prop = (id, orgId, name, formatted) => ({ _id: id, orgId, name, address: { formatted } });
const unit = (id, orgId, propertyId, unitNumber, available) => ({
  _id: id,
  orgId,
  propertyId,
  unitNumber,
  unitNumberKey: unitKey(unitNumber),
  available,
});

// The real call's buildings (all in Schenectady), plus one sharing Van Vranken's house number in the same
// city, and another team's building at the very same address.
const tables = {
  properties: [
    prop("p_wash", ORG, "1 Washington Avenue", "1 Washington Avenue, Schenectady, NY"),
    prop("p_laf", ORG, "204 Lafayette Street", "204 Lafayette Street, Schenectady, NY"),
    prop("p_vv", ORG, "1635 Van Vranken Avenue", "1635 Van Vranken Avenue, Schenectady, NY"),
    prop("p_union", ORG, "1635 Union Street", "1635 Union Street, Schenectady, NY"),
    prop("p_other_vv", OTHER, "1635 Van Vranken Avenue", "1635 Van Vranken Avenue, Schenectady, NY"),
  ],
  units: [
    unit("u_vv_1", ORG, "p_vv", "1", false),
    unit("u_vv_2b", ORG, "p_vv", "2B", true),
    unit("u_vv_10", ORG, "p_vv", "10", true),
    unit("u_other_2b", OTHER, "p_other_vv", "2B", true),
  ],
};

/** Just enough of Convex's QueryCtx for tourApartmentFor: query(table).withIndex(name, eq...).collect(). */
function fakeCtx(data) {
  return {
    db: {
      query(table) {
        return {
          withIndex(_name, build) {
            const conds = [];
            const q = {
              eq(field, value) {
                conds.push([field, value]);
                return q;
              },
            };
            build(q);
            return { collect: async () => data[table].filter((r) => conds.every(([k, v]) => r[k] === v)) };
          },
        };
      },
    },
  };
}
const ctx = fakeCtx(tables);
const resolve = (spokenAddress, spokenUnit, orgId = ORG) => T.tourApartmentFor(ctx, { orgId, spokenAddress, spokenUnit });

test("building text: the street part first, then the whole address", () => {
  assert.deepEqual(T.tourBuildingQueries("1635 Van Vranken Avenue, Schenectady, NY"), [
    "1635 Van Vranken Avenue",
    "1635 Van Vranken Avenue, Schenectady, NY",
  ]);
  assert.deepEqual(T.tourBuildingQueries("1635 Van Vranken Avenue"), ["1635 Van Vranken Avenue"]);
  assert.deepEqual(T.tourBuildingQueries("  "), []);
  assert.deepEqual(T.tourBuildingQueries(undefined), []);
});

test("names the building: a street or name word, never just the city", () => {
  const vv = tables.properties[2];
  assert.equal(T.namesBuilding("1635 Van Vranken Avenue", vv), true);
  assert.equal(T.namesBuilding("Van Vranken", vv), true);
  assert.equal(T.namesBuilding("Schenectady", vv), false);
  assert.equal(T.namesBuilding("Schenectady, NY", vv), false);
});

test("a log_lead / check_availability address string resolves to that building", async () => {
  const a = await resolve("1635 Van Vranken Avenue, Schenectady, NY");
  assert.equal(a.property?.id, "p_vv");
  assert.equal(a.property?.address, "1635 Van Vranken Avenue, Schenectady, NY");
  assert.equal(a.property?.street, "1635 Van Vranken Avenue");
  assert.equal(a.unit, null);
  assert.equal(a.unitStatus, "none_given");
  // Same number in the same city on another street does not make it ambiguous.
  assert.equal((await resolve("1635 Union Street, Schenectady, NY")).property?.id, "p_union");
  assert.equal((await resolve("204 Lafayette Street, Schenectady, NY")).property?.id, "p_laf");
  assert.equal((await resolve("1635 Van Vranken Avenue")).property?.id, "p_vv");
});

test("a city or area never resolves to a building (the real call passed 'Schenectady')", async () => {
  for (const spoken of ["Schenectady", "Schenectady, NY", "Albany"]) {
    const a = await resolve(spoken);
    assert.equal(a.property, null, spoken);
    assert.equal(a.unit, null, spoken);
  }
  // Even a team with only one building in that city.
  const single = fakeCtx({ properties: [tables.properties[2]], units: [] });
  assert.equal((await T.tourApartmentFor(single, { orgId: ORG, spokenAddress: "Schenectady" })).property, null);
});

test("a unit attaches only when it is exactly an AVAILABLE unit of that building", async () => {
  const twoB = await resolve("1635 Van Vranken Avenue, Schenectady, NY", "2B");
  assert.equal(twoB.unit?.id, "u_vv_2b");
  assert.equal(twoB.unit?.label, "2B");
  assert.equal(twoB.unitStatus, "matched");
  // Unit 1 exists but is not available: the building stays, the unit is left off.
  const one = await resolve("1635 Van Vranken Avenue, Schenectady, NY", "1");
  assert.equal(one.property?.id, "p_vv");
  assert.equal(one.unit, null);
  assert.equal(one.unitStatus, "not_available");
  // Exact only: "1" is never unit 10.
  assert.notEqual(one.unit?.id, "u_vv_10");
});

test("org scoping: another team's building or unit never resolves", async () => {
  const a = await resolve("1635 Van Vranken Avenue, Schenectady, NY", "2B", ORG);
  assert.equal(a.property?.id, "p_vv");
  assert.equal(a.unit?.id, "u_vv_2b");
  const b = await resolve("1 Washington Avenue, Schenectady, NY", undefined, OTHER);
  assert.equal(b.property, null);
  const c = await resolve("1635 Van Vranken Avenue, Schenectady, NY", "2B", OTHER);
  assert.equal(c.property?.id, "p_other_vv");
  assert.equal(c.unit?.id, "u_other_2b");
});

test("available_units carry unit labels: sorted, capped, per building, labels only", () => {
  const row = (address, unitLabel, extra = {}) => ({
    community: address.split(",")[0],
    address,
    city: "Schenectady",
    unitLabel,
    bedrooms: "1br",
    rentedAs: null,
    rent: 1150,
    availableFrom: null,
    leasingFacts: null,
    ...extra,
  });
  const vv = "1635 Van Vranken Avenue, Schenectady, NY";
  const laf = "204 Lafayette Street, Schenectady, NY";
  const groups = T.groupOfferedUnits([
    row(vv, "10"),
    row(vv, "2B"),
    row(vv, "1"),
    row(vv, "3"),
    row(vv, "4"),
    row(laf, "A", { rent: 1695 }),
    row(laf, null, { rent: 1695 }), // a house-style unit with no label
  ]);
  assert.equal(groups.length, 2);
  const vvOut = T.offeredUnitForAgent(groups.find((g) => g.address === vv));
  assert.deepEqual(vvOut.units, ["1", "2B", "3", "4"]); // natural order, capped at 4
  assert.equal(vvOut.units_available, 5);
  const lafOut = T.offeredUnitForAgent(groups.find((g) => g.address === laf));
  assert.deepEqual(lafOut.units, ["A"]);
  assert.equal(lafOut.units_available, 2);
  // Nothing about residents or owners in the payload.
  assert.deepEqual(Object.keys(vvOut).sort(), [
    "address",
    "available_from",
    "bedrooms",
    "city",
    "community",
    "leasing_facts",
    "rent_max",
    "rent_min",
    "rented_as",
    "units",
    "units_available",
  ]);
  // Two buildings with one community name never share a group (or their unit labels).
  const same = T.groupOfferedUnits([row(vv, "1", { community: "Pine" }), row(laf, "A", { community: "Pine" })]);
  assert.equal(same.length, 2);
  // No labels at all: no units key.
  assert.equal("units" in T.offeredUnitForAgent(T.groupOfferedUnits([row(vv, null)])[0]), false);
});

const prompt = A.composePrompt(A.LEASING_PROMPT, [], [], null);

test("prompt: log_lead once early and once final, the never-re-ask rule intact", () => {
  assert.ok(prompt.includes("log_lead, twice. FIRST LOG"));
  assert.ok(prompt.includes("ONE more time with final_log true and everything said anywhere in the call"));
  assert.ok(prompt.includes("you\n   still never ask for anything already said (HARD RULE 4)"));
  assert.ok(prompt.includes("4. Never ask for what you already have."));
  assert.ok(!prompt.includes("again after every one or two new"));
  assert.ok(!prompt.includes("recording it with log_lead as you go"));
  assert.ok(!prompt.includes("Include every answer you have each time you call it"));
  assert.ok(!prompt.includes("the logging tool after the first useful answer and again as you learn more"));
  // The maintenance two-log flow is unchanged.
  assert.ok(prompt.includes("In a routine call that means two calls: the first log\n(STEP 2) and the final log (STEP 3)."));
});

test("prompt: an older stored prompt's log-after-every-answer lines are rewritten at compose time", () => {
  const old = A.LEASING_PROMPT.replace(
    "recording it with log_lead as LEASING CALLS step 3 says.",
    "recording it with log_lead as you go.",
  )
    .replace("The final log_lead carries every answer.", "Include every answer you have each time you call it.")
    .replace(
      "the logging tool once you have the core of what they need, then as its own steps say.",
      "the logging tool after the first useful answer and again as you learn more.",
    );
  assert.notEqual(old, A.LEASING_PROMPT);
  assert.equal(A.withAreaFirst(old), A.withAreaFirst(A.LEASING_PROMPT));
});

test("prompt: where-is-it from known results, the building passed to request_tour, no verbal-only corrections", () => {
  assert.ok(prompt.includes("WHERE IS IT: when the caller asks where an available unit is"));
  assert.ok(prompt.includes("never a city or area. Only those questions"));
  // B40 follow-up: the tour is for one listing from Sarah's own results, settled before any times.
  const flat = prompt.replace(/\s+/g, " ");
  assert.ok(flat.includes("for one available listing from a result in this call (log_lead available_units, check_availability, get_unit_details)"));
  assert.ok(flat.includes("For both, pass the listing's address, exactly as the result gave it, as spoken_building"));
  assert.ok(P.TOUR_BOOKING_BLOCK.includes("Never state a tour address, unit, day or time other than what the latest request_tour or\n   reschedule_tour result says."));
  assert.ok(P.TOUR_BOOKING_BLOCK.includes("If it cannot be changed, say the team will confirm the address with them."));
  assert.ok(prompt.includes(P.TOUR_BOOKING_BLOCK));
  assert.ok(!prompt.includes("If it returns a property_address, give that too"));
});

test("tool descriptions: log_lead twice with final_log, request_tour's building, get_unit_details never a city", () => {
  const defs = A.toolDefsFor("https://example.convex.site", false);
  const byName = (n) => defs.find((d) => d.name === n);
  const logLead = byName("log_lead");
  assert.match(logLead.description, /Call it twice/);
  assert.match(logLead.description, /Do not call it after each answer/);
  assert.ok(logLead.properties.final_log);
  const tour = byName("request_tour");
  assert.match(tour.properties.spoken_building.description, /log_lead available_units, check_availability, get_unit_details/);
  assert.match(tour.properties.spoken_building.description, /Never a\s+city or area/);
  const details = byName("get_unit_details");
  assert.match(details.description, /never a city or area/);
  assert.match(details.description, /answer that from the available_units or check_availability results/);
  const move = byName("reschedule_tour");
  assert.ok(move.properties.spoken_building);
  assert.deepEqual(move.required, ["conversation_id", "tour_id", "slot_start", "caller_confirmed"]);
});
