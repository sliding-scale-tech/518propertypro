// Production seed (scripts/prod/seedPeople.mjs + convex/prodSeed.ts). The runner's pure parts (input
// checks, passwords, output path, key/target guards) and the REAL Convex handlers against an in-memory
// database: a fresh deployment's team is created by an admin, roles go on like an accepted invite, a
// second run changes nothing, and the phone menu is written as a draft that stays off. Nothing is
// created in Clerk or Convex and nothing is sent. From dashboard/:
//   node --test scripts/probes/prod_seed.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
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

const S = await import("../prod/seedPeople.mjs");
const P = await import("../../convex/prodSeed.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = join(HERE, "..", "..");
const REPO = join(DASHBOARD, "..");
const EXAMPLE = JSON.parse(readFileSync(join(DASHBOARD, "scripts", "prod", "people.example.json"), "utf8"));
const RUNNER = readFileSync(join(DASHBOARD, "scripts", "prod", "seedPeople.mjs"), "utf8");

// --- Runner: input ------------------------------------------------------------------------------------

test("the example input is valid and holds placeholder data only", () => {
  const r = S.validateInput(EXAMPLE);
  assert.deepEqual(r.problems, []);
  assert.equal(r.people.length, 7);
  for (const p of r.people) {
    if (p.email) assert.match(p.email, /@example\.com$/, "example.com addresses only");
    if (p.phone) assert.match(p.phone, /^\+1518555010\d$/, "555-01xx fictional numbers only");
  }
  for (const e of r.phoneMenu) assert.match(e.phone, /^\+1518555010\d$/);
  // The real roster never appears in the committed example.
  assert.ok(!/518propertypro|gmail|yahoo|icloud|Fiore|Buell/i.test(JSON.stringify(EXAMPLE)));
});

test("input problems name the entry and the field", () => {
  const r = S.validateInput({
    people: [
      { firstName: "", email: "nope", roles: [] },
      { firstName: "Tech", email: "t@example.com", phone: "518-555-0101", roles: ["technician"], photoTeam: "gold" },
      { firstName: "Boss", email: "t@example.com", roles: ["admin", "technician"] },
      { firstName: "X", email: null, roles: ["owner"] },
    ],
    phoneMenu: [
      { key: 1, label: "A", phone: "+15185550101" },
      { key: 3, label: "", phone: "5185550102", personEmail: "who@example.com" },
    ],
  });
  const all = r.problems.join("\n");
  assert.match(all, /people\[0\]: firstName is required/);
  assert.match(all, /people\[0\]: email "nope" is not a valid address/);
  assert.match(all, /people\[0\]: roles is required/);
  assert.match(all, /people\[1\] \(Tech\): phone must be in international format/);
  assert.match(all, /people\[1\] \(Tech\): only an asset manager has a photoTeam/);
  assert.match(all, /people\[2\] \(Boss\): email t@example\.com is used twice/);
  assert.match(all, /people\[2\] \(Boss\): admin already includes every role/);
  assert.match(all, /people\[3\] \(X\): unknown role "owner"/);
  assert.match(all, /phoneMenu\[1\]: label \(the name callers hear\) is required/);
  assert.match(all, /phoneMenu\[1\]: phone must be in international format/);
  assert.match(all, /phoneMenu\[1\]: personEmail who@example\.com is not one of the people above/);
  assert.match(all, /phoneMenu: keys must run 1, 2, 3 \.\.\. with no gaps/);
  assert.deepEqual(S.validateInput({ people: [{ firstName: "T", email: "t@example.com", roles: ["technician"] }] }).problems, [
    "people: at least one admin with an email is required (a fresh deployment's team is created by an admin).",
  ]);
});

test("admins are seeded first", () => {
  const order = S.seedOrder(S.validateInput(EXAMPLE).people).map((p) => p.firstName);
  assert.deepEqual(order.slice(0, 2), ["Avery", "Blake"]);
});

// --- Runner: passwords and secrets --------------------------------------------------------------------

test("temporary passwords are long, mixed, unique and free of look-alike characters", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const p = S.generatePassword();
    assert.equal(p.length, 20);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[a-z]/);
    assert.match(p, /[2-9]/);
    assert.match(p, /[!@#$%^&*\-_=+?]/);
    assert.doesNotMatch(p, /[0O1lI]/);
    seen.add(p);
  }
  assert.equal(seen.size, 500);
  assert.throws(() => S.generatePassword(8), /at least 12/);
});

