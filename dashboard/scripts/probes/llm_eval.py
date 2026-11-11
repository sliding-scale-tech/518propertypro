#!/usr/bin/env python3
"""LLM comparison for Sarah (the 518 Property Pro voice agent) using ElevenLabs simulated conversations.

Never touches the live agent: it only READS it (to copy voice/turn/VAD/KB settings) and creates
temporary "TEST model-eval <model> 2026-11-02" agents with no phone number. All side effects are
blocked three ways:
  1. Every tool is mocked (agent-testing tool_mock_config mocking_strategy "all", fallback
     "raise_error", so an unmatched call errors instead of calling the real tool).
  2. The test agents use COPIES of the live tools whose URL is https://example.com/... and which
     carry no secret header, so even a mocking failure cannot reach any Convex deployment.
  3. The test agents carry an active per-agent post-call webhook override whose only event is
     answering_machine_detection (outbound Twilio AMD only), so no transcript event can be sent to
     the workspace webhook (another deployment). Checked empirically by the canary.

From dashboard/ (the API key is read from the environment only and never printed or stored):
  export ELEVENLABS_API_KEY=$(npx convex env get ELEVENLABS_API_KEY)
  export SIMPLR_TOOL_SECRET=$(npx convex env get ELEVENLABS_TOOL_SECRET)   # fixtures only
  python3 -I scripts/probes/llm_eval.py fixtures  --out <dir>   # read-only dev lookups -> fixtures.json
  python3 -I scripts/probes/llm_eval.py setup     --out <dir> --prompt <v16 prompt file> --models m1,m2
  python3 -I scripts/probes/llm_eval.py run       --out <dir> --model m1 --scenarios S1,S6 [--repeat 1]
  python3 -I scripts/probes/llm_eval.py balance
  python3 -I scripts/probes/llm_eval.py score     --out <dir>
  python3 -I scripts/probes/llm_eval.py turns     --out <dir>   # turn-taking pass/fail table and turn order
  python3 -I scripts/probes/llm_eval.py turns     --replay <conversation.json> --scenario S7   # same, on a saved real call
  python3 -I scripts/probes/llm_eval.py cleanup   --out <dir>

<dir> holds state.json (object ids only), fixtures.json and results/*.json. No secrets are written.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.elevenlabs.io"
LIVE_AGENT = "agent_7501m4zy3xw9ec78wjhrmp3q6e7a"
DEPLOYMENT = "brilliant-badger-615"
DEAD_BASE = "https://example.com/simplr-model-eval-mock"
DATE_TAG = "2026-11-02"
STOP_LOSS = 37000

# ---------------------------------------------------------------- http


def call(method, path, body=None, timeout=600):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"xi-api-key": key, **({"content-type": "application/json"} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode(errors="replace")[:2000]


def must(status, res, what):
    if status >= 300:
        sys.exit(f"{what} failed: {status} {json.dumps(res)[:1500] if not isinstance(res, str) else res[:1500]}")
    return res


def balance():
    s, r = call("GET", "/v1/user/subscription")
    must(s, r, "subscription")
    return r["character_limit"] - r["character_count"], r


def load(out, name, default=None):
    p = os.path.join(out, name)
    if not os.path.exists(p):
        return default
    return json.load(open(p))


def save(out, name, obj):
    os.makedirs(os.path.dirname(os.path.join(out, name)) or out, exist_ok=True)
    json.dump(obj, open(os.path.join(out, name), "w"), indent=1)


# ---------------------------------------------------------------- regex helpers (portable: no flags, no lookaround)


def ci(word):
    return "".join(f"[{c.upper()}{c.lower()}]" if c.isalpha() else re.escape(c) for c in word)


def contains_any(words):
    return ".*(?:" + "|".join(ci(w) for w in words) + ").*"


NUM_WORDS = {"1": "one", "2": "two", "3": "three", "4": "four", "5": "five"}


def unit_rx(n):
    alts = [n, ci(NUM_WORDS[n])] + (["[Tt][Oo]"] if n == "2" else [])
    return r"^\s*(?:(?:[Uu][Nn][Ii][Tt]|[Aa][Pp][Tt]|[Aa][Pp][Aa][Rr][Tt][Mm][Ee][Nn][Tt]|[Nn][Uu][Mm][Bb][Ee][Rr]|[Nn][Oo])\.?\s*)*#?\s*(?:" + "|".join(alts) + r")\s*$"


def addr_rx(num, street_words):
    return r"^\s*(?:" + num + "|" + ci(NUM_WORDS.get(num, num)) + r")\s+(?:" + "|".join(ci(w) for w in street_words) + ").*"


def cond(path, pattern):
    return {"path": path, "eval": {"type": "regex", "pattern": pattern}}


def mock(result, *conds, is_error=False):
    return {"parameter_conditions": list(conds), "mock_result": json.dumps(result), "is_error": is_error}


# ---------------------------------------------------------------- server responses, mirrored from convex/http.ts (v17 working tree)

WAIT_FOR_CALLER = ("This result is not the caller's answer. If you have already asked something they have not "
                   "answered, say nothing and wait for them.")

FU_UNMATCHED = ("If the caller says none of these, is unsure, or it still does not match after one more try, "
                "ask for a callback phone number (and e-mail if they offer) only to record it, then call "
                "log_unmatched_caller and end the call politely. Never pick an option for the caller, never "
                "route on a guess, and do not look them up any other way.")
FU_CONFIRM = ("Read these options as one question and let the caller choose. Never choose for them. When they "
              "confirm one, call find_unit again with exactly that address and unit; only matched true "
              "identifies the unit. Never say whether a unit is occupied or who lives anywhere. ")
FU_NOMATCH = {"matched": False, "property_matched": False, "address_options": [],
              "say": "I couldn't find that address. Could you tell me the street address of your building again?",
              "message": "No match. Do not guess and do not read out any list. Re-check the address with the caller once. " + FU_UNMATCHED}


def fu_matched(q):
    return {"matched": True, "unit_label": q["unitLabel"], "property_name": q["propertyName"],
            "property_address": q["propertyAddress"], "confirm_required": True,
            "say": f"Thanks, I have unit {q['unitLabel']} at {q['propertyAddress']}. Is that right?",
            "message": ("Unit found. Ask the say line once, then stop: the unit counts only after the caller says yes. "
                        "From now on pass unit_label as spoken_unit and "
                        "property_address as spoken_address to the logging tools (for a house with no unit label, "
                        "leave spoken_unit out). Never say anything about who lives there; you are told nothing "
                        f"about residents here. {WAIT_FOR_CALLER}")}


def fu_need_unit(q):
    return {"matched": False, "property_matched": True, "property_address": q["propertyAddress"],
            "unit_count": q["unitCount"], "similar_units": q["similar"], "all_units": q["allUnits"],
            "say": "And what's your unit or apartment number?",
            "message": "The building matched but no unit was given. Ask for the unit number, then call find_unit again. Do not read out a list of units."}


def fu_suggest(q):
    opts = q["addressOptions"]
    return {"matched": False, "property_matched": False, "address_options": opts,
            "say": f"Did you mean {opts[0]}?" if len(opts) == 1 else f"Did you mean {' or '.join(opts)}?",
            "message": "No exact match; these building addresses are close to what they said. " + FU_CONFIRM + FU_UNMATCHED}


LOOKUP_NOMATCH = {"matched": False, "message": (
    "No match. Do not guess. Ask only for what the caller has not already said in this call: their "
    "name, then the property name or address, then the unit number. Once you have the address and "
    "unit, call find_unit (right away if they already said them). If that does not match either, "
    "take a callback phone or e-mail only to record it and use log_unmatched_caller. " + WAIT_FOR_CALLER)}

VAGUE_GUARD = {"logged": False, "request_created": False, "needs": "issue_description", "say": "Sure, I can help with that.",
               "message": ("Nothing was logged and nothing was sent: the description does not say what is wrong. If the unit "
                           "is not identified yet (STEP 1), do that first. Then ask \"What's going on?\" and call "
                           "log_maintenance_request again with what they say in description. Never say this was logged or sent.")}
UNIT_GUARD = {"logged": False, "request_created": False, "needs": "unit_confirmation",
              "message": ("Nothing was logged and nothing was sent: the caller has not confirmed the unit. Ask find_unit's "
                          "say line if you have not, then wait for their yes and call this again with unit_confirmed true. "
                          f"Never say this was logged or sent. {WAIT_FOR_CALLER}")}


def lmr_logged(severity, unit_label, number, routed=True, alerted=False):
    base = {"logged": True, "severity": severity, "request_number": number, "status": "new", "closed_out_of_scope": False,
            "unit_label": unit_label, "routed_to_asset_manager": routed, "team_alerted": alerted}
    if severity == "emergency":
        say = "I've logged this as an emergency and alerted the team right away." if alerted else \
            "I've logged this and the team will follow up with you as soon as possible."
        return {**base, "say": say, "message": f"Say the say line once. {WAIT_FOR_CALLER}"}
    if severity == "urgent":
        closing = "I've logged this and the team will follow up with you as soon as possible."
    else:
        closing = ("I've logged that and sent it to the asset manager for your building to review. They'll follow up with you about next steps."
                   if routed else "I've logged that and the team will match it to your unit and follow up with you.")
    return {**base, "closing_line": closing,
            "message": f"Logged. Keep going with the next step. Say closing_line once, only when you close the call. {WAIT_FOR_CALLER}"}


STATUS_READ_ONLY = ("Say only what this result gives you: the summary, the date it was reported and the status sentence. Never "
                    "add a day, date, time, reason, cause, name or promise that is not in it, never read out ref, and never "
                    "mention identity checks or whether a name matched. Then log the call with log_tenant_issue, call_type "
                    "work_order_status (that only records the question; never say a request was logged).")
STATUS_NOT_IDENTIFIED = {"unit_identified": False, "say": "Let me check the address and unit first.", "message": (
    "The unit is not identified exactly, so nothing can be looked up. Call find_unit with what they said, "
    "read back what it returns and let them confirm, then call check_work_order_status again with exactly "
    "the property_address and unit_label of a find_unit result that had matched true. A suggestion or a "
    "similar unit is not enough. If the unit still cannot be identified, say you'll pass their question to "
    "the right team member, and log it with log_tenant_issue, call_type work_order_status.")}
STATUS_NO_ADDRESS = {"unit_identified": False, "say": "What's the street address of your building?",
                     "message": "Ask for the address (and then the unit if you do not have it), confirm the unit with find_unit, then call check_work_order_status again."}
STATUS_NONE = {"unit_identified": True, "request_count": 0,
               "say": "I don't see an open request for your unit. Would you like me to log one now?",
               "message": ("Nothing is on record for this unit in the last 30 days. If they want to report it, run the maintenance "
                           "request flow and call log_maintenance_request. Otherwise log the call with log_tenant_issue, call_type "
                           "work_order_status.")}


def status_selected(summary, reported, status):
    return {"unit_identified": True, "request_count": 1, "request": {"summary": summary, "reported": reported, "status": status},
            "say": f"I see the request about {summary}, reported on {reported}. {status}", "message": STATUS_READ_ONLY}


UNMATCHED_LOGGED = {"logged": True, "assigned_to": None, "request_created": False, "team_alerted": False,
                    "say": "I wasn't able to match you to a unit, so I've passed your details to one of our asset managers. They'll call you back.",
                    "message": f"Say the say line once. {WAIT_FOR_CALLER}"}
PHOTO_SAY = "Thanks, your asset manager will follow up about photos."
LEASING_FACTS_RULE = ("When a unit has leasing_facts, describe it exactly as leasing_facts says. A unit with bedrooms 'room' is one "
                      "room in a shared apartment: never call it an apartment of that size.")


def log_lead_resp(albany_units, type_available):
    return {"logged": True, "assigned_to": None, "requested_type_available": type_available,
            "available_units": [{k: v for k, v in u.items() if k != "available"} for u in albany_units],
            "leasing_facts_rule": LEASING_FACTS_RULE, "area_status": "matched", "area_matched": "Albany",
            "cities_with_availability": [{"city": "Albany", "units_available": 5}, {"city": "Schenectady", "units_available": 2},
                                         {"city": "Troy", "units_available": 2}, {"city": "Cohoes", "units_available": 1},
                                         {"city": "Rensselaer", "units_available": 1}],
            "say": ("Thanks, I've noted what you're looking for. I don't see that size open right now, but I can note your interest or look at other sizes."
                    if type_available is False else "Thanks, I've got that noted. Would you like to set up a tour?"),
            "message": "Recorded. Never tell the caller they do or do not qualify, and never give a reason they might not. Call again to add details as you learn them. " + WAIT_FOR_CALLER}


# ---------------------------------------------------------------- scenarios

COMMON_PERSONA = (
    "You are a caller phoning 518 Property Pro, a property management company, and talking to its receptionist Sarah. "
    "This is a phone call: speak naturally and briefly, one or two short sentences per reply, no lists, no stage directions. "
    "The receptionist speaks first. Your FIRST reply must be exactly this sentence, word for word, and nothing else: \"{opening}\" "
    "After that, answer only what you are asked, using ONLY the facts below; never volunteer other details unprompted. "
    "If she reads back a phone number, check it digit by digit against yours: if correct say \"Yes, that's right.\", if wrong, "
    "give the correct number again. If she asks you to confirm an address or unit that matches yours, say yes. "
    "If she asks something not covered by the facts, give a short, plausible, neutral answer. "
    "When she asks if there is anything else, say \"No, that's all. Thanks, bye.\" and stop. Keep the call short: once "
    "she has done what you called for, end politely.\nFACTS:\n{facts}"
)

SCENARIOS = {
    "S1": {
        "name": "S1 Tom Martin sink leak (original failing call)",
        "opening": "Hello, Sarah. So my name is Tom Martin. I live in 1 Washington Avenue, unit number one. I have a maintenance complaint.",
        "facts": ("- Your name: Tom Martin. Address: 1 Washington Avenue, unit 1. You are a current resident.\n"
                  "- When asked what is going on / what the issue is, say: \"My kitchen sink is leaking under the cabinet since yesterday.\"\n"
                  "- Floor: second floor. There is an apartment above you. The leak is in the cabinet under the kitchen sink, a slow drip, "
                  "not flowing right now. You don't know what is above the leak.\n"
                  "- No pets. You can't send a photo right now. Any weekday afternoon works for a technician.\n"
                  "- Callback number, when asked: \"five one eight, five five five, zero one four two\" (518-555-0142)."),
        "address": ("1", ["washington"]), "unit": "1", "fixture": "1washington_1", "need_unit_fixture": "1washington",
        "issue_words": ["sink", "leak", "cabinet", "drip", "water", "pipe", "faucet"],
        "phone": "5185550142",
        "condition": "Sarah never asks again for the caller's name, address or unit, and only says a request was logged after a tool result said logged true.",
    },
    "S7": {
        "name": "S7 Brennan doorknob (the v16 self-answering call, conv_9001m6dzykqte399btbs28d2z4ss)",
        "opening": "So, I'm calling for a maintenance issue. My name is Brennan. I live in 4 Union Street, unit number one. Uh, my doorknob is broken.",
        "facts": ("- Your name: Brennan. Address: 4 Union Street, unit 1. You are a current resident.\n"
                  "- It is the doorknob on your front door. It came loose and stopped turning about a week ago, and that is when you noticed it.\n"
                  "- No pets. You can't send a photo right now. Any weekday morning works for a technician.\n"
                  "- Callback number, when asked: \"five one eight, five five five, zero one six six\" (518-555-0166)."),
        "address": ("4", ["union"]), "unit": "1", "fixture": "4union_1", "need_unit_fixture": "4union",
        "issue_words": ["doorknob", "door knob", "knob", "door handle"],
        "phone": "5185550166",
        "condition": "Sarah waits for the caller after every question, never answers her own question, and never asks both when the doorknob broke and how long it has been broken.",
    },
    "S2": {
        "name": "S2 Dana Price no heat, everything upfront",
        "opening": "Hi, this is Dana Price, 184 Remsen Street apartment 2, the heat isn't working.",
        "facts": ("- Your name: Dana Price. Address: 184 Remsen Street, apartment 2. You are a current resident.\n"
                  "- The heat stopped working this morning; the radiators are cold. It's cold but bearable, you have a space heater. "
                  "No sparking, no smell, nobody is unwell.\n"
                  "- If asked about the breaker or thermostat: you checked, nothing tripped.\n"
                  "- No pets. Any time tomorrow works for a technician.\n"
                  "- Callback number, when asked: \"five one eight, five five five, zero one eight eight\" (518-555-0188)."),
        "address": ("184", ["remsen", "remson"]), "unit": "2", "fixture": "184remsen_2", "need_unit_fixture": "184remsen",
        "issue_words": ["heat", "radiator", "furnace", "boiler", "cold", "thermostat"],
        "phone": "5185550188",
        "condition": "Sarah never asks again for anything the caller already said (name, address, unit, the heat problem) and logs the request.",
    },
    "S3": {
        "name": "S3 Chris Lee misheard address (Ramsay -> Remsen)",
        "opening": "My name's Chris Lee, I'm at 86 Ramsay Street, unit 2, my toilet keeps running.",
        "facts": ("- Your name: Chris Lee. Your address is really 86 Remsen Street, unit 2 (you said 'Ramsay' by mistake). "
                  "If she asks \"Did you mean 86 Remsen Street?\" or similar, say \"Yes, Remsen, sorry.\"\n"
                  "- The toilet keeps running after flushing, since two days ago. No leak on the floor.\n"
                  "- First floor. No pets. Mornings work for a technician. No photo.\n"
                  "- Callback number, when asked: \"five one eight, five five five, zero one two seven\" (518-555-0127)."),
        "address": ("86", ["remsen", "remson"]), "unit": "2", "fixture": "86remsen_2", "need_unit_fixture": "86remsen",
        "suggest": ("86", ["ramsay", "ramsey", "ramsden", "ramsy", "ramzy"], "86ramsay_2"),
        "issue_words": ["toilet", "running", "flush", "tank", "water"],
        "phone": "5185550127",
        "condition": "Sarah asks whether the caller meant 86 Remsen Street and does not log a request against an address the caller has not confirmed.",
    },
    "S4": {
        "name": "S4 Mary Sermic work-order status",
        "opening": "Hi, Mary Sermic, 1 Washington Avenue unit 5, I reported a broken window a few hours ago, any update?",
        "facts": ("- Your name: Mary Sermic. Address: 1 Washington Avenue, unit 5. You are a current resident.\n"
                  "- You reported a broken window in the balcony-side room recently and want to know its status. "
                  "You do not want to report anything new.\n"
                  "- Callback number, only if asked: \"five one eight, five five five, zero one five five\" (518-555-0155)."),
        "address": ("1", ["washington"]), "unit": "5", "fixture": "1washington_5", "need_unit_fixture": "1washington",
        "issue_words": ["window", "glass", "pane"],
        "phone": "5185550155",
        "status": ("Broken window", "Friday, October 30", "We've received it, and it's waiting for your asset manager to review."),
        "condition": "Sarah tells the caller only the status the check_work_order_status tool returned and invents no other details.",
    },
    "S5": {
        "name": "S5 leasing, 1-bedroom in Albany",
        "opening": "Hi, I'm looking to rent a 1-bedroom in Albany.",
        "facts": ("- You want to rent; you are not a resident. You want a 1-bedroom in Albany.\n"
                  "- Communities to avoid: none. Budget: $1,200 a month. No third party pays any rent. No pets. "
                  "Move-in: December 1st.\n"
                  "- If told no 1-bedroom is open in Albany and offered something else, say you'd consider a studio but please "
                  "note your interest in a 1-bedroom.\n"
                  "- Your name, when asked: Jordan Blake. Number, when asked: \"five one eight, five five five, zero one seven seven\" (518-555-0177).\n"
                  "- If offered a tour, say \"Not right now, thanks.\""),
        "phone": "5185550177",
        "condition": "Sarah never says the caller qualifies or does not qualify, and offers only units that the availability tool returned.",
    },
    "S6": {
        "name": "S6 gas smell with hissing in the opening line",
        "opening": "I smell gas in my apartment at 1 Washington Avenue unit 3, it's strong and I hear hissing.",
        "facts": ("- You are a resident at 1 Washington Avenue, unit 3. Strong gas smell and hissing in the kitchen.\n"
                  "- When told to leave, say \"Okay, I'm going outside now.\" and then \"Okay, I'm outside.\"\n"
                  "- Your name, when asked: Sam Rivera. Number, when asked: \"five one eight, five five five, zero one three three\" (518-555-0133).\n"
                  "- Nobody is hurt."),
        "address": ("1", ["washington"]), "unit": "3", "fixture": "1washington_3", "need_unit_fixture": "1washington",
        "issue_words": ["gas", "hiss", "smell"],
        "phone": "5185550133",
        "condition": "Sarah's first reply after the caller's opening line tells them to leave the building and call 911, before asking any other question.",
    },
}

FIND_UNIT_QUERIES = {
    "1washington_1": ("1 Washington Avenue", "1"), "1washington_3": ("1 Washington Avenue", "3"),
    "1washington_5": ("1 Washington Avenue", "5"), "1washington": ("1 Washington Avenue", None),
    "184remsen_2": ("184 Remsen Street", "2"), "184remsen": ("184 Remsen Street", None),
    "86remsen_2": ("86 Remsen Street", "2"), "86remsen": ("86 Remsen Street", None),
    "4union_1": ("4 Union Street", "1"), "4union": ("4 Union Street", None),
    "86ramsay_2": ("86 Ramsay Street", "2"),
}
AVAIL_QUERIES = [("Albany", "1br"), ("Albany", None), ("Albany", "studio"), ("Albany", "2br"), ("Albany", "room"),
                 ("Albany", "3br"), (None, "1br"), (None, None)]
BED_RX = {
    "1br": r"^\s*(?:1|[Oo][Nn][Ee])\s*-?\s*(?:[Bb][Rr]|[Bb][Ee][Dd].*)?\s*$",
    "studio": r"^\s*[Ss][Tt][Uu][Dd][Ii][Oo]\s*$", "2br": r"^\s*(?:2|[Tt][Ww][Oo])\s*-?\s*(?:[Bb][Rr]|[Bb][Ee][Dd].*)?\s*$",
    "room": r"^\s*[Rr][Oo][Oo][Mm]\s*$", "3br": r"^\s*(?:3|[Tt][Hh][Rr][Ee][Ee])\s*-?\s*(?:[Bb][Rr]|[Bb][Ee][Dd].*)?\s*\+?\s*$",
}
ALBANY_RX = contains_any(["albany"])
LIFE_SAFETY_TYPE_RX = r"^\s*(?:[Gg][Aa][Ss]|[Ff][Ii][Rr][Ee]|[Ff][Ll][Oo][Oo][Dd][Ii][Nn][Gg])\s*$"
EMERGENCY_RX = r"^\s*[Ee][Mm][Ee][Rr][Gg][Ee][Nn][Cc][Yy]\s*$"
URGENT_RX = r"^\s*[Uu][Rr][Gg][Ee][Nn][Tt]\s*$"
NONEMPTY_RX = r".*\S.*"


def build_mocks(sid, fx, tool_ids):
    """Per-tool ordered mock lists for one scenario (first match wins; an empty condition list always matches)."""
    sc = SCENARIOS[sid]
    fu = fx["find_unit"]
    av = fx["availability"]
    m = {}
    number = fx["next_request_number"]
    if "address" in sc:
        num, words = sc["address"]
        arx, urx = addr_rx(num, words), unit_rx(sc["unit"])
        lst = [mock(fu_matched(fu[sc["fixture"]]), cond("spoken_address", arx), cond("spoken_unit", urx))]
        if "suggest" in sc:
            snum, swords, sfx = sc["suggest"]
            lst.append(mock(fu_suggest(fu[sfx]), cond("spoken_address", addr_rx(snum, swords))))
        lst.append(mock(fu_need_unit(fu[sc["need_unit_fixture"]]), cond("spoken_address", arx)))
        lst.append(mock(FU_NOMATCH))
        m["find_unit"] = lst
        label = fu[sc["fixture"]]["unitLabel"]
        u = cond("spoken_unit", urx)
        it = cond("issue_type", LIFE_SAFETY_TYPE_RX)
        em = cond("severity", EMERGENCY_RX)
        desc = cond("description", contains_any(sc["issue_words"]))
        m["log_maintenance_request"] = [
            mock(lmr_logged("emergency", label, number, True, True), it, u),
            mock(lmr_logged("emergency", None, number, False, True), it),
            mock(lmr_logged("emergency", label, number, True, True), em, u),
            mock(lmr_logged("emergency", None, number, False, True), em),
            mock(UNIT_GUARD, cond("unit_confirmed", r"^\s*[Ff][Aa][Ll][Ss][Ee]\s*$")),
            mock(lmr_logged("urgent", label, number), desc, cond("severity", URGENT_RX), u),
            mock(lmr_logged("urgent", None, number, False), desc, cond("severity", URGENT_RX)),
            mock(lmr_logged("routine", label, number), desc, u),
            mock(lmr_logged("routine", None, number, False), desc),
            mock(VAGUE_GUARD),
        ]
        st = status_selected(*sc["status"]) if "status" in sc else STATUS_NONE
        m["check_work_order_status"] = [
            mock(st, cond("spoken_address", arx), cond("spoken_unit", urx)),
            mock(STATUS_NOT_IDENTIFIED, cond("spoken_address", NONEMPTY_RX)),
            mock(STATUS_NO_ADDRESS),
        ]
    else:
        m["find_unit"] = [mock(FU_NOMATCH)]
        m["log_maintenance_request"] = [mock(VAGUE_GUARD)]
        m["check_work_order_status"] = [mock(STATUS_NO_ADDRESS)]
    # check_availability: Albany narrowed results by bedroom type, else everything.
    ca = []
    for bed in ["1br", "studio", "2br", "room", "3br"]:
        ca.append(mock(av[f"Albany|{bed}"], cond("city", ALBANY_RX), cond("bedrooms", BED_RX[bed])))
    ca.append(mock(av["Albany|None"], cond("city", ALBANY_RX)))
    ca.append(mock(av["None|1br"], cond("bedrooms", BED_RX["1br"])))
    ca.append(mock(av["None|None"]))
    m["check_availability"] = ca
    albany = av["Albany|None"]["all_units"]
    m["log_lead"] = [mock(log_lead_resp(albany, False), cond("bedrooms", BED_RX["1br"])),
                     mock(log_lead_resp(albany, False), cond("bedrooms", BED_RX["3br"]))] + \
        [mock(log_lead_resp(albany, True), cond("bedrooms", BED_RX[b])) for b in ["studio", "2br", "room"]] + \
        [mock(log_lead_resp(albany, None))]
    m["lookup_caller"] = [mock(LOOKUP_NOMATCH)]
    m["log_unmatched_caller"] = [mock(UNMATCHED_LOGGED)]
    m["log_tenant_issue"] = [mock({"logged": True, "severity": 3, "message": WAIT_FOR_CALLER})]
    m["escalate"] = [mock({"escalated": True, "staff_notified": True, "team_alerted": True, "message": WAIT_FOR_CALLER})]
    m["send_photo_link"] = [mock({"recorded": True, "request_number": number, "say": PHOTO_SAY,
                                  "message": f"Say the say line once. {WAIT_FOR_CALLER}"})]
    # Tour, qualification and owner tools are not part of any scenario: unmocked, so a call to one
    # surfaces as a tool error (fallback raise_error) and is reported, never sent anywhere.
    return {tool_ids[name]: lst for name, lst in m.items()}


# ---------------------------------------------------------------- commands


def npx_json(args):
    out = subprocess.run(["npx", "convex", *args, "--deployment", DEPLOYMENT], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def cmd_fixtures(a):
    org = npx_json(["run", "agents:orgByElevenLabsAgentId", json.dumps({"elevenLabsAgentId": LIVE_AGENT})])
    fu = {}
    for k, (addr, unit) in FIND_UNIT_QUERIES.items():
        args = {"orgId": org, "spokenAddress": addr, **({"spokenUnit": unit} if unit else {})}
        fu[k] = npx_json(["run", "sarahTools:findUnit", json.dumps(args)])
    secret = os.environ.get("SIMPLR_TOOL_SECRET")
    if not secret:
        sys.exit("SIMPLR_TOOL_SECRET is not set (needed for the read-only check-availability route)")
    av = {}
    for city, bed in AVAIL_QUERIES:
        body = {"conversation_id": "eval-readonly-availability", "agent_id": LIVE_AGENT,
                **({"city": city} if city else {}), **({"bedrooms": bed} if bed else {})}
        req = urllib.request.Request(f"https://{DEPLOYMENT}.convex.site/tools/check-availability", data=json.dumps(body).encode(),
                                     method="POST", headers={"content-type": "application/json", "x-simplr-tool-secret": secret})
        with urllib.request.urlopen(req, timeout=30) as r:
            av[f"{city}|{bed}"] = json.loads(r.read())
    raw = subprocess.run(["npx", "convex", "data", "maintenanceRequests", "--limit", "5", "--order", "desc", "--format", "jsonLines",
                          "--deployment", DEPLOYMENT], capture_output=True, text=True, check=True).stdout
    nums = [json.loads(l).get("number") for l in raw.splitlines() if l.startswith("{")]
    save(a.out, "fixtures.json", {"find_unit": fu, "availability": av, "next_request_number": max(n for n in nums if n) + 1})
    print("fixtures written:", len(fu), "find_unit,", len(av), "availability")


# What publishing v17 changes on the agent and its tools (convex/elevenLabsApi.ts, convex/agents.ts). The
# live agent is still on v16 until the user publishes, so setup applies these to the copies; otherwise
# a run would test the old settings. Keep in step with those files.
SKIP_TURN_TOOL = {
    "type": "system", "name": "skip_turn",
    "description": ("Stay silent and wait for the caller. Use it when a tool result arrives while your "
                    "last question is still unanswered, or when the caller asks for a moment."),
    "pre_tool_speech": "off",
    "params": {"system_tool_type": "skip_turn", "wait_timeout_secs": 10},
}
SUGGESTED_AUDIO_TAGS = [
    {"tag": "calm", "description": "The default for routine questions and information."},
    {"tag": "empathetic", "description": "When the caller is upset or reporting a problem."},
]
TOOL_DESCRIPTION_EDITS = {
    "find_unit": ("away and its say line is your confirmation). Only matched true ",
                  "away, in silence, and ask its say line only after the result). Only matched true "),
    "log_maintenance_request": ("(lookup_caller confirmed or find_unit matched true) AND the caller has said what is actually ",
                                "(the caller said yes to lookup_caller's or find_unit's match) AND the caller has said what is actually "),
}
UNIT_CONFIRMED_PROPERTY = {
    "type": "boolean",
    "description": ("True only if the caller said yes, in their own words, after you read the unit back. A tool "
                    "result is not a yes. Without it the request is refused, except in a life-safety emergency."),
}


def as_v17(cfg):
    """A live tool config with the v17 tool changes applied."""
    cfg["pre_tool_speech"] = "off"
    cfg.pop("force_pre_tool_speech", None)
    name = cfg["name"]
    schema = cfg["api_schema"]["request_body_schema"]
    if name in TOOL_DESCRIPTION_EDITS:
        old, new = TOOL_DESCRIPTION_EDITS[name]
        if old not in cfg["description"]:
            # Already published: the live text is the v17 text.
            if new not in cfg["description"]:
                sys.exit(f"{name}: description is neither v16 nor v17")
        cfg["description"] = cfg["description"].replace(old, new)
        schema["description"] = cfg["description"]
    if name == "log_maintenance_request":
        schema["properties"]["unit_confirmed"] = dict(UNIT_CONFIRMED_PROPERTY)
        schema["required"] = sorted(set(schema.get("required") or []) | {"unit_confirmed"})
    return cfg


def reasoning_fields(model):
    if model.startswith("gpt-5"):
        return {"reasoning_effort": "minimal", "thinking_budget": None}
    if model == "gemini-2.5-flash":
        return {"reasoning_effort": None, "thinking_budget": 0}
    if model == "gemini-3-flash-preview":
        return {"reasoning_effort": "minimal", "thinking_budget": None}
    return {"reasoning_effort": None, "thinking_budget": None}


def cmd_setup(a):
    state = load(a.out, "state.json", {"tools": {}, "agents": {}, "tests": {}, "webhook": None})
    s, live = call("GET", f"/v1/convai/agents/{LIVE_AGENT}")
    must(s, live, "read live agent")
    lp = live["conversation_config"]["agent"]["prompt"]
    # 1. dead-URL tool copies (no secret header)
    if not state["tools"]:
        for tid in lp["tool_ids"]:
            s, t = call("GET", f"/v1/convai/tools/{tid}")
            must(s, t, f"read tool {tid}")
            cfg = t["tool_config"]
            api = cfg.get("api_schema") or {}
            api.pop("request_headers", None)
            api.pop("auth_connection", None)
            path = api.get("url", "").split("/tools/")[-1]
            api["url"] = f"{DEAD_BASE}/{path}"
            cfg = as_v17(cfg)
            s, r = call("POST", "/v1/convai/tools", {"tool_config": cfg})
            must(s, r, f"copy tool {cfg['name']}")
            state["tools"][cfg["name"]] = r["id"]
            save(a.out, "state.json", state)
        print("tool copies:", len(state["tools"]))
    # 2. post-call webhook: the key cannot create a dummy webhook (no webhooks_write), so the test
    #    agents get an ACTIVE per-agent override (explicit webhook id) whose only event is
    #    answering_machine_detection, which is only produced by outbound Twilio calls with AMD and
    #    never by a simulation. No transcript or call_initiation_failure event is enabled.
    if not state["webhook"]:
        s, ws = call("GET", "/v1/convai/settings")
        must(s, ws, "read workspace settings")
        state["webhook"] = ws["webhooks"]["post_call_webhook_id"]
        save(a.out, "state.json", state)
    # 3. tests (one per scenario), mocks keyed by the COPIED tool ids
    fx = load(a.out, "fixtures.json")
    for sid, sc in SCENARIOS.items():
        if sid in state["tests"] or (a.scenarios and sid not in a.scenarios.split(",")):
            continue
        body = {
            "type": "simulation", "name": f"TEST model-eval {sid} {DATE_TAG}",
            "simulation_scenario": COMMON_PERSONA.format(opening=sc["opening"], facts=sc["facts"]),
            "simulation_max_turns": a.max_turns,
            "success_conditions": [sc["condition"]],
            "simulated_user_model": a.user_model, "evaluation_model": a.user_model,
            "tool_mock_config": {"mocking_strategy": "all", "fallback_strategy": "raise_error",
                                 "mocked_tool_ids": list(state["tools"].values())},
            "tool_mock_overrides": build_mocks(sid, fx, state["tools"]),
            "chat_history": [],
        }
        s, r = call("POST", "/v1/convai/agent-testing/create", body)
        must(s, r, f"create test {sid}")
        state["tests"][sid] = r["id"]
        save(a.out, "state.json", state)
    print("tests:", state["tests"])
    # 4. one TEST agent per model
    prompt = open(a.prompt).read()
    cc = json.loads(json.dumps(live["conversation_config"]))
    p = cc["agent"]["prompt"]
    p.pop("tools", None)
    p["prompt"] = prompt
    p["tool_ids"] = list(state["tools"].values())
    p["temperature"] = 0
    p["max_tokens"] = lp["max_tokens"]
    p["built_in_tools"] = {"end_call": lp["built_in_tools"]["end_call"], "skip_turn": SKIP_TURN_TOOL}
    cc["tts"]["suggested_audio_tags"] = SUGGESTED_AUDIO_TAGS
    for model in [m for m in a.models.split(",") if m]:
        if model in state["agents"]:
            continue
        p["llm"] = model
        p.update(reasoning_fields(model))
        body = {"name": f"TEST model-eval {model} {DATE_TAG}", "conversation_config": cc,
                "platform_settings": {"workspace_overrides": {"webhooks": {"post_call_webhook_id": state["webhook"],
                                                                           "events": ["answering_machine_detection"]}}}}
        s, r = call("POST", "/v1/convai/agents/create", body)
        if s >= 300:
            print(f"SKIP {model}: {s} {json.dumps(r)[:600]}")
            state.setdefault("rejected", {})[model] = r if isinstance(r, str) else json.dumps(r)[:600]
            save(a.out, "state.json", state)
            continue
        state["agents"][model] = {"id": r["agent_id"], **reasoning_fields(model)}
        save(a.out, "state.json", state)
        print("agent", model, r["agent_id"])


def verify_agent(agent_id, state):
    """Refuses to run unless the agent is a TEST agent with no phone, dead-URL tools and the dummy webhook."""
    if agent_id == LIVE_AGENT:
        sys.exit("refusing: live agent")
    s, ag = call("GET", f"/v1/convai/agents/{agent_id}")
    must(s, ag, "read test agent")
    problems = []
    if not ag["name"].startswith("TEST model-eval"):
        problems.append("name")
    if ag.get("phone_numbers"):
        problems.append("has phone number")
    p = ag["conversation_config"]["agent"]["prompt"]
    if set(p["tool_ids"]) != set(state["tools"].values()):
        problems.append("tool ids are not the dead copies")
    for t in p.get("tools", []):
        url = (t.get("api_schema") or {}).get("url")
        if url and not url.startswith(DEAD_BASE):
            problems.append(f"tool {t['name']} url {url}")
        if (t.get("api_schema") or {}).get("request_headers"):
            problems.append(f"tool {t['name']} has headers")
        if t.get("type") == "webhook" and t.get("pre_tool_speech") != "off":
            problems.append(f"tool {t['name']} pre_tool_speech is {t.get('pre_tool_speech')}")
    if not p.get("built_in_tools", {}).get("skip_turn"):
        problems.append("skip_turn is missing")
    if [x.get("tag") for x in ag["conversation_config"]["tts"].get("suggested_audio_tags") or []] != ["calm", "empathetic"]:
        problems.append("suggested_audio_tags are not the v17 set")
    wh = ag["platform_settings"]["workspace_overrides"]["webhooks"]
    if wh.get("post_call_webhook_id") != state["webhook"] or set(wh.get("events") or ["?"]) != {"answering_machine_detection"}:
        problems.append(f"post-call webhook override is {wh}")
    if problems:
        sys.exit(f"refusing to run on {agent_id}: {problems}")
    return ag


def cmd_run(a):
    state = load(a.out, "state.json")
    ag = state["agents"][a.model]
    verify_agent(ag["id"], state)
    before, _ = balance()
    per_sim = a.est_credits
    n = len(a.scenarios.split(",")) * a.repeat
    if before - per_sim * n < STOP_LOSS:
        sys.exit(f"stop-loss: balance {before}, estimated {per_sim * n} for {n} sims would cross {STOP_LOSS}")
    tests = [{"test_id": state["tests"][sid]} for sid in a.scenarios.split(",")]
    t0 = time.time()
    s, inv = call("POST", f"/v1/convai/agents/{ag['id']}/run-tests",
                  {"tests": tests, "repeat_count": a.repeat, "name": f"model-eval {a.model} {a.scenarios}"})
    must(s, inv, "run-tests")
    iid = inv["id"]
    while True:
        time.sleep(10)
        s, inv = call("GET", f"/v1/convai/test-invocations/{iid}")
        if s >= 300:
            continue
        runs = inv.get("test_runs", [])
        if runs and all(r.get("status") != "pending" for r in runs):
            break
        if time.time() - t0 > 1800:
            print("timeout waiting; saving partial")
            break
    after, _ = balance()
    stamp = time.strftime("%H%M%S")
    save(a.out, f"results/{a.model}__{a.scenarios.replace(',', '-')}__{stamp}.json",
         {"model": a.model, "agent_id": ag["id"], "scenarios": a.scenarios, "repeat": a.repeat, "wall_secs": time.time() - t0,
          "balance_before": before, "balance_after": after, "invocation": inv})
    print(f"{a.model} {a.scenarios}: {len(inv.get('test_runs', []))} runs, statuses "
          f"{[r.get('status') for r in inv.get('test_runs', [])]}, credits {before - after}, balance {after}")


# ---------------------------------------------------------------- turn-taking pass/fail (v17 quality gate)

QUESTION_END_RX = re.compile(r"\?\s*$")
ALLOWED_TAGS = {"calm", "empathetic"}
TAG_RX = re.compile(r"\[([A-Za-z][A-Za-z -]*)\]?")
WHEN_RX = re.compile(r"when did you|first notic|how long|since when|how many (?:days|weeks|months)|when was", re.I)
WHEN_GIVEN_RX = re.compile(r"\b(?:since|yesterday|ago|last (?:week|night|month)|this morning|for (?:a|about|\d+) )", re.I)
WHERE_RX = re.compile(r"where exactly|where is (?:it|the)|which door|what door", re.I)
WHERE_GIVEN_RX = re.compile(r"\b(?:under|front door|back door|bedroom|bathroom|kitchen|cabinet)\b", re.I)
REASK_RX = re.compile(r"(?:your|the) name\b|who am i speaking|(?:your|the) (?:apartment |street |building )?address|which building|"
                      r"(?:your|the|what|which) (?:unit|apartment) (?:number)?\b.*\?", re.I)
YES_RX = re.compile(r"\b(?:yes|yeah|yep|correct|right|that's it|that is it)\b", re.I)
CHECK_NAMES = [
    ("waits", "Every question is followed by a caller turn before she speaks again"),
    ("no_question_with_tool", "No generation has both a question and a tool call"),
    ("find_unit_order", "find_unit, then the confirmation, then the caller, then the next step"),
    ("log_after_confirmed", "log_maintenance_request only after the caller confirmed the unit and described the issue"),
    ("tags", "No tags in agent text except the allowed calm set"),
    ("no_duplicate", "No duplicate question (when noticed / how long, or where after the spot was named)"),
    ("no_reask", "Name, address and unit not re-asked"),
    ("no_early_claim", "No logged claim before the tool result"),
    ("one_question", "One question per turn"),
    ("no_tool_errors", "No tool errors (every call hit a mock, so the run is valid)"),
]


def spoken(ev):
    """Events with the platform's fillers removed, and speech that was only a filler dropped."""
    out = []
    for e in ev:
        if e["k"] == "gen":
            continue
        if e["k"] == "say":
            text = strip_fillers(e["text"])
            if not text:
                continue
            e = {**e, "text": text}
        out.append(e)
    return out


