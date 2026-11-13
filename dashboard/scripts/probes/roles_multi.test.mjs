// Multi-role members (B31). No packages, nothing sent, no deployment touched.
// From dashboard/:
//   node --test scripts/probes/roles_multi.test.mjs
//
// 1. Pure rules (convex/roleSet.ts): rolesFor / hasRole / appRolesOf / primaryView / checkRoles /
//    storageForRoles, and proof that viewFor and isAdminView are unchanged from the old one-view rule.
// 2. Authz matrix: the REAL Convex handlers (registered `_handler`s) run against an in-memory
//    database for every persona. Each single-role persona must get exactly what the old rule gave,
//    each combination exactly the union of its roles, and no role must get nothing.
// 3. Source scan: no server permission may still be decided by "the one view" (viewFor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
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

const R = await import("../../convex/roleSet.ts");
const A = await import("../../convex/authz.ts");
const F = await import("../../convex/financeAccess.ts");
const J = await import("../../convex/jobRoles.ts");
const WO = await import("../../convex/workOrders.ts");
const MT = await import("../../convex/maintenance.ts");
const BOARD = await import("../../convex/board.ts");
const RES = await import("../../convex/residents.ts");
const PROP = await import("../../convex/properties.ts");
const DASH = await import("../../convex/dashboard.ts");
const LEDGER = await import("../../convex/ledgerAccounts.ts");
const TEN = await import("../../convex/tenants.ts");
const TEAM = await import("../../convex/team.ts");
const UNITS = await import("../../convex/units.ts");

const CONVEX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "convex");

// --- 1. Pure rules -------------------------------------------------------------------------------

const JOB_ROLES = ["executive", "maintenance_lead", "asset_manager", "technician", "accountant", "simplr_admin"];

/** The OLD one-view rule, verbatim (authz.viewFor before B31). */
function oldViewFor(isAdmin, jobRoles) {
  if (isAdmin || jobRoles.includes("simplr_admin") || jobRoles.includes("executive") || jobRoles.includes("maintenance_lead")) {
    return "admin";
  }
  if (jobRoles.includes("asset_manager")) return "asset_manager";
  if (jobRoles.includes("technician")) return "technician";
  if (jobRoles.includes("accountant")) return "accountant";
  return "none";
}

/** Every subset of the job roles, with and without the team admin flag. */
function allMemberships() {
  const out = [];
  for (let mask = 0; mask < 1 << JOB_ROLES.length; mask++) {
    const jobRoles = JOB_ROLES.filter((_, i) => mask & (1 << i));
    out.push({ isAdmin: false, jobRoles }, { isAdmin: true, jobRoles });
  }
  return out;
}

test("viewFor and isAdminView are unchanged for every membership", () => {
  for (const m of allMemberships()) {
    assert.equal(A.viewFor(m.isAdmin, m.jobRoles), oldViewFor(m.isAdmin, m.jobRoles), JSON.stringify(m));
    assert.equal(A.isAdminView(m), oldViewFor(m.isAdmin, m.jobRoles) === "admin", JSON.stringify(m));
    assert.equal(A.canManageMaintenance(m), oldViewFor(m.isAdmin, m.jobRoles) === "admin", JSON.stringify(m));
  }
});

test("rolesFor: Admin is exclusive, the other three combine", () => {
  assert.deepEqual([...R.rolesFor(true, [])], ["admin"]);
  assert.deepEqual([...R.rolesFor(false, ["simplr_admin", "asset_manager"])], ["admin"]);
  assert.deepEqual([...R.rolesFor(false, ["executive"])], ["admin"]);
  assert.deepEqual([...R.rolesFor(false, ["maintenance_lead", "accountant"])], ["admin"]);
  assert.deepEqual([...R.rolesFor(false, ["accountant", "asset_manager"])], ["asset_manager", "accountant"]);
  assert.deepEqual([...R.rolesFor(false, ["technician", "accountant", "asset_manager"])], ["asset_manager", "technician", "accountant"]);
  assert.deepEqual([...R.rolesFor(false, [])], []);
  assert.deepEqual([...R.rolesFor(false, null)], []);
  // A single-role person holds exactly the role their old view was.
  for (const m of allMemberships()) {
    const view = oldViewFor(m.isAdmin, m.jobRoles);
    const roles = R.rolesFor(m.isAdmin, m.jobRoles);
    if (roles.size <= 1) assert.deepEqual([...roles], view === "none" ? [] : [view], JSON.stringify(m));
    assert.equal(R.primaryView(roles), view, JSON.stringify(m));
  }
});

