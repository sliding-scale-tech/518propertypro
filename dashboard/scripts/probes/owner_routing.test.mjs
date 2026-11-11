// Unit tests for the owner call routing menu (convex/ownerRoutingLib.ts and its use in
// convex/sarahConfigLib.ts): hours and availability in America/New_York (DST, overnight), phone
// normalisation, loop checks, transfer targets, and the prompt staying unchanged while the menu is off.
// No packages, no network. From dashboard/:
//   node --test scripts/probes/owner_routing.test.mjs
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

const R = await import("../../convex/ownerRoutingLib.ts");
const L = await import("../../convex/sarahConfigLib.ts");

const at = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const MON_FRI_9_5 = R.parseHours("Mon-Fri 09:00-17:00");

// --- Hours -------------------------------------------------------------------------------------

test("hours parse to rules and format back to the same canonical string", () => {
  assert.deepEqual(R.parseHours(""), []);
  assert.deepEqual(R.parseHours(null), []);
  assert.deepEqual(MON_FRI_9_5, [{ days: [0, 1, 2, 3, 4], start: "09:00", end: "17:00" }]);
  const s = "Mon-Fri 09:00-17:00; Sat,Sun 10:00-14:00";
  assert.equal(R.formatHours(R.parseHours(s)), "Mon-Fri 09:00-17:00; Sat-Sun 10:00-14:00");
  assert.equal(R.formatHours(R.parseHours("mon,wed,fri 08:30-12:00")), "Mon,Wed,Fri 08:30-12:00");
  // A range can wrap the week.
  assert.deepEqual(R.parseHours("Sat-Mon 09:00-12:00")[0].days, [0, 5, 6]);
  // Stable round trip.
  for (const x of ["Mon-Fri 09:00-17:00", "Fri 22:00-02:00", "Tue,Thu 00:00-24:00"]) {
    assert.equal(R.formatHours(R.parseHours(R.formatHours(R.parseHours(x)))), R.formatHours(R.parseHours(x)));
  }
});

test("free text and malformed hours are rejected, never guessed at", () => {
  for (const bad of ["9-5 weekdays", "Mon-Fri 9:00-17:00", "Mon-Fri 09:00-25:00", "Mon-Fri 09:00-09:00", "Funday 09:00-10:00", "09:00-17:00", "Mon-Fri 24:00-02:00"]) {
    assert.equal(R.parseHours(bad), null, bad);
  }
});

test("availability: inside and outside Mon-Fri 9-5 in New York", () => {
  // Tue Nov 3 2026 (EST, UTC-5): 14:00 UTC = 9:00 AM, 22:00 UTC = 5:00 PM.
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 11, 3, 14, 0)), true);
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 11, 3, 13, 59)), false);
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 11, 3, 21, 59)), true);
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 11, 3, 22, 0)), false); // end is exclusive
  // Sat Nov 7, noon in New York.
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 11, 7, 17)), false);
  // No hours set = any time.
  assert.equal(R.isWithinHours([], at(2026, 11, 8, 8)), true);
});

test("availability follows the New York clock across DST, not UTC", () => {
  // 13:30 UTC on a Monday: 9:30 AM EDT before the fall-back (Oct 26), 8:30 AM EST after it (Nov 2).
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 10, 26, 13, 30)), true);
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 11, 2, 13, 30)), false);
  // Spring forward, Sun Mar 8 2026: 13:30 UTC on Mon Mar 9 is 9:30 AM EDT (inside), on Fri Mar 6 8:30 AM EST (outside).
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 3, 9, 13, 30)), true);
  assert.equal(R.isWithinHours(MON_FRI_9_5, at(2026, 3, 6, 13, 30)), false);
  // The fall-back night itself (Sun Nov 1 2026): 1:30 AM happens twice; both are inside Sun 01:00-03:00.
  const sunNight = R.parseHours("Sun 01:00-03:00");
  assert.equal(R.isWithinHours(sunNight, at(2026, 11, 1, 5, 30)), true); // 1:30 AM EDT
  assert.equal(R.isWithinHours(sunNight, at(2026, 11, 1, 6, 30)), true); // 1:30 AM EST
  assert.equal(R.isWithinHours(sunNight, at(2026, 11, 1, 8, 30)), false); // 3:30 AM EST
});

