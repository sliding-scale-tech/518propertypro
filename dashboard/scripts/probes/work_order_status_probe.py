#!/usr/bin/env python3
"""End-to-end probe of Sarah's check_work_order_status over the deployed HTTP route.

From dashboard/:
  python3 -I scripts/probes/work_order_status_probe.py run --agent <agentId> --deployment brilliant-badger-615
  python3 -I scripts/probes/work_order_status_probe.py cleanup --deployment brilliant-badger-615

`run` creates TEST fixtures (convex/probeFixtures.ts: inserted directly, so nothing is routed or
notified and no counter moves), POSTs to /tools/check-work-order-status with the tool secret read
from the deployment env (ELEVENLABS_TOOL_SECRET, never printed), checks every answer, then deletes
the fixtures (also on failure). `cleanup` only deletes fixtures. No call to ElevenLabs or Twilio.

Resident names are read from the deployment to build the "right name" cases and are NEVER printed:
output says "resident A", "resident B" ... and every answer is scanned for resident name words.
"""
import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request

ORG = "ns7c7c822tacme3cjfmje01jt18g914c"
ADMIN_USER = "mx7ebkw0x0jgrddjaeaveb23v98h4x6r"
TEST_PHONE = "+15185550142"  # 555-01xx: reserved for fiction, never a real line
# (property street line, unit label): the units the fixtures go on. None has a real request.
UNIT_A = ("433 3rd Street", "1")  # no requests; a pair entry with a shared surname
UNIT_B = ("90 Hill Street", "1")  # one request with a scheduled visit, recorded with TEST_PHONE as caller ID
UNIT_C = ("858 Union Street", "2")  # several requests and work orders; three residents
ALLOWED_KEYS = {"unit_identified", "lookup_error", "request_count", "request", "choices", "likely_ref", "say", "message"}


def npx(args, deployment, capture=True):
    out = subprocess.run(["npx", "convex", *args, "--deployment", deployment], capture_output=capture, text=True, check=True)
    return out.stdout.strip() if capture else ""


def table(name, deployment):
    raw = npx(["data", name, "--limit", "2000", "--format", "jsonl"], deployment)
    return [json.loads(line) for line in raw.splitlines() if line.startswith("{")]


def run_fn(fn, args, deployment):
    return json.loads(npx(["run", fn, json.dumps(args)], deployment))


