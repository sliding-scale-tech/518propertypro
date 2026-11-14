#!/usr/bin/env node
// Production seed: staff accounts, roles, phones, photo emails and Sarah's owner phone menu.
// docs/PROD-RUNBOOK.md says when to run it. No packages. From dashboard/:
//
//   node scripts/prod/seedPeople.mjs plan  --input <people.json>
//   CLERK_SECRET_KEY=sk_live_... node scripts/prod/seedPeople.mjs apply --target prod \
//       --input <people.json> --out <file OUTSIDE the repo, e.g. ~/Desktop/518-temp-passwords.csv>
//
// What `apply` does, in this order (admins first, so a fresh deployment's team is created by an admin):
//   1. For each person with an email: find their Clerk account by email, or create it with a unique,
//      random temporary password and publicMetadata.mustChangePassword = true. The password is written
//      to --out straight away (one line per person, file mode 600) and NOWHERE else: not to the
//      console, not to Convex, not to the repo.
//   2. `npx convex run prodSeed:seedPerson` with the Clerk user id, email, name, roles, phone and
//      photo team (no password). That writes the users row, team membership and roles the way an
//      accepted invite does, and users.mustChangePassword.
//   3. `npx convex run prodSeed:seedRoutingDirectory` with the phone menu (draft only, not live).
// People without an email are NOT created (a login needs one): they are listed at the end.
//
// Idempotent: an existing Clerk account keeps its password (and gets no line in --out) unless its
// email is passed to --reset-password. Re-running with the same input changes nothing.
//
// Safety: `--target dev` runs only against the dev deployment in .env.local and needs a test key
// (sk_test_); `--target prod` runs `convex run --prod` and needs a live key (sk_live_). The key is
// read from the CLERK_SECRET_KEY environment variable, never from a file or an argument, and never
// printed. Emails and phones are masked in everything printed.

import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD = join(HERE, "..", "..");
const REPO = join(DASHBOARD, "..");
const CLERK_API = "https://api.clerk.com/v1";