test("overnight ranges belong to the day they start on, and wrap the week", () => {
  const fri = R.parseHours("Fri 22:00-02:00");
  assert.equal(R.isWithinHours(fri, at(2026, 11, 7, 3, 30)), true); // Fri Nov 6, 10:30 PM EST
  assert.equal(R.isWithinHours(fri, at(2026, 11, 7, 6, 30)), true); // Sat Nov 7, 1:30 AM
  assert.equal(R.isWithinHours(fri, at(2026, 11, 7, 7, 30)), false); // Sat 2:30 AM
  assert.equal(R.isWithinHours(fri, at(2026, 11, 6, 3, 30)), false); // Thu Nov 5, 10:30 PM
  const sun = R.parseHours("Sun 22:00-02:00");
  assert.equal(R.isWithinHours(sun, at(2026, 11, 9, 6)), true); // Mon Nov 9, 1:00 AM (from Sunday)
  // Ending at midnight.
  const evening = R.parseHours("Mon-Fri 17:00-00:00");
  assert.equal(R.isWithinHours(evening, at(2026, 11, 4, 4, 30)), true); // Tue 11:30 PM
  assert.equal(R.isWithinHours(evening, at(2026, 11, 4, 5, 30)), false); // Wed 12:30 AM
  assert.match(R.describeHours(evening), /5:00 PM to midnight/);
});

// --- Numbers -----------------------------------------------------------------------------------

test("phone numbers normalise to dialable E.164, strictly", () => {
  assert.equal(R.dialableNumber("(518) 365-0996"), "+15183650996");
  assert.equal(R.dialableNumber("518.555.0123"), "+15185550123");
  assert.equal(R.dialableNumber("1-518-555-0123"), "+15185550123");
  assert.equal(R.dialableNumber("+44 20 7946 0958"), "+442079460958");
  for (const bad of ["911", "ext 204", "204", "518-555-012", "411-555-1234", "518-911-1234", "018-555-0123", "518-055-0123", "518-555-0123 x2", ""]) {
    assert.equal(R.dialableNumber(bad), null, bad);
  }
  assert.equal(R.normalizeExtension("ext. 204"), "204");
  assert.equal(R.normalizeExtension("x12"), "12");
  assert.equal(R.normalizeExtension(""), "");
  assert.equal(R.normalizeExtension("12a"), null);
  assert.equal(R.postDialDigits("204"), "ww204");
});

const dir = (entries, extra = {}) => ({ enabled: false, entries, ...extra });
const msgs = (d, opts) => R.routingProblems(d, opts).map((p) => `${p.field}: ${p.message}`);

