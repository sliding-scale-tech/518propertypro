// Invite-only dashboard access (convex/inviteGate.ts). Runs the REAL Clerk-webhook path
// (users.upsertFromClerk + team.ensureTeamForUser), the invite handlers, the production seed and the
// authz helpers against an in-memory database: an uninvited sign-up gets no membership, no role and no
// team and is refused by every data path; an invitee is let in by redeeming; a seeded person is
// unaffected; ALLOW_OPEN_SIGNUP=true is the only way back to open self-join. No packages, no network.
// From dashboard/:
//   node --test scripts/probes/invite_only.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const IG = await import("../../convex/inviteGate.ts");
const G = await import("../../convex/passwordGate.ts");
const A = await import("../../convex/authz.ts");
const U = await import("../../convex/users.ts");
const TEAM = await import("../../convex/team.ts");
const P = await import("../../convex/prodSeed.ts");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONVEX = join(ROOT, "convex");
const NEED_INVITE = IG.INVITE_REQUIRED;
const noInvite = (e) => e?.data === NEED_INVITE;
const mustChange = (e) => e?.data === G.PASSWORD_CHANGE_REQUIRED;

// Every test starts with open sign-up off, whatever the shell running them has set.
delete process.env.ALLOW_OPEN_SIGNUP;

// --- In-memory db ---------------------------------------------------------------------------------------

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
    filter() {
      return this;
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
    async *[Symbol.asyncIterator]() {
      for (const r of this.rows) yield r;
    }
  }
  return {
    query: (t) => new Q(tables[t] ?? []),
    get: async (id) => all().find((r) => r._id === id) ?? null,
    normalizeId: (t, id) => ((tables[t] ?? []).some((r) => r._id === id) ? id : null),
    insert: async (t, doc) => {
      const id = `${t}_${++n}`;
      (tables[t] ??= []).push({ _id: id, _creationTime: 100 + n, ...doc });
      return id;
    },
    patch: async (id, fields) => {
      const row = all().find((r) => r._id === id);
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) delete row[k];
        else row[k] = v;
      }
    },
    delete: async (id) => {
      for (const rows of Object.values(tables)) {
        const i = rows.findIndex((r) => r._id === id);
        if (i >= 0) rows.splice(i, 1);
      }
    },
  };
}

/** A deployment. `team: true` = the 518 team already exists with its admin (as dev and seeded prod do). */
function deployment({ team = true } = {}) {
  const tables = { users: [], memberships: [], organizations: [], agents: [], invites: [], auditEvents: [], sarahConfig: [], tourAvailability: [], googleCalendarConnections: [] };
  if (team) {
    tables.users.push({ _id: "u_admin", _creationTime: 1, clerkId: "user_admin", email: "admin@example.com", firstName: "Avery", createdAt: 1, updatedAt: 1 });
    tables.organizations.push({ _id: "org1", _creationTime: 0, name: "518 Property Pro", createdBy: "u_admin", createdAt: 0, updatedAt: 0 });
    tables.memberships.push({ _id: "m_admin", _creationTime: 2, orgId: "org1", userId: "u_admin", role: "admin", jobRoles: ["executive"], createdAt: 2 });
    tables.agents.push({ _id: "agent1", _creationTime: 3, orgId: "org1" });
  }
  const scheduled = [];
  let identity = null;
  const db = makeDb(tables);
  const ctx = {
    db,
    auth: { getUserIdentity: async () => identity },
    scheduler: { runAfter: async (...a) => scheduled.push(a) },
  };
  return { tables, ctx, scheduled, signInAs: (clerkId) => (identity = clerkId ? { subject: clerkId, tokenIdentifier: `x|${clerkId}` } : null) };
}

/** What the Clerk webhook does on user.created (clerkWebhook.ts): mirror the user, then ensureTeamForUser. */
async function clerkSignUp(ctx, { clerkId, email, firstName = "Sam" }) {
  const userId = await U.upsertFromClerk._handler(ctx, { clerkId, email, firstName });
  await TEAM.ensureTeamForUser._handler(ctx, { userId });
  // session.created runs the same path again on their first sign-in.
  await TEAM.ensureTeamForUser._handler(ctx, { userId });
  return userId;
}