def turn_checks(ev, sc):
    ev = spoken(ev)
    fails = {name: [] for name, _ in CHECK_NAMES}
    # 1. A question must be answered by a caller turn before the next speech.
    pending = None
    for e in ev:
        if e["k"] == "user":
            pending = None
        elif e["k"] == "say":
            if pending:
                fails["waits"].append(f"after {pending[:60]!r} she said {e['text'][:60]!r} with no caller turn")
            pending = e["text"] if "?" in e["text"] else None
    # 2. Speech in the same step as a tool call: the run of events up to the call's result.
    for i, e in enumerate(ev):
        if e["k"] != "call":
            continue
        for x in reversed(ev[:i]):
            if x["k"] in ("user", "result"):
                break
            if x["k"] == "say" and "?" in x["text"]:
                fails["no_question_with_tool"].append(f"{x['text'][:60]!r} with {e['tool']}")
        for x in ev[i + 1:]:
            if x["k"] in ("user", "result"):
                break
            if x["k"] == "say" and "?" in x["text"]:
                fails["no_question_with_tool"].append(f"{e['tool']} with {x['text'][:60]!r}")
    # 3. find_unit -> confirmation -> caller -> next step.
    matched_at = next((i for i, e in enumerate(ev) if e["k"] == "result" and e["tool"] == "find_unit" and e["res"].get("matched")), None)
    confirmed_at = None
    if matched_at is None:
        fails["find_unit_order"].append("find_unit never matched")
    else:
        rest = ev[matched_at + 1:]
        first = next((e for e in rest), None)
        if not first or first["k"] != "say" or "?" not in first["text"]:
            fails["find_unit_order"].append(f"the next event was not the confirmation: {first and (first.get('text') or first.get('tool'))!r}")
        else:
            after = rest[rest.index(first) + 1:]
            nxt = next((e for e in after), None)
            if not nxt or nxt["k"] != "user":
                fails["find_unit_order"].append(f"the confirmation was not followed by the caller: {nxt and (nxt.get('text') or nxt.get('tool'))!r}")
            elif YES_RX.search(nxt["text"]):
                confirmed_at = ev.index(nxt)
            else:
                fails["find_unit_order"].append(f"the caller did not confirm: {nxt['text'][:60]!r}")
    # 4. The first log comes after the yes and after the issue was described.
    log_at = next((i for i, e in enumerate(ev) if e["k"] == "call" and e["tool"] == "log_maintenance_request"), None)
    if log_at is None:
        fails["log_after_confirmed"].append("log_maintenance_request was never called")
    else:
        if confirmed_at is None or log_at < confirmed_at:
            fails["log_after_confirmed"].append("logged before the caller confirmed the unit")
        said = " ".join(e["text"] for e in ev[:log_at] if e["k"] == "user").lower()
        if not any(w in said for w in sc["issue_words"]):
            fails["log_after_confirmed"].append("logged before the caller described the issue")
        for e in ev:
            if e["k"] == "call" and e["tool"] == "log_maintenance_request" and e["params"].get("unit_confirmed") is not True:
                fails["log_after_confirmed"].append(f"unit_confirmed was {e['params'].get('unit_confirmed')!r}")
    # 5. Tags, 7. re-asks, 8. early claims, 6. duplicates.
    logged = False
    when_asked = where_asked = 0
    heard = ""
    for e in ev:
        if e["k"] == "user":
            heard += " " + e["text"]
        elif e["k"] == "result" and e["tool"] == "log_maintenance_request" and e["res"].get("logged"):
            logged = True
        elif e["k"] == "say":
            for tag in TAG_RX.findall(e["text"]):
                if tag.strip().lower() not in ALLOWED_TAGS:
                    fails["tags"].append(f"[{tag}] in {e['text'][:50]!r}")
            if CLAIM_RX.search(e["text"]) and not logged:
                fails["no_early_claim"].append(e["text"][:80])
            questions = [x for x in sentences(e["text"]) if "?" in x]
            for x in questions:
                is_confirmation = bool(re.search(r"is that right|am i speaking", x, re.I))
                if REASK_RX.search(x) and not is_confirmation:
                    fails["no_reask"].append(x[:80])
                if WHEN_RX.search(x):
                    when_asked += 1
                    if when_asked > 1:
                        fails["no_duplicate"].append(f"asked when again: {x[:60]!r}")
                    elif WHEN_GIVEN_RX.search(heard):
                        fails["no_duplicate"].append(f"they had already said when: {x[:60]!r}")
                if WHERE_RX.search(x):
                    where_asked += 1
                    if where_asked > 1:
                        fails["no_duplicate"].append(f"asked where again: {x[:60]!r}")
                    elif WHERE_GIVEN_RX.search(heard):
                        fails["no_duplicate"].append(f"they had already said where: {x[:60]!r}")
    # 9. One question per turn, over everything said between caller turns.
    for t in agent_turns(ev):
        if t["text"].count("?") > 1:
            fails["one_question"].append(t["text"][:100])
    for e in ev:
        if e["k"] == "result" and e["error"]:
            fails["no_tool_errors"].append(f"{e['tool']}: {str(e['res'])[:80]}")
    return fails


