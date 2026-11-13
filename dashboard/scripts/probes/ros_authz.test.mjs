// Authorization tests for the Rental Owner Statement (ROS) backend (spec 9.4). No packages.
// From dashboard/:
//   node --test scripts/probes/ros_authz.test.mjs
// The finance gate is server-side: every exported query/mutation/action in the finance files must
// call requireFinance(ctx) as its FIRST await (so before any ctx.db read or write), and nothing
// internal may be exported without a comment saying why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const { canUseFinanceView } = await import("../../convex/rosPolicy.ts");

const CONVEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex");
const read = (name) => readFileSync(join(CONVEX, name), "utf8");

// WP2 files (must exist) and WP3's workOrderBilling.ts (scanned once it exists).
const WP2_FILES = ["ledgerAccounts.ts", "owners.ts", "ledger.ts", "ownerStatements.ts"];
const WP3_FILE = "workOrderBilling.ts";
// Management fee settings (2026-11-11): feeSettings.ts is gated like the WP2 files; feeMigration.ts
// exports only an internal mutation (checked for its "why" comment).
const FEE_FILES = ["feeSettings.ts"];
// Rent payments (2026-11-12): rentPayments.ts is gated like the WP2 files; its logic lives in
// rentPaymentsLib.ts, which registers nothing and checks every record against the caller's org.
const PAYMENT_FILES = ["rentPayments.ts"];
// Rent history (2026-11-13): unitRent.ts (changeRent, history) is gated the same way: admin view +
// accountant change rent; asset managers and technicians are refused.
const RENT_HISTORY_FILES = ["unitRent.ts"];
const SCANNED = [...WP2_FILES, ...FEE_FILES, ...PAYMENT_FILES, ...RENT_HISTORY_FILES, ...(existsSync(join(CONVEX, WP3_FILE)) ? [WP3_FILE] : [])];