test("validation: loops back to Sarah are rejected with a specific message", () => {
  const own = { ownLines: ["+15185550199"] };
  const p1 = msgs(dir([{ label: "Nina", phone: "518-555-0199" }]), own);
  assert.equal(p1.length, 1);
  assert.match(p1[0], /^entries\.0\.phone: Nina: that is Sarah's own phone line \(ending 0199\)/);
  const p2 = msgs(dir([{ label: "Nina", phone: "518-555-0100" }], { mainOfficeNumber: "(518) 555-0100" }));
  assert.match(p2[0], /^entries\.0\.phone: Nina: that is the main office number, which forwards to Sarah/);
  // Several people may share one number (the B36 test setup): allowed, with a warning, never an error.
  const shared = dir([{ label: "Nina", phone: "518-555-0101" }, { label: "Nikki", phone: "+15185550101" }]);
  assert.deepEqual(msgs(shared), []);
  assert.deepEqual(R.routingWarnings(shared), [
    "Test setup: everyone in the menu shares one number (+1 518-555-0101). Replace with real numbers before production.",
  ]);
  const someShare = dir([{ label: "Nina", phone: "518-555-0101" }, { label: "Nikki", phone: "+15185550101" }, { label: "Pat", phone: "518-555-0102" }]);
  assert.match(R.routingWarnings(someShare)[0], /^Test setup: Nina, Nikki share one number \(\+1 518-555-0101\)/);
  assert.deepEqual(R.routingWarnings(dir([{ label: "Nina", phone: "518-555-0101" }, { label: "Pat", phone: "518-555-0102" }])), []);
  // The loop checks still hold when everyone shares a number.
  const loop = msgs(dir([{ label: "Nina", phone: "518-555-0199" }, { label: "Nikki", phone: "518-555-0199" }]), own);
  assert.equal(loop.length, 2);
  assert.match(msgs(dir([], { mainOfficeNumber: "12" }))[0], /^mainOfficeNumber: Main office number: enter a full 10-digit number/);
});

test("validation: per-field messages for extensions, hours, names and the switch", () => {
  assert.match(msgs(dir([{ label: "Delia (Accounting)", phone: "ext 204" }]))[0], /^entries\.0\.phone: Delia \(Accounting\): enter the full phone number to dial.*Extension field/);
  assert.match(msgs(dir([{ label: "Pat", phone: "", extension: "204" }]))[0], /^entries\.0\.extension: Pat: add the phone number to dial before the extension/);
  assert.match(msgs(dir([{ label: "Pat", phone: "518-555-0123", extension: "2-4" }]))[0], /^entries\.0\.extension: Pat: the extension can only be digits/);
  assert.match(msgs(dir([{ label: "Pat", phone: "", hours: "9 to 5" }]))[0], /^entries\.0\.hours: Pat: the hours could not be read/);
  assert.match(msgs(dir([{ label: "", phone: "" }]))[0], /^entries\.0\.label: Key 1 needs a name\./);
  assert.match(msgs({ enabled: true, entries: [{ label: "Pat", phone: "" }] })[0], /^enabled: Add a phone number for at least one person/);
  assert.match(msgs(dir(Array.from({ length: 10 }, (_, i) => ({ label: `P${i}`, phone: "" }))))[0], /^entries: The menu can have at most 9 people/);
});

test("validation: the directory can be enabled with only some numbers (the one-number test)", () => {
  const d = {
    enabled: true,
    entries: ["Pat Fiore", "Alex Buell", "Nikki", "Nina", "Delia (Accounting)", "Alyssa"].map((label) => ({ label, phone: "" })),
  };
  d.entries[3].phone = "518-555-0123";
  assert.deepEqual(R.routingProblems(d, { ownLines: ["+15185550199"] }), []);
});

// --- The menu ----------------------------------------------------------------------------------

const six = (phones = {}) =>
  ["Pat Fiore", "Alex Buell", "Nikki", "Nina", "Delia (Accounting)", "Alyssa"].map((label, i) => ({
    label,
    phone: phones[i + 1] ?? "",
    ...(phones[`h${i + 1}`] ? { hours: phones[`h${i + 1}`] } : {}),
    ...(phones[`x${i + 1}`] ? { extension: phones[`x${i + 1}`] } : {}),
  }));

test("keys follow the directory order and people are found by key, name or role", () => {
  const menu = R.menuOf({ enabled: true, entries: six({ 4: "518-555-0104", 5: "518-555-0105" }) });
  assert.deepEqual(menu.map((m) => m.key), [1, 2, 3, 4, 5, 6]);
  const find = (q) => R.findMenuEntry(menu, q)?.label ?? null;
  assert.equal(find("4"), "Nina");
  assert.equal(find("press three"), "Nikki");
  assert.equal(find("Nina please"), "Nina");
  assert.equal(find("pat"), "Pat Fiore");
  assert.equal(find("Pat Fiore"), "Pat Fiore");
  assert.equal(find("accounting"), "Delia (Accounting)");
  assert.equal(find("the accounts department"), "Delia (Accounting)");
  assert.equal(find("Delia in Accounting"), "Delia (Accounting)");
  assert.equal(find("7"), null);
  assert.equal(find("maintenance"), null);
  assert.equal(menu[4].spoken, "Delia in Accounting");
});

test("availability: available, after hours, no number and not found", () => {
  const menu = R.menuOf({ enabled: true, entries: six({ 4: "518-555-0104", h4: "Mon-Fri 09:00-17:00" }) });
  const tueNoon = at(2026, 11, 3, 17);
  const tueNight = at(2026, 11, 4, 2); // Tue 9 PM
  const a = R.availabilityOf(menu, "Nina", tueNoon, { fallback: "If she can't pick up, you can leave a voicemail" });
  assert.equal(a.status, "available");
  assert.equal(a.entry.phone, "+15185550104");
  assert.equal(a.say, "I'll put you through to Nina now. If she can't pick up, you can leave a voicemail.");
  const b = R.availabilityOf(menu, "4", tueNight);
  assert.equal(b.status, "after_hours");
  assert.equal(b.say, "Nina isn't available right now. I can take a message and pass it on.");
  const b2 = R.availabilityOf(menu, "Nina", tueNight, { afterHours: "Our office is open weekdays 9 to 5" });
  assert.equal(b2.say, "Our office is open weekdays 9 to 5. I can take a message and pass it on to Nina.");
  const c = R.availabilityOf(menu, "accounting", tueNoon);
  assert.equal(c.status, "no_number");
  assert.match(c.say, /^Delia in Accounting isn't available by phone/);
  const d = R.availabilityOf(menu, "the plumber", tueNoon);
  assert.equal(d.status, "not_found");
  assert.equal(d.say, "Who would you like to reach? I can put you through to Nina.");
});

test("blocked numbers (Sarah's own line, the main office) are never transfer targets", () => {
  const menu = R.menuOf({ enabled: true, entries: six({ 1: "518-555-0101", 4: "518-555-0104" }), mainOfficeNumber: "518-555-0104" }, ["+15185550101"]);
  assert.equal(menu[0].phone, null);
  assert.equal(menu[3].phone, null);
  assert.equal(R.transferToolConfig(menu), null);
});

test("transfer targets (static fallback): one rule per distinct number, blind, extension as post-dial digits", () => {
  const menu = R.menuOf({ enabled: true, entries: six({ 2: "518-555-0102", 5: "518-555-0105", x5: "204" }) });
  const tool = R.transferToolConfig(menu, "static");
  assert.equal(tool.type, "system");
  assert.equal(tool.name, "transfer_to_number");
  assert.equal(tool.params.system_tool_type, "transfer_to_number");
  assert.equal(tool.params.transfers.length, 2);
  const [alex, delia] = tool.params.transfers;
  assert.deepEqual(alex.transfer_destination, { type: "phone", phone_number: "+15185550102" });
  assert.equal(alex.transfer_type, "blind");
  assert.equal(alex.post_dial_digits, undefined);
  assert.match(alex.condition, /verified by verify_owner in this call, asked for Alex Buell \(menu key 2\)/);
  assert.deepEqual(delia.post_dial_digits, { type: "static", value: "ww204" });
  assert.match(delia.condition, /Delia in Accounting \(menu key 5, Accounting\)/);
  assert.equal(R.transferToolConfig(R.menuOf({ enabled: true, entries: six() }), "static"), null);
  // Everyone on one test number: one rule naming them all.
  const one = R.menuOf({ enabled: true, entries: six({ 1: "+17542795559", 2: "+17542795559", 3: "+17542795559", 4: "+17542795559", 5: "+17542795559", 6: "+17542795559" }) });
  assert.equal(one.filter((m) => m.phone).length, 6);
  assert.equal(R.transferToolConfig(one, "static").params.transfers.length, 1);
});

test("transfer mode is static: the dynamic destination fails real Twilio calls without an initiation webhook", () => {
  assert.equal(R.TRANSFER_DESTINATION_MODE, "static");
  const tool = R.transferToolConfig(R.menuOf({ enabled: true, entries: six({ 2: "518-555-0102" }) }));
  assert.doesNotMatch(JSON.stringify(tool), /\{\{/);
});

test("transfer target (dynamic, unused): no staff number in the agent config, only the variable the gated tool sets", () => {
  const menu = R.menuOf({ enabled: true, entries: six({ 2: "518-555-0102", 4: "518-555-0104" }) });
  const tool = R.transferToolConfig(menu, "dynamic");
  assert.equal(tool.params.transfers.length, 1);
  const [rule] = tool.params.transfers;
  assert.deepEqual(rule.transfer_destination, { type: "phone_dynamic_variable", phone_number: "{{owner_transfer_number}}" });
  assert.equal(rule.transfer_type, "blind");
  assert.equal(rule.post_dial_digits, undefined); // nobody has an extension
  assert.doesNotMatch(JSON.stringify(tool), /\+1518555010/);
  // With an extension anywhere, the digits come from their own variable.
  const ext = R.transferToolConfig(R.menuOf({ enabled: true, entries: six({ 5: "518-555-0105", x5: "204" }) }), "dynamic");
  assert.deepEqual(ext.params.transfers[0].post_dial_digits, { type: "dynamic", value: "{{owner_transfer_digits}}" });
  assert.equal(R.transferToolConfig(R.menuOf({ enabled: true, entries: six() }), "dynamic"), null);
  // What check_staff_availability assigns: a real number only for an available entry, "none" otherwise.
  assert.deepEqual(R.transferAssignmentValues(null), { number: "none", digits: "w" });
  assert.deepEqual(R.transferAssignmentValues({ phone: null, extension: null }), { number: "none", digits: "w" });
  assert.deepEqual(R.transferAssignmentValues({ phone: "+15185550105", extension: "204" }), { number: "+15185550105", digits: "ww204" });
  assert.deepEqual(R.transferPlaceholders(), { owner_transfer_number: "none", owner_transfer_digits: "w" });
});

// --- In the Sarah config -----------------------------------------------------------------------

function liveConfig(phones) {
  const c = L.normalizeConfig(L.defaultConfig());
  c.callTypes = c.callTypes.map((t) => (t.key === "owner_routing" ? { ...t, enabled: true, approvedBy: "Test", approvedAt: 1 } : t));
  c.routingDirectory = { ...c.routingDirectory, enabled: true, entries: six(phones) };
  return c;
}

test("off unless owner_routing is on, approved, the directory enabled and someone has a number", () => {
  assert.equal(L.ownerRoutingMenu(L.normalizeConfig(L.defaultConfig())), null);
  const c = liveConfig({ 4: "+15185550104" });
  assert.equal(L.ownerRoutingMenu(c).filter((m) => m.phone).length, 1);
  const unapproved = { ...c, callTypes: c.callTypes.map((t) => (t.key === "owner_routing" ? { key: t.key, enabled: true } : t)) };
  assert.equal(L.ownerRoutingMenu(unapproved), null);
  assert.equal(L.ownerRoutingMenu({ ...c, routingDirectory: { ...c.routingDirectory, enabled: false } }), null);
  assert.equal(L.ownerRoutingMenu(liveConfig({})), null);
  assert.equal(L.ownerRoutingStatus(c).live, true);
  assert.match(L.ownerRoutingStatus(unapproved).reason, /not approved/);
});

test("the prompt is byte-identical while the menu is off, however far it is set up", () => {
  const base = L.composeSarahSections(L.normalizeConfig(L.defaultConfig()));
  // Numbers entered and approved, but the directory switch is off: still nothing.
  const c = liveConfig({ 4: "+15185550104" });
  const offDir = { ...c, routingDirectory: { ...c.routingDirectory, enabled: false } };
  assert.deepEqual(L.composeSarahSections(offDir), base);
  // Directory on, numbers in, but the call type not approved: still nothing.
  const unapproved = { ...c, callTypes: c.callTypes.map((t) => (t.key === "owner_routing" ? { key: t.key, enabled: true } : t)) };
  assert.deepEqual(L.composeSarahSections(unapproved), base);
  // Everything on and approved, but nobody has a number yet: still nothing.
  assert.deepEqual(L.composeSarahSections(liveConfig({})), base);
  for (const s of Object.values(base)) {
    assert.doesNotMatch(s, /OWNER CALL ROUTING|check_staff_availability|transfer_to_number|take_staff_message/);
  }
});

test("while live, the prompt carries the owners-only block with only the reachable people", () => {
  const extra = L.composeSarahSections(liveConfig({ 4: "+15185550104", 5: "+15185550105" })).extra;
  assert.match(extra, /OWNER CALL ROUTING \(existing property owners only/);
  assert.match(extra, /The phone menu, word for word, ONLY after verify_owner returned verified: "Press 4 for Nina\. Press 5 for Delia in Accounting\. Or you can just say the name\."\n/);
  assert.doesNotMatch(extra, /Name the people only if they ask/);
  // Order (user, 2026-11-03): property, name (optional), email (read back), verify, THEN the menu,
  // availability, transfer. The menu is never read before verify_owner returned verified.
  const at = (s) => {
    const i = extra.indexOf(s);
    assert.ok(i >= 0, `missing: ${s}`);
    return i;
  };
  assert.ok(at("1. Ask which property they own") < at("2. Ask their name. It is optional"));
  assert.ok(at("2. Ask their name") < at("3. Ask for the email address on file"));
  assert.ok(at("3. Ask for the email address on file") < at("4. Call verify_owner with the confirmed address and email"));
  assert.ok(at("4. Call verify_owner") < at("5. Only after verify_owner returned verified"));
  assert.ok(at("5. Only after verify_owner returned verified") < at("read the phone menu as one turn"));
  assert.ok(at("read the phone menu as one turn") < at("check_staff_availability with who they asked for"));
  assert.ok(at("check_staff_availability with who they asked for") < at("call transfer_owner_call"));
  // The only place the menu is read is step 5, after verified; the old "read it as soon as they say
  // they own" step is gone, and a failed verification gets a message, never the menu.
  assert.doesNotMatch(extra, /existing owner, read the phone menu/);
  assert.match(extra, /no_match_take_message: say its say line, then step 8, with no menu\./);
  // The name is optional and never used to verify.
  assert.match(extra, /It is optional: if they would rather not say, move on\. Never used to verify\./);
  // A person named early is remembered and confirmed after verification, not asked again (rule 4).
  assert.match(extra, /If they name\s+who they want early, remember it\./);
  assert.match(extra, /if they already named who they want, confirm it \("You\s+wanted Pat Fiore, right\?"\) or go to step 6 \(rule 4\)/);
  // Keypad: a digit is a menu key only after the menu; before verification it is nothing.
  assert.match(extra, /A single keypad digit after the menu\s+is that key\./);
  assert.match(extra, /Digits before verify_owner returned verified are not a property, a key or a yes:\s+say you'll take them to the menu once they're verified, then ask for the property\./);
  // Where the address comes from (the hallucinated-address call).
  assert.ok(extra.includes(R.OWNER_ADDRESS_RULE));
  assert.match(R.OWNER_ADDRESS_RULE, /^spoken_property_address is ONLY the address the caller said in this call\. Never fill it from an example, a previous call, or a guess\. If they haven't said one, ask first\.$/);
  // A failed verification leaves a message for the person, or the team.
  assert.match(extra, /take_staff_message \(person: who they wanted, else "the team"\)/);
  assert.doesNotMatch(extra, /transfer_to_number/); // our own Twilio transfer, not ElevenLabs' blind one
  // A failed or impossible transfer never ends the call.
  assert.match(extra, /the transfer did not go through:\s+say sorry, then step 8/);
  assert.match(extra, /fails, errors or gives no answer, never end\s+the call/);
  assert.match(extra, /An email read-back\s+follows the same confirm-before-use rule as phone numbers \(rule 8\)/);
  assert.match(extra, /Never say which part failed,\s+and never say or hint at any email on file/);
  assert.match(extra, /Never transfer anyone verify_owner did not verify in this call/);
  assert.match(extra, /Not reachable by phone \(take a message\): 1: Pat Fiore, 2: Alex Buell, 3: Nikki, 6: Alyssa\./);
  assert.doesNotMatch(extra, /\+1518555010[45]/); // never a staff number in the prompt
  // The general rule stays for everything else.
  assert.match(extra, /Do not offer to connect anyone to Pat or "press 0"/);
});

test("the spoken menu is built from the directory, in order, only for people with a number", () => {
  const one = "+17542795559";
  const all = R.menuOf({ enabled: true, entries: six({ 1: one, 2: one, 3: one, 4: one, 5: one, 6: one }) });
  const MENU = "Press 1 for Pat Fiore. Press 2 for Alex Buell. Press 3 for Nikki. Press 4 for Nina. Press 5 for Delia in Accounting. Press 6 for Alyssa. Or you can just say the name.";
  assert.equal(R.spokenMenu(all), MENU);
  // Keys stay the directory position: people without a number leave a gap, never a renumbering.
  assert.equal(R.spokenMenu(R.menuOf({ enabled: true, entries: six({ 1: one, 4: one }) })), "Press 1 for Pat Fiore. Press 4 for Nina. Or you can just say the name.");
  assert.equal(R.spokenMenu(R.menuOf({ enabled: true, entries: six({ 4: one }) })), "Press 4 for Nina. Or you can just say the name.");
  // Nobody with a number: no menu at all.
  assert.equal(R.spokenMenu(R.menuOf({ enabled: true, entries: six() })), "");
  // In the live prompt: the menu once, the step that reads it, and nobody "not reachable".
  const s = L.composeSarahSections(liveConfig({ 1: one, 2: one, 3: one, 4: one, 5: one, 6: one }));
  assert.ok(s.extra.includes(`The phone menu, word for word, ONLY after verify_owner returned verified: "${MENU}"`));
  assert.equal(s.extra.split(MENU).length, 2);
  assert.doesNotMatch(s.extra, /Not reachable by phone/);
  assert.match(s.extra, /Otherwise read the phone menu as one turn,\s+then stop and wait\. Never read it twice in a call unless asked\./);
  // The HARD RULES let the menu through rules 2 and 5, top and bottom, only while it is live.
  assert.match(s.top, /the OWNER CALL ROUTING phone menu is read once as written \(rules 2 and 5 do not\nforbid any of these\)\./);
  assert.doesNotMatch(s.top, /returns \(rule 2 does not forbid any of these\)/);
  assert.match(s.bottom, /check_work_order_status's request choices and the owner phone menu are the only exceptions/);
  assert.notEqual(s.top, L.HARD_RULES);
  assert.notEqual(s.bottom, L.HARD_RULES_REMINDER);
  const off = L.composeSarahSections(L.normalizeConfig(L.defaultConfig()));
  assert.equal(off.top, L.HARD_RULES);
  assert.equal(off.bottom, L.HARD_RULES_REMINDER);
  assert.doesNotMatch(off.top + off.bottom, /phone menu/);
});

test("validateConfigShape throws the same specific message as the editor", () => {
  const c = liveConfig({ 4: "+15185550199" });
  assert.throws(() => L.validateConfigShape(c, { ownLines: ["+15185550199"] }), (e) => /Nina: that is Sarah's own phone line/.test(String(e.data)));
  assert.doesNotThrow(() => L.validateConfigShape(liveConfig({ 4: "+15185550104" }), { ownLines: ["+15185550199"] }));
  assert.doesNotThrow(() => L.validateConfigShape(L.normalizeConfig(L.defaultConfig())));
});

test("normalizing an entry stores E.164, digit extensions and canonical hours", () => {
  assert.deepEqual(R.normalizeRoutingEntry({ label: " Nina ", phone: "(518) 555-0104", extension: "ext 12", hours: "mon-fri 09:00-17:00" }), {
    label: "Nina",
    phone: "+15185550104",
    extension: "12",
    hours: "Mon-Fri 09:00-17:00",
  });
  assert.deepEqual(R.normalizeRoutingEntry({ label: "Pat", phone: "", extension: "", hours: "" }), { label: "Pat", phone: "" });
});

// --- Our own Twilio transfer (TRANSFER_MECHANISM "twilio_dial") -----------------------------------

test("transfer mechanism is our own Twilio dial: ElevenLabs' blind transfer drops the caller on busy/no answer", () => {
  assert.equal(R.TRANSFER_MECHANISM, "twilio_dial");
  assert.ok(R.OWNER_TRANSFER_DELAY_MS >= 3000);
  assert.ok(R.CALL_SID_RE.test("CA5a4b91fc3a18231aa827c45e19159bff"));
  assert.ok(!R.CALL_SID_RE.test(""));
  assert.ok(!R.CALL_SID_RE.test("CA5a4b91fc3a18231aa827c45e19159bff/../x"));
});

test("dial TwiML: Sarah's number as caller ID, a ring timeout, an action URL, extension only when real", () => {
  const x = R.ownerDialTwiml({
    number: "+15185550102",
    digits: "w",
    callerId: "+12232504974",
    actionUrl: "https://example.convex.site/twilio/owner-transfer-result?c=conv_1&x=<y>",
  });
  assert.match(x, /<Dial callerId="\+12232504974" timeout="20" action="https:\/\/example\.convex\.site\/twilio\/owner-transfer-result\?c=conv_1&amp;x=&lt;y&gt;" method="POST">/);
  assert.match(x, /<Number>\+15185550102<\/Number>/); // a bare pause sends no digits
  const ext = R.ownerDialTwiml({ number: "+15185550105", digits: "ww204", callerId: "+12232504974", actionUrl: "https://a.b/c" });
  assert.match(ext, /<Number sendDigits="ww204">\+15185550105<\/Number>/);
});

test("a busy or unanswered transfer keeps the caller on the line with a voicemail; answered hangs up", () => {
  assert.ok(R.dialAnswered("completed"));
  assert.ok(R.dialAnswered("answered"));
  for (const s of ["busy", "no-answer", "failed", "canceled", "", null, undefined]) assert.ok(!R.dialAnswered(s));
  const f = R.ownerTransferFallbackTwiml({ label: "Pat Fiore (Owner)", voicemailUrl: "https://a.b/twilio/owner-voicemail?c=conv_1" });
  assert.match(f, /^<\?xml/);
  assert.match(f, /Pat Fiore couldn't take your call right now/);
  assert.doesNotMatch(f, /\(Owner\)/);
  assert.match(f, /<Record maxLength="120" [^>]*action="https:\/\/a\.b\/twilio\/owner-voicemail\?c=conv_1"/);
  assert.ok(f.indexOf("<Record") < f.lastIndexOf("<Say")); // silence after the tone still hears a closing line
  assert.match(R.ownerTransferFallbackTwiml({ label: null, voicemailUrl: "https://a.b/v" }), /the team couldn't take your call/);
  assert.match(R.ownerVoicemailThanksTwiml("Delia & Co"), /saved for Delia &amp; Co/);
  assert.match(R.hangupTwiml(), /<Hangup\/>/);
});
