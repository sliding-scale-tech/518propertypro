// Forced password change on first login (convex/passwordGate.ts, lib/password-gate.ts). Runs the REAL
// authz helpers and Convex handlers against an in-memory database: a person still on a temporary
// password is refused by every data path with the same ConvexError, the one exempt query answers, and
// the flag rule (Clerk claim vs users.mustChangePassword mirror) holds. No packages, no network.
// From dashboard/:
//   node --test scripts/probes/password_gate.test.mjs
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

const G = await import("../../convex/passwordGate.ts");
const A = await import("../../convex/authz.ts");
const U = await import("../../convex/users.ts");
const TEAM = await import("../../convex/team.ts");
const L = await import("../../lib/password-gate.ts");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONVEX = join(ROOT, "convex");
const MSG = G.PASSWORD_CHANGE_REQUIRED;

// --- In-memory db (index eq ranges, first/unique/collect/take, get, insert, patch) ---------------------

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
      (tables[t] ??= []).push({ _id: id, _creationTime: Date.now() + n, ...doc });
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

function world({ flagged, claim } = {}) {
  const tables = {
    users: [{ _id: "u1", _creationTime: 1, clerkId: "user_1", email: "a@example.com", firstName: "Avery", ...(flagged !== undefined ? { mustChangePassword: flagged } : {}) }],
    memberships: [{ _id: "m1", _creationTime: 2, orgId: "org1", userId: "u1", role: "admin", jobRoles: ["executive"], createdAt: 1 }],
    organizations: [{ _id: "org1", _creationTime: 0, name: "Team", createdBy: "u1", createdAt: 0, updatedAt: 0 }],
    invites: [],
    auditEvents: [],
  };
  const identity = { subject: "user_1", tokenIdentifier: "x|user_1", ...(claim !== undefined ? { mustChangePassword: claim } : {}) };
  const db = makeDb(tables);
  const ctx = { db, auth: { getUserIdentity: async () => identity } };
  return { tables, ctx, identity };
}

const refused = (e) => e?.data === MSG;

// --- 1. The rule --------------------------------------------------------------------------------------

test("rule: an explicit token claim wins, otherwise the users mirror decides", () => {
  const cases = [
    // [db flag, claim, blocked]
    [undefined, undefined, false],
    [false, undefined, false],
    [true, undefined, true],
    [true, false, false], // Clerk already cleared it; the webhook has not reached the mirror yet
    [false, true, true], // re-flagged in Clerk; the mirror is behind
    [undefined, true, true],
    [true, true, true],
    [true, "true", true],
    [true, "false", false],
    [true, null, true],
  ];
  for (const [db, claim, blocked] of cases) {
    const identity = claim === undefined ? { subject: "s" } : { subject: "s", mustChangePassword: claim };
    assert.equal(G.passwordChangeRequired(db === undefined ? {} : { mustChangePassword: db }, identity), blocked, JSON.stringify({ db, claim }));
  }
  assert.equal(G.passwordChangeRequired(null, { mustChangePassword: true }), true);
  assert.equal(G.passwordChangeRequired(null, null), false);
});

test("webhook mirror: only an explicit boolean in public_metadata changes the flag", () => {
  assert.equal(G.flagFromPublicMetadata({ mustChangePassword: true }), true);
  assert.equal(G.flagFromPublicMetadata({ mustChangePassword: false }), false);
  assert.equal(G.flagFromPublicMetadata({}), undefined);
  assert.equal(G.flagFromPublicMetadata(null), undefined);
  assert.equal(G.flagFromPublicMetadata({ mustChangePassword: "yes" }), undefined);
});

// --- 2. Central helpers -------------------------------------------------------------------------------

test("currentUser / requireUser / currentOrg / requireOrg / requireOrgAdmin refuse a flagged person", async () => {
  for (const fn of [A.currentUser, A.requireUser, A.currentOrg, A.requireOrg, A.requireOrgAdmin, A.requireAdminView]) {
    const { ctx } = world({ flagged: true });
    await assert.rejects(fn(ctx), refused, fn.name);
  }
});

test("the same helpers work normally once the password is changed", async () => {
  const { ctx } = world({ flagged: false });
  assert.equal((await A.currentUser(ctx))._id, "u1");
  assert.equal((await A.requireOrg(ctx)).orgId, "org1");
  const { ctx: legacy } = world({}); // rows written before the flag existed
  assert.equal((await A.requireOrgAdmin(legacy)).orgId, "org1");
});