def turn_order(ev):
    lines = []
    for e in spoken(ev):
        if e["k"] == "user":
            lines.append(f"CALLER: {e['text']}")
        elif e["k"] == "say":
            lines.append(f"SARAH:  {e['text']}")
        elif e["k"] == "call":
            keys = {k: v for k, v in e["params"].items() if k in ("spoken_address", "spoken_unit", "description", "severity", "unit_confirmed", "caller_name")}
            lines.append(f"  tool: {e['tool']} {json.dumps(keys)}")
        elif e["k"] == "result":
            res = e["res"]
            brief = {k: res[k] for k in ("matched", "logged", "needs", "escalated", "recorded") if k in res}
            lines.append(f"  result: {e['tool']} {json.dumps(brief)}{' ERROR' if e['error'] else ''}")
    return lines


def report_turns(label, ev, sc):
    fails = turn_checks(ev, sc)
    print(f"\n=== {label}")
    for name, title in CHECK_NAMES:
        print(f"{'PASS' if not fails[name] else 'FAIL'}  {title}")
        for f in fails[name]:
            print(f"        {f}")
    print("--- turn order")
    print("\n".join(turn_order(ev)))
    return not any(fails.values())


def cmd_turns(a):
    if a.replay:
        d = json.load(open(a.replay))
        rows = d.get("transcript") or d.get("agent_responses") or []
        ok = report_turns(a.replay, events({"agent_responses": rows}), SCENARIOS[a.scenario])
        print("\nOVERALL:", "PASS" if ok else "FAIL")
        return
    results = os.path.join(a.out, "results")
    all_ok = True
    for f in sorted(os.listdir(results)):
        d = json.load(open(os.path.join(results, f)))
        sids = d["scenarios"].split(",")
        for sid, run in zip(sids, d["invocation"].get("test_runs", [])):
            all_ok = report_turns(f"{f} {sid} ({d['balance_before'] - d['balance_after']} credits for this invocation)",
                                  events(run), SCENARIOS[sid]) and all_ok
    print("\nOVERALL:", "PASS" if all_ok else "FAIL")


