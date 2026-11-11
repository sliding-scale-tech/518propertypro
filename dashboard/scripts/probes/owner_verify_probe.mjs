// Dev-safe end-to-end probe for verify_owner and the check_staff_availability gate (B36), through the
// deployment's real HTTP tool routes with the tool secret (read from the deployment env, never
// printed). Picks a Make Up property that has two owner emails, reads the emails in-script and NEVER
// prints them: output is statuses and the property's street line only. Uses probe_ conversation ids
// and deletes their verification rows afterwards (the masked audit events stay: the trail is
// append-only). No ElevenLabs calls, no texts, no transfers.
//   node scripts/probes/owner_verify_probe.mjs [--deployment brilliant-badger-615]
import { execFileSync } from "node:child_process";

const DASH = new URL("../../", import.meta.url).pathname;
const dep = process.argv.includes("--deployment") ? process.argv[process.argv.indexOf("--deployment") + 1] : null;
const depArgs = dep ? ["--deployment", dep] : [];
const AGENT = "agent_7501m4zy3xw9ec78wjhrmp3q6e7a";
const npx = (args) => execFileSync("npx", ["convex", ...args, ...depArgs], { cwd: DASH, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64e6 });

const secret = npx(["env", "get", "ELEVENLABS_TOOL_SECRET"]).trim();
const site = npx(["env", "get", "CONVEX_SITE_URL"]).trim();
if (!secret || !site) throw new Error("ELEVENLABS_TOOL_SECRET or CONVEX_SITE_URL is not set on this deployment.");

const props = npx(["data", "properties", "--format", "jsonLines", "--limit", "1000"])
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const target = props.find((p) => p.category === "make_up" && (p.ownerEmails ?? []).length >= 2 && /^\d+\s/.test(p.address?.formatted ?? p.name));
if (!target) throw new Error("No Make Up property with two owner emails was found.");
const street = (target.address?.formatted ?? target.name).split(",")[0].trim();
const [email1, email2] = target.ownerEmails;
// The second owner's email as a caller would say it: "x dot y at domain dot com", in capitals.
const spoken = email2.toUpperCase().replace(/@/, " at ").replace(/\./g, " dot ").replace(/_/g, " underscore ").replace(/-/g, " dash ");
const wrong = `x${email1}`; // a near miss: one extra letter

async function tool(path, body) {
  const res = await fetch(`${site}/tools/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-simplr-tool-secret": secret },
    body: JSON.stringify({ agent_id: AGENT, ...body }),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const results = [];
const check = (name, ok, detail) => results.push({ name, pass: !!ok, detail });
const runId = Date.now();
const c1 = `probe_owner_verify_${runId}_a`;
const c2 = `probe_owner_verify_${runId}_b`;

try {
  console.log(`Property: ${street} (Make Up, ${target.ownerEmails.length} owner emails on file)`);
  let r = await tool("verify-owner", { conversation_id: c1, spoken_property_address: street });
  check("address only -> confirm the property", r.status === "needs_property_confirmation" && r.candidates?.length === 1 && r.candidates[0] === street, `${r.status}: "${r.say}"`);
  const misheard = street.replace(/^(\d+)\s+(\S)(\S*)/, (_, n, a, rest) => `${n} ${a}${rest.slice(0, -1)}${rest.slice(-1) === "e" ? "a" : "e"}`);
  r = await tool("verify-owner", { conversation_id: c1, spoken_property_address: misheard, email: email1 });
  check("misheard street -> options, never a guess, no email check", r.status === "needs_property_confirmation" && !r.verified, `${r.status} ${JSON.stringify(r.candidates)}`);
  r = await tool("check-staff-availability", { conversation_id: c1, person: "Nina" });
  check("availability before verification -> no number", r.available === false && r.transfer_number === "none", `${r.status}, transfer_number=${r.transfer_number}`);
  r = await tool("verify-owner", { conversation_id: c1, spoken_property_address: street, email: wrong });
  check("near-miss email -> not_verified, 1 attempt left", r.status === "not_verified" && r.attempts_left === 1 && !JSON.stringify(r).includes("@"), `${r.status}, attempts_left=${r.attempts_left}: "${r.say}"`);
  r = await tool("verify-owner", { conversation_id: c1, spoken_property_address: street, email: spoken });
  check("second owner's email, spoken in capitals -> verified", r.status === "verified" && r.verified === true, r.status);
  r = await tool("verify-owner", { conversation_id: c1, spoken_property_address: street, email: wrong });
  check("already verified call is not re-checked", r.status === "verified", r.status);
  r = await tool("check-staff-availability", { conversation_id: c1, person: "Nina" });
  check("availability after verification, menu not published -> menu_off, no number", r.available === false && r.status === "menu_off" && r.transfer_number === "none", `${r.status}, transfer_number=${r.transfer_number}`);

  r = await tool("verify-owner", { conversation_id: c2, spoken_property_address: street, email: wrong });
  check("call 2, wrong email -> not_verified", r.status === "not_verified" && r.attempts_left === 1, r.status);
  r = await tool("verify-owner", { conversation_id: c2, spoken_property_address: street, email: `y${email1}` });
  check("call 2, wrong again -> take a message", r.status === "no_match_take_message", `${r.status}: "${r.say}"`);
  r = await tool("verify-owner", { conversation_id: c2, spoken_property_address: street, email: email1 });
  check("call 2, third try even with the right email -> refused", r.status === "no_match_take_message", r.status);
  r = await tool("verify-owner", { conversation_id: c2, spoken_property_address: street, email: "hello there" });
  check("call 2, unreadable email after lock -> still refused", r.status === "no_match_take_message", r.status);
} finally {
  let removed = 0;
  for (const c of [c1, c2]) removed += Number(npx(["run", "ownerRouting:deleteProbeVerifications", JSON.stringify({ elevenLabsConversationId: c })]).trim() || 0);
  const left = [c1, c2].map((c) => npx(["run", "ownerRouting:wasVerified", JSON.stringify({ orgId: target.orgId, elevenLabsConversationId: c })]).trim());
  console.log(`Cleanup: removed ${removed} probe verification rows; verified rows left for the probe calls: ${left.join(", ")}`);
}

for (const x of results) console.log(`${x.pass ? "PASS" : "FAIL"}  ${x.name}  [${x.detail}]`);
const failed = results.filter((x) => !x.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