test("hasRole / hasAnyRole", () => {
  const delia = { isAdmin: false, jobRoles: ["asset_manager", "accountant"] };
  assert.equal(R.hasRole(delia, "asset_manager"), true);
  assert.equal(R.hasRole(delia, "accountant"), true);
  assert.equal(R.hasRole(delia, "technician"), false);
  assert.equal(R.hasRole(delia, "admin"), false);
  assert.equal(R.hasAnyRole(delia, "admin", "accountant"), true);
  assert.equal(R.hasAnyRole(delia, "admin", "technician"), false);
  const admin = { isAdmin: true, jobRoles: ["asset_manager"] };
  assert.equal(R.hasRole(admin, "admin"), true);
  // An Admin is never "also an asset manager" (old rule: admin view, never the AM branches).
  assert.equal(R.hasRole(admin, "asset_manager"), false);
  assert.equal(R.hasAnyRole({ isAdmin: false, jobRoles: [] }, "admin", "asset_manager", "technician", "accountant"), false);
});

test("appRolesOf / appRoleOf", () => {
  assert.deepEqual(R.appRolesOf("member", ["accountant", "asset_manager"]), ["asset_manager", "accountant"]);
  assert.deepEqual(R.appRolesOf("admin", ["technician"]), ["admin"]);
  assert.deepEqual(R.appRolesOf("member", []), []);
  assert.equal(J.appRoleOf("member", ["accountant", "asset_manager"]), "asset_manager");
  assert.equal(J.appRoleOf("member", []), null);
  for (const m of allMemberships()) {
    const view = oldViewFor(m.isAdmin, m.jobRoles);
    assert.equal(J.appRoleOf(m.isAdmin ? "admin" : "member", m.jobRoles), view === "none" ? null : view);
  }
});

test("checkRoles: validation and exact messages", () => {
  assert.deepEqual(R.checkRoles([]), { ok: false, error: "Pick at least one role for this person." });
  assert.deepEqual(R.checkRoles(null), { ok: false, error: "Pick at least one role for this person." });
  assert.deepEqual(R.checkRoles(undefined), { ok: false, error: "Pick at least one role for this person." });
  assert.deepEqual(R.checkRoles(["", "  "]), { ok: false, error: "Pick at least one role for this person." });
  assert.deepEqual(R.checkRoles(["admin", "accountant"]), {
    ok: false,
    error: "Admin already includes every role — remove the others or untick Admin.",
  });
  assert.deepEqual(R.checkRoles(["owner"]), {
    ok: false,
    error: "Pick a valid role: Admin, Asset manager, Technician or Accountant.",
  });
  assert.deepEqual(R.checkRoles([42]), {
    ok: false,
    error: "Pick a valid role: Admin, Asset manager, Technician or Accountant.",
  });
  assert.deepEqual(R.checkRoles(["admin"]), { ok: true, roles: ["admin"] });
  assert.deepEqual(R.checkRoles(["accountant", "asset_manager", "accountant"]), { ok: true, roles: ["asset_manager", "accountant"] });
  assert.deepEqual(R.checkRoles([" technician "]), { ok: true, roles: ["technician"] });
  // Server wrapper throws the same wording as a ConvexError.
  assert.throws(() => J.parseAppRoles([]), (e) => e.data === "Pick at least one role for this person.");
  assert.throws(
    () => J.parseAppRoles(["admin", "technician"]),
    (e) => e.data === "Admin already includes every role — remove the others or untick Admin.",
  );
  assert.deepEqual(J.parseAppRoles(["technician", "asset_manager"]), ["asset_manager", "technician"]);
});

