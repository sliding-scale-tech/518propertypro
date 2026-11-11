#!/usr/bin/env python3
"""Probes the log_maintenance_request guard over the deployed HTTP route: a call without a real issue
description must create nothing and tell Sarah to ask what is wrong (test call 2026-11-02, where
"Maintenance complaint." was logged and sent to the asset manager before the caller described it).

From dashboard/:
  python3 -I scripts/probes/maintenance_guard_probe.py --agent <agentId> --deployment brilliant-badger-615

POSTs to /tools/log-maintenance-request with the x-simplr-tool-secret header read from the deployment
env (ELEVENLABS_TOOL_SECRET, never printed), using fresh probe conversation ids, then checks that no
maintenance request or resident-call row exists for them. Only vague, non-emergency cases are sent,
so even a failing guard would create at most a routine request on a probe id (reported below).

Safety: before sending anything it checks that the guard is deployed, using lookup_caller's no-match
answer (read-only; it lost its "say" line in the same change). On older code it stops without
POSTing to log_maintenance_request, because there the first case would create a real routed request.
No call to ElevenLabs or Twilio.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

FAILS = []


def npx(args, deployment):
    out = subprocess.run(["npx", "convex", *args, "--deployment", deployment], capture_output=True, text=True, check=True)
    return out.stdout.strip()


def post(url, secret, body):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method="POST",
        headers={"content-type": "application/json", "x-simplr-tool-secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{f'  ({detail})' if detail else ''}")
    if not ok:
        FAILS.append(label)


def rows_for(table, ids, deployment):
    raw = npx(["data", table, "--limit", "200", "--order", "desc", "--format", "jsonLines"], deployment)
    rows = [json.loads(line) for line in raw.splitlines() if line.startswith("{")]
    return [r for r in rows if r.get("elevenLabsConversationId") in ids]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", required=True)
    ap.add_argument("--deployment", required=True)
    a = ap.parse_args()
    secret = npx(["env", "get", "ELEVENLABS_TOOL_SECRET"], a.deployment)
    site = f"https://{a.deployment}.convex.site"
    run = int(time.time())

    status, res = post(f"{site}/tools/lookup-caller", secret, {"conversation_id": f"probe-guard-{run}-lookup", "agent_id": a.agent})
    if status != 200 or "say" in res:
        sys.exit("The deployed code does not have the guard yet (lookup_caller still has its old say line). "
                 "Deploy first (npx convex dev --once), then run this again. Nothing was sent.")
    check("lookup_caller no-match has no question in it", res.get("matched") is False and "say" not in res)

    known = {"spoken_address": "1 Washington Avenue", "spoken_unit": "1", "caller_name": "Probe Tester"}
    cases = [
        ("generic description (the 2026-11-02 call)", {"description": "Maintenance complaint.", **known}),
        ("no description at all", dict(known)),
        ("only the caller's own details", {"description": "Probe Tester at 1 Washington Avenue, unit 1, has a maintenance issue.", **known}),
        ("placeholder description", {"description": "unknown"}),
    ]
    ids = []
    for i, (label, extra) in enumerate(cases, 1):
        conv = f"probe-guard-{run}-{i}"
        ids.append(conv)
        body = {"conversation_id": conv, "agent_id": a.agent, "issue_type": "other", "severity": "routine", **extra}
        status, res = post(f"{site}/tools/log-maintenance-request", secret, body)
        ok = (
            status == 200
            and res.get("logged") is False
            and res.get("request_created") is False
            and res.get("needs") == "issue_description"
            and res.get("say") == "Sure, I can help with that."
            and "What's going on?" in (res.get("message") or "")
            and "Never say this was logged" in (res.get("message") or "")
        )
        check(f"held back: {label}", ok, f"status {status}, say {res.get('say')!r}")

    # An emergency with no description at all is still rejected outright (it never reaches the guard).
    conv = f"probe-guard-{run}-emergency"
    ids.append(conv)
    status, res = post(f"{site}/tools/log-maintenance-request", secret,
                       {"conversation_id": conv, "agent_id": a.agent, "issue_type": "fire", "severity": "emergency"})
    check("emergency without description still a 400 error", status == 400 and res.get("logged") is False, f"status {status}")

    leaked = rows_for("maintenanceRequests", set(ids), a.deployment)
    check("no maintenance request created for any probe id", not leaked,
          ", ".join(f"#{r.get('number')} {r['_id']}" for r in leaked))
    legacy = rows_for("tenantIssues", set(ids), a.deployment)
    check("no resident-call row created for any probe id", not legacy, ", ".join(r["_id"] for r in legacy))

    print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