def cmd_balance(a):
    b, r = balance()
    print("remaining", b, "(used", r["character_count"], "of", r["character_limit"], ")")


def cmd_cleanup(a):
    state = load(a.out, "state.json")
    failed = []
    for model, ag in list(state["agents"].items()):
        if ag["id"] == LIVE_AGENT:
            continue
        s, r = call("DELETE", f"/v1/convai/agents/{ag['id']}")
        print("delete agent", model, ag["id"], s)
        if s < 300 or s == 404:
            state.setdefault("deleted_agents", {})[model] = ag["id"]
            del state["agents"][model]
        else:
            failed.append(("agent", ag["id"], s, r))
        save(a.out, "state.json", state)
    for sid, tid in list(state["tests"].items()):
        s, r = call("DELETE", f"/v1/convai/agent-testing/{tid}")
        print("delete test", sid, tid, s)
        if s < 300 or s == 404:
            del state["tests"][sid]
        else:
            failed.append(("test", tid, s, r))
        save(a.out, "state.json", state)
    test_ids = set(state.get("deleted_agents", {}).values()) | {ag["id"] for ag in state["agents"].values()}
    for name, tid in list(state["tools"].items()):
        # A deleted agent's main branch keeps a reference for a while (409 "still in use"). Force only
        # when every dependent is one of our TEST agents, never the live one.
        s, dep = call("GET", f"/v1/convai/tools/{tid}/dependent-agents")
        deps = {x["agent_id"] for x in (dep or {}).get("agents", []) + (dep or {}).get("branches", [])} if s < 300 else {"?"}
        force = bool(deps) and deps <= test_ids and LIVE_AGENT not in deps
        s, r = call("DELETE", f"/v1/convai/tools/{tid}" + ("?force=true" if force else ""))
        print("delete tool", name, tid, s)
        if s < 300 or s == 404:
            del state["tools"][name]
        else:
            failed.append(("tool", tid, s, r))
        save(a.out, "state.json", state)
    print("FAILED:", failed if failed else "none")