test("storageForRoles: single roles are stored exactly as before (jobRolesFor)", () => {
  for (const r of ["admin", "asset_manager", "technician", "accountant"]) {
    assert.deepEqual(R.storageForRoles([r]), J.jobRolesFor(r), r);
  }
  assert.deepEqual(R.storageForRoles(["asset_manager", "accountant"]), { role: "member", jobRoles: ["asset_manager", "accountant"] });
  // Round trip: what is stored reads back as the same role set.
  for (const roles of [["asset_manager", "accountant"], ["technician", "accountant"], ["asset_manager", "technician", "accountant"], ["admin"]]) {
    const s = R.storageForRoles(roles);
    assert.deepEqual(R.appRolesOf(s.role, s.jobRoles), roles);
  }
});

// --- 2. Authz matrix against the real handlers -----------------------------------------------------

/** Minimal in-memory Convex db: index ranges (eq/gt/gte/lt/lte), filter, order, take, first, unique, get. */
function makeDb(tables) {
  const all = () => Object.values(tables).flat();
  const rangeBuilder = (preds) => {
    const b = {
      eq: (f, v) => (preds.push((r) => r[f] === v), b),
      gt: (f, v) => (preds.push((r) => r[f] > v), b),
      gte: (f, v) => (preds.push((r) => r[f] >= v), b),
      lt: (f, v) => (preds.push((r) => r[f] < v), b),
      lte: (f, v) => (preds.push((r) => r[f] <= v), b),
    };
    return b;
  };
  const filterBuilder = {
    field: (name) => ({ __field: name }),
    eq: (a, b) => ({ __op: "eq", a, b }),
    neq: (a, b) => ({ __op: "neq", a, b }),
    and: (...xs) => ({ __op: "and", xs }),
    or: (...xs) => ({ __op: "or", xs }),
    not: (x) => ({ __op: "not", x }),
  };
  const evalExpr = (e, row) => {
    if (e && typeof e === "object" && "__field" in e) return row[e.__field];
    if (e && typeof e === "object" && "__op" in e) {
      switch (e.__op) {
        case "eq": return evalExpr(e.a, row) === evalExpr(e.b, row);
        case "neq": return evalExpr(e.a, row) !== evalExpr(e.b, row);
        case "and": return e.xs.every((x) => evalExpr(x, row));
        case "or": return e.xs.some((x) => evalExpr(x, row));
        case "not": return !evalExpr(e.x, row);
      }
    }
    return e;
  };
  class Query {
    constructor(rows) {
      this.rows = rows;
    }
    withIndex(_name, fn) {
      if (!fn) return this;
      const preds = [];
      fn(rangeBuilder(preds));
      return new Query(this.rows.filter((r) => preds.every((p) => p(r))));
    }
    withSearchIndex() {
      return this;
    }
    filter(fn) {
      const expr = fn(filterBuilder);
      return new Query(this.rows.filter((r) => evalExpr(expr, r)));
    }
    order(dir) {
      const rows = [...this.rows].sort((a, b) => a._creationTime - b._creationTime);
      return new Query(dir === "desc" ? rows.reverse() : rows);
    }
    async collect() {
      return [...this.rows];
    }
    async take(n) {
      return this.rows.slice(0, n);
    }
    async first() {
      return this.rows[0] ?? null;
    }
    async unique() {
      return this.rows[0] ?? null;
    }
    async paginate() {
      return { page: [...this.rows], isDone: true, continueCursor: "" };
    }
    async *[Symbol.asyncIterator]() {
      for (const r of this.rows) yield r;
    }
  }
  return {
    query: (t) => new Query(tables[t] ?? []),
    get: async (id) => all().find((r) => r._id === id) ?? null,
    normalizeId: (t, id) => ((tables[t] ?? []).some((r) => r._id === id) ? id : null),
    system: { get: async () => null, query: () => new Query([]) },
  };
}

let seq = 0;
const row = (id, fields) => ({ _id: id, _creationTime: ++seq, ...fields });

