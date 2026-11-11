#!/usr/bin/env python3
"""Client unit roster -> Convex importer (backlog B3).

Reads ONE tab of docs/rosters/518-unit-rosters-normalized.xlsx (the local mirror of the live
Google Sheet), converts it to JSON and calls the internal Convex mutation
rosterImport:importProperties in batches of whole properties. Mapping and validation live in
convex/rosterMapping.ts; this script only converts cells and checks the sheet's shape.

Run from dashboard/ with an isolated interpreter (needs openpyxl):

    python3 -I scripts/roster/import_roster.py dry-run --category silver \
        --org <orgId> --asset-manager <usersId> --deployment brilliant-badger-615
    python3 -I scripts/roster/import_roster.py apply   ...same flags...
    python3 -I scripts/roster/import_roster.py verify  --category silver --org <orgId> --deployment ...
    python3 -I scripts/roster/import_roster.py to-json --category silver > silver.json

Rows still under review: `--skip-flagged` leaves out every row whose "Please check" is not empty
(no unit, resident or unitSourceRows row is written for it; a property is created only if at
least one of its rows is imported). `--include-rows M-022,M-036` keeps the named flagged rows
anyway, and `--expect-skipped M-001,...` stops unless exactly those rows are skipped. Pass the
same three flags to `verify`, so it compares the rows that were imported.

Safety: every Convex call names --deployment explicitly, and the script refuses to run unless
that deployment is the one in dashboard/.env.local (CONVEX_DEPLOYMENT) and is a dev deployment.
It never passes --prod. Tenant names are never printed.
"""

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
DASHBOARD = os.path.normpath(os.path.join(HERE, "..", ".."))
REPO = os.path.dirname(DASHBOARD)
WORKBOOK = os.path.join(REPO, "docs", "rosters", "518-unit-rosters-normalized.xlsx")

TABS = {"gold": "Gold", "silver": "Silver", "make_up": "Make Up (Delia)"}

# The contract (docs/rosters/unit-fields-spec.md, "Final column list"): every header the sheet must
# have, each exactly once. Columns are found by header name, not position, so moving a column in
# the Sheet does not break the import; a header that is not listed here stops it.
# None = a column that is never imported: the review columns (Please check, Correct? (Y/N),
# Corrections) and "Phone Number" (user decision 2026-11-03: accepted but not imported yet).
COLUMNS = [
    ("Row ID", "rowId"),
    ("Property", "property"),
    ("Unit", "unit"),
    ("Phone Number", None),
    ("Category", "category"),
    ("City", "city"),
    ("Unit type", "unitType"),
    ("Floor", "floor"),
    ("Bedrooms", "bedrooms"),
    ("Bathrooms", "bathrooms"),
    ("Status", "status"),
    ("Tenants", "tenants"),
    ("Lease type", "leaseType"),
    ("Lease end", "leaseEnd"),
    ("Rent", "rent"),
    ("Rent paid to", "rentPaidTo"),
    ("Heating fuel", "heatingFuel"),
    ("Gas paid by", "gasPaidBy"),
    ("Electric paid by", "electricPaidBy"),
    ("Laundry", "laundry"),
    ("Selling", "selling"),
    ("Asset manager", "assetManager"),
    ("Owners Name", "ownersName"),
    ("Owners Email Address", "ownersEmail"),
    ("Notes", "notes"),
    ("Please check", None),
    ("Correct? (Y/N)", None),
    ("Corrections", None),
    ("Source: Unit", "sourceUnit"),
    ("Source: COM (unlabeled column)", "sourceCom"),
    ("Source: Floor", "sourceFloor"),
    ("Source: Tenants", "sourceTenants"),
    ("Source: Lease End/Exp", "sourceLeaseEnd"),
    ("Source: Bed/Bath", "sourceBedBath"),
    ("Source: Rent", "sourceRent"),
    ("Source: G/E & T/L", "sourceGeTl"),
    ("Source: LMAT", "sourceLmat"),
    ("Source: Laundry", "sourceLaundry"),
    ("Source: Gas Paid", "sourceGasPaid"),
    ("Source: Electric Paid", "sourceElectricPaid"),
    ("Source: Gas/Electric", "sourceGasElectric"),
    ("Source: Who", "sourceWho"),
    ("Source: W/D", "sourceWd"),
    ("Source: Property heading", "sourcePropertyHeading"),
    ("Source: Layout notes", "sourceLayoutNotes"),
    ("Source: Section", "sourceSection"),
    ("Source: Page", "page"),
    ("Source: Manager feedback", "managerFeedback"),
]
PLEASE_CHECK = "Please check"
INT_KEYS = {"floor", "bedrooms", "page"}  # whole numbers that openpyxl reads as floats
DATE_KEYS = {"leaseEnd"}

