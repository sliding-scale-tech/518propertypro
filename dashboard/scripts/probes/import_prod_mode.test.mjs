// Guard tests for the PRODUCTION mode of the two importers (scripts/roster/import_roster.py and
// scripts/owners/import_owners.mjs, docs/PROD-RUNBOOK.md step 5). Nothing here touches a real
// deployment: `npx` is replaced by a fake first on PATH that records every call and answers with
// canned data, so the tests can prove what would have been sent. From dashboard/:
//   node --test scripts/probes/import_prod_mode.test.mjs
// The roster tests need the local workbook (docs/rosters/518-unit-rosters-normalized.xlsx, git-ignored)
// and python3 with openpyxl; they are skipped when either is missing. The dev-path tests need
// CONVEX_DEPLOYMENT=dev:<name> in .env.local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = join(HERE, "..", "..");
const ROSTER = join(DASHBOARD, "scripts", "roster", "import_roster.py");
const OWNERS = join(DASHBOARD, "scripts", "owners", "import_owners.mjs");
const WORKBOOK = join(DASHBOARD, "..", "docs", "rosters", "518-unit-rosters-normalized.xlsx");
const PROD = "dependable-crab-872";
const CLI = await import("../owners/import_owners.mjs");

// --- the fake npx -------------------------------------------------------------------------------------

const FAKE = `#!/usr/bin/env node
const fs = require("fs");
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPX_LOG, JSON.stringify(argv) + "\\n");
const fn = argv.find((a) => /^[A-Za-z]+:[A-Za-z]+$/.test(a));
const payload = JSON.parse(argv[argv.length - 1]);
const z = (n) => ({ created: 0, updated: 0, unchanged: n });
const summary = { dryRun: payload.dryRun, properties: z(3), units: z(5), unitsChanged: [], rentKeptForHistory: 0, rentKeptUnits: [],
  sourceRows: z(5), residents: { created: 0, updated: 0, deactivated: 0, unchanged: 4 }, available: [],
  ownerLinks: { linked: 0, created: 0, alreadyLinked: 0, needsReview: 0, errors: 0 } };
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
const fail = (o) => { process.stderr.write("Uncaught ConvexError: " + JSON.stringify(o) + "\\n    at handler"); process.exit(1); };
if (fn === "importPreflight:check") {
  const bad = process.env.FAKE_AM_BAD;
  out({ deployment: process.env.FAKE_DEPLOYMENT || "${PROD}", orgExists: process.env.FAKE_ORG_EXISTS !== "no", orgName: "Test Team",
    propertiesInOrg: process.env.FAKE_EMPTY ? 0 : 3, propertiesByCategory: { gold: 3 }, unitsInOrg: 5,
    assetManagers: (payload.assetManagers || []).map((a) => ({ category: a.category, userExists: bad !== "missing",
      inThisTeam: bad !== "other_team", isAssetManager: bad !== "not_am", firstName: "Pat" })) });
}
if (fn === "rosterImport:importProperties") {
  if (!payload.dryRun) out(summary);
  fail({ kind: "dry_run", compact: true, summary, secondPass: summary, lossless: { rows: payload.rows.length, cells: 1, diffs: [] } });
}
if (fn === "ownersImport:importOwners") {
  const empty = { owners: { created: 0, updated: 0, unchanged: 2 }, links: { created: 0, existing: 3 }, byCategory: {}, invalid: [], flags: [],
    ownersToCreate: [], linkedElsewhere: [], noOwner: [], crossCategory: [], twoOwnerNames: [], companyOwned: [], coOwned: [],
    skippedOpenDraft: [], differsFromRoster: [] };
  if (!payload.dryRun) out(empty);
  fail({ kind: "dry_run", dryRun: true, report: empty, secondPass: { owners: empty.owners, links: empty.links } });
}
process.stderr.write("fake npx: unexpected call " + fn);
process.exit(3);
`;

const BIN = mkdtempSync(join(tmpdir(), "fake-npx-"));
writeFileSync(join(BIN, "npx"), FAKE);
chmodSync(join(BIN, "npx"), 0o755);