/** The world: caller C (roles vary), another AM M2. U1 is C's unit, U2 is M2's. */
function world(callerRole, callerJobRoles) {
  const now = Date.now();
  const org = "org1";
  const users = [
    row("uC", { clerkId: "clerk_C", email: "c@example.com", firstName: "Cal" }),
    row("uM2", { clerkId: "clerk_M2", email: "m2@example.com", firstName: "Mo" }),
    row("uT2", { clerkId: "clerk_T2", email: "t2@example.com", firstName: "Ty" }),
  ];
  const memberships = [
    row("mC", { orgId: org, userId: "uC", role: callerRole, jobRoles: callerJobRoles, createdAt: now }),
    row("mM2", { orgId: org, userId: "uM2", role: "member", jobRoles: ["asset_manager"], createdAt: now }),
    row("mT2", { orgId: org, userId: "uT2", role: "member", jobRoles: ["technician"], createdAt: now }),
  ];
  const properties = [
    row("P1", { orgId: org, name: "One", ownerName: "Owner One", updatedAt: now }),
    row("P2", { orgId: org, name: "Two", ownerName: "Owner Two", updatedAt: now }),
  ];
  const units = [
    row("U1", { orgId: org, propertyId: "P1", unitNumber: "1A", assetManagerUserId: "uC" }),
    row("U2", { orgId: org, propertyId: "P2", unitNumber: "2A", assetManagerUserId: "uM2" }),
  ];
  const wo = (id, unitId, propertyId, status, tech, number) =>
    row(id, {
      orgId: org,
      unitId,
      propertyId,
      status,
      technicianUserId: tech,
      number,
      title: `Job ${id}`,
      scope: "Fix",
      priority: "routine",
      createdAt: now,
      updatedAt: now,
      completedAt: status === "completed" ? now : undefined,
      tenantPreferredTime: "mornings",
      billAmountCents: 5000,
      costCents: 3000,
    });
  const workOrders = [
    wo("WO1", "U1", "P1", "assigned", "uC", 1), // C's unit, C is the technician
    wo("WO2", "U2", "P2", "completed", "uT2", 2), // finished work elsewhere
    wo("WO3", "U2", "P2", "assigned", "uC", 3), // C's technician job on someone else's unit
    wo("WO4", "U2", "P2", "in_progress", "uT2", 4), // nothing to do with C
  ];
  const residents = [
    row("R1", { orgId: org, unitId: "U1", fullName: "Rae One", phones: [], active: true }),
    row("R2", { orgId: org, unitId: "U2", fullName: "Rex Two", phones: [], active: true }),
  ];
  const req = (id, unitId, propertyId, am, number) =>
    row(id, {
      orgId: org,
      unitId,
      propertyId,
      assignedAssetManagerUserId: am,
      status: "new",
      severity: "routine",
      description: `Issue ${id}`,
      number,
      createdAt: now,
      updatedAt: now,
      source: "phone",
    });
  const maintenanceRequests = [req("MR1", "U1", "P1", "uC", 1), req("MR2", "U2", "P2", "uM2", 2)];
  return { users, memberships, properties, units, workOrders, residents, maintenanceRequests, organizations: [row(org, { name: "Team" })] };
}

function ctxFor(tables) {
  return {
    db: makeDb(tables),
    auth: { getUserIdentity: async () => ({ subject: "clerk_C" }) },
    storage: { getUrl: async () => "https://example.invalid/file" },
  };
}

const PERSONAS = {
  none: { role: "member", jobRoles: [], roles: [] },
  admin: { role: "admin", jobRoles: ["executive", "maintenance_lead"], roles: ["admin"] },
  am: { role: "member", jobRoles: ["asset_manager"], roles: ["asset_manager"] },
  tech: { role: "member", jobRoles: ["technician"], roles: ["technician"] },
  acc: { role: "member", jobRoles: ["accountant"], roles: ["accountant"] },
  "am+acc": { role: "member", jobRoles: ["asset_manager", "accountant"], roles: ["asset_manager", "accountant"] },
  "am+tech": { role: "member", jobRoles: ["asset_manager", "technician"], roles: ["asset_manager", "technician"] },
  "tech+acc": { role: "member", jobRoles: ["technician", "accountant"], roles: ["technician", "accountant"] },
  "am+tech+acc": { role: "member", jobRoles: ["asset_manager", "technician", "accountant"], roles: ["asset_manager", "technician", "accountant"] },
};

/**
 * What each SINGLE role could reach before B31 (the old per-view rules), per capability. A
 * combination must reach exactly the union of its roles; no role reaches nothing.
 */