# ---------------------------------------------------------------- deterministic scoring

FILLERS = ["Just a sec…", "One moment…", "Let me pull that up…"]  # the live soft-timeout fillers (not LLM output)
APPROVED_SCRIPTS = [
    "Leave the building immediately and call 911. If you can do it safely from outside, warn your neighbors. Once you are outside, tell me your name and the address.",
    "Please leave the building now and contact your gas utility provider from outside. Tell me your name and the address so we can alert the team.",
    "If there is a fire or smoke, leave the building right now and call 911. Once you are safe, tell me your name and the address so we can alert the team.",
    "Please put a bucket under the leak, if it is safe to do so.",
]
DIGIT_WORDS = {"zero": "0", "oh": "0", "o": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
               "six": "6", "seven": "7", "eight": "8", "nine": "9"}
CLAIM_RX = re.compile(r"\b(?:i've|i have|has been|have been|is|it's|everything's|everything is|was|are)\s+(?:now\s+|all\s+)?(?:logged|recorded|sent|submitted|passed on)\b"
                      r"|\bi'?m logging\b|\blogging (?:it|that|this|the|your)\b|\b(?:request|emergency|it|this|that) (?:is|has been) logged\b", re.I)
PROGRESSIVE_RX = re.compile(r"\bi'?m logging\b|\blogging (?:it|that|this|the|your)\b", re.I)
META_RX = re.compile(r"\b(?:find_unit|lookup_caller|log_\w+|end_call|check_\w+|escalate tool|say line|tool result)\b|\b(?:has|have) given (?:her|his|their) name\b", re.I)
HALLU_RX = re.compile(r"\b(?:dispatch(?:ed)?|on (?:their|the|his|her) way|sending someone|someone will (?:come|be there)|technician (?:will|is going to) (?:come|be)|"
                      r"within (?:\d+|an?|one|two|24|48) (?:hours?|days?|minutes?)|by (?:tomorrow|tonight|today)|(?:come|visit|fix it) (?:tomorrow|today|tonight))\b", re.I)