test("a signed Clerk claim: true blocks a clean mirror, false lets a stale mirror through", async () => {
  await assert.rejects(A.requireOrg(world({ flagged: false, claim: true }).ctx), refused);
  assert.equal((await A.requireOrg(world({ flagged: true, claim: false }).ctx)).orgId, "org1");
});

test("action helpers (requireUserId / requireOrgId / requireAdminViewId) refuse a flagged person", async () => {
  const user = { _id: "u1", clerkId: "user_1", mustChangePassword: true };
  const resolved = { orgId: "org1", role: "admin", jobRoles: ["executive"], userId: "u1", mustChangePassword: true };
  const actx = (row) => ({ auth: { getUserIdentity: async () => ({ subject: "user_1" }) }, runQuery: async () => row });
  await assert.rejects(A.requireUserId(actx(user)), refused);
  await assert.rejects(A.requireOrgId(actx(resolved)), refused);
  await assert.rejects(A.requireAdminViewId(actx(resolved)), refused);
  assert.equal(await A.requireUserId(actx({ ...user, mustChangePassword: false })), "u1");
  assert.equal((await A.requireOrgId(actx({ ...resolved, mustChangePassword: false }))).orgId, "org1");
});

test("orgForClerkId reports the flag so requireOrgId can check it", async () => {
  const { ctx } = world({ flagged: true });
  const r = await A.orgForClerkId._handler(ctx, { clerkId: "user_1" });
  assert.equal(r.mustChangePassword, true);
});

// --- 3. Real handlers ---------------------------------------------------------------------------------

test("data queries and mutations refuse a flagged caller (team.overview, team.myAccess, users.current, team.rename)", async () => {
  const { ctx } = world({ flagged: true });
  await assert.rejects(TEAM.overview._handler(ctx, {}), refused);
  await assert.rejects(TEAM.myAccess._handler(ctx, {}), refused);
  await assert.rejects(TEAM.myPendingInvite._handler(ctx, {}), refused);
  await assert.rejects(U.current._handler(ctx, {}), refused);
  await assert.rejects(TEAM.rename._handler(ctx, { name: "New" }), refused);
});

test("redeeming an invite is refused too", async () => {
  const { ctx, tables } = world({ flagged: true });
  tables.invites.push({ _id: "i1", _creationTime: 3, orgId: "org1", email: "a@example.com", role: "member", tokenHash: "h", expiresAt: Date.now() + 60_000, createdAt: 1, createdBy: "u1" });
  await assert.rejects(TEAM.redeemInvite._handler(ctx, { clerkId: "user_1", tokenHash: "h" }), refused);
});

test("users.passwordGate is the one query a flagged person gets an answer from, and it says only the flag", async () => {
  assert.deepEqual(await U.passwordGate._handler(world({ flagged: true }).ctx, {}), { mustChangePassword: true });
  assert.deepEqual(await U.passwordGate._handler(world({ flagged: false }).ctx, {}), { mustChangePassword: false });
  assert.deepEqual(await U.passwordGate._handler(world({ flagged: true, claim: false }).ctx, {}), { mustChangePassword: false });
  const anon = { db: makeDb({}), auth: { getUserIdentity: async () => null } };
  assert.equal(await U.passwordGate._handler(anon, {}), null);
});

test("upsertFromClerk mirrors the flag only when Clerk states it", async () => {
  const { ctx, tables } = world({ flagged: true });
  await U.upsertFromClerk._handler(ctx, { clerkId: "user_1", firstName: "Avery" });
  assert.equal(tables.users[0].mustChangePassword, true, "an ordinary update leaves it alone");
  await U.upsertFromClerk._handler(ctx, { clerkId: "user_1", mustChangePassword: false });
  assert.equal(tables.users[0].mustChangePassword, false);
  await U.upsertFromClerk._handler(ctx, { clerkId: "user_2", email: "b@example.com", mustChangePassword: true });
  assert.equal(tables.users.find((u) => u.clerkId === "user_2").mustChangePassword, true);
});

// --- 4. Source scans: nothing reads identity around the helpers ----------------------------------------