function run(cmd, args, extraEnv = {}) {
  const log = join(mkdtempSync(join(tmpdir(), "fake-log-")), "calls.log");
  writeFileSync(log, "");
  const proc = spawnSync(cmd, args, {
    cwd: DASHBOARD,
    encoding: "utf8",
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_NPX_LOG: log, ...extraEnv },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const info = (c) => {
    const payload = JSON.parse(c[c.length - 1]);
    return { fn: c.find((a) => /^[A-Za-z]+:[A-Za-z]+$/.test(a)), payload, prod: c.includes("--prod"), deployment: c.includes("--deployment") };
  };
  return { status: proc.status, out: proc.stdout, err: proc.stderr, calls: calls.map(info), raw: calls };
}

const roster = (args, env) => run("python3", ["-I", ROSTER, ...args], env);
const owners = (args, env) => run("node", [OWNERS, ...args], env);

const havePython = spawnSync("python3", ["-I", "-c", "import openpyxl"], { encoding: "utf8" }).status === 0;
const canRoster = havePython && existsSync(WORKBOOK);
const devName = (() => {
  try {
    const d = CLI.configuredDeployment(readFileSync(join(DASHBOARD, ".env.local"), "utf8"));
    return d && d.startsWith("dev:") ? d.slice(4) : null;
  } catch {
    return null;
  }
})();

const ALL = ["--category", "all", "--org", "ORG", "--asset-manager-gold", "AMG", "--asset-manager-silver", "AMS", "--asset-manager-make-up", "AMM"];
const PROD_OK = ["--target", "prod", "--confirm-prod", PROD];

// --- roster importer: refusals (no sheet, no network) -------------------------------------------------

test("roster prod: a missing or wrong confirmation refuses and sends nothing", { skip: !havePython }, () => {
  for (const confirm of [[], ["--confirm-prod", "brilliant-badger-615"], ["--confirm-prod", "dependable-crab-87"], ["--confirm-prod", ""]]) {
    for (const command of ["dry-run", "apply", "verify"]) {
      const r = roster([command, "--target", "prod", ...confirm, ...ALL]);
      assert.notEqual(r.status, 0, `${command} ${confirm}`);
      assert.match(r.err, /--confirm-prod dependable-crab-872 must be typed out/);
      assert.equal(r.calls.length, 0, "no Convex call before the confirmation matches");
    }
  }
});

test("roster prod: a missing asset manager, org or a wrong deployment refuses before any call", { skip: !havePython }, () => {
  let r = roster(["apply", ...PROD_OK, "--category", "all", "--org", "ORG", "--asset-manager-gold", "AMG"]);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /--asset-manager-silver .*required/);
  assert.match(r.err, /--asset-manager-make-up .*required/);
  r = roster(["apply", ...PROD_OK, "--category", "silver"]);
  assert.match(r.err, /--org .*required/);
  assert.match(r.err, /--asset-manager .*required/);
  r = roster(["apply", ...PROD_OK, "--deployment", "brilliant-badger-615", ...ALL]);
  assert.match(r.err, /not the production deployment/);
  r = roster(["apply", ...PROD_OK, "--category", "all", "--org", "ORG", "--asset-manager", "AM"]);
  assert.match(r.err, /with --category all/);
  r = roster(["apply", "--target", "staging", ...ALL]);
  assert.notEqual(r.status, 0);
  for (const x of [r]) assert.equal(x.calls.length, 0);
});

// --- roster importer: the real flow against the fake (needs the workbook) ------------------------------

test("roster prod dry-run: --prod on every call, preflight first, nothing written", { skip: !canRoster }, () => {
  for (const args of [["dry-run", ...PROD_OK, ...ALL], ["apply", ...PROD_OK, ...ALL, "--dry-run"]]) {
    const r = roster(args);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /DRY RUN: nothing was written to production/);
    assert.equal(r.calls[0].fn, "importPreflight:check");
    assert.deepEqual(r.calls[0].payload.assetManagers, [
      { category: "gold", userId: "AMG" },
      { category: "silver", userId: "AMS" },
      { category: "make_up", userId: "AMM" },
    ]);
    for (const c of r.calls) {
      assert.ok(c.prod, "every call has --prod");
      assert.ok(!c.deployment, "no call names a dev deployment");
    }
    const imports = r.calls.filter((c) => c.fn === "rosterImport:importProperties");
    assert.equal(imports.length, 3, "one rolled-back dry run per team");
    assert.ok(imports.every((c) => c.payload.dryRun === true), "nothing but dry runs");
    // Counts per team are printed; the summary names no tenant.
    for (const team of ["Gold", "Silver", "Make Up"]) assert.match(r.out, new RegExp(`${team}.*: \\d+ rows`));
  }
});