test("the password file must be outside the repo and new", () => {
  assert.match(S.outPathProblem(join(DASHBOARD, "pw.csv")), /outside the repository/);
  assert.match(S.outPathProblem(join(REPO, "docs", "pw.csv")), /outside the repository/);
  assert.match(S.outPathProblem(REPO), /outside the repository/);
  assert.match(S.outPathProblem(join(DASHBOARD, "package.json")), /outside the repository/);
  assert.match(S.outPathProblem(join(tmpdir(), "no-such-dir-xyz", "pw.csv")), /does not exist/);
  assert.equal(S.outPathProblem(join(tmpdir(), `seed-test-${process.pid}-${Date.now()}.csv`)), null);
  assert.match(S.outPathProblem(tmpdir()), /already exists/);
});

test("arguments: secrets are never accepted on the command line; apply needs a target and an out file", () => {
  assert.throws(() => S.parseArgs(["apply", "--input", "x.json", "--password", "p"]), /CLERK_SECRET_KEY environment variable/);
  assert.throws(() => S.parseArgs(["apply", "--input", "x.json", "--clerk-secret-key", "sk"]), /CLERK_SECRET_KEY environment variable/);
  assert.throws(() => S.parseArgs(["apply", "--input", "x.json", "--out", "/tmp/x"]), /--target must be "dev" or "prod"/);
  assert.throws(() => S.parseArgs(["apply", "--input", "x.json", "--target", "prod"]), /--out <file outside the repo> is required/);
  assert.throws(() => S.parseArgs(["go"]), /"plan" or "apply"/);
  const a = S.parseArgs(["apply", "--input", "x.json", "--target", "prod", "--out", "/tmp/x", "--reset-password", "A@x.com, b@x.com"]);
  assert.deepEqual(a.resetPassword, ["a@x.com", "b@x.com"]);
  assert.equal(S.parseArgs(["plan", "--input", "x.json"]).mode, "plan");
});

test("the Clerk key must match the target; dev runs only on the .env.local dev deployment", () => {
  assert.match(S.keyProblem("prod", undefined), /Set CLERK_SECRET_KEY/);
  assert.match(S.keyProblem("prod", "sk_test_abc"), /PRODUCTION Clerk secret key/);
  assert.match(S.keyProblem("dev", "sk_live_abc"), /development Clerk secret key/);
  assert.equal(S.keyProblem("prod", "sk_live_abc"), null);
  assert.equal(S.keyProblem("dev", "sk_test_abc"), null);
  assert.ok(!S.keyProblem("prod", "sk_test_SECRETVALUE").includes("SECRETVALUE"), "the key is never echoed");
  assert.deepEqual(S.convexTargetFlags("prod", ""), ["--prod"]);
  assert.deepEqual(S.convexTargetFlags("dev", "CONVEX_DEPLOYMENT=dev:brilliant-badger-615 # team"), ["--deployment", "brilliant-badger-615"]);
  assert.throws(() => S.convexTargetFlags("dev", "CONVEX_DEPLOYMENT=prod:x"), /No dev deployment/);
});

test("masking keeps emails and phones out of the console", () => {
  assert.equal(S.maskEmail("pat@example.com"), "p•••@example.com");
  assert.equal(S.maskEmail(null), "(no email)");
  assert.equal(S.maskPhone("+15185550101"), "+1518•••0101");
  assert.equal(S.shortName({ firstName: "Avery", lastName: "Example" }), "Avery E.");
});

