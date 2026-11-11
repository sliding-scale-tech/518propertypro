#!/usr/bin/env node
// Owners import from the unit rosters (ROS WP4, docs/specs/ros-build-spec.md 8.3). No packages.
// From dashboard/:
//
//   node scripts/owners/import_owners.mjs dry-run --org <orgId> --deployment <dev-name>
//   node scripts/owners/import_owners.mjs apply   --org <orgId> --deployment <dev-name>
//
// Calls `npx convex run ownersImport:importOwners` on the named deployment. The mutation reads the
// owners from the properties already imported from the rosters (ownerName / ownerEmails); this
// script sends only the org and the mode. Safety: it refuses unless --deployment is the dev
// deployment in dashboard/.env.local (CONVEX_DEPLOYMENT=dev:<name>), and it never passes --prod.
// A dry run rolls back and prints what a real run would do. The management fee is never set by the
// import (the accountant sets it per owner).
//
// Output never contains a full email: the report masks them, and Convex errors are cut down to the
// error line only.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = join(HERE, "..", "..");

export function parseArgs(argv) {
  const out = { mode: argv[0], org: undefined, deployment: undefined };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--org") out.org = argv[++i];
    else if (a === "--deployment") out.deployment = argv[++i];
    else if (a === "--prod") throw new Error("--prod is not allowed: this script only runs against a dev deployment.");
    else throw new Error(`Unknown argument "${a}".`);
  }
  if (out.mode !== "dry-run" && out.mode !== "apply") throw new Error('The first argument must be "dry-run" or "apply".');
  if (!out.org) throw new Error("--org <orgId> is required.");
  if (!out.deployment) throw new Error("--deployment <dev deployment name> is required.");
  if (!/^[a-z0-9-]+$/.test(out.deployment)) throw new Error("--deployment must be a deployment name like brilliant-badger-615.");
  return out;
}