const ROLES = ["admin", "asset_manager", "technician", "accountant"];
const PHOTO_TEAMS = ["gold", "silver", "make_up"];
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Arguments --------------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = { mode: argv[0], input: undefined, out: undefined, target: undefined, resetPassword: [] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${a} needs a value.`);
      return value;
    };
    if (a === "--input") out.input = next();
    else if (a === "--out") out.out = next();
    else if (a === "--target") out.target = next();
    else if (a === "--reset-password") out.resetPassword.push(...next().split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
    else if (a === "--password" || a === "--secret" || a === "--clerk-secret-key") {
      throw new Error(`${a} is not accepted: secrets come only from the CLERK_SECRET_KEY environment variable.`);
    } else throw new Error(`Unknown argument "${a}".`);
  }
  if (out.mode !== "plan" && out.mode !== "apply") throw new Error('The first argument must be "plan" or "apply".');
  if (!out.input) throw new Error("--input <people.json> is required.");
  if (out.mode === "apply") {
    if (out.target !== "dev" && out.target !== "prod") throw new Error('--target must be "dev" or "prod".');
    if (!out.out) throw new Error("--out <file outside the repo> is required: it is where the temporary passwords go.");
  }
  return out;
}

/** Null when the output path is acceptable, else why not. Never inside the repo, never an existing file. */
export function outPathProblem(path, repo = REPO) {
  if (!path) return "--out is required.";
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  const full = resolve(expanded);
  const rel = relative(resolve(repo), full);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return "--out must be outside the repository, so the passwords can never be committed.";
  }
  if (existsSync(full)) return `${full} already exists. Pass a new file name (nothing is ever overwritten).`;
  if (!existsSync(dirname(full))) return `The folder ${dirname(full)} does not exist.`;
  return null;
}

// --- Input ------------------------------------------------------------------------------------

/**
 * Checks the input file and returns { orgName, people, phoneMenu, problems }. Every problem names the
 * entry and the field, so the operator can fix the file without guessing.
 */
export function validateInput(data) {
  const problems = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { orgName: undefined, people: [], phoneMenu: [], problems: ["The input must be a JSON object with people and phoneMenu."] };
  }
  const orgName = typeof data.orgName === "string" && data.orgName.trim() ? data.orgName.trim() : undefined;
  const people = [];
  const seenEmails = new Set();
  if (!Array.isArray(data.people) || data.people.length === 0) problems.push("people: add at least one person.");
  for (const [i, p] of (Array.isArray(data.people) ? data.people : []).entries()) {
    const where = `people[${i}]${p && typeof p.firstName === "string" && p.firstName.trim() ? ` (${p.firstName.trim()})` : ""}`;
    if (!p || typeof p !== "object") {
      problems.push(`${where}: must be an object.`);
      continue;
    }
    const firstName = typeof p.firstName === "string" ? p.firstName.trim() : "";
    if (!firstName) problems.push(`${where}: firstName is required.`);
    const lastName = typeof p.lastName === "string" && p.lastName.trim() ? p.lastName.trim() : undefined;
    let email = null;
    if (p.email !== null && p.email !== undefined && p.email !== "") {
      if (typeof p.email !== "string" || !EMAIL.test(p.email.trim())) problems.push(`${where}: email "${p.email}" is not a valid address (use null when there is none yet).`);
      else {
        email = p.email.trim().toLowerCase();
        if (seenEmails.has(email)) problems.push(`${where}: email ${email} is used twice.`);
        seenEmails.add(email);
      }
    }
    const phone = typeof p.phone === "string" && p.phone.trim() ? p.phone.trim() : undefined;
    if (p.phone !== undefined && p.phone !== null && p.phone !== "" && (!phone || !E164.test(phone))) {
      problems.push(`${where}: phone must be in international format, like +15185550123.`);
    }
    const roles = Array.isArray(p.roles) ? [...new Set(p.roles.map((r) => String(r).trim()))] : [];
    if (roles.length === 0) problems.push(`${where}: roles is required (admin, asset_manager, technician, accountant).`);
    for (const r of roles) if (!ROLES.includes(r)) problems.push(`${where}: unknown role "${r}" (use admin, asset_manager, technician or accountant).`);
    if (roles.includes("admin") && roles.length > 1) problems.push(`${where}: admin already includes every role; list it alone.`);
    let photoTeam;
    if (p.photoTeam !== undefined && p.photoTeam !== null && p.photoTeam !== "") {
      if (!PHOTO_TEAMS.includes(p.photoTeam)) problems.push(`${where}: photoTeam must be gold, silver or make_up.`);
      else if (!roles.includes("asset_manager")) problems.push(`${where}: only an asset manager has a photoTeam.`);
      else photoTeam = p.photoTeam;
    }
    people.push({ firstName, lastName, email, phone, roles, photoTeam });
  }
  if (people.length > 0 && !people.some((p) => p.roles.includes("admin") && p.email)) {
    problems.push("people: at least one admin with an email is required (a fresh deployment's team is created by an admin).");
  }

  const phoneMenu = [];
  if (data.phoneMenu !== undefined) {
    if (!Array.isArray(data.phoneMenu)) problems.push("phoneMenu must be a list.");
    const keys = new Set();
    for (const [i, e] of (Array.isArray(data.phoneMenu) ? data.phoneMenu : []).entries()) {
      const where = `phoneMenu[${i}]`;
      if (!e || typeof e !== "object") {
        problems.push(`${where}: must be an object.`);
        continue;
      }
      if (!Number.isInteger(e.key) || e.key < 1 || e.key > 9) problems.push(`${where}: key must be a whole number from 1 to 9.`);
      else if (keys.has(e.key)) problems.push(`${where}: key ${e.key} is used twice.`);
      keys.add(e.key);
      const label = typeof e.label === "string" ? e.label.trim() : "";
      if (!label) problems.push(`${where}: label (the name callers hear) is required.`);
      const phone = typeof e.phone === "string" ? e.phone.trim() : "";
      if (!E164.test(phone)) problems.push(`${where}: phone must be in international format, like +15185550123.`);
      let personEmail;
      if (e.personEmail !== undefined && e.personEmail !== null && e.personEmail !== "") {
        personEmail = String(e.personEmail).trim().toLowerCase();
        if (!seenEmails.has(personEmail)) problems.push(`${where}: personEmail ${personEmail} is not one of the people above.`);
      }
      phoneMenu.push({ key: e.key, label, phone, ...(personEmail ? { personEmail } : {}) });
    }
    const sorted = [...keys].filter(Number.isInteger).sort((a, b) => a - b);
    if (sorted.some((k, i) => k !== i + 1)) problems.push("phoneMenu: keys must run 1, 2, 3 ... with no gaps.");
  }
  return { orgName, people, phoneMenu, problems };
}

/** Admins first (the first one creates the team on a fresh deployment), then file order. */
export function seedOrder(people) {
  return [...people.filter((p) => p.roles.includes("admin")), ...people.filter((p) => !p.roles.includes("admin"))];
}

// --- Passwords --------------------------------------------------------------------------------

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

/**
 * A random temporary password: 20 characters (about 120 bits) from the OS CSPRNG (crypto.randomInt,
 * no modulo bias), at least one upper, lower, digit and symbol, no look-alike characters (0/O, 1/l/I).
 */
export function generatePassword(length = 20) {
  if (length < 12) throw new Error("A temporary password must be at least 12 characters.");
  const pick = (set) => set[randomInt(set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// --- Masking ----------------------------------------------------------------------------------

export function maskEmail(email) {
  if (!email) return "(no email)";
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}•••@${email.slice(at + 1)}` : "•••";
}