function invite(tables, { email, tokenHash = "h1", expiresAt = Date.now() + 60_000, jobRoles = ["technician"], role = "member" }) {
  tables.invites.push({ _id: `inv_${tables.invites.length + 1}`, _creationTime: 50, orgId: "org1", email, role, jobRoles, tokenHash, createdBy: "u_admin", createdAt: Date.now(), expiresAt });
}

/** Mimics an action ctx whose runQuery answers authz.orgForClerkId from this db. */
function actionCtx(ctx, clerkId) {
  return {
    auth: { getUserIdentity: async () => ({ subject: clerkId }) },
    runQuery: async (_ref, args) => A.orgForClerkId._handler(ctx, args),
  };
}

// --- 1. Uninvited sign-up -------------------------------------------------------------------------------

test("uninvited sign-up: no membership, no role, no new team", async () => {
  const { tables, ctx, scheduled } = deployment();
  const userId = await clerkSignUp(ctx, { clerkId: "user_stranger", email: "stranger@example.com" });
  assert.ok(tables.users.some((u) => u._id === userId), "the Clerk account is mirrored");
  assert.equal(tables.memberships.filter((m) => m.userId === userId).length, 0, "no membership");
  assert.equal(tables.organizations.length, 1, "no org created");
  assert.equal(scheduled.length, 0, "no team setup scheduled");
});

test("uninvited sign-up is refused by every central helper with INVITE_REQUIRED", async () => {
  const { ctx, signInAs } = deployment();
  await clerkSignUp(ctx, { clerkId: "user_stranger", email: "stranger@example.com" });
  signInAs("user_stranger");
  for (const fn of [A.currentUser, A.requireUser, A.currentOrg, A.requireOrg, A.requireOrgAdmin, A.requireAdminView]) {
    await assert.rejects(fn(ctx), noInvite, fn.name);
  }
  await assert.rejects(A.requireJobRole(ctx, "technician"), noInvite);
  const actx = actionCtx(ctx, "user_stranger");
  await assert.rejects(A.requireUserId(actx), noInvite);
  await assert.rejects(A.requireOrgId(actx), noInvite);
  await assert.rejects(A.requireAdminViewId(actx), noInvite);
});

test("uninvited sign-up is refused by real data handlers (team.overview, team.myAccess, users.current, team.rename)", async () => {
  const { ctx, signInAs } = deployment();
  await clerkSignUp(ctx, { clerkId: "user_stranger", email: "stranger@example.com" });
  signInAs("user_stranger");
  await assert.rejects(TEAM.overview._handler(ctx, {}), noInvite);
  await assert.rejects(TEAM.myAccess._handler(ctx, {}), noInvite);
  await assert.rejects(U.current._handler(ctx, {}), noInvite);
  await assert.rejects(TEAM.rename._handler(ctx, { name: "Mine now" }), noInvite);
});

test("uninvited sign-up: the gate says invite_required, and there is nothing to join", async () => {
  const { tables, ctx, signInAs } = deployment();
  await clerkSignUp(ctx, { clerkId: "user_stranger", email: "stranger@example.com" });
  signInAs("user_stranger");
  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "invite_required" });
  assert.equal(await TEAM.myPendingInvite._handler(ctx, {}), null);
  await assert.rejects(TEAM.acceptPendingInvite._handler(ctx, {}), (e) => /no invitation waiting/.test(e.data));
  assert.equal(tables.memberships.length, 1, "still only the admin");
});

test("gate states for signed out and not-yet-synced accounts", async () => {
  const { ctx, signInAs } = deployment();
  signInAs(null);
  assert.equal(await TEAM.accessGate._handler(ctx, {}), null);
  signInAs("user_not_synced");
  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "setting_up" });
  // A user row the webhook has not written yet still degrades to null, not an error.
  assert.equal(await A.currentOrg(ctx), null);
});

// --- 2. No new org from self sign-up --------------------------------------------------------------------

