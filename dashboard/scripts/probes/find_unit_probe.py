#!/usr/bin/env python3
"""Probes Sarah's find_unit against a Convex deployment. Prints unit labels and building
addresses only (that is all find_unit ever returns); never prints the tool secret.

From dashboard/:
  python3 -I scripts/probes/find_unit_probe.py query --org <orgId> --deployment brilliant-badger-615
  python3 -I scripts/probes/find_unit_probe.py http  --agent <agentId> --deployment brilliant-badger-615

`query` runs internal sarahTools:findUnit through `npx convex run`. `http` POSTs to the deployed
/tools/find-unit route with the x-simplr-tool-secret header read from the deployment's env
(ELEVENLABS_TOOL_SECRET); the org is resolved from the agent id exactly as on a real call. Neither
mode calls ElevenLabs or Twilio.
"""
import argparse
import json
import subprocess
import sys
import urllib.request

# (spoken_address, spoken_unit or None, what we expect, short label)
CASES = [
    ("184 Remsen Street", "2", "matched 2"),
    ("184 Remsen Street", "7", "no similar; building has 2 units so all listed"),
    ("Remsen Street", "2", "ambiguous: the Remsen Street buildings"),
    ("Remson St 184", "2", "suggestion: 184 Remsen Street (not a match)"),
    ("687 State Street", "B", "similar B1-B4"),
    ("301 Green Street", "1", "similar, capped at 4, out of 17"),
    ("9 Lexington Court", None, "matched (house, no unit label)"),
    ("742 Evergreen Terrace", "3", "none, no suggestions"),
    ("301 Green Street", "one fourteen", "114 (exact reading)"),
    ("184 Remsen", "to", "2 (exact reading)"),
    ("687 State", "be two", "B2 (exact reading)"),
    ("687 State", "D2", "B2 as a suggestion, not a match"),
    ("1146 Madison", "three A", "4-3A as a suggestion"),
    ("301 Green Street", "Z9", "no list; ask to repeat (17 units)"),
    ("Lafayet Street", "3C", "suggestion: 204 Lafayette Street"),
    ("Union Street", "2", "too many buildings to list; ask the number"),
    ("", "2", "no address: never a list"),
    # v12: the street number is exactly ours and the street word is a loose mishearing.
    ("86 Ramsay Street", "2", "suggestion: 86 Remsen Street (not a match)"),
    ("86 Ramsden Street", "2", "suggestion: 86 Remsen Street (not a match)"),
    ("86 Main Street", "2", "none, no suggestions (no 86 Main-like building)"),
]

def norm(r):
    """One view over the internal query (camelCase) and HTTP (snake_case) shapes."""
    return {
        "matched": r.get("matched"),
        "unit": r.get("unitLabel", r.get("unit_label")),
        "building": r.get("propertyMatched", r.get("property_matched")),
        "similar": r.get("similar", r.get("similar_units")) or [],
        "all": r.get("allUnits", r.get("all_units")) or [],
        "options": r.get("addressOptions", r.get("address_options")) or [],
    }


def suggests(*opts):
    return lambda n: n["matched"] is False and not n["building"] and n["options"] == list(opts)


# Expected outcome per case (same order as CASES): the probe prints PASS / FAIL for each.
CHECKS = [
    lambda n: n["matched"] is True and n["unit"] == "2",
    lambda n: n["matched"] is False and n["building"] and n["similar"] == [] and n["all"] == ["2", "COM1"],
    lambda n: n["matched"] is False and len(n["options"]) == 5 and all("Remsen" in o for o in n["options"]),
    suggests("184 Remsen Street"),
    lambda n: n["matched"] is False and n["similar"] == ["B1", "B2", "B3", "B4"],
    lambda n: n["matched"] is False and len(n["similar"]) == 4,
    lambda n: n["matched"] is True and n["unit"] is None,
    lambda n: n["matched"] is False and not n["building"] and n["options"] == [],
    lambda n: n["matched"] is True and n["unit"] == "114",
    lambda n: n["matched"] is True and n["unit"] == "2",
    lambda n: n["matched"] is True and n["unit"] == "B2",
    lambda n: n["matched"] is False and n["similar"] == ["B2"],
    lambda n: n["matched"] is False and n["similar"] == ["4-3A"],
    lambda n: n["matched"] is False and n["building"] and n["similar"] == [] and n["all"] == [],
    suggests("204 Lafayette Street"),
    lambda n: n["matched"] is False and not n["building"] and n["options"] == [],
    lambda n: n["matched"] is False and not n["building"] and n["options"] == [],
    suggests("86 Remsen Street"),
    suggests("86 Remsen Street"),
    lambda n: n["matched"] is False and not n["building"] and n["options"] == [],
]
assert len(CHECKS) == len(CASES)

SAFE_KEYS = {
    # internal query (camelCase) and HTTP tool (snake_case) fields; all labels/addresses/counts
    "matched", "unitLabel", "propertyName", "propertyAddress", "propertyMatched", "unitCount",
    "needUnit", "similar", "allUnits", "addressStatus", "addressOptions", "addressOptionCount",
    "unit_label", "property_name", "property_address", "property_matched", "unit_count",
    "similar_units", "all_units", "address_options", "say",
}


def npx(args, deployment):
    out = subprocess.run(
        ["npx", "convex", *args, "--deployment", deployment],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


FAILED = []


def show(i, addr, unit, expect, result):
    kept = {k: v for k, v in result.items() if k in SAFE_KEYS}
    ok = CHECKS[i - 1](norm(result))
    if not ok:
        FAILED.append(i)
    print(f"{i:2}. {'PASS' if ok else 'FAIL'} address={addr!r} unit={unit!r}\n    expect: {expect}\n    got:    {json.dumps(kept)}")


def summary():
    print(f"\n{len(CASES) - len(FAILED)}/{len(CASES)} passed" + (f"; failed: {FAILED}" if FAILED else ""))
    if FAILED:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["query", "http"])
    ap.add_argument("--deployment", required=True)
    ap.add_argument("--org")
    ap.add_argument("--agent")
    a = ap.parse_args()

    if a.mode == "query":
        if not a.org:
            sys.exit("--org is required for query mode")
        for i, (addr, unit, expect) in enumerate(CASES, 1):
            args = {"orgId": a.org}
            if addr:
                args["spokenAddress"] = addr
            if unit is not None:
                args["spokenUnit"] = unit
            res = json.loads(npx(["run", "sarahTools:findUnit", json.dumps(args)], a.deployment))
            show(i, addr, unit, expect, res)
        summary()
        return

    if not a.agent:
        sys.exit("--agent is required for http mode")
    secret = npx(["env", "get", "ELEVENLABS_TOOL_SECRET"], a.deployment)
    url = f"https://{a.deployment}.convex.site/tools/find-unit"
    for i, (addr, unit, expect) in enumerate(CASES, 1):
        body = {"conversation_id": f"probe-find-unit-{i}", "agent_id": a.agent}
        if addr:
            body["spoken_address"] = addr
        if unit is not None:
            body["spoken_unit"] = unit
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), method="POST",
            headers={"content-type": "application/json", "x-simplr-tool-secret": secret},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            show(i, addr, unit, expect, json.loads(r.read()))
    summary()


if __name__ == "__main__":
    main()
