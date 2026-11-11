// Review fix 4: default ledger accounts the accountant deleted or renamed must not come back when a
// work order is closed (workOrderBilling.seedAccounts) or the close form calls ensureAccounts.
// Both now go through ledgerAccountSeed.seedIfNeeded, the same rule as ledgerAccounts.ensureSeeded.
// No packages. From dashboard/:
//   node --test scripts/probes/ros_seed.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

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
const S = await import("../../convex/ledgerAccountSeed.ts");
const { normalizeNameKey } = await import("../../convex/rosFormat.ts");

/** A fake ctx.db over one org's ledgerAccounts (by_org and by_org_and_name_key). */
function fakeCtx(rows) {
  return {
    db: {
      query: () => ({
        withIndex: (_name, fn) => {
          const conds = [];
          const b = { eq: (f, v) => (conds.push((r) => r[f] === v), b) };
          fn(b);
          const hit = rows.filter((r) => conds.every((c) => c(r)));
          return { collect: async () => hit, first: async () => hit[0] ?? null };
        },
      }),
      insert: async (_t, doc) => {
        rows.push(doc);
        return `new_${rows.length}`;
      },
    },
  };
}

const seeded = () =>
  S.DEFAULT_ACCOUNTS.map((a) => ({ ...a, orgId: "org1", nameKey: normalizeNameKey(a.name), active: true }));

test("a deleted Pest Control and a renamed Landscaping survive closing a work order", async () => {
  // After setup the accountant DELETED "Pest Control" and RENAMED "Landscaping" -> "Lawn Care".
  const rows = seeded()
    .filter((a) => a.name !== "Pest Control")
    .map((a) => (a.name === "Landscaping" ? { ...a, name: "Lawn Care", nameKey: normalizeNameKey("Lawn Care") } : a));
  const before = rows.map((r) => r.name).sort();
  assert.equal(S.needsAccountSetup(rows), false);
  // reviewClose -> seedAccounts -> seedIfNeeded, twice (a second close)
  assert.deepStrictEqual(await S.seedIfNeeded(fakeCtx(rows), "org1"), []);
  assert.deepStrictEqual(await S.seedIfNeeded(fakeCtx(rows), "org1"), []);
  assert.deepStrictEqual(rows.map((r) => r.name).sort(), before);
  assert.ok(!rows.some((r) => r.name === "Pest Control" || r.name === "Landscaping"));
});

test("a new org (or one missing a system account) still gets the defaults", async () => {
  const empty = [];
  assert.equal(S.needsAccountSetup(empty), true);
  const inserted = await S.seedIfNeeded(fakeCtx(empty), "org1");
  assert.deepStrictEqual(inserted, S.DEFAULT_ACCOUNTS.map((a) => a.name));
  assert.equal(S.needsAccountSetup(empty), false);
  assert.deepStrictEqual(await S.seedIfNeeded(fakeCtx(empty), "org1"), []);

  const noRepairs = seeded().filter((a) => a.systemKey !== "repairs");
  assert.equal(S.needsAccountSetup(noRepairs), true);
  assert.deepStrictEqual(await S.seedIfNeeded(fakeCtx(noRepairs), "org1"), ["Repairs"]);
});

test("every seeding path uses the gated helper (no direct ensureDefaultAccounts call left)", () => {
  const read = (f) => readFileSync(new URL(`../../convex/${f}`, import.meta.url), "utf8");
  for (const f of ["workOrderBilling.ts", "ledgerAccounts.ts", "workOrders.ts", "ownerStatements.ts"]) {
    assert.ok(!/ensureDefaultAccounts\s*\(/.test(read(f)), `${f} calls ensureDefaultAccounts directly`);
  }
  assert.match(read("workOrderBilling.ts"), /seedIfNeeded\(ctx, org\.orgId\)/);
  assert.match(read("workOrderBilling.ts"), /needsSetup: needsAccountSetup\(rows\)/);
  assert.match(read("ledgerAccounts.ts"), /seedIfNeeded\(ctx, org\.orgId\)/);
});