def cleanup(deployment):
    removed = run_fn("probeFixtures:deleteStatusFixtures", {"orgId": ORG}, deployment)
    print(f"cleanup: removed requests {sorted(removed['requests'])}, work orders {sorted(removed['workOrders'])}, attached rows {removed['attached']}")
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["run", "cleanup"])
    ap.add_argument("--deployment", required=True)
    ap.add_argument("--agent")
    a = ap.parse_args()
    if a.mode == "cleanup":
        cleanup(a.deployment)
        return
    if not a.agent:
        sys.exit("--agent is required for run")

    props = {p["_id"]: p for p in table("properties", a.deployment) if p["orgId"] == ORG}
    units = table("units", a.deployment)
    residents = [r for r in table("residents", a.deployment) if r["orgId"] == ORG and r["active"]]

    def unit_id(spec):
        hits = [u["_id"] for u in units if u["unitNumber"] == spec[1] and props.get(u["propertyId"], {}).get("name") == spec[0]]
        if len(hits) != 1:
            sys.exit(f"could not find unit {spec}")
        return hits[0]

    ua, ub, uc = unit_id(UNIT_A), unit_id(UNIT_B), unit_id(UNIT_C)
    names = {u: [r["fullName"] for r in residents if r["unitId"] == u] for u in (ua, ub, uc)}
    # Every resident name word (4+ letters) in the team: none may appear in any answer.
    secret_words = {w.lower() for r in residents for w in re.findall(r"[A-Za-z']+", r["fullName"]) if len(w) >= 4}

    # Resident A: the FIRST person of unit A's "X & Y Surname" entry, said with the shared surname.
    left, right = [s.strip() for s in names[ua][0].split("&")]
    name_a = f"{left.split()[0]} {right.split()[-1]}"
    # Resident B: unit B's second person, full name.
    name_b = names[ub][0].split("&")[1].strip()
    # Resident C: a first name that is unique among unit C's residents, said alone.
    firsts = [n.split()[0] for n in names[uc]]
    name_c = next(f for f in firsts if firsts.count(f) == 1)

    fixtures = {
        "orgId": ORG,
        "createdBy": ADMIN_USER,
        "requests": [
            {"key": "b1", "unitId": ub, "status": "work_order_created", "title": "Water leak: bathroom sink dripping", "issueType": "water_leak", "daysAgoCreated": 3, "daysAgoUpdated": 2, "callerNumber": TEST_PHONE},
            {"key": "c1", "unitId": uc, "status": "forwarded_to_pat", "title": "Water leak: kitchen sink dripping", "issueType": "water_leak", "daysAgoCreated": 5, "daysAgoUpdated": 4},
            {"key": "c2", "unitId": uc, "status": "work_order_created", "title": "Electrical: bedroom outlet not working", "issueType": "electrical", "daysAgoCreated": 8, "daysAgoUpdated": 6},
            {"key": "c3", "unitId": uc, "status": "closed_out_of_scope", "title": "Light bulb out in the hallway", "issueType": "tenant_responsibility", "daysAgoCreated": 6, "daysAgoUpdated": 5, "closeReason": "Tenant responsibility under the lease"},
            {"key": "c4", "unitId": uc, "status": "closed_out_of_scope", "title": "Old closed request (outside the window)", "issueType": "other", "daysAgoCreated": 60, "daysAgoUpdated": 45, "closeReason": "Other"},
        ],
        "workOrders": [
            {"key": "b1wo", "unitId": ub, "requestKey": "b1", "status": "assigned", "title": "Fix bathroom sink", "daysAgoCreated": 2, "dueInDays": 4, "window": "2-4pm"},
            {"key": "c2wo", "unitId": uc, "requestKey": "c2", "status": "assigned", "title": "Replace bedroom outlet", "daysAgoCreated": 6, "dueInDays": 4, "window": "9am-12pm"},
            {"key": "c5", "unitId": uc, "status": "completed", "title": "Replace smoke detector battery", "daysAgoCreated": 12, "completedDaysAgo": 10},
        ],
    }

    secret = npx(["env", "get", "ELEVENLABS_TOOL_SECRET"], a.deployment)
    url = f"https://{a.deployment}.convex.site/tools/check-work-order-status"
    stamp = int(time.time())
    results = []

    def call(conv, **body):
        payload = {"conversation_id": conv, "agent_id": a.agent, **body}
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={"content-type": "application/json", "x-simplr-tool-secret": secret})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())

    def check(label, res, ok, note=""):
        text = json.dumps(res).lower()
        words = set(re.findall(r"[a-z']+", text))
        leaked = sorted(w for w in secret_words if w in words)
        extra = sorted(set(res) - ALLOWED_KEYS)
        phone_leak = "5550142" in text
        passed = bool(ok) and not leaked and not extra and not phone_leak
        results.append(passed)
        shown = {k: res[k] for k in ("unit_identified", "lookup_error", "request_count", "likely_ref") if k in res}
        if "request" in res:
            shown["request"] = res["request"]
        if "choices" in res:
            shown["choices"] = [{"summary": c["summary"], "reported": c["reported"]} for c in res["choices"]]
        shown["say"] = res.get("say")
        problems = (f" LEAKED name words: {len(leaked)}" if leaked else "") + (f" EXTRA keys: {extra}" if extra else "") + (" PHONE LEAK" if phone_leak else "")
        print(f"{'PASS' if passed else 'FAIL'} {label}{(' - ' + note) if note else ''}{problems}\n     {json.dumps(shown)}")

    print("creating TEST fixtures (no notifications) ...")
    created = run_fn("probeFixtures:createStatusFixtures", fixtures, a.deployment)
    print("created:", {k: f"#{v['number']}" for k, v in created.items()})
    try:
        addr_a, addr_b, addr_c = UNIT_A[0], UNIT_B[0], UNIT_C[0]
        WRONG = "Zed Quillfeather"  # invented; matches nobody
        GENERIC_VISIT = "A technician visit is scheduled, and your asset manager will confirm the exact time with you."
        st = lambda x: x.get("request", {}).get("status", "")
        convs = {}

        # 1. Nothing on record: same answer whoever is asking.
        r = call(f"probe-wos-{stamp}-1", spoken_address=addr_a, spoken_unit=UNIT_A[1], caller_name=name_a)
        check("1a. none: resident A (pair entry, shared surname)", r, r.get("request_count") == 0 and "don't see an open request" in r.get("say", ""))
        r2 = call(f"probe-wos-{stamp}-1b", spoken_address=addr_a, spoken_unit=UNIT_A[1], caller_name=WRONG)
        check("1b. none: a wrong name gets the identical answer", r2, r2 == r)

        # 2. One request with a scheduled visit: the status for everyone, the day and time only when verified.
        convs["2a"] = f"probe-wos-{stamp}-2a"
        r = call(convs["2a"], spoken_address=addr_b, spoken_unit=UNIT_B[1], caller_name=WRONG)
        check("2a. one request, wrong name: status, visit without day or time", r, st(r) == GENERIC_VISIT and "summary" in r.get("request", {}))
        convs["2b"] = f"probe-wos-{stamp}-2b"
        r = call(convs["2b"], spoken_address=addr_b, spoken_unit=UNIT_B[1], caller_name=name_b)
        check("2b. one request, resident B (full name): visit day, date and time", r, st(r).startswith("A technician visit is scheduled for ") and st(r).endswith(", 2-4pm."))
        r = call(f"probe-wos-{stamp}-2c", spoken_address=addr_b, spoken_unit=UNIT_B[1], caller_id=TEST_PHONE)
        check("2c. caller ID = the number on the request: visit day and time", r, st(r).startswith("A technician visit is scheduled for "))
        r = call(f"probe-wos-{stamp}-2d", spoken_address=addr_c, spoken_unit=UNIT_C[1], caller_id=TEST_PHONE, issue_description="the outlet in my bedroom")
        check("2d. same caller ID on another unit: status flow as unverified", r, len(r.get("choices", [])) == 4)

        # 3. Several requests: summaries first (no status), then the one picked.
        conv3 = f"probe-wos-{stamp}-3"
        r = call(conv3, spoken_address=addr_c, spoken_unit=UNIT_C[1], caller_name=name_c, issue_description="the outlet in my bedroom", first_reported="last week")
        want = f"MR-{created['c2']['number']}"
        check(
            "3a. several: resident C (first name alone, unique)",
            r,
            "request" not in r and len(r.get("choices", [])) == 4 and r.get("likely_ref") == want and "status" not in json.dumps(r.get("choices")),
            "4 items: 2 open + 2 closed in 30 days; the 45-day-old close is left out",
        )
        r3w = call(f"probe-wos-{stamp}-3w", spoken_address=addr_c, spoken_unit=UNIT_C[1], caller_name=WRONG, issue_description="the outlet in my bedroom", first_reported="last week")
        check("3b. several: a wrong name gets the identical list", r3w, r3w == r)
        r = call(conv3, spoken_address=addr_c, spoken_unit=UNIT_C[1], caller_name=name_c, request_ref=want)
        check("3c. resident C picks the outlet request: visit day and time", r, st(r).startswith("A technician visit is scheduled for ") and st(r).endswith(", 9am-12pm."))
        r = call(f"probe-wos-{stamp}-3w", spoken_address=addr_c, spoken_unit=UNIT_C[1], caller_name=WRONG, request_ref=want)
        check("3d. wrong name picks the outlet request: no day or time", r, st(r) == GENERIC_VISIT)
        r = call(conv3, spoken_address=addr_c, spoken_unit=UNIT_C[1], caller_name=name_c, request_ref=f"MR-{created['c3']['number']}")
        check("3e. the bulb request: tenant-responsibility reason", r, "tenant's responsibility" in st(r))
        r = call(conv3, spoken_address=addr_c, spoken_unit=UNIT_C[1], caller_name=name_c, request_ref=f"WO-{created['c5']['number']}")
        check("3f. the hand-made work order: completed on <date>", r, st(r).startswith("The work was completed on"))

        # 4. The real test call of 2026-10-31 (browser, no caller ID): the caller's own words for their
        # name (exact first name, surname heard as an S/C sound-alike), 1 Washington Avenue unit 5,
        # broken window. That unit's request is the user's own test request; read only.
        convs["4a"] = f"probe-wos-{stamp}-4a"
        r4 = call(convs["4a"], spoken_address="1 Washington Avenue", spoken_unit="5", caller_name="Mary Sermic", issue_description="broken window", first_reported="a few hours ago")
        check("4a. real call: resident D, sound-alike surname, 1 Washington Ave unit 5", r4, st(r4) == "We've received it, and it's waiting for your asset manager to review.")
        convs["4b"] = f"probe-wos-{stamp}-4b"
        r = call(convs["4b"], spoken_address="1 Washington Avenue", spoken_unit="5", caller_name=WRONG, issue_description="broken window")
        check("4b. same unit, wrong name: same status, nothing hints at the name", r, r == r4, "no visit is scheduled on that request, so the answers are identical")

        # 5. Unit not identified exactly: refused.
        r = call(f"probe-wos-{stamp}-5a", spoken_address="86 Ramsay Street", spoken_unit="2", caller_name=name_b)
        check("5a. suggestion-only address (86 Ramsay Street): refused", r, r.get("unit_identified") is False and "request" not in r and "choices" not in r)
        r = call(f"probe-wos-{stamp}-5b", spoken_address=addr_c, spoken_unit="22", caller_name=name_c)
        check("5b. similar-but-different unit label: refused", r, r.get("unit_identified") is False and "request" not in r)

        # 6. After 3 unverified lookups on one call, a right name no longer unlocks the visit time.
        conv6 = f"probe-wos-{stamp}-6"
        for _ in range(3):
            call(conv6, spoken_address=addr_b, spoken_unit=UNIT_B[1], caller_name=WRONG)
        r = call(conv6, spoken_address=addr_b, spoken_unit=UNIT_B[1], caller_name=name_b)
        check("6. right name after 3 unverified tries on one call: status, no visit time", r, st(r) == GENERIC_VISIT)

        # 7. A real lookup error (team not resolvable: no agent id, unknown call): the "live status" line.
        payload = {"conversation_id": f"probe-wos-{stamp}-7", "spoken_address": addr_b, "spoken_unit": UNIT_B[1], "caller_name": name_b}
        req7 = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={"content-type": "application/json", "x-simplr-tool-secret": secret})
        with urllib.request.urlopen(req7, timeout=30) as resp:
            r = json.loads(resp.read())
        check("7. lookup error: only here the 'can't see the live status' line", r, r.get("lookup_error") is True and "live status" in r.get("say", "") and "request" not in r)

        # 8. Staff see the verification result in the audit log (never the caller).
        audit = [e for e in table("auditEvents", a.deployment) if e["entity"] == "conversation" and e["entityId"] in convs.values()]
        got = {k: sorted({e["action"] for e in audit if e["entityId"] == v}) for k, v in convs.items()}
        expect = {"2a": ["work_order_status_unverified"], "2b": ["work_order_status_verified"], "4a": ["work_order_status_verified"], "4b": ["work_order_status_unverified"]}
        check("8. verification result recorded for staff per call", {}, got == expect, json.dumps(got))
    finally:
        cleanup(a.deployment)
    print(f"\n{sum(results)}/{len(results)} passed")
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    main()