const OLD_SINGLE = {
  workOrders: { admin: ["WO1", "WO2", "WO3", "WO4"], asset_manager: ["WO1"], technician: ["WO1", "WO3"], accountant: ["WO2"] },
  residents: { admin: ["R1", "R2"], asset_manager: ["R1"], technician: [], accountant: ["R1", "R2"] },
  properties: { admin: ["P1", "P2"], asset_manager: ["P1"], technician: [], accountant: ["P1", "P2"] },
  units: { admin: ["U1", "U2"], asset_manager: ["U1"], technician: [], accountant: ["U1", "U2"] },
  requests: { admin: ["MR1", "MR2"], asset_manager: ["MR1"], technician: [], accountant: [] },
  finance: { admin: true, asset_manager: false, technician: false, accountant: true },
  amDashboard: { admin: false, asset_manager: true, technician: false, accountant: false },
};

const unionOf = (cap, roles) => {
  const vals = roles.map((r) => OLD_SINGLE[cap][r]);
  if (typeof OLD_SINGLE[cap].admin === "boolean") return vals.some(Boolean);
  return [...new Set(vals.flat())].sort();
};

async function run(fn, ctx, args = {}) {
  try {
    return { ok: true, value: await fn._handler(ctx, args) };
  } catch (e) {
    return { ok: false, error: e?.data ?? e?.message };
  }
}