/** Each top-level `export const X = query|mutation|action(` with its text up to the next top-level export. */
function registeredFunctions(src) {
  const re = /^export const (\w+) = (query|mutation|action|internalQuery|internalMutation|internalAction)\(/gm;
  const starts = [...src.matchAll(re)].map((m) => ({ name: m[1], kind: m[2], index: m.index }));
  const exportsAt = [...src.matchAll(/^export /gm)].map((m) => m.index);
  return starts.map((s) => {
    const end = exportsAt.find((i) => i > s.index) ?? src.length;
    return { ...s, body: src.slice(s.index, end) };
  });
}

test("canUseFinanceView: admin and accountant only", () => {
  assert.equal(canUseFinanceView("admin"), true);
  assert.equal(canUseFinanceView("accountant"), true);
  assert.equal(canUseFinanceView("asset_manager"), false);
  assert.equal(canUseFinanceView("technician"), false);
  assert.equal(canUseFinanceView("none"), false);
  assert.equal(canUseFinanceView(""), false);
});

test("FINANCE_DENIED wording", () => {
  const src = read("financeAccess.ts");
  assert.match(src, /export const FINANCE_DENIED = "You don't have access to owner statements\.";/);
  assert.match(src, /if \(!canUseFinance\(org\)\) throw new ConvexError\(FINANCE_DENIED\);/);
});

for (const file of SCANNED) {
  test(`${file}: every exported query/mutation/action calls requireFinance(ctx) first`, () => {
    const src = read(file);
    const fns = registeredFunctions(src).filter((f) => !f.kind.startsWith("internal"));
    assert.ok(fns.length > 0, `${file} exports no functions`);
    for (const f of fns) {
      const handlerAt = f.body.search(/handler:\s*async\s*\(/);
      assert.ok(handlerAt >= 0, `${file} ${f.name}: no async handler`);
      const handler = f.body.slice(handlerAt);
      const gate = handler.indexOf("requireFinance(ctx");
      assert.ok(gate >= 0, `${file} ${f.name}: does not call requireFinance(ctx)`);
      const firstAwait = handler.indexOf("await ");
      assert.equal(handler.slice(firstAwait, firstAwait + "await requireFinance(ctx".length), "await requireFinance(ctx", `${file} ${f.name}: requireFinance(ctx) is not the first await`);
      const db = handler.indexOf("ctx.db");
      assert.ok(db === -1 || gate < db, `${file} ${f.name}: ctx.db is used before requireFinance(ctx)`);
      const helperCall = handler.search(/\b(?!requireFinance)\w+\(ctx\b/);
      assert.ok(helperCall === -1 || helperCall > gate, `${file} ${f.name}: a ctx helper runs before requireFinance`);
    }
  });

  test(`${file}: nothing internal is exported without a comment saying why`, () => {
    const src = read(file);
    for (const f of registeredFunctions(src).filter((x) => x.kind.startsWith("internal"))) {
      const before = src.slice(Math.max(0, f.index - 400), f.index);
      assert.match(before, /\/\/[^\n]*\n\s*$|\*\/\s*$/, `${file} ${f.name}: exported ${f.kind} has no comment saying why`);
    }
  });
}

test("feeMigration.ts: internal only, with a comment saying why", () => {
  const src = read("feeMigration.ts");
  const fns = registeredFunctions(src);
  assert.deepStrictEqual(fns.map((f) => f.kind), ["internalMutation"]);
  const before = src.slice(Math.max(0, fns[0].index - 400), fns[0].index);
  assert.match(before, /\*\/\s*$/);
});

test("feeSettingsLib.ts registers no Convex function (helpers only)", () => {
  const src = read("feeSettingsLib.ts");
  assert.doesNotMatch(src, /\b(query|mutation|action|internalQuery|internalMutation|internalAction)\(\{/);
  assert.doesNotMatch(src, /^import \{[^}]*\} from "\.\/_generated\/server"/m);
});

test("rentPaymentsLib.ts / rentPaymentsPolicy.ts register no Convex function; the lib checks the org", () => {
  for (const f of ["rentPaymentsLib.ts", "rentPaymentsPolicy.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /\b(query|mutation|action|internalQuery|internalMutation|internalAction)\(\{/, f);
    assert.doesNotMatch(src, /^import \{[^}]*\} from "\.\/_generated\/server"/m, f);
  }
  const lib = read("rentPaymentsLib.ts");
  assert.match(lib, /orgId === org\.orgId/);
  assert.match(lib, /orgId !== org\.orgId/);
});

test("WP2 files exist and rosBuild registers no Convex function", () => {
  for (const f of [...WP2_FILES, "rosBuild.ts"]) assert.ok(existsSync(join(CONVEX, f)), `${f} is missing`);
  const src = read("rosBuild.ts");
  assert.doesNotMatch(src, /\b(query|mutation|action|internalQuery|internalMutation|internalAction)\(\{/);
  // Only `import type` from the generated server module: it is a helper, not a registered function.
  assert.doesNotMatch(src, /^import \{[^}]*\} from "\.\/_generated\/server"/m);
});

test("every record read by id is checked against the caller's org", () => {
  // Each finance file compares orgId on what it loads, so another team's id reads as "not found".
  for (const file of WP2_FILES) {
    const src = read(file);
    assert.match(src, /orgId !== org\.orgId|orgId === org\.orgId/, `${file} never checks orgId`);
  }
});

const hasForTechnician = /function forTechnician\s*\(/.test(read("workOrders.ts"));
test(
  "technician strip: workOrders.ts forTechnician removes all seven billing keys",
  { todo: hasForTechnician ? false : "WP3 has not added forTechnician to workOrders.ts yet" },
  () => {
    const src = read("workOrders.ts");
    assert.match(src, /function forTechnician\s*\(/);
    const at = src.search(/function forTechnician\s*\(/);
    // The key list lives in forTechnician or in a constant next to it.
    const around = src.slice(Math.max(0, at - 1500), at + 1500);
    for (const key of ["billAmountCents", "costCents", "rosAccountId", "billedStatementId", "billedLedgerEntryId", "billedAt", "noOwnerCharge"]) {
      assert.ok(around.includes(key), `forTechnician does not strip ${key}`);
    }
  },
);