# Decision 2 (user, 2026-10-30): exactly the units Sarah may offer, checked against the rule.
EXPECTED_AVAILABLE = {
    "silver": sorted([
        "173 Western Avenue 1",
        "184 Remsen Street 2",
        "204 Lafayette Street 3C",
        "361 Washington Avenue 8",
        "718 East Street 6- BR",
        "1635 Van Vranken Avenue 1",
        "687 State Street B2",
        "687 State Street B3",
        "687 State Street B4",
    ]),
    # Same rule (user decision 2026-11-03). M-009's rent is Delia's confirmed asking rent; the
    # other eight are still asked ("is the rent shown the current asking rent?") but imported.
    "make_up": sorted([
        "169 Myrtle Ave, Albany 2",
        "19 Newark St, Cohoes 1",
        "53 - 57 Broad St, Waterford 1R",
        "66 Second St, Waterford 5",
        "66 Second St, Waterford 7",
        "152 Main St, Cohoes 2",
        "182 Hill St, Troy 2",
        "218 North 4th St, Mechanicville 1",
        "536 3rd St, Watervliet 1R",
    ]),
    # Same rule (user decision 2026-11-04): the rents Nina typed are the asking rents. Not offered:
    # 3 South Marshall Street 1 (G-027, "not renting", now Vacant – not rent ready), the commercial
    # units, and every unit of the Selling = Yes properties (54 Alexander, 280 9th, 281 Ontario).
    "gold": sorted([
        "1 - 4 Strong Place 1B",
        "1 - 4 Strong Place 4A",
        "1 - 4 Strong Place 4B",
        "2 Prout Avenue 6",
        "8 South Main Street 2A",
        "15-17 2nd Street 15-3R",
        "15-17 2nd Street 17-1",
        "19 Garner Street 2 L",
        "19 Garner Street 2 R",
        "24 107th Street 1",
        "24 107th Street 2",
        "36 Spring Street 1F",
        "36 Spring Street 2F",
        "36 Spring Street 3F",
        "46 - 48 South Lake Avenue 2",
        "46 - 48 South Lake Avenue 3",
        "46 - 48 South Lake Avenue 5",
        "46 - 48 South Lake Avenue 11",
        "52 Bassett Street 2",
        "52 Bassett Street 3",
        "89 Howard Street 1",
        "89 Howard Street 2",
        "106 Elsmere Avenue 2",
        "109 Washington Street 3",  # G-113, moved out (Nina, 2026-11-09)
        "166 2nd St 1",
        "166 2nd St 3",  # G-134, moved out (Nina, 2026-11-09)
        "171 Saratoga Avenue 1",
        "187 Saratoga Avenue 2",
        "208 Elm Street 1",
        "427 1st Street 2",
        "448 5th Avenue 1",
        "521 1st Street 1 F",
        "1815 Highland Avenue 2",
    ]),
}

BATCH_ROWS = 60