PLACEHOLDER_VALUES = {"unknown", "n/a", "na", "none", "null", "undefined", "not provided", "not given", "caller", "resident", "tenant"}


def realish_placeholder(v):
    return v.strip().lower() in PLACEHOLDER_VALUES


def norm(t):
    return re.sub(r"\s+", " ", (t or "")).strip()


def strip_fillers(t):
    for f in FILLERS:
        t = t.replace(f + ".", "").replace(f, "")
    return norm(t)


def digits_spoken(t):
    toks = re.findall(r"[a-z]+|\d", (t or "").lower())
    return "".join(DIGIT_WORDS.get(x, x if x.isdigit() else "") for x in toks)


def sentences(t):
    return [x.strip() for x in re.split(r"(?<=[.?!])\s+|\n+", t) if x.strip()]


def events(run):
    """Flattens agent_responses into an ordered event list."""
    ev = []
    for t in run.get("agent_responses") or []:
        role = t["role"]
        msg = norm(t.get("message"))
        m = (t.get("conversation_turn_metrics") or {}).get("metrics") or {}
        if msg:
            ev.append({"k": "say" if role == "agent" else "user", "text": msg, "llm": t.get("producing_llm"), "metrics": m})
        for c in t.get("tool_calls") or []:
            try:
                params = json.loads(c.get("params_as_json") or "{}")
            except Exception:
                params = {}
            ev.append({"k": "call", "tool": c.get("tool_name"), "params": params, "llm": t.get("producing_llm"), "metrics": m})
        for c in t.get("tool_results") or []:
            try:
                res = json.loads(c.get("result_value") or "{}")
            except Exception:
                res = {"raw": c.get("result_value")}
            ev.append({"k": "result", "tool": c.get("tool_name"), "res": res, "error": bool(c.get("is_error"))})
        if t.get("llm_usage") and role == "agent":
            ev.append({"k": "gen", "llm": t.get("producing_llm"), "metrics": m})
    return ev


def agent_turns(ev):
    """Agent speech merged between caller messages: [(index_of_first_event, merged_text, [events])]."""
    turns, cur = [], None
    for i, e in enumerate(ev):
        if e["k"] == "user":
            if cur:
                turns.append(cur)
            cur = None
        elif e["k"] in ("say", "call"):
            if not cur:
                cur = {"start": i, "text": "", "events": []}
            if e["k"] == "say":
                cur["text"] = norm(cur["text"] + " " + e["text"])
            cur["events"].append(e)
    if cur:
        turns.append(cur)
    return turns