for (const [name, p] of Object.entries(PERSONAS)) {
  test(`authz matrix: ${name}`, async () => {
    const ctx = ctxFor(world(p.role, p.jobRoles));
    const ids = (rows) => rows.map((r) => r._id).sort();

    // Work orders: list and detail, plus the shape each reach gives.
    const list = await run(WO.list, ctx, {});
    assert.ok(list.ok, `${name} workOrders.list: ${list.error}`);
    assert.deepEqual(ids(list.value), unionOf("workOrders", p.roles), `${name} workOrders.list`);
    for (const id of ["WO1", "WO2", "WO3", "WO4"]) {
      const got = await run(WO.get, ctx, { workOrderId: id });
      assert.ok(got.ok, `${name} workOrders.get ${id}: ${got.error}`);
      assert.equal(got.value !== null, unionOf("workOrders", p.roles).includes(id), `${name} workOrders.get ${id}`);
      if (!got.value) continue;
      const w = got.value.workOrder;
      const reachFull = p.roles.includes("admin") || (p.roles.includes("asset_manager") && id === "WO1");
      const reachAcc = p.roles.includes("accountant") && id === "WO2";
      const reachTech = p.roles.includes("technician") && (id === "WO1" || id === "WO3");
      // A technician-only reach never gets billing; any wider reach does.
      assert.equal("billAmountCents" in w, reachFull || reachAcc, `${name} ${id} billing keys`);
      assert.equal(got.value.billing === null, !(reachFull || reachAcc), `${name} ${id} billing view`);
      // The tenant's preferred time: everyone but an accountant-only reach.
      assert.equal(w.tenantPreferredTime !== undefined, reachFull || reachTech, `${name} ${id} tenantPreferredTime`);
      // Internal history (audit) only for admin / the unit's AM.
      assert.equal(Array.isArray(got.value.audit), true);
      // Technician "work" powers only on their own job.
      assert.equal(got.value.viewerCan.work, reachTech, `${name} ${id} viewerCan.work`);
      assert.equal(got.value.viewerCan.manage, p.roles.includes("admin"), `${name} ${id} viewerCan.manage`);
    }

    // Board drawer: admin / AM reach only (technician and accountant reaches use workOrders.get).
    for (const id of ["WO1", "WO2", "WO3", "WO4"]) {
      const d = await run(BOARD.detail, ctx, { kind: "work_order", id });
      assert.ok(d.ok, `${name} board.detail ${id}: ${d.error}`);
      const full = p.roles.includes("admin") || (p.roles.includes("asset_manager") && id === "WO1");
      assert.equal(d.value !== null, full, `${name} board.detail ${id}`);
    }

    // Residents.
    const res = await run(RES.list, ctx, {});
    assert.ok(res.ok, `${name} residents.list: ${res.error}`);
    assert.deepEqual(ids(res.value), unionOf("residents", p.roles), `${name} residents.list`);

    // Properties (buildings) and owner details: owner fields only where a non-AM-scoped role reads.
    const props = await run(PROP.list, ctx, {});
    assert.ok(props.ok, `${name} properties.list: ${props.error}`);
    assert.deepEqual(ids(props.value), unionOf("properties", p.roles), `${name} properties.list`);
    // Owner contact details: hidden only from a pure asset manager (old AM rule); any role that reads
    // every building (admin, accountant) brings them.
    const seesOwners = p.roles.includes("admin") || p.roles.includes("accountant");
    for (const prop of props.value) assert.equal(prop.ownerName !== undefined, seesOwners, `${name} ${prop._id} owner details`);
    // "Your units" still counts the AM's own units when they also hold accountant.
    if (p.roles.includes("asset_manager")) {
      for (const prop of props.value) assert.equal(prop.yourUnits, prop._id === "P1" ? 1 : 0, `${name} ${prop._id} yourUnits`);
    }

    // Units (the unit list): admin / AM / accountant read it, a pure technician or no role is refused;
    // an AM sees only their own and covered units unless they also hold accountant (then every unit).
    const unitsRes = await run(UNITS.list, ctx, {});
    const mayViewUnits = p.roles.some((r) => r === "admin" || r === "asset_manager" || r === "accountant");
    assert.equal(unitsRes.ok, mayViewUnits, `${name} units.list access: ${unitsRes.error}`);
    if (mayViewUnits) {
      assert.deepEqual(ids(unitsRes.value), unionOf("units", p.roles), `${name} units.list`);
      const byProp = await run(UNITS.listByProperty, ctx, { propertyId: "P2" });
      assert.ok(byProp.ok, `${name} units.listByProperty: ${byProp.error}`);
      assert.deepEqual(ids(byProp.value), unionOf("units", p.roles).filter((id) => id === "U2"), `${name} units.listByProperty`);
    } else {
      assert.equal(unitsRes.error, "You don't have access to that.");
    }

    // Maintenance requests.
    const reqs = await run(MT.list, ctx, { tab: "new" });
    assert.ok(reqs.ok, `${name} maintenance.list: ${reqs.error}`);
    assert.deepEqual(reqs.value.map((r) => r._id).sort(), unionOf("requests", p.roles), `${name} maintenance.list`);

    // Finance gate (owner statements, payments, ledger, owners, accounts, change rent all use it).
    const fin = await run(LEDGER.list, ctx, {});
    assert.equal(fin.ok, unionOf("finance", p.roles), `${name} finance gate: ${fin.error}`);
    if (!fin.ok) assert.equal(fin.error, "You don't have access to owner statements.");
    assert.equal(F.canUseFinance({ isAdmin: p.role === "admin", jobRoles: p.jobRoles }), unionOf("finance", p.roles));

    // Asset manager dashboard.
    const amDash = await run(DASH.amOverview, ctx, {});
    assert.equal(amDash.ok, unionOf("amDashboard", p.roles), `${name} dashboard.amOverview: ${amDash.error}`);

    // Resident calls (tenants page): admin / AM only, the AM's own units (same scope as requests:
    // both seeded requests came in by phone).
    const calls = await run(TEN.issues, ctx, {});
    assert.ok(calls.ok, `${name} tenants.issues: ${calls.error}`);
    assert.equal(calls.value.length, unionOf("requests", p.roles).length, `${name} tenants.issues`);

    // myAccess reports every role held.
    const access = await run(TEAM.myAccess, ctx, {});
    assert.ok(access.ok);
    assert.deepEqual(access.value.roles, p.roles, `${name} myAccess.roles`);
  });
}