# find_unit checks run against the imported data (dry run and verify).
PROBES = {
    "silver": [
        {"spokenAddress": "184 Remsen Street", "spokenUnit": "2"},
        {"spokenAddress": "479 1st Street", "spokenUnit": "479-1"},
        {"spokenAddress": "477 1st Street", "spokenUnit": "479-1"},
        {"spokenAddress": "687 State Street", "spokenUnit": "B2"},
        {"spokenAddress": "687 State St, Albany", "spokenUnit": "apartment b 2"},
        {"spokenAddress": "Remsen Street", "spokenUnit": "2"},
    ],
    # Make Up addresses mostly have a street type and a city in the Property text.
    "make_up": [
        {"spokenAddress": "19 Spring Street, Troy", "spokenUnit": "2"},
        {"spokenAddress": "19 Spring Street, Troy", "spokenUnit": "1"},
        {"spokenAddress": "218 North Fourth Street, Mechanicville", "spokenUnit": "1"},
        {"spokenAddress": "9 South Main Street Mechanicville", "spokenUnit": "1-1"},
        {"spokenAddress": "86 4th Street Waterford", "spokenUnit": "86-1"},
        {"spokenAddress": "17 Harrison Avenue", "spokenUnit": "1F"},
        {"spokenAddress": "Broad Street Waterford", "spokenUnit": "2"},
    ],
    # Gold: spaced labels, the 39 Mulberry split, "St" vs "Street", and a Selling property.
    "gold": [
        {"spokenAddress": "19 Garner Street", "spokenUnit": "2L"},
        {"spokenAddress": "46 48 South Lake Avenue", "spokenUnit": "11"},
        {"spokenAddress": "39 Mulberry Street", "spokenUnit": "39A"},
        {"spokenAddress": "37 Mulberry Street", "spokenUnit": "39A"},
        {"spokenAddress": "166 2nd Street", "spokenUnit": "1"},
        {"spokenAddress": "54 Alexander Street", "spokenUnit": "1"},
        {"spokenAddress": "Saratoga Avenue", "spokenUnit": "1"},
    ],
}


def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


# --- Sheet -> JSON -----------------------------------------------------------------

def convert_cell(key, value, row_id):
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        if key not in DATE_KEYS:
            die(f"{row_id}: {key} holds a date ({value}); only Lease end may")
        if (value.hour, value.minute, value.second, value.microsecond) != (0, 0, 0, 0):
            die(f"{row_id}: {key} date has a time part ({value})")
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, bool):
        die(f"{row_id}: {key} holds a boolean")
    if isinstance(value, (int, float)):
        if key in INT_KEYS:
            if float(value) != int(value):
                die(f"{row_id}: {key} {value} is not a whole number")
            return int(value)
        return int(value) if float(value).is_integer() else float(value)
    if isinstance(value, str):
        return value
    die(f"{row_id}: {key} has an unexpected cell type {type(value).__name__}")


def read_tab(category, with_flags=False):
    """The tab's rows as JSON-ready dicts, columns found by header name.

    With with_flags, also returns {Row ID: "Please check" text} (review only, never sent)."""
    if category not in TABS:
        die(f"unknown category {category!r}; use one of {', '.join(TABS)}")
    wb = openpyxl.load_workbook(WORKBOOK, data_only=True)
    ws = wb[TABS[category]]
    header = [c.value for c in ws[1]]
    known = dict(COLUMNS)
    position = {}
    for i, name in enumerate(header):
        if name is None:
            continue  # an unused column; checked below to hold no data
        if not isinstance(name, str) or name not in known:
            die(f"{TABS[category]}: column {i + 1} has the header {name!r}, which the importer does not know; "
                f"add it to COLUMNS in import_roster.py (and the spec) before importing")
        if name in position:
            die(f"{TABS[category]}: the header {name!r} appears twice (columns {position[name] + 1} and {i + 1})")
        position[name] = i
    missing = [h for h, _ in COLUMNS if h not in position]
    if missing:
        die(f"{TABS[category]}: missing columns {missing}")
    unnamed = [i for i, name in enumerate(header) if name is None]
    rows, flags = [], {}
    for cells in ws.iter_rows(min_row=2, values_only=True):
        if all(v is None for v in cells):
            continue
        row_id = cells[position["Row ID"]]
        for i in unnamed:
            if i < len(cells) and cells[i] is not None:
                die(f"{TABS[category]}: {row_id} has a value in column {i + 1}, which has no header")
        out = {}
        for header_name, key in COLUMNS:
            if key is None:
                continue  # review columns and Phone Number are never imported
            out[key] = convert_cell(key, cells[position[header_name]], row_id)
        check = cells[position[PLEASE_CHECK]]
        flags[row_id] = check.strip() if isinstance(check, str) else ("" if check is None else str(check))
        rows.append(out)
    prefix = {"gold": "G", "silver": "S", "make_up": "M"}[category]
    ids = [r["rowId"] for r in rows]
    if len(set(ids)) != len(ids):
        die("duplicate Row IDs")
    for i, rid in enumerate(ids, 1):
        if rid != f"{prefix}-{i:03d}":
            die(f"Row IDs are not sequential: row {i} is {rid!r}")
    return (rows, flags) if with_flags else rows


