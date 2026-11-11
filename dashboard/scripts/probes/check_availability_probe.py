#!/usr/bin/env python3
"""Probes Sarah's check_availability (city filter) on a Convex deployment, end to end over HTTP.
Prints city names, counts, building names, bedroom types and leasing wording only (that is all
check_availability returns: no resident data). Never prints the tool secret.

From dashboard/:
  python3 -I scripts/probes/check_availability_probe.py --agent <agentId> --deployment brilliant-badger-615

POSTs to the deployed /tools/check-availability route with the x-simplr-tool-secret header read
from the deployment's env (ELEVENLABS_TOOL_SECRET); the team is resolved from the agent id
exactly as on a real phone call. Read-only: nothing is written, and neither ElevenLabs nor Twilio
is called.
"""
import argparse
import json
import subprocess
import urllib.request

# (city argument or None, what we expect)
CASES = [
    ("Albany", "matched Albany; includes the 687 State Street room wording"),
    ("albany ny", "matched Albany"),
    ("Skenectady", "matched Schenectady (misspelling)"),
    ("Troy", "matched Troy"),
    ("Clifton Park", "none_available, plus the cities that do have openings"),
    ("Buffalo", "unknown_city, plus the cities that do have openings"),
    ("anywhere", "no_preference: everything, as with no city"),
    (None, "not_given: everything (the behaviour before cities)"),
]


def npx(args, deployment):
    out = subprocess.run(
        ["npx", "convex", *args, "--deployment", deployment],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def units_line(u):
    parts = [u.get("community") or "?", u.get("city") or "no city", u.get("bedrooms") or "?"]
    parts.append(f"x{u.get('units_available')}")
    if u.get("leasing_facts"):
        parts.append(f"leasing_facts={u['leasing_facts']!r}")
    return " | ".join(str(p) for p in parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--deployment", required=True)
    ap.add_argument("--agent", required=True)
    a = ap.parse_args()

    secret = npx(["env", "get", "ELEVENLABS_TOOL_SECRET"], a.deployment)
    url = f"https://{a.deployment}.convex.site/tools/check-availability"
    for i, (city, expect) in enumerate(CASES, 1):
        body = {"conversation_id": f"probe-check-availability-{i}", "agent_id": a.agent}
        if city is not None:
            body["city"] = city
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), method="POST",
            headers={"content-type": "application/json", "x-simplr-tool-secret": secret},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read())
        units = res.get("all_units", [])
        print(f"{i}. city={city!r}\n   expect: {expect}")
        print(f"   city_status={res.get('city_status')} city_matched={res.get('city_matched')!r} "
              f"units_in_result={sum(u.get('units_available') or 0 for u in units)}")
        print("   cities_with_availability: " + ", ".join(
            f"{c['city']} {c['units_available']}" for c in res.get("cities_with_availability", [])))
        for u in units:
            print("   - " + units_line(u))
        if res.get("say"):
            print(f"   say: {res['say']}")
        # Every field that existed before cities must still be there.
        missing = [k for k in ("property_name", "property_address", "pets_allowed", "move_in_window_days",
                               "leasing_facts_rule", "requested_unit", "all_units") if k not in res]
        if missing:
            print(f"   MISSING FIELDS: {missing}")


if __name__ == "__main__":
    main()