test("source: the password goes only to Clerk and the out file, never to the console or Convex", () => {
  // Every line that mentions the generated password variable.
  // Quoted strings (messages, flag names) are left out; template literals are kept (the CSV line is one).
  const lines = RUNNER.split("\n").filter((l) => /(?<![-\w])password(?![-\w])/.test(l.replace(/"[^"]*"|'[^']*'/g, '""')) && !/^\s*(\/\/|\/?\*)/.test(l));
  for (const l of lines) {
    assert.ok(
      /const password = generatePassword\(\)|^\s*password,$|\{ password, sign_out_of_other_sessions|writeSync\(fd, .*csv\(password\)/.test(l),
      `unexpected use of the password: ${l.trim()}`,
    );
  }
  assert.ok(!/console\.(log|error|warn|info)\([^)]*password\b/.test(RUNNER));
  const seedCall = RUNNER.slice(RUNNER.indexOf('"prodSeed:seedPerson", {'), RUNNER.indexOf("});", RUNNER.indexOf('"prodSeed:seedPerson", {')));
  assert.ok(seedCall.length > 0 && !/password\b/.test(seedCall.replace(/mustChangePassword/g, "")), "no password in the Convex arguments");
  assert.match(RUNNER, /openSync\(outPath, "wx", 0o600\)/, "created exclusively, owner-only");
  assert.match(RUNNER, /spawnSync\("npx", cmd, \{ cwd: DASHBOARD, encoding: "utf8" \}\)/, "no shell");
});

// --- Convex handlers -----------------------------------------------------------------------------------

function makeDb(tables) {
  let n = 0;
  const all = () => Object.values(tables).flat();
  class Q {
    constructor(rows) {
      this.rows = rows;
    }
    withIndex(_i, fn) {
      if (!fn) return this;
      const preds = [];
      const b = { eq: (f, v) => (preds.push((r) => r[f] === v), b), gte: (f, v) => (preds.push((r) => r[f] >= v), b) };
      fn(b);
      return new Q(this.rows.filter((r) => preds.every((p) => p(r))));
    }
    order(dir) {
      const rows = [...this.rows].sort((a, b) => a._creationTime - b._creationTime);
      return new Q(dir === "desc" ? rows.reverse() : rows);
    }
    async collect() {
      return [...this.rows];
    }
    async take(k) {
      return this.rows.slice(0, k);
    }
    async first() {
      return this.rows[0] ?? null;
    }
    async unique() {
      return this.rows[0] ?? null;
    }
  }
  return {
    query: (t) => new Q(tables[t] ?? []),
    get: async (id) => all().find((r) => r._id === id) ?? null,
    normalizeId: (t, id) => ((tables[t] ?? []).some((r) => r._id === id) ? id : null),
    insert: async (t, doc) => {
      const id = `${t}_${++n}`;
      (tables[t] ??= []).push({ _id: id, _creationTime: n, ...doc });
      return id;
    },
    patch: async (id, fields) => {
      const row = all().find((r) => r._id === id);
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) delete row[k];
        else row[k] = v;
      }
    },
  };
}

function fresh() {
  const tables = { users: [], memberships: [], organizations: [], agents: [], auditEvents: [], sarahConfig: [] };
  return { tables, ctx: { db: makeDb(tables), auth: { getUserIdentity: async () => null } } };
}

const avery = { clerkId: "user_avery", email: "Admin.One@example.com", firstName: "Avery", lastName: "Example", roles: ["admin"], phone: "+15185550101", orgName: "Example Property Co", mustChangePassword: true };
const emery = { clerkId: "user_emery", email: "makeup.am@example.com", firstName: "Emery", roles: ["asset_manager", "accountant"], phone: "+15185550105", photoTeam: "make_up", mustChangePassword: true };
const tech = { clerkId: "user_tech", email: "tech.one@example.com", firstName: "Frankie", roles: ["technician"], phone: "+15185550106", mustChangePassword: true };

test("fresh deployment: the first admin creates the team; roles, phone and the flag are stored", async () => {
  const { tables, ctx } = fresh();
  const r = await P.seedPerson._handler(ctx, avery);
  assert.equal(r.org, "created");
  assert.equal(r.user, "created");
  assert.equal(r.membership, "created");
  assert.equal(r.mustChangePassword, true);
  assert.equal(tables.organizations[0].name, "Example Property Co");
  assert.equal(tables.organizations[0].createdBy, r.userId);
  const u = tables.users[0];
  assert.equal(u.email, "admin.one@example.com");
  assert.equal(u.mustChangePassword, true);
  assert.ok(!Object.keys(u).some((k) => /password/i.test(k) && k !== "mustChangePassword"), "no password stored");
  const m = tables.memberships[0];
  assert.equal(m.role, "admin");
  assert.deepEqual(m.jobRoles, ["executive", "maintenance_lead"]);
  assert.equal(m.phone, "+15185550101");
});

test("fresh deployment: a non-admin cannot be first", async () => {
  const { ctx } = fresh();
  await assert.rejects(P.seedPerson._handler(ctx, tech), (e) => /Seed an admin first/.test(e.data));
});

test("multi-role asset manager + accountant, with the team photo email", async () => {
  const { tables, ctx } = fresh();
  await P.seedPerson._handler(ctx, avery);
  const r = await P.seedPerson._handler(ctx, emery);
  assert.equal(r.org, "existing");
  assert.equal(r.photoEmail, "set");
  const m = tables.memberships.find((x) => x.userId === r.userId);
  assert.equal(m.role, "member");
  assert.deepEqual(m.jobRoles, ["asset_manager", "accountant"]);
  assert.equal(m.photoEmail, "dgallerie@518propertypro.com");
});

test("a second run of the same input changes nothing", async () => {
  const { tables, ctx } = fresh();
  for (const p of [avery, emery, tech]) await P.seedPerson._handler(ctx, p);
  const audits = tables.auditEvents.length;
  for (const p of [avery, emery, tech]) {
    const rerun = { ...p };
    delete rerun.mustChangePassword; // existing Clerk account: flag not re-sent
    const r = await P.seedPerson._handler(ctx, rerun);
    assert.equal(r.user, "unchanged", p.firstName);
    assert.equal(r.membership, "unchanged", p.firstName);
    assert.equal(r.mustChangePassword, true, "flag left as it was");
  }
  assert.equal(tables.auditEvents.length, audits);
  assert.equal(tables.memberships.length, 3);
  assert.equal(tables.users.length, 3);
});

test("the Clerk webhook got there first: its role-less membership is given the roles, its auto team name replaced", async () => {
  const { tables, ctx } = fresh();
  // What team.ensureTeamForUser writes for the very first sign-up on a fresh install.
  tables.users.push({ _id: "u_av", _creationTime: 0, clerkId: "user_avery", email: "admin.one@example.com", firstName: "Avery", createdAt: 0, updatedAt: 0 });
  tables.organizations.push({ _id: "org_auto", _creationTime: 0, name: "Avery's Team", createdBy: "u_av", createdAt: 0, updatedAt: 0 });
  tables.memberships.push({ _id: "m_av", _creationTime: 0, orgId: "org_auto", userId: "u_av", role: "admin", createdAt: 0 });
  const r = await P.seedPerson._handler(ctx, avery);
  assert.equal(r.org, "renamed");
  assert.equal(tables.organizations[0].name, "Example Property Co");
  assert.equal(r.membership, "updated");
  assert.deepEqual(tables.memberships[0].jobRoles, ["executive", "maintenance_lead"]);
  // A technician the webhook joined as a bare member.
  tables.users.push({ _id: "u_t", _creationTime: 1, clerkId: "user_tech", email: "tech.one@example.com", createdAt: 0, updatedAt: 0 });
  tables.memberships.push({ _id: "m_t", _creationTime: 1, orgId: "org_auto", userId: "u_t", role: "member", createdAt: 0 });
  const t = await P.seedPerson._handler(ctx, tech);
  assert.equal(t.membership, "updated");
  assert.deepEqual(tables.memberships[1].jobRoles, ["technician"]);
  assert.equal(tables.memberships[1].phone, "+15185550106");
});

test("a team someone already named is never renamed; an email on another account is refused", async () => {
  const { tables, ctx } = fresh();
  await P.seedPerson._handler(ctx, avery);
  tables.organizations[0].name = "518 Property Pro";
  await P.seedPerson._handler(ctx, { ...avery, orgName: "Something Else" });
  assert.equal(tables.organizations[0].name, "518 Property Pro");
  await assert.rejects(P.seedPerson._handler(ctx, { ...emery, clerkId: "user_other", email: avery.email }), (e) => /already on another account/.test(e.data));
});

test("bad input to seedPerson gets specific ConvexErrors", async () => {
  const { ctx } = fresh();
  await assert.rejects(P.seedPerson._handler(ctx, { ...avery, clerkId: "bob" }), (e) => /Clerk user id/.test(e.data));
  await assert.rejects(P.seedPerson._handler(ctx, { ...avery, email: "x" }), (e) => /not a valid email/.test(e.data));
  await assert.rejects(P.seedPerson._handler(ctx, { ...avery, roles: [] }), (e) => /Pick at least one role/.test(e.data));
  await assert.rejects(P.seedPerson._handler(ctx, { ...avery, phone: "5185550101" }), (e) => /international format/.test(e.data));
  await assert.rejects(P.seedPerson._handler(ctx, { ...avery, photoTeam: "gold" }), (e) => /only an asset manager/.test(e.data));
  await assert.rejects(P.seedPerson._handler(ctx, { ...emery, photoTeam: "bronze" }), (e) => /photoTeam must be one of/.test(e.data));
});

test("phone menu: written to the draft in key order, switched off, nothing published; re-run unchanged", async () => {
  const { tables, ctx } = fresh();
  await P.seedPerson._handler(ctx, avery);
  await P.seedPerson._handler(ctx, emery);
  const entries = [
    { key: 2, label: "Blake Example", phone: "+15185550102" },
    { key: 1, label: "Avery Example", phone: "+15185550101", personEmail: "admin.one@example.com" },
    { key: 3, label: "Emery (Accounting)", phone: "+15185550105", personEmail: "makeup.am@example.com" },
  ];
  const r = await P.seedRoutingDirectory._handler(ctx, { entries });
  assert.deepEqual(r, { result: "set", keys: 3, enabled: false });
  const row = tables.sarahConfig[0];
  assert.equal(row.version, 0);
  assert.equal(row.published, undefined, "not live");
  assert.deepEqual(row.draft.routingDirectory.entries.map((e) => e.label), ["Avery Example", "Blake Example", "Emery (Accounting)"]);
  assert.equal(row.draft.routingDirectory.entries[0].userId, tables.users[0]._id);
  assert.ok(!row.draft.routingDirectory.entries.some((e) => /alyssa/i.test(e.label)));
  assert.equal(row.draft.routingDirectory.enabled, false);
  assert.deepEqual(await P.seedRoutingDirectory._handler(ctx, { entries }), { result: "unchanged", keys: 3, enabled: false });
  await assert.rejects(P.seedRoutingDirectory._handler(ctx, { entries: [{ key: 1, label: "A", phone: "+15185550101" }, { key: 3, label: "B", phone: "+15185550102" }] }), (e) => /no gaps or repeats/.test(e.data));
  await assert.rejects(P.seedRoutingDirectory._handler(ctx, { entries: [{ key: 1, label: "A", phone: "+15185550101", personEmail: "nobody@example.com" }] }), (e) => /is not on the team/.test(e.data));
  await assert.rejects(P.seedRoutingDirectory._handler(ctx, { entries: [{ key: 1, label: "A", phone: "12" }] }), (e) => /full 10-digit number/.test(e.data));
});