def id_list(text):
    return [x.strip() for x in (text or "").split(",") if x.strip()]


def select_rows(args):
    """The rows to import: all of them, or (--skip-flagged) the resolved ones plus --include-rows.

    Returns (rows, skipped Row IDs, properties with every row skipped)."""
    rows, flags = read_tab(args.category, with_flags=True)
    include = id_list(getattr(args, "include_rows", None))
    expect = id_list(getattr(args, "expect_skipped", None))
    if not args.skip_flagged:
        if include or expect:
            die("--include-rows and --expect-skipped only make sense with --skip-flagged")
        return rows, [], []
    unknown = [r for r in include if r not in flags]
    if unknown:
        die(f"--include-rows names rows that are not on the tab: {unknown}")
    not_flagged = [r for r in include if not flags[r]]
    if not_flagged:
        die(f"--include-rows names rows that have no \"Please check\" question (they are imported anyway): {not_flagged}")
    keep = [r for r in rows if not flags[r["rowId"]] or r["rowId"] in include]
    skipped = [r["rowId"] for r in rows if flags[r["rowId"]] and r["rowId"] not in include]
    if expect and sorted(skipped) != sorted(expect):
        die(f"skipped rows differ from --expect-skipped:\n  skipped  {skipped}\n  expected {sorted(expect)}\n"
            f"  only skipped {sorted(set(skipped) - set(expect))}, only expected {sorted(set(expect) - set(skipped))}")
    kept_props = {r["property"] for r in keep}
    gone = []
    for r in rows:
        if r["property"] not in kept_props and r["property"] not in gone:
            gone.append(r["property"])
    return keep, skipped, gone


def batches(rows):
    groups = {}
    for r in rows:
        groups.setdefault(r["property"], []).append(r)
    batch, out = [], []
    for name, group in groups.items():
        if batch and len(batch) + len(group) > BATCH_ROWS:
            out.append(batch)
            batch = []
        batch.extend(group)
    if batch:
        out.append(batch)
    return out, len(groups)


def expected_available(rows):
    """Decision 2's rule applied to the sheet: Vacant + Residential + rent stated, and the
    property not marked Selling (user decision 2026-11-04)."""
    return sorted(
        f"{r['property']} {r['unit']}"
        for r in rows
        if r["status"] == "Vacant" and r["unitType"] == "Residential" and r["rent"] != "-"
        and r["selling"] != "Yes"
    )


# --- Convex calls --------------------------------------------------------------------

def check_deployment(deployment):
    env = os.path.join(DASHBOARD, ".env.local")
    configured = None
    with open(env) as f:
        for line in f:
            m = re.match(r"\s*CONVEX_DEPLOYMENT\s*=\s*([^\s#]+)", line)
            if m:
                configured = m.group(1)
    if configured != f"dev:{deployment}":
        die(f"--deployment {deployment} is not the dev deployment in .env.local ({configured}); refusing")


def error_line(stderr):
    """Only the error message line: never echo the call's data, which holds tenant names."""
    lines = [l for l in stderr.splitlines() if "Error" in l and "Request ID" not in l and "Failed to run" not in l]
    return (lines[0] if lines else stderr.strip().splitlines()[-1] if stderr.strip() else "(no output)")[:400]