test("pure work-order reach: union of roles, nothing more", () => {
  const mk = (jobRoles, isAdmin = false) => ({ orgId: "org1", isAdmin, jobRoles, user: { _id: "uC" } });
  const scope = { managed: new Set(["U1"]), covering: new Set(), coveringFor: [] };
  const w = (unitId, status, tech) => ({ orgId: "org1", unitId, status, technicianUserId: tech });
  // Another team's work order: nobody reaches it.
  for (const p of Object.values(PERSONAS)) {
    const r = WO.reachWith(mk(p.jobRoles, p.role === "admin"), scope, { ...w("U1", "completed", "uC"), orgId: "org2" });
    assert.equal(WO.anyReach(r), false);
  }
  assert.deepEqual(WO.reachWith(mk(["asset_manager", "accountant"]), scope, w("U2", "assigned", "uX")), { full: false, accountant: false, technician: false });
  assert.deepEqual(WO.reachWith(mk(["asset_manager", "accountant"]), scope, w("U2", "reviewed_closed", "uX")), { full: false, accountant: true, technician: false });
  assert.deepEqual(WO.reachWith(mk(["technician"]), null, w("U2", "assigned", "uC")), { full: false, accountant: false, technician: true });
  assert.deepEqual(WO.reachWith(mk([]), null, w("U1", "completed", "uC")), { full: false, accountant: false, technician: false });
});

test("pure request access: canRead / canAct follow the AM role, admin everything", () => {
  const scope = { managed: new Set(["U1"]), covering: new Set(["U3"]), coveringFor: [] };
  const req = (unitId, am) => ({ orgId: "org1", unitId, assignedAssetManagerUserId: am });
  const mk = (jobRoles, isAdmin = false) => ({ orgId: "org1", isAdmin, jobRoles, user: { _id: "uC" } });
  for (const p of Object.values(PERSONAS)) {
    const org = mk(p.jobRoles, p.role === "admin");
    const sc = p.roles.includes("asset_manager") ? scope : { managed: new Set(), covering: new Set(), coveringFor: [] };
    const admin = p.roles.includes("admin");
    const am = p.roles.includes("asset_manager");
    assert.equal(MT.canRead(org, req("U1", "uX"), sc), admin || am);
    assert.equal(MT.canRead(org, req("U3", "uX"), sc), admin || am, "covered unit is readable");
    assert.equal(MT.canAct(org, req("U3", "uX"), sc), admin, "covered unit is read-only");
    assert.equal(MT.canRead(org, req("U2", "uX"), sc), admin);
  }
});

// --- 3. Source scan ------------------------------------------------------------------------------

// Only authz.ts (the definition) and team.ts (myAccess.view, the UI's landing view) may call viewFor.
const VIEWFOR_ALLOWED = new Set(["authz.ts", "team.ts"]);

test("no server permission depends on the one view (viewFor)", () => {
  for (const f of readdirSync(CONVEX).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(join(CONVEX, f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (!/\bviewFor\(/.test(code)) continue;
    assert.ok(VIEWFOR_ALLOWED.has(f), `${f} still calls viewFor(); use rolesOf / hasRole / hasAnyRole / isAdminView`);
  }
  // team.ts uses it only for myAccess.view (the UI's default landing view).
  const team = readFileSync(join(CONVEX, "team.ts"), "utf8").replace(/\/\/.*$/gm, "");
  assert.equal((team.match(/\bviewFor\(/g) ?? []).length, 1);
  assert.match(team, /view: viewFor\(org\.isAdmin, org\.jobRoles\),/);
});

test("team.setRoles is admin-only and validates with parseAppRoles", () => {
  const team = readFileSync(join(CONVEX, "team.ts"), "utf8");
  const at = team.indexOf("export const setRoles = mutation(");
  assert.ok(at >= 0);
  const body = team.slice(at, team.indexOf("export const setAppRole", at));
  const gate = body.indexOf("await requireOrgAdmin(ctx)");
  assert.ok(gate >= 0 && gate < body.indexOf("parseAppRoles(args.roles)"));
  assert.match(body, /membership\.orgId !== org\.orgId\) throw new ConvexError\("Member not found\."\)/);
  assert.match(body, /writeMemberRoles\(ctx, org, membership, roles, "roles_set"\)/);
  // setAppRole is kept as a one-role wrapper over the same writer (same last-Admin rules).
  assert.match(team, /writeMemberRoles\(ctx, org, membership, \[appRole\], "app_role_set"\)/);
  assert.match(team, /throw new ConvexError\("Ask another Admin to change your role\."\)/);
  assert.match(team, /throw new ConvexError\("The team needs at least one Admin\."\)/);
});