test("fresh, empty deployment: a self sign-up creates no team and becomes no admin", async () => {
  const { tables, ctx, scheduled, signInAs } = deployment({ team: false });
  await clerkSignUp(ctx, { clerkId: "user_first", email: "first@example.com", firstName: "First" });
  assert.equal(tables.organizations.length, 0, "no org");
  assert.equal(tables.memberships.length, 0, "no membership");
  assert.equal(scheduled.length, 0, "no agents.ensure");
  signInAs("user_first");
  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "invite_required" });
});

test("source: ensureTeamForUser checks the open-signup flag before it can insert anything", () => {
  const src = readFileSync(join(CONVEX, "team.ts"), "utf8");
  const start = src.indexOf("export const ensureTeamForUser");
  const body = src.slice(start, src.indexOf("\n});", start));
  const flag = body.indexOf("if (!openSignupAllowed()) return;");
  assert.ok(flag > 0, "the flag check is there");
  for (const write of ['insert("memberships"', 'insert("organizations"', "internal.agents.ensure"]) {
    assert.ok(body.indexOf(write) > flag, `${write} only after the flag check`);
  }
});

test("source: only the reviewed paths insert memberships or organizations", () => {
  const hits = {};
  for (const f of ["team.ts", "prodSeed.ts", "orgMigration.ts", "singleTenantMigration.ts", "users.ts", "clerkWebhook.ts", "authz.ts"]) {
    const src = readFileSync(join(CONVEX, f), "utf8");
    const n = (src.match(/insert\("(memberships|organizations)"/g) ?? []).length;
    if (n) hits[f] = n;
  }
  // team.ts: redeemInvite, acceptPendingInvite, and ensureTeamForUser's ALLOW_OPEN_SIGNUP branch (3:
  // a member row, or on an empty deployment the org plus its admin row).
  // prodSeed.ts: seedPerson (org on a fresh deployment, membership). The migrations are internal,
  // operator-run (`npx convex run`), never reachable from sign-up.
  assert.deepEqual(hits, { "team.ts": 5, "prodSeed.ts": 2, "orgMigration.ts": 2, "singleTenantMigration.ts": 1 });
});

// --- 3. Invited sign-up ---------------------------------------------------------------------------------

test("invited: signs up with the invited email, redeems the link, gets the invite's role", async () => {
  const { tables, ctx, signInAs } = deployment();
  invite(tables, { email: "tech@example.com", tokenHash: "tok", jobRoles: ["technician"] });
  const userId = await clerkSignUp(ctx, { clerkId: "user_tech", email: "Tech@Example.com" });
  assert.equal(tables.memberships.filter((m) => m.userId === userId).length, 0, "sign-up alone gives nothing");
  signInAs("user_tech");
  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "invited", orgName: "518 Property Pro" });

  const r = await TEAM.redeemInvite._handler(ctx, { clerkId: "user_tech", tokenHash: "tok" });
  assert.equal(r.orgName, "518 Property Pro");
  const m = tables.memberships.find((x) => x.userId === userId);
  assert.equal(m.orgId, "org1");
  assert.equal(m.role, "member");
  assert.deepEqual(m.jobRoles, ["technician"]);
  assert.ok(tables.invites[0].acceptedAt, "invite used up");
  assert.equal(tables.organizations.length, 1);

  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "member" });
  assert.equal((await A.requireOrg(ctx)).orgId, "org1");
  assert.deepEqual((await TEAM.myAccess._handler(ctx, {})).roles, ["technician"]);
  assert.equal(await A.requireUserId(actionCtx(ctx, "user_tech")), userId);
});

test("invited: joining from the in-app offer (no token) works the same", async () => {
  const { tables, ctx, signInAs } = deployment();
  invite(tables, { email: "am@example.com", jobRoles: ["asset_manager"] });
  const userId = await clerkSignUp(ctx, { clerkId: "user_am", email: "am@example.com" });
  signInAs("user_am");
  assert.deepEqual(await TEAM.myPendingInvite._handler(ctx, {}), { orgName: "518 Property Pro", role: "member" });
  await TEAM.acceptPendingInvite._handler(ctx, {});
  assert.deepEqual(tables.memberships.find((m) => m.userId === userId).jobRoles, ["asset_manager"]);
  assert.equal((await A.requireOrg(ctx)).orgId, "org1");
});