def convex_run(deployment, fn, args):
    cmd = ["npx", "convex", "run", "--deployment", deployment, "--typecheck", "disable", "--codegen", "disable", fn, json.dumps(args)]
    proc = subprocess.run(cmd, cwd=DASHBOARD, capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def parse_json_output(stdout):
    start = min([i for i in (stdout.find("{"), stdout.find("[")) if i >= 0], default=-1)
    if start < 0:
        die(f"no JSON in Convex output: {stdout[:500]}")
    return json.loads(stdout[start:])


def dry_run_summary(stderr):
    m = re.search(r"ConvexError: (\{.*\})", stderr, re.S)
    if not m:
        return None
    text = m.group(1)
    # The CLI prints the data and then the stack; take the first complete JSON object.
    depth = 0
    for i, ch in enumerate(text):
        depth += ch == "{"
        depth -= ch == "}"
        if depth == 0:
            return json.loads(text[: i + 1])
    return None


def add(total, part):
    for k, v in part.items():
        if isinstance(v, dict):
            add(total.setdefault(k, {}), v)
        elif isinstance(v, list):
            total.setdefault(k, []).extend(v)
        elif isinstance(v, bool):
            total[k] = v
        else:
            total[k] = total.get(k, 0) + v


def print_selection(args, rows, skipped, gone):
    if not args.skip_flagged:
        return
    print(f"--skip-flagged: importing {len(rows)} rows; skipped {len(skipped)} flagged rows: {', '.join(skipped)}")
    if args.include_rows:
        print(f"  flagged rows imported anyway (--include-rows): {', '.join(id_list(args.include_rows))}")
    print(f"  properties with every row skipped (not created): {gone if gone else 'none'}")


def run_import(args, dry_run):
    check_deployment(args.deployment)
    rows, skipped, gone = select_rows(args)
    print_selection(args, rows, skipped, gone)
    avail = expected_available(rows)
    want = EXPECTED_AVAILABLE.get(args.category)
    if want is not None and avail != want:
        die(f"availability rule gives {avail}, expected {want}")
    chunks, n_props = batches(rows)
    if dry_run and args.single_batch:
        chunks = [rows]  # one transaction, so the dry run sees the whole roster at once
    print(f"{TABS[args.category]}: {len(rows)} rows, {n_props} properties, {len(chunks)} batches; "
          f"rule-available {len(avail)}; {'DRY RUN' if dry_run else 'APPLY'}")
    total = {}
    for i, chunk in enumerate(chunks, 1):
        payload = {"orgId": args.org, "category": args.category, "assetManagerUserId": args.asset_manager,
                   "rows": chunk, "dryRun": dry_run}
        if dry_run:
            payload["probes"] = PROBES.get(args.category, [])
        code, out, err = convex_run(args.deployment, "rosterImport:importProperties", payload)
        if dry_run:
            summary = dry_run_summary(err + out)
            if not summary or summary.get("kind") != "dry_run":
                die(f"batch {i}: import failed: {error_line(err)}")
            full = summary
            summary = full["summary"]
            if args.single_batch:
                sp = full["secondPass"]
                print(f"  dry-run re-run in the same transaction: properties {sp['properties']} units {sp['units']} "
                      f"residents {sp['residents']} sourceRows {sp['sourceRows']} unitsChanged {sp['unitsChanged']}")
                ll = full["lossless"]
                print(f"  dry-run lossless check: {ll['rows']} rows, {ll['cells']} cells read back, {len(ll['diffs'])} differences")
                for p in ll["diffs"][:50]:
                    print("    DIFF", p)
                print("  dry-run check_availability units (availableUnits):")
                for u in full["offered"]:
                    print("    ", json.dumps(u, ensure_ascii=False))
                print("  dry-run find_unit probes:")
                for p in full["probes"]:
                    print("    ", json.dumps(p))
                print("  dry-run addresses (properties.name -> address.formatted):")
                for a in full.get("addresses", []):
                    print(f"     {a['property']!r} -> {a['formatted']!r}")
        else:
            if code != 0:
                die(f"batch {i}: import failed (earlier batches are committed; fix and re-run, it is idempotent): {error_line(err)}")
            summary = parse_json_output(out)
        add(total, summary)
        print(f"  batch {i}: {len(chunk)} rows -> properties {summary['properties']} units {summary['units']} "
              f"residents {summary['residents']} sourceRows {summary['sourceRows']} "
              f"ownerLinks {summary.get('ownerLinks', {})}")
    total["available"] = sorted(total.get("available", []))
    print(json.dumps({k: v for k, v in total.items() if k != "dryRun"}, indent=2))


# --- Verify (lossless round trip) ----------------------------------------------------

def owner_cell_for_compare(key, value):
    """Mirror of ownerCellForCompare in rosterMapping.ts: owner name trimmed, emails lowercase."""
    if key not in ("ownersName", "ownersEmail") or not isinstance(value, str):
        return value
    if value.strip() == "":
        return None
    if key == "ownersName":
        return value.strip()
    return ", ".join(e.strip().lower() for e in value.split(", "))


def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(float(a) - float(b)) < 1e-9
    return a == b


def compare(rows, exported_rows):
    """Every non-review column of every sheet row against what the database reads back as."""
    exported = {r["rowId"]: r for r in exported_rows}
    sheet = {r["rowId"]: r for r in rows}
    problems = []
    if set(exported) != set(sheet):
        problems.append(f"row sets differ: only in DB {sorted(set(exported) - set(sheet))[:10]}, "
                        f"only in sheet {sorted(set(sheet) - set(exported))[:10]}")
    cells = 0
    for rid, srow in sheet.items():
        erow = exported.get(rid)
        if not erow:
            continue
        for _, key in COLUMNS:
            if key is None:
                continue
            cells += 1
            if not same(owner_cell_for_compare(key, srow[key]), owner_cell_for_compare(key, erow.get(key))):
                # Never print tenant names or owner data: show the column only for those cells.
                hidden = ("tenants", "sourceTenants", "ownersName", "ownersEmail")
                shown = "(hidden)" if key in hidden else f"sheet {srow[key]!r} db {erow.get(key)!r}"
                problems.append(f"{rid} {key}: {shown}")
    return problems


def run_verify(args):
    check_deployment(args.deployment)
    rows, skipped, gone = select_rows(args)
    print_selection(args, rows, skipped, gone)
    code, out, err = convex_run(args.deployment, "rosterImport:exportRows", {"orgId": args.org, "category": args.category})
    if code != 0:
        die(f"export failed: {error_line(err)}")
    exported_rows = parse_json_output(out)
    problems = compare(rows, exported_rows)
    cells = len(exported_rows) * sum(1 for _, k in COLUMNS if k)
    print(f"lossless check: {len(rows)} sheet rows, {len(exported_rows)} DB rows, {cells} cells compared, {len(problems)} differences")
    for p in problems[:50]:
        print("  DIFF", p)
    code, out, err = convex_run(args.deployment, "rosterImport:stats", {"orgId": args.org, "category": args.category})
    if code != 0:
        die(f"stats failed: {error_line(err)}")
    stats = parse_json_output(out)
    print(json.dumps(stats, indent=2))
    want = EXPECTED_AVAILABLE.get(args.category)
    if want is not None and sorted(stats["available"]) != want:
        problems.append(f"available in DB {stats['available']} != expected {want}")
        print("  DIFF available set")
    # Sheet-side breakdowns, to compare with the DB tallies above.
    from collections import Counter
    print("sheet Status", dict(Counter(r["status"] for r in rows)))
    print("sheet Unit type", dict(Counter(r["unitType"] for r in rows)))
    print("sheet Lease type", dict(Counter(r["leaseType"] for r in rows)))
    names = [n for r in rows if r["tenants"] != "-" for n in r["tenants"].split("; ")]
    print(f"sheet tenant names {len(names)}, with '&' {sum('&' in n for n in names)}")
    sys.exit(1 if problems else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["to-json", "dry-run", "apply", "verify"])
    ap.add_argument("--category", required=True, choices=sorted(TABS))
    ap.add_argument("--org")
    ap.add_argument("--asset-manager", help="users _id every new property/unit is assigned to")
    ap.add_argument("--deployment", help="dev deployment name, e.g. brilliant-badger-615")
    ap.add_argument("--skip-flagged", action="store_true",
                    help="leave out every row whose \"Please check\" is not empty (still under review)")
    ap.add_argument("--include-rows", help="with --skip-flagged: comma-separated flagged Row IDs to import anyway")
    ap.add_argument("--expect-skipped", help="with --skip-flagged: comma-separated Row IDs that must be exactly "
                                             "the skipped ones, or nothing runs")
    ap.add_argument("--single-batch", action="store_true",
                    help="dry run only: send every row in one transaction and check the read-back, "
                         "availability and find_unit results before anything is committed")
    args = ap.parse_args()
    if args.command == "to-json":
        json.dump(read_tab(args.category), sys.stdout, ensure_ascii=False, indent=1)
        return
    if not args.org or not args.deployment:
        die("--org and --deployment are required")
    if args.command == "verify":
        run_verify(args)
        return
    if not args.asset_manager:
        die("--asset-manager is required")
    run_import(args, dry_run=args.command == "dry-run")


if __name__ == "__main__":
    main()