test("roster prod apply: dry-run summary first, then real writes, all with --prod", { skip: !canRoster }, () => {
  const r = roster(["apply", ...PROD_OK, ...ALL]);
  assert.equal(r.status, 0, r.err);
  const imports = r.calls.filter((c) => c.fn === "rosterImport:importProperties");
  const firstWrite = imports.findIndex((c) => c.payload.dryRun === false);
  assert.equal(firstWrite, 3, "the three dry runs come before any write");
  assert.ok(imports.slice(0, 3).every((c) => c.payload.dryRun === true));
  assert.ok(imports.slice(3).every((c) => c.payload.dryRun === false));
  assert.ok(r.calls.every((c) => c.prod && !c.deployment));
  // Each team's own asset manager goes with its rows.
  const byCat = Object.fromEntries(imports.map((c) => [c.payload.category, c.payload.assetManagerUserId]));
  assert.deepEqual(byCat, { gold: "AMG", silver: "AMS", make_up: "AMM" });
});

test("roster prod: a deployment that is not the confirmed one, or an id that is not in prod, writes nothing", { skip: !canRoster }, () => {
  const cases = [
    [{ FAKE_DEPLOYMENT: "brilliant-badger-615" }, /reached deployment .brilliant-badger-615./],
    [{ FAKE_ORG_EXISTS: "no" }, /--org does not exist/],
    [{ FAKE_AM_BAD: "missing" }, /asset manager id does not exist/],
    [{ FAKE_AM_BAD: "other_team" }, /not a member of that team/],
    [{ FAKE_AM_BAD: "not_am" }, /asset_manager job role/],
  ];
  for (const [env, pattern] of cases) {
    const r = roster(["apply", ...PROD_OK, ...ALL], env);
    assert.notEqual(r.status, 0);
    assert.match(r.err, pattern);
    assert.deepEqual(r.calls.map((c) => c.fn), ["importPreflight:check"], "only the read-only check ran");
  }
});

test("roster prod verify: read-only calls, with --prod", { skip: !canRoster }, () => {
  const r = roster(["verify", ...PROD_OK, "--category", "gold", "--org", "ORG"]);
  assert.ok(r.calls.length >= 1 && r.calls.every((c) => c.prod && !c.deployment));
  assert.ok(r.calls.every((c) => c.fn === "importPreflight:check" || c.fn.startsWith("rosterImport:")));
  assert.ok(!r.calls.some((c) => c.fn === "rosterImport:importProperties"), "verify never imports");
});

// --- roster importer: the dev path is unchanged -------------------------------------------------------

test("roster dev: without --target it still uses --deployment, never --prod, no preflight", { skip: !(canRoster && devName) }, () => {
  const r = roster(["dry-run", "--category", "silver", "--org", "ORG", "--asset-manager", "AM", "--deployment", devName]);
  assert.equal(r.status, 0, r.err);
  assert.ok(r.calls.length >= 1);
  for (const c of r.calls) {
    assert.equal(c.fn, "rosterImport:importProperties");
    assert.ok(c.deployment && !c.prod);
    assert.ok(!("compact" in c.payload), "the dev dry run asks for the full payload, as before");
    assert.equal(c.payload.dryRun, true);
  }
  const call = r.raw[0];
  assert.deepEqual(call.slice(0, 5), ["convex", "run", "--deployment", devName, "--typecheck"]);
});

test("roster dev: prod-only flags and the production name are refused", { skip: !(havePython && devName) }, () => {
  const base = ["apply", "--category", "silver", "--org", "ORG", "--asset-manager", "AM"];
  let r = roster([...base, "--deployment", PROD]);
  assert.notEqual(r.status, 0);
  assert.match(r.err, /not the dev deployment/);
  r = roster([...base, "--deployment", devName, "--confirm-prod", PROD]);
  assert.match(r.err, /only goes with --target prod/);
  r = roster([...base, "--deployment", devName, "--dry-run"]);
  assert.match(r.err, /production-mode flag/);
  r = roster(["apply", "--category", "all", "--org", "ORG", "--asset-manager", "AM", "--deployment", devName]);
  assert.match(r.err, /only for --target prod/);
  assert.equal(r.calls.length, 0);
});

// --- owners importer ----------------------------------------------------------------------------------