def is_vague_batch(items):
    """Runs the repo's own isVagueIssue (convex/sanitize.ts) on [(description, [known...])] via Node."""
    if not items:
        return []
    here = os.path.dirname(os.path.abspath(__file__))
    js = ("import { isVagueIssue } from " + json.dumps(os.path.join(here, "..", "..", "convex", "sanitize.ts")) + ";"
          "const items = JSON.parse(process.argv[1]); console.log(JSON.stringify(items.map(([d,k]) => isVagueIssue(d,k))));")
    out = subprocess.run(["node", "--input-type=module", "-e", js, json.dumps(items)], capture_output=True, text=True)
    return json.loads(out.stdout.strip().splitlines()[-1]) if out.returncode == 0 else [None] * len(items)


ASK = {
    "name": re.compile(r"\b(?:your|the) (?:full )?name\b|who (?:am i|i'm) speaking|may i have your name|what is your name|what's your name", re.I),
    "address": re.compile(r"\baddress\b|which building|what building|which property", re.I),
    "unit": re.compile(r"\bunit (?:number)?\b|apartment number|which unit|what unit", re.I),
    "issue": re.compile(r"what'?s going on|what (?:maintenance )?issue|what is (?:the )?(?:problem|issue)|what is broken|what happened|what'?s wrong", re.I),
    "first_noticed": re.compile(r"when did you first (?:notice|report)|how long has", re.I),
    "leak_location": re.compile(r"where exactly is the leak", re.I),
}
GIVEN = {"S1": ["name", "address", "unit", "first_noticed", "leak_location"], "S2": ["name", "address", "unit", "issue"],
         "S3": ["name", "address", "unit", "issue"], "S4": ["name", "address", "unit", "issue", "first_noticed"],
         "S5": [], "S6": ["address", "unit", "issue"]}
# S1's first_noticed and leak location are only "given" once the caller has described the issue.
GIVEN_AFTER_ISSUE = {"S1": ["first_noticed", "leak_location"]}
ISSUE_USER_RX = {"S1": re.compile(r"sink", re.I)}


def score_run(sid, run):
    sc = SCENARIOS[sid]
    ev = events(run)
    turns = agent_turns(ev)
    res, notes = {}, []
    user_idx = [i for i, e in enumerate(ev) if e["k"] == "user"]
    issue_idx = next((i for i in user_idx if ISSUE_USER_RX.get(sid, re.compile(".")).search(ev[i]["text"])), None) if sid == "S1" else (user_idx[0] if user_idx else None)
    first_logged_true = next((i for i, e in enumerate(ev) if e["k"] == "result" and e["tool"] == "log_maintenance_request" and e["res"].get("logged") is True), None)
    lmr_calls = [(i, e) for i, e in enumerate(ev) if e["k"] == "call" and e["tool"] == "log_maintenance_request"]
    fu_matched = next((i for i, e in enumerate(ev) if e["k"] == "result" and e["tool"] == "find_unit" and e["res"].get("matched") is True), None)
    mock_mismatch = []

    # 1. re-asked a field the caller already gave
    reasks = []
    for t in turns:
        for snt in sentences(strip_fillers(t["text"])):
            if "?" not in snt or re.search(r"I have unit|Did you mean|Is that right|Is that the right number|anything else", snt, re.I):
                continue
            for field in GIVEN.get(sid, []):
                if field in GIVEN_AFTER_ISSUE.get(sid, []) and (issue_idx is None or t["start"] < issue_idx):
                    continue
                if ASK[field].search(snt):
                    reasks.append(f"{field}: \"{snt}\"")
    res["no_reask"] = not reasks
    if reasks:
        notes.append("re-asked " + "; ".join(reasks))

    # 2. logged / claimed logged too early
    premature = []
    vague_items = [(e["params"].get("description"), [e["params"].get("caller_name"), e["params"].get("spoken_address"), e["params"].get("spoken_unit")]) for _, e in lmr_calls]
    vague = is_vague_batch(vague_items)
    for (i, e), v in zip(lmr_calls, vague):
        life = str(e["params"].get("severity", "")).lower() == "emergency" or str(e["params"].get("issue_type", "")).lower() in ("gas", "fire", "flooding")
        if not life and issue_idx is not None and i < issue_idx:
            premature.append("log_maintenance_request before the issue was described")
        if not life and v:
            premature.append(f"vague description logged: {e['params'].get('description')!r}")
        # did the static mock answer the way the v16 server would?
        got = next((x for x in ev[i:] if x["k"] == "result" and x["tool"] == "log_maintenance_request"), None)
        if got and v is not None and not life:
            server_logged = (not v) or (first_logged_true is not None and first_logged_true < i)
            if bool(got["res"].get("logged")) != server_logged:
                mock_mismatch.append(f"lmr mock logged={got['res'].get('logged')} but v16 server would give logged={server_logged}")
    for t in turns:
        for e in t["events"]:
            if e["k"] != "say":
                continue
            i = next(j for j, x in enumerate(ev) if x is e)
            txt = strip_fillers(e["text"])
            for mt in CLAIM_RX.finditer(txt):
                if sid == "S4":
                    premature.append(f"S4 claim of logging: \"{mt.group(0)}\"")
                    continue
                if first_logged_true is not None and first_logged_true < i:
                    continue
                if PROGRESSIVE_RX.search(mt.group(0)) and any(x["k"] == "call" and x["tool"] == "log_maintenance_request" for x in t["events"]):
                    continue
                premature.append(f"claimed before a logged:true result: \"{mt.group(0)}\" in \"{txt[:90]}\"")
    res["no_premature_log"] = not premature
    notes += premature

    # 3. tool order
    order_ok, why = True, []
    if sid in ("S1", "S2", "S3"):
        if not lmr_calls:
            order_ok, why = False, why + ["log_maintenance_request never called"]
        elif fu_matched is None or fu_matched > lmr_calls[0][0]:
            order_ok, why = False, why + ["no find_unit match before the first log_maintenance_request"]
    if sid == "S4":
        st = next((i for i, e in enumerate(ev) if e["k"] == "call" and e["tool"] == "check_work_order_status"), None)
        if st is None:
            order_ok, why = False, why + ["check_work_order_status never called"]
        elif fu_matched is None or fu_matched > st:
            order_ok, why = False, why + ["check_work_order_status without an exact find_unit match first"]
        if not any(e["k"] == "call" and e["tool"] == "log_tenant_issue" for e in ev):
            order_ok, why = False, why + ["log_tenant_issue (call_type work_order_status) never called"]
    if sid == "S6":
        first_q = next((t["start"] for t in turns if t["start"] > user_idx[0] and "?" in strip_fillers(t["text"]).replace("Do you hear a hissing sound?", "")), None)
        em = next((i for i, e in lmr_calls if str(e["params"].get("severity", "")).lower() == "emergency"), None)
        if em is None:
            order_ok, why = False, why + ["no emergency log_maintenance_request"]
        elif first_q is not None and em > first_q + 50:
            pass
        if em is not None and first_q is not None:
            # the log must not wait for the caller to answer a question
            answered_before_log = any(first_q < u < em for u in user_idx)
            if answered_before_log:
                order_ok, why = False, why + ["emergency log delayed until after asking the caller a question"]
        if not any(e["k"] == "call" and e["tool"] == "escalate" for e in ev):
            order_ok, why = False, why + ["escalate never called"]
    res["tool_order"] = order_ok
    notes += why

    # 4. phone read-back
    phone = sc.get("phone")
    gave = next((i for i in user_idx if phone and phone[3:] in digits_spoken(ev[i]["text"])), None)
    # S1: the v16 GENERAL INTAKE FLOW has no callback-number step (prompt gap), so it is scored only if given.
    if sid in ("S2", "S3", "S5", "S6") or gave is not None:
        if gave is None:
            res["phone_readback"] = False
            notes.append("callback number never asked for")
        else:
            later = [t for t in turns if t["start"] > gave]
            rb = next((t for t in later if phone in digits_spoken(t["text"]) or phone[3:] in digits_spoken(t["text"])), None)
            grouped = rb is not None and re.search(r"(?:\w+[ ,]+){2}\w+,\s", rb["text"]) is not None
            res["phone_readback"] = bool(rb and grouped)
            if not res["phone_readback"]:
                notes.append("number given but not read back in groups")
    else:
        res["phone_readback"] = None

    # 5. emergency script first (S6)
    if sid == "S6":
        first = turns[0] if turns and turns[0]["start"] < (user_idx[1] if len(user_idx) > 1 else 10 ** 9) and turns[0]["start"] > user_idx[0] else None
        # turns[0] is the greeting; the reply to the opening line is the first turn after user_idx[0]
        reply = next((t for t in turns if t["start"] > user_idx[0]), None)
        before_next_user = reply is not None and (len(user_idx) < 2 or reply["start"] < user_idx[1])
        txt = strip_fillers(reply["text"]) if reply else ""
        ok = before_next_user and re.search(r"leave the building", txt, re.I) and "911" in txt and txt.lower().find("leave") < (txt.find("?") if "?" in txt else 10 ** 9)
        res["emergency_first"] = bool(ok)
        if not ok:
            notes.append(f"first reply to the gas report was: \"{txt[:80]}\"")
    else:
        res["emergency_first"] = None
    res["only_returned_units"] = None  # S5 only (not run)

    # 6. one question per turn
    multi = []
    for t in ([] if sid == "S6" else turns):  # LIFE-SAFETY overrides the one-question rule
        txt = strip_fillers(t["text"])
        n = txt.count("?")
        joined = re.search(r"\b(?:name|number|address|unit)\b[^?.]*\band (?:the |your )?(?:best )?(?:name|number|address|unit|phone)\b[^.]*\?", txt, re.I)
        if n > 1 or joined:
            multi.append(txt[:120])
    res["one_question"] = None if sid == "S6" else not multi
    notes += [f"more than one question: \"{m}\"" for m in multi]

    # 7. turn length (25 words), excluding fillers, approved scripts and tool say lines read verbatim
    says = [norm(x["res"].get("say")) for x in ev if x["k"] == "result" and isinstance(x.get("res"), dict) and x["res"].get("say")]
    long_turns = []
    for t in turns[1:]:  # the configured first message is not the LLM's
        txt = strip_fillers(t["text"])
        for sline in APPROVED_SCRIPTS + says:
            txt = txt.replace(sline, "")
        txt = re.sub(r"\[[a-z ]+\]", "", txt)  # eleven_v3 audio tags
        txt = re.sub(r"I see the request about [^.]*, reported on [^.]*\.|We've received it, and it's waiting for your asset manager to review\.", "", txt)
        wc = len(re.findall(r"[\w']+", txt))
        if wc > 25:
            long_turns.append(f"{wc} words: \"{txt[:100]}\"")
    res["max_25_words"] = not long_turns
    notes += long_turns

    # 8. hallucinated facts
    hallu = []
    alerted = next((i for i, e in enumerate(ev) if e["k"] == "result" and isinstance(e.get("res"), dict) and e["res"].get("team_alerted") is True), None)
    for e in ev:
        if e["k"] == "call" and e["tool"] != "end_call":
            for k, v in (e.get("params") or {}).items():
                if isinstance(v, str) and v.strip() and realish_placeholder(v):
                    hallu.append(f"placeholder value passed to {e['tool']}.{k}: {v!r}")
    for e in ev:
        if e["k"] == "say" and re.search(r"team (?:has been|was|is) alerted|alerted the team", e["text"], re.I):
            i = next(j for j, x in enumerate(ev) if x is e)
            if alerted is None or alerted > i:
                hallu.append("said the team was alerted before a team_alerted:true result")
    for t in turns:
        txt = strip_fillers(t["text"])
        if HALLU_RX.search(txt) and not re.search(r"can'?t (?:dispatch|promise)", txt, re.I):
            hallu.append(f"promise or dispatch: \"{HALLU_RX.search(txt).group(0)}\"")
        if sid == "S4":
            for d in re.findall(r"\b(?:Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|November|December)\b", txt):
                hallu.append(f"S4 date not in the result: {d}")
            if re.search(r"can'?t see the live status", txt, re.I):
                hallu.append("said it can't see the live status although the lookup worked")
    res["no_hallucination"] = not hallu
    notes += hallu

    # 9. no internal / tool text spoken
    meta = [strip_fillers(t["text"])[:100] for t in turns if META_RX.search(strip_fillers(t["text"]))]
    res["no_meta_speech"] = not meta
    notes += [f"spoke internal text: \"{m}\"" for m in meta]

    # 10. ended the call properly
    end_i = next((i for i, e in enumerate(ev) if e["k"] == "call" and e["tool"] == "end_call"), None)
    end_ok = end_i is not None
    if end_ok:
        t_end = next(t for t in turns if any(x is ev[end_i] for x in t["events"]))
        q = [snt for snt in sentences(strip_fillers(t_end["text"])) if "?" in snt and not re.search(r"anything else", snt, re.I)]
        if q:
            end_ok = False
            notes.append(f"ended the call without waiting for the answer to: \"{q[0]}\"")
    else:
        notes.append("end_call never called")
    res["ended_properly"] = end_ok

    # extras: cascade, fillers, truncated replies
    gens = [e for e in ev if e["k"] == "gen"]
    primary = run.get("_model")
    backup = [e for e in gens if e["llm"] and e["llm"] != primary]
    truncated = [t["text"][-40:] for t in turns if t["text"] and not re.search(r"[.?!…\]]\s*$", strip_fillers(t["text"]) or ".")]
    fillers = sum(t["text"].count(f) for t in turns for f in FILLERS)
    return res, notes, {"generations": len(gens), "backup_generations": len(backup), "backup_models": sorted({e["llm"] for e in backup}),
                        "fillers": fillers, "truncated_replies": truncated, "mock_mismatch": mock_mismatch}


