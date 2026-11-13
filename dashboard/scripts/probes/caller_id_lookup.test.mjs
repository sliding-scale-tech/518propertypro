// Unit tests for the caller-ID lookup switch (CALLER_ID_LOOKUP_ENABLED in convex/sarahConfigLib.ts):
// off, Sarah gets no lookup_caller tool and no prompt step for it; on, both come back. Also checks the
// find_unit-once rule and that the WAIT LINE rule is gone (2026-11-13). No packages, no network.
// From dashboard/:
//   node --test scripts/probes/caller_id_lookup.test.mjs
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

const L = await import("../../convex/sarahConfigLib.ts");
const A = await import("../../convex/agents.ts");

const site = "https://example.convex.site";
const config = () => L.normalizeConfig(L.defaultConfig());

test("the switch is off until tenant phone numbers are imported", () => {
  assert.equal(L.CALLER_ID_LOOKUP_ENABLED, false);
});

test("off: no lookup_caller tool and no tool description mentions it; on: it comes back", () => {
  for (const routing of [false, true]) {
    const off = A.toolDefsFor(site, routing);
    assert.deepEqual(off, A.toolDefsFor(site, routing, false));
    assert.equal(off.some((d) => d.name === "lookup_caller"), false);
    for (const d of off) assert.doesNotMatch(d.description, /lookup_caller/, d.name);

    const on = A.toolDefsFor(site, routing, true);
    const lookup = on.find((d) => d.name === "lookup_caller");
    assert.equal(lookup.url, `${site}/tools/lookup-caller`);
    assert.equal(lookup.properties.caller_id.dynamicVariable, "system__caller_id");
    // Same tools otherwise, in the same order.
    assert.deepEqual(
      on.filter((d) => d.name !== "lookup_caller").map((d) => d.name),
      off.map((d) => d.name),
    );
    assert.match(on.find((d) => d.name === "find_unit").description, /Use it after lookup_caller did not match\./);
  }
});

test("find_unit is called once, with the address and the unit, in silence", () => {
  for (const on of [false, true]) {
    const d = A.toolDefsFor(site, false, on).find((t) => t.name === "find_unit").description;
    assert.match(d, /Call it only when you have BOTH the property and the unit number/);
    assert.match(d, /ask for the unit first, as one question, then call it once with both/);
    assert.match(d, /unless the caller says the home is a house or has no unit number/);
    assert.match(d, /call it right away, in silence, and ask its say line only after the result/);
    assert.doesNotMatch(d, /wait line/);
  }
});

test("off: the prompt never tells Sarah to call lookup_caller, and still never re-asks", () => {
  const s = L.composeSarahSections(config());
  assert.deepEqual(s, L.composeSarahSections(config(), false));
  for (const [k, text] of Object.entries(s)) assert.doesNotMatch(text, /lookup_caller/, k);
  assert.match(s.resident, / a\. Start by asking for what they have not already said \(HARD RULE 4\)/);
  assert.match(s.resident, /is never asked again\./);
  assert.match(s.resident, /Never call it on the address alone, unless they say the home is a house/);
  assert.match(s.resident, / b2\. If find_unit does not match/);
  // The whole composed prompt too: the stored leasing prompt's old resident block is replaced.
  assert.doesNotMatch(A.composePrompt(A.LEASING_PROMPT, [], [], null), /lookup_caller/);
});

test("on: STEP 1 opens with lookup_caller again, with the same find_unit rule", () => {
  const s = L.composeSarahSections(config(), true);
  assert.match(s.resident, / a\. Call lookup_caller\. If it matches, confirm it/);
  assert.match(s.resident, / b\. If there is no match, or they say no: get their NAME/);
  assert.match(s.resident, /Never call it on the address alone, unless they say the home is a house/);
  // Only the resident section changes.
  const off = L.composeSarahSections(config(), false);
  for (const k of ["top", "lifeSafety", "extra", "bottom"]) assert.equal(s[k], off[k], k);
});

test("no WAIT LINE: only a life-safety script is spoken before a tool call", () => {
  assert.doesNotMatch(L.HARD_RULES, /WAIT LINE|wait line/);
  assert.match(L.HARD_RULES, /and say nothing\. Only a life-safety script is spoken before its tool call\.\n1\./);
  assert.match(L.HARD_RULES_REMINDER, /A reply either calls a tool or speaks, never both; a question ends your turn;/);
  assert.doesNotMatch(L.HARD_RULES_REMINDER, /wait line/);
});