test("owners prod: parseArgs needs the typed confirmation, and dev parsing is unchanged", () => {
  assert.throws(() => CLI.parseArgs(["apply", "--target", "prod", "--org", "o"]), /--confirm-prod dependable-crab-872/);
  assert.throws(() => CLI.parseArgs(["apply", "--target", "prod", "--confirm-prod", "brilliant-badger-615", "--org", "o"]), /does not match/);
  assert.throws(() => CLI.parseArgs(["apply", "--target", "prod", "--confirm-prod", PROD, "--org", "o", "--deployment", "x-1"]), /not the production deployment/);
  assert.throws(() => CLI.parseArgs(["apply", "--target", "prod", "--confirm-prod", PROD]), /--org/);
  assert.throws(() => CLI.parseArgs(["apply", "--target", "staging", "--org", "o", "--deployment", "d"]), /--target/);
  assert.throws(() => CLI.parseArgs(["apply", "--org", "o", "--deployment", "d", "--confirm-prod", PROD]), /only goes with --target prod/);
  assert.throws(() => CLI.parseArgs(["apply", "--org", "o", "--deployment", "d", "--dry-run"]), /production-mode flag/);
  assert.throws(() => CLI.parseArgs(["apply", "--org", "o", "--deployment", "d", "--prod"]), /--prod/);
  assert.deepEqual(CLI.parseArgs(["dry-run", "--org", "o1", "--deployment", "happy-cat-1"]), { mode: "dry-run", org: "o1", deployment: "happy-cat-1" });
  const prod = CLI.parseArgs(["apply", "--target", "prod", "--confirm-prod", PROD, "--org", "o1", "--dry-run"]);
  assert.equal(prod.target, "prod");
  assert.equal(prod.dryRunFlag, true);
  assert.deepEqual(CLI.targetFlags(prod), ["--prod"]);
  assert.deepEqual(CLI.targetFlags({ deployment: "happy-cat-1" }), ["--deployment", "happy-cat-1"]);
});

test("owners prod: refusals send nothing; dry-run and --dry-run write nothing", () => {
  let r = owners(["apply", "--target", "prod", "--org", "ORG"]);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 0);
  r = owners(["apply", "--target", "prod", "--confirm-prod", "wrong-name-1", "--org", "ORG"]);
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.length, 0);
  for (const args of [["dry-run", ...PROD_OK, "--org", "ORG"], ["apply", ...PROD_OK, "--org", "ORG", "--dry-run"]]) {
    r = owners(args);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /DRY RUN: nothing was written to production/);
    assert.deepEqual(r.calls.map((c) => c.fn), ["importPreflight:check", "ownersImport:importOwners"]);
    assert.ok(r.calls.every((c) => c.prod && !c.deployment));
    assert.equal(r.calls[1].payload.dryRun, true);
  }
});

test("owners prod apply: a rolled-back dry run first, then the write, all with --prod", () => {
  const r = owners(["apply", ...PROD_OK, "--org", "ORG"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.calls.map((c) => [c.fn, c.payload.dryRun]), [["importPreflight:check", undefined], ["ownersImport:importOwners", true], ["ownersImport:importOwners", false]]);
  assert.ok(r.calls.every((c) => c.prod && !c.deployment));
});

test("owners prod: wrong deployment, no team or no properties yet writes nothing", () => {
  for (const [env, pattern] of [
    [{ FAKE_DEPLOYMENT: "brilliant-badger-615" }, /reached deployment/],
    [{ FAKE_ORG_EXISTS: "no" }, /does not exist/],
    [{ FAKE_EMPTY: "1" }, /roster import first/],
  ]) {
    const r = owners(["apply", ...PROD_OK, "--org", "ORG"], env);
    assert.notEqual(r.status, 0);
    assert.match(r.err, pattern);
    assert.deepEqual(r.calls.map((c) => c.fn), ["importPreflight:check"]);
  }
});

test("owners dev: without --target the call is exactly as before", { skip: !devName }, () => {
  const r = owners(["dry-run", "--org", "ORG", "--deployment", devName]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.raw, [
    ["convex", "run", "--deployment", devName, "--typecheck", "disable", "--codegen", "disable", "ownersImport:importOwners", JSON.stringify({ orgId: "ORG", dryRun: true })],
  ]);
  assert.match(r.out, /dry-run: owners from the unit rosters -> /);
  const bad = owners(["dry-run", "--org", "ORG", "--deployment", PROD]);
  assert.notEqual(bad.status, 0);
  assert.equal(bad.calls.length, 0);
});

// --- the read-only Convex query -----------------------------------------------------------------------

test("importPreflight is internal and read-only", () => {
  const src = readFileSync(join(DASHBOARD, "convex", "importPreflight.ts"), "utf8");
  assert.ok(!/internalMutation|\bmutation\b|\bdb\.(insert|patch|replace|delete)\b|export const \w+ = (query|action)\(/.test(src));
  assert.equal((src.match(/export const \w+ = internalQuery\(/g) ?? []).length, 2);
});