test("direct ctx.auth.getUserIdentity() calls are only the reviewed ones", () => {
  const hits = {};
  for (const f of readdirSync(CONVEX).filter((x) => x.endsWith(".ts"))) {
    const n = (readFileSync(join(CONVEX, f), "utf8").match(/ctx\.auth\.getUserIdentity\(\)/g) ?? []).length;
    if (n) hits[f] = n;
  }
  // authz.ts: the helpers themselves. users.ts: passwordGate (exempt by design). team.ts: acceptInvite
  // (its redeemInvite checks the gate) and redeemInvite's own check. agents.ts: current (identity used
  // only to decide "signed in, no team" -> null) and mintToken (goes on to requireOrgId).
  // A new direct call must be reviewed against the password gate and added here.
  assert.deepEqual(hits, { "agents.ts": 2, "authz.ts": 3, "team.ts": 2, "users.ts": 1 });
});

test("the webhook passes the metadata flag through", () => {
  const src = readFileSync(join(CONVEX, "clerkWebhook.ts"), "utf8");
  assert.match(src, /mustChangePassword: flagFromPublicMetadata\(user\.public_metadata\)/);
});

test("proxy.ts redirects flagged sessions to the change page", () => {
  const src = readFileSync(join(ROOT, "proxy.ts"), "utf8");
  assert.match(src, /mustChangePasswordFromClaims\(sessionClaims\) && !allowedWhileFlagged\(pathname\)/);
  assert.match(src, /NextResponse\.redirect\(new URL\(CHANGE_PASSWORD_PATH, req\.url\)\)/);
});

test("the server action clears the flag only after Clerk confirms a fresh password change", () => {
  const src = readFileSync(join(ROOT, "app", "change-password", "actions.ts"), "utf8");
  assert.match(src, /^"use server";/);
  assert.match(src, /const \{ userId \} = await auth\(\);/);
  assert.match(src, /changedAt <= issuedAt \|\| changedAt < now - RECENT_MS/);
  assert.ok(src.indexOf("changedAt <= issuedAt") < src.indexOf("updateUserMetadata"), "checked before clearing");
  assert.ok(!/(newPassword|currentPassword|password)\s*[,)]|\bpassword:/.test(src.replace(/password_last_updated_at|mustChangePassword|tempPasswordIssuedAt|PasswordChange|"[^"]*"/g, "")), "never takes or sends a password");
  assert.match(src, /export async function completePasswordChange\(\): Promise<CompleteResult>/, "takes no arguments from the browser");
});

// --- 5. Web rules (lib/password-gate.ts) -------------------------------------------------------------

test("middleware rules: only the change page and sign-in stay reachable", () => {
  for (const p of ["/change-password", "/sign-in", "/sign-in/factor-one", "/sso-callback"]) assert.equal(L.allowedWhileFlagged(p), true, p);
  for (const p of ["/dashboard", "/home", "/tech", "/change-passwordx", "/settings", "/api/x"]) assert.equal(L.allowedWhileFlagged(p), false, p);
  assert.equal(L.isApiPath("/api/x"), true);
  assert.equal(L.isApiPath("/apix"), false);
  assert.equal(L.mustChangePasswordFromClaims({ metadata: { mustChangePassword: true } }), true);
  assert.equal(L.mustChangePasswordFromClaims({ metadata: { mustChangePassword: false } }), false);
  assert.equal(L.mustChangePasswordFromClaims({ metadata: {} }), false);
  assert.equal(L.mustChangePasswordFromClaims(null), false);
  assert.equal(L.mustChangePasswordFromMetadata({ mustChangePassword: true }), true);
  assert.equal(L.mustChangePasswordFromMetadata(undefined), false);
});

test("change form: each field gets its own message", () => {
  const ok = { currentPassword: "Temp-Pass-123456", newPassword: "my new password", confirmPassword: "my new password" };
  assert.deepEqual(L.checkPasswordFields(ok), {});
  assert.deepEqual(L.checkPasswordFields({ currentPassword: "", newPassword: "", confirmPassword: "" }), {
    currentPassword: "Enter the temporary password you signed in with.",
    newPassword: "Enter a new password.",
    confirmPassword: "Type your new password again to confirm it.",
  });
  assert.equal(L.checkPasswordFields({ ...ok, newPassword: "short", confirmPassword: "short" }).newPassword, "Use at least 8 characters for your new password.");
  assert.equal(L.checkPasswordFields({ ...ok, newPassword: "abcdefghij", confirmPassword: "abcdefghij" }, 12).newPassword, "Use at least 12 characters for your new password.");
  assert.equal(
    L.checkPasswordFields({ ...ok, newPassword: ok.currentPassword, confirmPassword: ok.currentPassword }).newPassword,
    "Choose a new password that is different from your temporary one.",
  );
  assert.equal(L.checkPasswordFields({ ...ok, confirmPassword: "something else" }).confirmPassword, "The two new passwords do not match.");
});