test("invited at a DIFFERENT email: redeeming is refused and they get the need-an-invite page", async () => {
  const { tables, ctx, signInAs } = deployment();
  invite(tables, { email: "invited@example.com", tokenHash: "tok" });
  const userId = await clerkSignUp(ctx, { clerkId: "user_other", email: "other@example.com" });
  await assert.rejects(
    TEAM.redeemInvite._handler(ctx, { clerkId: "user_other", tokenHash: "tok" }),
    (e) => /This invitation was sent to invited@example\.com/.test(e.data),
  );
  assert.equal(tables.memberships.filter((m) => m.userId === userId).length, 0);
  assert.equal(tables.invites[0].acceptedAt, undefined, "the invite stays live for the right person");
  signInAs("user_other");
  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "invite_required" });
  await assert.rejects(A.requireOrg(ctx), noInvite);
});

test("an expired or revoked invite lets nobody in", async () => {
  for (const extra of [{ expiresAt: Date.now() - 1 }, { revokedAt: Date.now() }]) {
    const { tables, ctx, signInAs } = deployment();
    invite(tables, { email: "late@example.com", tokenHash: "tok" });
    Object.assign(tables.invites[0], extra);
    await clerkSignUp(ctx, { clerkId: "user_late", email: "late@example.com" });
    await assert.rejects(TEAM.redeemInvite._handler(ctx, { clerkId: "user_late", tokenHash: "tok" }), (e) => /no longer valid/.test(e.data));
    signInAs("user_late");
    assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "invite_required" });
    await assert.rejects(TEAM.acceptPendingInvite._handler(ctx, {}), (e) => /no invitation waiting/.test(e.data));
    assert.equal(tables.memberships.length, 1);
  }
});

// --- 4. Seeded and existing members ---------------------------------------------------------------------

test("seeded: the seed creates the team on an empty deployment; the webhook adds no second team", async () => {
  const { tables, ctx, signInAs, scheduled } = deployment({ team: false });
  const avery = { clerkId: "user_avery", email: "admin.one@example.com", firstName: "Avery", roles: ["admin"], orgName: "518 Property Pro", mustChangePassword: true };
  // The seed script creates the Clerk account first, so user.created can land before seedPerson.
  await clerkSignUp(ctx, { clerkId: "user_avery", email: "admin.one@example.com", firstName: "Avery" });
  assert.equal(tables.organizations.length, 0, "webhook created nothing");
  const r = await P.seedPerson._handler(ctx, avery);
  assert.equal(r.org, "created");
  assert.equal(r.membership, "created");
  assert.equal(tables.organizations.length, 1);
  assert.equal(tables.organizations[0].name, "518 Property Pro");

  // First sign-in: session.created schedules the team setup for the admin, and nothing else.
  await TEAM.ensureTeamForUser._handler(ctx, { userId: r.userId });
  assert.equal(tables.organizations.length, 1);
  assert.equal(tables.memberships.length, 1);
  assert.equal(scheduled.length, 1, "agents.ensure for the seeded admin's team");

  // Order: a seeded person meets the password gate first, never the invite gate.
  signInAs("user_avery");
  await assert.rejects(A.requireOrg(ctx), mustChange);
  await assert.rejects(TEAM.accessGate._handler(ctx, {}), mustChange);
  tables.users[0].mustChangePassword = false;
  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "member" });
  assert.equal((await A.requireOrgAdmin(ctx)).orgId, r.orgId);
});

test("seeded: a non-admin seeded into the existing team is a member with roles; webhook order does not matter", async () => {
  const { tables, ctx, signInAs } = deployment();
  const tech = { clerkId: "user_t", email: "tech.one@example.com", firstName: "Frankie", roles: ["technician"], mustChangePassword: true };
  const r = await P.seedPerson._handler(ctx, tech);
  await clerkSignUp(ctx, { clerkId: "user_t", email: "tech.one@example.com" }); // webhook after the seed
  assert.equal(tables.memberships.filter((m) => m.userId === r.userId).length, 1);
  assert.deepEqual(tables.memberships.find((m) => m.userId === r.userId).jobRoles, ["technician"]);
  signInAs("user_t");
  await assert.rejects(A.currentUser(ctx), mustChange, "password first");
  tables.users.find((u) => u.clerkId === "user_t").mustChangePassword = false;
  assert.equal((await A.requireOrg(ctx)).orgId, "org1");
});