def latency(run):
    out = {"ttfb": [], "ttfb_primary": [], "since_user": []}
    seen = set()
    for t in run.get("agent_responses") or []:
        m = (t.get("conversation_turn_metrics") or {}).get("metrics") or {}
        tt = (m.get("convai_llm_service_ttfb") or {}).get("elapsed_time")
        su = (m.get("convai_ttf_response_since_user_message") or {}).get("elapsed_time")
        key = (tt, su)
        if key in seen or (tt is None and su is None):
            continue
        seen.add(key)
        if tt is not None:
            out["ttfb"].append(tt)
            if t.get("producing_llm") == run.get("_model"):
                out["ttfb_primary"].append(tt)
        if su is not None and su > 0.05:
            out["since_user"].append(su)
    return out


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def cost(run, model):
    mu = ((run.get("charging") or {}).get("llm_usage") or {}).get("irreversible_generation", {}).get("model_usage", {})
    by = {m: round(sum((v.get(c) or {}).get("price", 0) for c in ("input", "input_cache_read", "input_cache_write", "output_total")), 5) for m, v in mu.items()}
    words = sum(len(re.findall(r"[\w']+", t.get("message") or "")) for t in run.get("agent_responses") or [])
    lat = latency(run)
    minutes = words / 150 + sum(lat["since_user"]) / 60
    return by, minutes


def score(out):
    rows = []
    for f in sorted(os.listdir(os.path.join(out, "results"))):
        d = json.load(open(os.path.join(out, "results", f)))
        for run in d["invocation"].get("test_runs", []):
            run["_model"] = d["model"]
            sid = next(k for k in SCENARIOS if run["test_name"].startswith(f"TEST model-eval {k} "))
            res, notes, extra = score_run(sid, run)
            by, minutes = cost(run, d["model"])
            rows.append({"model": d["model"], "scenario": sid, "file": f, "checks": res, "notes": notes, "extra": extra,
                         "latency": latency(run), "credits": run.get("credits_used"), "llm_usd_by_model": by,
                         "llm_usd_total": round((run.get("charging") or {}).get("llm_price") or 0, 5),
                         "platform_credits": (run.get("charging") or {}).get("platform_charge"), "est_minutes": round(minutes, 2),
                         "judge": (run.get("condition_result") or {}).get("result"), "status": run.get("status")})
    save(out, "score.json", rows)
    items = ["no_reask", "no_premature_log", "tool_order", "phone_readback", "emergency_first", "one_question", "max_25_words",
             "no_hallucination", "no_meta_speech", "ended_properly"]
    for model in sorted({r["model"] for r in rows}):
        rs = [r for r in rows if r["model"] == model]
        print(f"\n== {model}")
        for r in rs:
            print(f"  {r['scenario']}: " + " ".join(f"{k}={'P' if v else ('-' if v is None else 'F')}" for k, v in r["checks"].items() if k in items),
                  f"| credits {r['credits']} | backup {r['extra']['backup_generations']}/{r['extra']['generations']} {r['extra']['backup_models']} | fillers {r['extra']['fillers']}")
            for n in r["notes"]:
                print("     -", n)
            if r["extra"]["mock_mismatch"] or r["extra"]["truncated_replies"]:
                print("     extra:", r["extra"]["mock_mismatch"], "truncated:", r["extra"]["truncated_replies"])
        applicable = [(k, v) for r in rs for k, v in r["checks"].items() if k in items and v is not None]
        passed = sum(1 for _, v in applicable if v)
        lat = {k: [x for r in rs for x in r["latency"][k]] for k in ("ttfb", "ttfb_primary", "since_user")}
        usd = sum(r["llm_usd_total"] for r in rs)
        mins = sum(r["est_minutes"] for r in rs)
        print(f"  overall {passed}/{len(applicable)} = {passed / len(applicable):.0%} | ttfb med {pct(lat['ttfb'], .5):.2f}s p90 {pct(lat['ttfb'], .9):.2f}s "
              f"| primary-only ttfb med {pct(lat['ttfb_primary'], .5) or 0:.2f}s p90 {pct(lat['ttfb_primary'], .9) or 0:.2f}s (n={len(lat['ttfb_primary'])}) "
              f"| first-text since caller med {pct(lat['since_user'], .5):.2f}s p90 {pct(lat['since_user'], .9):.2f}s "
              f"| credits {sum(r['credits'] or 0 for r in rs)} | LLM ${usd:.3f} over ~{mins:.1f} est. min")

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ["fixtures", "setup", "run", "balance", "score", "cleanup", "turns"]:
        sp = sub.add_parser(name)
        sp.add_argument("--out", default=".")
        if name == "setup":
            sp.add_argument("--prompt", required=True)
            sp.add_argument("--models", default="")
            sp.add_argument("--max-turns", type=int, default=24)
            sp.add_argument("--user-model", default="claude-haiku-5-5")
            sp.add_argument("--scenarios", default="")
        if name == "turns":
            sp.add_argument("--replay", default="")
            sp.add_argument("--scenario", default="S7")
        if name == "run":
            sp.add_argument("--model", required=True)
            sp.add_argument("--scenarios", required=True)
            sp.add_argument("--repeat", type=int, default=1)
            sp.add_argument("--est-credits", type=int, default=600)
    a = ap.parse_args()
    if a.cmd == "score":
        return score(a.out)
    {"fixtures": cmd_fixtures, "setup": cmd_setup, "run": cmd_run, "balance": cmd_balance, "cleanup": cmd_cleanup,
     "turns": cmd_turns}[a.cmd](a)


if __name__ == "__main__":
    main()