export function maskPhone(phone) {
  if (!phone) return "(no phone)";
  return phone.length > 6 ? `${phone.slice(0, 5)}•••${phone.slice(-4)}` : "•••";
}

/** "Pat F." style label for logs. */
export function shortName(p) {
  return `${p.firstName}${p.lastName ? ` ${p.lastName[0]}.` : ""}`;
}

// --- Deployment safety ------------------------------------------------------------------------

export function configuredDeployment(envText) {
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*CONVEX_DEPLOYMENT\s*=\s*["']?([^\s#"']+)/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Null when the Clerk key fits the target, else why not. The key itself is never echoed. */
export function keyProblem(target, key) {
  if (!key || !key.trim()) return "Set CLERK_SECRET_KEY in the environment (not in a file in the repo).";
  if (target === "prod" && !key.startsWith("sk_live_")) return "--target prod needs the PRODUCTION Clerk secret key (sk_live_...).";
  if (target === "dev" && !key.startsWith("sk_test_")) return "--target dev needs the development Clerk secret key (sk_test_...).";
  return null;
}

/** The `npx convex run` flags that select the deployment. */
export function convexTargetFlags(target, envText) {
  if (target === "prod") return ["--prod"];
  const configured = configuredDeployment(envText);
  if (!configured || !configured.startsWith("dev:")) throw new Error("No dev deployment in .env.local (CONVEX_DEPLOYMENT=dev:<name>).");
  return ["--deployment", configured.slice(4)];
}

// --- Clerk Backend API ------------------------------------------------------------------------

async function clerk(key, method, path, body) {
  const res = await fetch(`${CLERK_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    // Clerk's error codes and messages only: never the request body (it may hold the password).
    const errs = Array.isArray(json?.errors) ? json.errors.map((e) => `${e.code ?? "error"}: ${e.long_message ?? e.message ?? ""}`).join("; ") : "";
    throw new Error(`Clerk ${method} ${path.split("?")[0]} failed (HTTP ${res.status})${errs ? `: ${errs.slice(0, 300)}` : ""}`);
  }
  return json;
}

async function findClerkUser(key, email) {
  const list = await clerk(key, "GET", `/users?email_address=${encodeURIComponent(email)}&limit=2`);
  const users = Array.isArray(list) ? list : (list?.data ?? []);
  if (users.length > 1) throw new Error(`More than one Clerk account has ${maskEmail(email)}; fix that in the Clerk dashboard first.`);
  return users[0] ?? null;
}

/** Marks the password as temporary, stamped with Clerk's own time for it (not this machine's clock). */
async function flagTemporary(key, user) {
  const issuedAt = user.password_last_updated_at ?? user.updated_at ?? user.created_at;
  await clerk(key, "PATCH", `/users/${user.id}/metadata`, {
    public_metadata: { mustChangePassword: true, tempPasswordIssuedAt: issuedAt },
  });
}

// --- Convex -----------------------------------------------------------------------------------

/** Only the error line: never echo the call's arguments. */
export function errorLine(stderr) {
  const lines = stderr.split(/\r?\n/).filter((l) => /Error/.test(l) && !/Request ID|Failed to run/.test(l));
  return (lines[0] ?? stderr.trim().split(/\r?\n/).pop() ?? "(no output)").slice(0, 400);
}

function jsonFromStdout(stdout) {
  const starts = [stdout.indexOf("{"), stdout.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("No JSON in the Convex output.");
  return JSON.parse(stdout.slice(Math.min(...starts)));
}

function convexRun(targetFlags, fn, args) {
  const cmd = ["convex", "run", ...targetFlags, "--typecheck", "disable", "--codegen", "disable", fn, JSON.stringify(args)];
  // No shell: arguments go to the process as-is, so nothing in the input file can become a command.
  const proc = spawnSync("npx", cmd, { cwd: DASHBOARD, encoding: "utf8" });
  if (proc.status !== 0) throw new Error(`${fn}: ${errorLine(proc.stderr ?? "")}`);
  return jsonFromStdout(proc.stdout ?? "");
}

// --- Main -------------------------------------------------------------------------------------

function printPlan(input, log) {
  log("\n=== Production seed: plan (nothing is created) ===");
  log(`Team name (used only if the deployment has no team yet): ${input.orgName ?? "518 Property Pro"}`);
  log("\nPeople, in seed order");
  for (const p of seedOrder(input.people)) {
    const login = p.email ? `login ${maskEmail(p.email)}` : "NO LOGIN (no email yet: skipped)";
    log(`  - ${shortName(p)}: ${p.roles.join(" + ")}; ${login}; phone ${maskPhone(p.phone)}${p.photoTeam ? `; photo email for ${p.photoTeam}` : ""}`);
  }
  if (input.phoneMenu.length) {
    log("\nOwner phone menu (draft only, stays off)");
    for (const e of [...input.phoneMenu].sort((a, b) => a.key - b.key)) log(`  ${e.key}. ${e.label}: ${maskPhone(e.phone)}`);
  }
}

async function main() {
  const log = console.log;
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(resolve(args.input), "utf8"));
  } catch (err) {
    console.error(`Could not read ${args.input}: ${err.message.slice(0, 200)}`);
    process.exit(2);
  }
  const input = validateInput(raw);
  if (input.problems.length) {
    console.error("The input file has problems:");
    for (const p of input.problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  if (args.mode === "plan") {
    printPlan(input, log);
    return;
  }

  const key = process.env.CLERK_SECRET_KEY;
  const kp = keyProblem(args.target, key);
  if (kp) {
    console.error(kp);
    process.exit(2);
  }
  const op = outPathProblem(args.out);
  if (op) {
    console.error(op);
    process.exit(2);
  }
  const envText = existsSync(join(DASHBOARD, ".env.local")) ? readFileSync(join(DASHBOARD, ".env.local"), "utf8") : "";
  const targetFlags = convexTargetFlags(args.target, envText);
  log(`Target: ${args.target === "prod" ? "PRODUCTION (convex run --prod)" : `dev deployment ${targetFlags[1]}`}`);

  const status = convexRun(targetFlags, "prodSeed:status", {});
  log(`Deployment team: ${status.org ? `"${status.org.name}" with ${status.members} member(s)` : "none yet (the first admin will create it)"}`);

  // The password file: created now, exclusively (never overwrites), readable by this user only.
  const outPath = resolve(args.out.startsWith("~/") ? join(homedir(), args.out.slice(2)) : args.out);
  const fd = openSync(outPath, "wx", 0o600);
  writeSync(fd, "name,email,temporary_password\n");
  let passwordsWritten = 0;
  const csv = (s) => `"${String(s).replace(/"/g, '""')}"`;

  const skipped = [];
  const failures = [];
  let orgId = status.org?.id ?? null;
  try {
    for (const p of seedOrder(input.people)) {
      const who = `${shortName(p)} (${maskEmail(p.email)})`;
      if (!p.email) {
        skipped.push(p);
        continue;
      }
      try {
        let user = await findClerkUser(key, p.email);
        let clerkResult = "existing, password unchanged";
        let mustChangePassword;
        if (!user) {
          const password = generatePassword();
          user = await clerk(key, "POST", "/users", {
            email_address: [p.email],
            first_name: p.firstName,
            ...(p.lastName ? { last_name: p.lastName } : {}),
            password,
            public_metadata: { mustChangePassword: true },
          });
          writeSync(fd, `${csv(`${p.firstName}${p.lastName ? ` ${p.lastName}` : ""}`)},${csv(p.email)},${csv(password)}\n`);
          fsyncSync(fd);
          passwordsWritten++;
          await flagTemporary(key, user);
          clerkResult = "created with a temporary password";
          mustChangePassword = true;
        } else if (args.resetPassword.includes(p.email)) {
          const password = generatePassword();
          user = await clerk(key, "PATCH", `/users/${user.id}`, { password, sign_out_of_other_sessions: true });
          writeSync(fd, `${csv(`${p.firstName}${p.lastName ? ` ${p.lastName}` : ""}`)},${csv(p.email)},${csv(password)}\n`);
          fsyncSync(fd);
          passwordsWritten++;
          await flagTemporary(key, user);
          clerkResult = "existing, given a new temporary password";
          mustChangePassword = true;
        } else if (user.public_metadata?.mustChangePassword === true) {
          // A run that stopped half-way: the account exists and is still on its temporary password.
          if (typeof user.public_metadata.tempPasswordIssuedAt !== "number") await flagTemporary(key, user);
          clerkResult = "existing, still on its temporary password";
          mustChangePassword = true;
        }
        const r = convexRun(targetFlags, "prodSeed:seedPerson", {
          clerkId: user.id,
          email: p.email,
          firstName: p.firstName,
          ...(p.lastName ? { lastName: p.lastName } : {}),
          roles: p.roles,
          ...(p.phone ? { phone: p.phone } : {}),
          ...(p.photoTeam ? { photoTeam: p.photoTeam } : {}),
          ...(input.orgName ? { orgName: input.orgName } : {}),
          ...(mustChangePassword !== undefined ? { mustChangePassword } : {}),
        });
        orgId = r.orgId;
        log(
          `  ✓ ${who} [users id ${r.userId}]: Clerk ${clerkResult}; Convex user ${r.user}, membership ${r.membership}` +
            `${r.org !== "existing" ? `, team ${r.org}` : ""}${r.photoEmail !== "none" ? `, photo email ${r.photoEmail}` : ""}` +
            `${r.mustChangePassword ? ", must change password" : ""}${r.note ? ` (${r.note})` : ""}`,
        );
      } catch (err) {
        failures.push(`${who}: ${err.message}`);
        log(`  ✗ ${who}: ${err.message}`);
      }
    }
  } finally {
    closeSync(fd);
  }

  if (input.phoneMenu.length && failures.length === 0) {
    try {
      const r = convexRun(targetFlags, "prodSeed:seedRoutingDirectory", { entries: input.phoneMenu });
      log(`\nOwner phone menu: ${r.result}, ${r.keys} keys (draft only; menu switch ${r.enabled ? "ON" : "off"}).`);
    } catch (err) {
      failures.push(`phone menu: ${err.message}`);
      log(`\nOwner phone menu: ✗ ${err.message}`);
    }
  } else if (input.phoneMenu.length) {
    log("\nOwner phone menu: not written because a person failed above. Fix that and run again.");
  }

  if (skipped.length) {
    log("\nNot created: no email yet, and a login needs one. Add their email to the input and run again:");
    for (const p of skipped) log(`  - ${shortName(p)} (${p.roles.join(" + ")}), phone ${maskPhone(p.phone)}`);
  }
  if (orgId) log(`\nTeam (organizations) id: ${orgId}. The roster importer takes it as --org, and an asset manager's users id as --asset-manager.`);
  log(`\nTemporary passwords written: ${passwordsWritten}, to ${outPath} (mode 600).`);
  log("Hand each one over in person or by phone, never by email or text. Delete the file once everyone has signed in.");
  if (failures.length) {
    log(`\n${failures.length} problem(s); everything else was applied. Fix and run again (it is safe to repeat).`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    // err.message only: Clerk and Convex errors above are already cut down to codes and messages.
    console.error(err instanceof Error ? err.message : "Unexpected error.");
    process.exit(1);
  });
}