/** The CONVEX_DEPLOYMENT value in an .env.local text, or null. */
export function configuredDeployment(envText) {
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*CONVEX_DEPLOYMENT\s*=\s*["']?([^\s#"']+)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Null when the deployment is allowed, else the reason it is refused. */
export function deploymentProblem(deployment, envText) {
  const configured = configuredDeployment(envText);
  if (configured !== `dev:${deployment}`) {
    return `--deployment ${deployment} is not the dev deployment in .env.local (${configured ?? "none"}); refusing.`;
  }
  return null;
}

/** The data of a dry-run ConvexError in the CLI's stderr, or null. */
export function dryRunData(stderr) {
  const at = stderr.indexOf("ConvexError: {");
  if (at < 0) return null;
  const text = stderr.slice(at + "ConvexError: ".length);
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  return null;
}

/** Only the error line: never echo the call's arguments, which hold owner emails. */
export function errorLine(stderr) {
  const lines = stderr.split(/\r?\n/).filter((l) => /Error/.test(l) && !/Request ID|Failed to run/.test(l));
  const line = lines[0] ?? stderr.trim().split(/\r?\n/).pop() ?? "(no output)";
  return line.slice(0, 400);
}

function jsonFromStdout(stdout) {
  const starts = [stdout.indexOf("{"), stdout.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("No JSON in the Convex output.");
  return JSON.parse(stdout.slice(Math.min(...starts)));
}

const CATEGORY_LABEL = { gold: "Gold", silver: "Silver", make_up: "Make Up", none: "No category" };
const cat = (c) => CATEGORY_LABEL[c] ?? c;

export function printReport(report, mode, secondPass, log = console.log) {
  const list = (title, items, fmt) => {
    log(`\n${title} (${items.length})`);
    for (const it of items) log(`  - ${fmt(it)}`);
  };
  log(`\n=== Owners import from the unit rosters: ${mode} ===`);
  log(`Owners: created ${report.owners.created}, updated ${report.owners.updated}, unchanged ${report.owners.unchanged}`);
  log(`Links:  created ${report.links.created}, existing ${report.links.existing}`);
  if (secondPass) {
    log(
      `Second pass (idempotency): owners created ${secondPass.owners.created}, updated ${secondPass.owners.updated}; links created ${secondPass.links.created}`,
    );
  }
  log("\nPer category");
  for (const [c, n] of Object.entries(report.byCategory)) {
    if (n.properties === 0) continue;
    log(
      `  - ${cat(c)}: ${n.properties} properties, ${n.withOwner} with owner, ${n.noOwner} without, ${n.companyOwned} company-owned; links to create ${n.linksToCreate}, existing ${n.linksExisting}`,
    );
  }
  const plural = (n) => `${n} propert${n === 1 ? "y" : "ies"}`;
  list("NOT IMPORTED: owner data the owner rules refuse (fix the roster)", report.invalid, (i) => `${i.owner}: ${i.message} (${plural(i.properties)})`);
  list("Identity flags (name + email; review, never merged automatically)", report.flags, (f) => `[${f.flag}] ${f.detail}`);
  list("Owners to create", report.ownersToCreate, (o) => o);
  list("Not linked: the property is already linked to another owner (roster owner differs from the linked owner)", report.linkedElsewhere, (l) =>
    `${l.property}: roster says ${l.roster}, linked to ${l.linkedTo.join(" + ")}`,
  );
  list("Properties with no owner on the roster (link by hand)", report.noOwner, (n) => n);
  list("Owners across more than one roster", report.crossCategory, (x) => x);
  list("Names that may be two owners (review; not split)", report.twoOwnerNames, (t) => `${t.owner} [${t.reason}] - ${plural(t.properties)}`);
  list("Company-owned properties (linked; flagged)", report.companyOwned, (c) => `${c.owner}: ${c.properties.join("; ")}`);
  list("Co-owned (statements blocked until a split is set)", report.coOwned, (c) => `${c.property}: ${c.owners.join(" + ")}`);
  list("Not linked: property is on an open statement draft", report.skippedOpenDraft, (s) => s);
  list("Existing owner differs from the roster (kept)", report.differsFromRoster, (d) => `${d.owner}: ${d.fields.join(", ")}`);
  list("Not linked: in doubt, left for the Owners page's Needs-an-owner list", report.needsOwner ?? [], (n) => `${n.property}: roster says ${n.roster}; ${n.reason}`);
  list("Owners NOT created: none of their properties gets a link", report.notCreated ?? [], (o) => o);
  list("Owner emails ignored (not a valid address)", report.ignoredEmails ?? [], (e) => e);
  if (report.truncated && Object.keys(report.truncated).length > 0) {
    log(`\nSome lists were cut to fit the dry-run report: ${Object.entries(report.truncated).map(([k, n]) => `${k} -${n}`).join(", ")}`);
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error("Usage: node scripts/owners/import_owners.mjs dry-run|apply --org <orgId> --deployment <dev-name>");
    process.exit(2);
  }
  const problem = deploymentProblem(args.deployment, readFileSync(join(DASHBOARD, ".env.local"), "utf8"));
  if (problem) {
    console.error(problem);
    process.exit(2);
  }
  const dryRun = args.mode === "dry-run";
  const payload = JSON.stringify({ orgId: args.org, dryRun });
  const cmd = [
    "convex",
    "run",
    "--deployment",
    args.deployment,
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "ownersImport:importOwners",
    payload,
  ];
  console.log(`${args.mode}: owners from the unit rosters -> ${args.deployment}`);
  const proc = spawnSync("npx", cmd, { cwd: DASHBOARD, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (dryRun) {
    const data = dryRunData(proc.stderr ?? "");
    if (!data || data.kind !== "dry_run") {
      console.error(`Dry run failed: ${errorLine(proc.stderr ?? "")}`);
      process.exit(1);
    }
    printReport(data.report, "dry run (rolled back, nothing written)", data.secondPass);
    return;
  }
  if (proc.status !== 0) {
    console.error(`Import failed: ${errorLine(proc.stderr ?? "")}`);
    process.exit(1);
  }
  printReport(jsonFromStdout(proc.stdout), "applied");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