test("existing members keep access, including legacy role-less ones (no migration)", async () => {
  const { tables, ctx, signInAs } = deployment();
  // A role-less membership the old auto-join wrote.
  tables.users.push({ _id: "u_old", _creationTime: 5, clerkId: "user_old", email: "old@example.com", createdAt: 5, updatedAt: 5 });
  tables.memberships.push({ _id: "m_old", _creationTime: 6, orgId: "org1", userId: "u_old", role: "member", createdAt: 6 });
  await TEAM.ensureTeamForUser._handler(ctx, { userId: "u_old" });
  assert.equal(tables.memberships.length, 2, "nothing added or removed");
  signInAs("user_old");
  assert.deepEqual(await TEAM.accessGate._handler(ctx, {}), { state: "member" });
  assert.deepEqual((await TEAM.myAccess._handler(ctx, {})).roles, [], "still Waiting for access on /home");
  signInAs("user_admin");
  assert.equal((await A.requireOrgAdmin(ctx)).orgId, "org1");
  assert.equal(await A.requireUserId(actionCtx(ctx, "user_admin")), "u_admin");
});

// --- 5. ALLOW_OPEN_SIGNUP -------------------------------------------------------------------------------

test("openSignupAllowed: only an explicit true", () => {
  assert.equal(IG.openSignupAllowed({}), false);
  for (const v of ["", "false", "0", "yes", "1", "on"]) assert.equal(IG.openSignupAllowed({ ALLOW_OPEN_SIGNUP: v }), false, v);
  for (const v of ["true", "TRUE", " true "]) assert.equal(IG.openSignupAllowed({ ALLOW_OPEN_SIGNUP: v }), true, v);
});

test("ALLOW_OPEN_SIGNUP=true restores the old open self-join (demo deployments only)", async () => {
  process.env.ALLOW_OPEN_SIGNUP = "true";
  try {
    const { tables, ctx } = deployment();
    const userId = await clerkSignUp(ctx, { clerkId: "user_demo", email: "demo@example.com" });
    const m = tables.memberships.find((x) => x.userId === userId);
    assert.equal(m.role, "member");
    assert.equal(m.jobRoles, undefined, "role-less");

    const empty = deployment({ team: false });
    await clerkSignUp(empty.ctx, { clerkId: "user_first", email: "first@example.com", firstName: "First" });
    assert.equal(empty.tables.organizations.length, 1, "creates the team on an empty deployment");
    assert.ok(empty.scheduled.length >= 1, "its setup is scheduled (agents.ensure claims it once)");
  } finally {
    delete process.env.ALLOW_OPEN_SIGNUP;
  }
});

// --- 6. Client courtesy layer ---------------------------------------------------------------------------

test("TeamGate shows the need-an-invite page from the exempt gate query, inside the password gate", () => {
  const gate = readFileSync(join(ROOT, "components", "team-gate.tsx"), "utf8");
  assert.match(gate, /useQuery\(api\.team\.accessGate\)/);
  assert.ok(!/api\.team\.overview/.test(gate), "no data query mounts before membership is known");
  const shown = gate.replace(/\s+/g, " ");
  assert.ok(shown.includes(NEED_INVITE), "same words as the server's INVITE_REQUIRED");
  assert.match(gate, /signOut\(/);
  const chrome = readFileSync(join(ROOT, "components", "app-chrome.tsx"), "utf8");
  assert.ok(chrome.indexOf("<PasswordGate>") < chrome.indexOf("<TeamGate>"), "password change first");
  assert.ok(chrome.indexOf("<TeamGate>") < chrome.indexOf("<SignedInShell>"), "no sidebar before membership");
});
