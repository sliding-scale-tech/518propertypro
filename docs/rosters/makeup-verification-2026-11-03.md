# Make Up (Delia) tab: verification of the manager's edits, 2026-11-03

Read-only check of the live Google Sheet "518 property list" (spreadsheet `1BtIdb_vUprOjXxg1Xk4cBiqcDQL0tWXa8Qd_-63lApg`), tab "Make Up (Delia)" (sheetId `2128282752`, confirmed from the tab metadata). Nothing in the Sheet was changed. Baseline: `docs/rosters/518-unit-rosters-normalized.xlsx` (pass 4, 2026-10-30). Contract: `docs/rosters/unit-fields-spec.md`. Importer read: `dashboard/convex/rosterMapping.ts`, `dashboard/convex/rosterImport.ts`, `dashboard/scripts/roster/import_roster.py`.

Privacy: no tenant names below ("tenant filled"); owner emails are masked; phone numbers are not printed.

Note: the Sheet was being edited while this check ran. Between the first and second metadata reads, the "Owners Name" / "Owners Email Address" headers were also added to Gold and Silver. The Make Up values were read again at the end and matched the analysed snapshot.

## 1. Structure

| Check | Result |
|---|---|
| Header row | **48 columns, not the 45 in the spec.** Three new columns: **D "Phone Number"** (after Unit), **W "Owners Name"** and **X "Owners Email Address"** (after Asset manager, before Notes). Apart from that, the 45 standard headers are all there, spelled exactly as before and in the same order. |
| Gold and Silver | Both now have the same 48 headers (Phone Number in D, Owners Name / Owners Email Address in W/X). On both tabs all three new columns are **empty**. (Report only.) |
| Source column groups | Intact. The outer group covers AC:AV (Source: Unit … Source: Manager feedback, indexes 28–47); the inner group covers AT:AV (Source: Section, Source: Page, Source: Manager feedback). The groups moved 2 columns right because of the new D and W/X columns. On Gold and Silver the groups moved the same way. |
| Source cells | **No Source: cell changed** on any row (all 20 Source columns are identical to the baseline). |
| Rows | 101 data rows, same as before. None added, removed or reordered. Row IDs run M-001…M-101 in order and are unique. |
| Other | Make Up basic filter now covers A1:AV1000 (it was A1:AQ102). Silver now freezes 2 columns (Row ID, Property) instead of 3. No cell notes and no anchored comments on the tab. Hidden "Read me" tab not touched. Its decision 3 still says At-will and Month-to-month "stay separate for now", which the spec superseded on 2026-10-30 (report only). |
| Dropdowns | Unit type, Status, Lease type, Rent paid to, Heating fuel, Gas/Electric paid by, Laundry and Selling still use the spec's lists (Status uses an en dash, U+2013). |

## 2. Changed cells (live vs baseline)

The 45 baseline columns have **737 changed cells**. On top of that, the new columns hold Phone Number 100, Owners Name 101 and Owners Email Address 100 filled cells.

| Column | Cells | What changed |
|---|---|---|
| Rent paid to | 101 | "-" → "518 Property Pro" on every row |
| Status | 100 | "-" → Occupied 91, Vacant 8, "Vacant – not rent ready" 1 (M-099). M-009 stayed Vacant. Now: Occupied 91, Vacant 9, Vacant – not rent ready 1 |
| Tenants | 100 | "-" → tenant filled on 90 rows; "-" → the word "Vacant" on 10 rows; M-055 stays "-" |
| Electric paid by | 92 | "-" → Tenant 81, Landlord 11 (66 Second St) |
| City | 86 | "-" → Waterford 34, Mechaniville 20, Watervliet 12, Cohoes 6, Rennselaer 4, Glens Falls 4, Albany 4, Troy 2 |
| Property | 84 | Street types and cities added to the address text (see section 3) |
| Correct? (Y/N) | 53 | "" → "Y" |
| Corrections | 53 | Free text (section 4) |
| Lease end | 34 | date → new date 15; date → **blank** 11; "-" → date 5; date → **0** 2; "-" → **blank** 1 |
| Lease type | 20 | Fixed term → Month-to-month 12; Month-to-month → Fixed term 4 (M-051, M-052, M-072, M-076); Unknown → Month-to-month 2 (M-045, M-046); Fixed term → "-" 1 (M-099); "-" → **blank** 1 (M-078) |
| Laundry | 4 | Unknown ("H/K") → Hookups in unit (M-006, M-084, M-085); "-" → None (M-036). No Unknown is left. |
| Selling | 3 | "-" → Yes (M-001, M-006, M-007) |
| Gas paid by | 3 | "-" → Tenant (M-034, M-035, M-036) |
| Floor | 3 | "-" → 1 (M-081), 2 (M-082), 2 (M-083) |
| Unit type | 1 | Residential → Office (M-045) |

Unchanged: Row ID, Unit, Category, Bedrooms, Bathrooms, **Rent** (the sum is still $126,474.00 = $106,689.00 + $19,785.00), Heating fuel, Asset manager (Delia on all rows), Notes, Please check, every Source column.

## 3. Value and consistency check

### Errors (must fix before import)

| Row ID(s) | Column | Value | Problem | Suggested value |
|---|---|---|---|---|
| M-027, M-031, M-032, M-038, M-041, M-043, M-053, M-067, M-068, M-078, M-098, M-099 (12) | Lease end | empty cell | Not stated must be "-". The importer rejects an empty data cell. | `-` |
| M-064, M-070 | Lease end | `0` (number) | Not a date. The importer rejects it (and 0 is never allowed). | `-` (both are Month-to-month) |
| M-078 | Lease type | empty cell | Not in the allowed set; the importer rejects it. | `-` (as on the other vacant rows; or `Vacant` on all 10 vacant rows if you want them consistent) |
| M-009, M-022, M-036, M-054, M-056, M-078, M-080, M-081, M-091, M-099 | Tenants | `Vacant` | Tenants must be "-" when the unit is vacant. The importer rejects "Tenants set on a unit whose Status is not occupied". | `-` |
| M-005, M-010 | Tenants | tenant filled, two full names joined with " & " | The convention is "; " between two full names. The importer splits only on "; ", so this would create one resident with both names. | `Full Name 1; Full Name 2` |
| M-010 vs M-011…M-015 | Property | `9 S. Main St, Mechanicville` vs `9 S. Main St, Mechaniville` | One building with two spellings. The importer groups by Property text, so it would create two properties. | `9 S. Main St, Mechanicville` on all 6 rows |
| M-033 vs M-034, M-035 | Property | `51 Broad, St Waterford` | Misplaced comma; splits the building into two properties. | `51 Broad St, Waterford` |
| M-076 vs M-075 | Property | `148 Main, Cohoes` | Missing "St"; splits the building. | `148 Main St, Cohoes` |
| M-081…M-083 | Property | `218 North 4th St, Mechaniccille` | City typo. | `218 North 4th St, Mechanicville` |
| 26 rows (M-010…M-015, M-026…M-028, M-031, M-032, M-061, M-062, M-067…M-074, M-081…M-085) | City | `Mechaniville` | Delia answered "Mechanicville" on M-010, and her own Property text uses Mechanicville. The City column was not updated. | `Mechanicville` |
| M-018…M-021 | City | `Rennselaer` | Misspelling of Rensselaer, NY (it was not in the source; she typed it). | `Rensselaer` (confirm) |

### Warnings (check with Delia, or decide)

- **M-055** (66 Second St 6): Status Occupied and Fixed term to 2027-06-30, but Tenants "-" and Phone empty. The tenant name is missing.
- **M-035, M-069, M-071**: Tenants hold two first names only ("A & B", "A and B"). Full names are needed, written as "Full Name 1; Full Name 2".
- **Shared-surname pairs** written "A & B Surname" (M-004, M-085, M-093) follow the Silver convention and import as one resident. That is fine unless you want one resident per person.
- **Lease end now in the past, status Occupied** (as of 2026-11-03): M-013, M-084, M-097 (2026-10-31, not asked before because they were still in the future on 10-29) and M-016 (2026-09-30; she says the tenant "is renewing for January", but the date was not changed).
- **M-033** Office: lease end moved from 2026-11-30 to **2029-11-30**. Confirm it is a 3-year lease, not a typo for 2026 or 2027.
- **M-045** (60 - 62 Broad 1R): she says "Not a unit - part of the office" and changed the Unit type to Office. M-045 and M-046 have the same tenant (the company's own realty group) and the same phone. Decide whether to drop or merge 1R into M-046 "Office" or keep it as a non-rentable unit. Both rows keep Rent "-" but now have Rent paid to "518 Property Pro". For the company's own office, "-" is probably right. M-046's question (rent and lease) has no answer, although its Lease type was set to Month-to-month.
- **Rent paid to = "518 Property Pro" on all 101 rows**, including the 15 "Delia Management Properties" rows that are managed for outside owners. Plausible, but confirm.
- **Electric paid by** was filled on 92 rows (and Gas paid by on 3). This answers open question 2 ("who pays the other one?"), so it is newer than the source ("Who" names only one utility). Electric-heated units M-030, M-037, M-040, M-041, M-099 still have Gas paid by "-". Do those units have gas at all?
- **Selling = Yes** on 1 N. Liberty Ave (M-001) and 19 Spring St (M-006, M-007). This is new and not in the source. None of these units is vacant, so Sarah's availability is not affected.
- **Floors** for 219 Saratoga Ave (M-084, M-085) are still "-" (question unanswered). M-083 (unit 3) is on floor 2, the same as unit 2. Confirm.
- **Same tenant and phone on two rows**: M-039 (53 - 57 Broad 2W, residential) and M-042 (unit 6, commercial). This may be correct. M-071 and M-072 share a phone but have different tenants (different buildings).
- **Vacant units Sarah would offer** (Vacant + Residential + rent stated): M-009, M-022, M-036, M-054, M-056, M-078, M-080, M-081, M-091 (9 units; M-099 is not rent ready, so it is excluded). Only M-009's rent was confirmed as the asking rent. Confirm the other eight are asking rents.
- **Stale Notes and review state** (process, as with Silver): 27 rows still say "Lease end: Date has passed" after she fixed them. M-005 still says "Invalid date", M-034 still says "Not a month-end date", and M-006, M-084, M-085 still say H/K "Meaning unknown". Please check was not cleared on the 53 resolved rows. Her answers are not in "Source: Manager feedback", and the importer never reads Corrections, so the provenance of her edits would be lost unless they are copied there.
- **Address format**: "86 - 88 4th St. Waterford" (M-063…M-066) has no comma. "17 Harrison Ave" (M-018…M-021) has no city, unlike the other addresses. Every Property now repeats the city that is also in City, so the importer's `addressFormatted` would read "…, Waterford, Waterford, NY". Either drop the city from Property or accept the duplicate.

### Phone Number (new column, report only)

- 81 rows use `NNN-NNN-NNNN`; 4 use `(NNN) NNN-NNNN` (M-052, M-098, M-100, M-101).
- Bad values: M-029 has only 9 digits. M-079 and M-095 are missing a hyphen. M-057 has area code 528 (probably a typo for 518). **M-074 has the tenant's name instead of a number.** M-043 says "N/A". M-055 is empty. The 10 vacant rows say "Vacant" (use "-").
- Duplicate numbers: M-039/M-042, M-045/M-046 (same tenant on both rows), M-071/M-072 (different tenants).

### Typed columns with free text

None. Every Status, Lease type, Laundry, Unit type, Selling, payer and Rent paid to value is a dropdown value. The free-text problems are the Tenants "Vacant" (above), Phone "Vacant"/"N/A"/a name, and the Corrections column.

## 4. Delia's corrections (every row she touched in Correct? / Corrections)

53 rows have Correct? = "Y" and 53 have Corrections text (51 rows have both). No row has "N". There are no cell notes or comments. Two rows have Y but no correction (M-024, M-027), and two have a correction but no Y (M-009, M-045). Of the 56 rows with a question, 55 got a Y and/or a correction; **M-046 got neither**.

Key: ✅ applied in the data columns · 🟡 partly applied · ❌ only described.

| Row ID | Question asked | Her correction (paraphrased) | Applied? | Cell change still needed (our conventions) |
|---|---|---|---|---|
| M-001 | No street type | "Ave" | ✅ Property `1 N. Liberty Ave, Wynantskill`. She also set Selling = Yes (not asked) | Owner email is blank (section 5) |
| M-005 | 9/31/27 is not a date | "9/30/27" | ✅ Lease end 2027-09-30 | Notes: replace `Lease end: Invalid date "9/31/27" in source` with `Lease end: Manager corrected source "9/31/27" to 9/30/27`. Tenants: use "; " (section 3) |
| M-006 | H/K meaning | "In Unit" | ✅ Laundry `Hookups in unit` | Notes: `Other: Laundry "H/K" = hookups in unit (manager)`. Ask: "In Unit" could mean a washer and dryer in the unit (`Provided in unit`) rather than hookups |
| M-009 | Vacant with rent $1,650: asking rent? | That is the asking rent | ✅ (data was already right) | Correct? = `Y` |
| M-010 | "Mechaniville" → Mechanicville? | "Mechanicville" | 🟡 Only this row's Property was changed | Property `9 S. Main St, Mechanicville` on M-011…M-015, and City `Mechanicville` on all 26 Mechanicville rows |
| M-016 | No street type; lease 9/30/26 passed | "Lane"; tenant is renewing for January | 🟡 Lane applied; lease not | Keep Fixed term. Lease end: the new end date once she gives it (else keep it and add Notes `Lease end: Manager: tenant renewing in January 2027`). Ask for the new end date |
| M-017 | No street type; lease 6/30/26 passed | "Lane"; lease ends in 2027 | ✅ Property `7 Museum Lane, Waterford`, Lease end 2027-06-30 | Notes: replace "Date has passed" with a manager note. Confirm 2027-06-30 is the exact date (she said only "2027") |
| M-022 | No street type; lease blank | Unit is vacant | ✅ Property `19 Newark St, Cohoes`, Status Vacant | Tenants `-`; Phone `-` |
| M-024 | No street type | (Y only) | ✅ `21 Vanderheyden St, Glens Falls` | none |
| M-027 | Lease 3/31/25 passed | (Y only) | 🟡 Month-to-month set, Lease end left empty | Lease end `-`; Notes `Lease end: Manager: now month-to-month (source 3/31/25)` |
| M-029, M-030 | Lease passed | "Fixed" | ✅ new lease ends 2027-06-30 / 2027-07-31 | Notes: replace "Date has passed" |
| M-031, M-032, M-038, M-041, M-043, M-053, M-067, M-068, M-098 | Lease passed (M-031, M-067, M-098 also street type) | "Fixed" | 🟡 Month-to-month and street types set; Lease end left **empty** | Lease end `-`; Notes `Lease end: Manager: now month-to-month (source <date>)` |
| M-064, M-070 | Lease passed | "Fixed" | 🟡 Month-to-month set; Lease end **0** | Lease end `-`; same Notes as above |
| M-033 | No street type | "Fixed" | 🟡 Property typed `51 Broad, St Waterford`; lease end changed to 2029-11-30 (not asked) | Property `51 Broad St, Waterford`; confirm 2029 |
| M-034 | 12/26/26 not a month-end | "Fixed" | ✅ Lease end 2026-12-31 (also Gas paid by Tenant) | Notes: replace "Not a month-end date" |
| M-035, M-039, M-044, M-050, M-057, M-065, M-077, M-079, M-083, M-101 | Lease passed (M-077 also street type; M-083 also floor) | "Fixed" | ✅ new future lease ends (M-083 floor 2) | Notes: replace "Date has passed". M-035 Tenants needs full names |
| M-036 | Street type; lease blank; Who blank; W/D blank | "Fixed" | ✅ Property, Status Vacant, Gas paid by Tenant, Laundry None | Tenants `-`; Phone `-` |
| M-045 | Street type; rent and lease are dashes | Not a unit, part of the office | 🟡 Unit type → Office, Lease type → Month-to-month; the row still exists as a unit | Decide: remove/merge with M-046, or keep with Rent paid to `-` and Notes `Other: Manager: not a separate unit, part of the office` |
| M-046 | Rent and lease are dashes | (nothing) | ❌ unanswered (Lease type set to Month-to-month without comment) | Ask: is the office rented, at what rent? |
| M-054, M-056, M-091 | Lease blank | "Fixed" | ✅ Status Vacant | Tenants `-`; Phone `-`; confirm rent is asking rent |
| M-061, M-063, M-072, M-075, M-090, M-094, M-096, M-100 | No street type | "Fixed" | ✅ street types (M-072 also became Fixed term to 2027-01-31, not asked) | M-063…M-066 Property `86 - 88 4th St, Waterford` (comma); M-076 Property `148 Main St, Cohoes` |
| M-078 | Lease blank | "Vacant" | 🟡 Status Vacant; Lease type and Lease end left **empty** | Lease type `-`, Lease end `-`, Tenants `-`, Phone `-` |
| M-080 | Lease blank | "Vacant" | ✅ Status Vacant | Tenants `-`, Phone `-` |
| M-081 | Street type; lease blank; floor blank | "Vacant" | ✅ Status Vacant, Floor 1; 🟡 Property city typo | Property `218 North 4th St, Mechanicville`; Tenants `-`, Phone `-` |
| M-082 | Floor blank | "Fixed" | ✅ Floor 2 | none |
| M-084 | Street type; H/K; floor blank | "Fixed" | 🟡 Property and Laundry done; **Floor still "-"**; lease 2026-10-31 now past | Ask for the floor and the lease status |
| M-085 | H/K; floor blank | "Fixed" | 🟡 Laundry done; **Floor still "-"** | Ask for the floor |
| M-099 | Lease 6/1/25 passed | "Vacant" | ✅ Status `Vacant – not rent ready`, Lease type `-`; 🟡 Lease end left **empty** | Lease end `-`, Tenants `-`, Phone `-`; Notes `Other: Manager: vacant, not rent ready` |

Rows edited without a correction or a question (newer truth, accepted): M-051, M-052 (At Will → Fixed term to 2027-12-31), M-076 (M2M → Fixed term to 2027-11-30), the Selling flags, the 92 Electric payers and all Status/Tenants/City values.

**Questions for Delia**
1. M-006: does "In Unit" mean hookups in the unit, or a washer and dryer provided? The same applies to M-084 and M-085 (H/K).
2. M-016: what is the new lease end after the January renewal?
3. M-013, M-084, M-097 (leases ended 2026-10-31): month-to-month now, renewed (new date), or moving out?
4. M-033: is the office lease really to 2029-11-30?
5. M-045 / M-046: should 1R be removed as a unit? Is the office rented, and at what rent? Should Rent paid to be "-" for the company's own office?
6. M-055: tenant name and phone?
7. M-035, M-069, M-071: full names of both tenants.
8. M-084, M-085: which floor?
9. M-017: is 2027-06-30 the exact end date?
10. Are the 8 unconfirmed vacant-unit rents (M-022, M-036, M-054, M-056, M-078, M-080, M-081, M-091) the asking rents?
11. 17 Harrison Ave: is the city Rensselaer? Electric-heated units: is there gas service?
12. M-001: owner email (blank).

## 5. Owner name / owner email

- **Owner source not reachable.** The cited file (`1xfSe5XEe9uosIab7-KChcN8otZzXY4LQ`) returns "not found" from both the Sheets tool and the Drive tools (metadata, download), and Drive search under this Google account does not find it. It is probably not shared with this account, or it lives in another account. **No cross-check against the source was possible**, nothing was downloaded, and there is nothing to delete. To finish this check, share it with the account used here or put a copy in the repo's scratch area.
- **What could be checked (internal):**
  - 101/101 rows have an owner name; 100/101 have an email (**M-001 blank**).
  - Owners are consistent within every property: no property's units disagree. The data is **per property** (each building has one owner pair), so it maps to the existing per-property `properties.ownerName` / `ownerEmail` fields in `dashboard/convex/schema.ts`. Nothing is per unit.
  - Distribution: all 86 "Delia - Rentals" rows show the two company owners (Pat Fiore & Alex Buell; `P***@518propertypro.com, A***@518propertypro.com`), which fits decision 3b (company-owned). The 15 "Delia Management Properties" rows have 4 outside owners: 1 N. Liberty Ave (1 person, email blank); 22-24 Crockett Ave (2 people, `l***@gmail.com, r***@gmail.com`); 19 Spring St (1, `r***@gmail.com`); 169 Myrtle Ave and 9 S. Main St (the same owner, `k***@gmail.com`).
  - Email syntax: every address is valid. Two-person cells use ", " as the separator consistently, with no stray spaces. The schema field `ownerEmail` is a single string, so two addresses in one cell need a decision (keep the ", " string, or split).
  - Spelling/format: "Robert Howell " (M-006, M-007) has a **trailing space**. On 22-24 Crockett Ave one owner's surname in the name cell does not match the local part of her email (two letters swapped: "Film" in the name vs "flim" in the address). Check this against the owner source (name not repeated here).
  - Gold and Silver: the owner columns exist but are empty.
- **Property keys**: the owner source could not be opened, so how it keys properties is unknown. Ours is the Property text, which Delia has just rewritten (street type + city), so any match should use a normalized street address, not the text.

## 6. Conflicts with the source PDF transcription (`docs/context/unit-make-up.md`)

Her edits are treated as the newer truth. Conflicts worth knowing:

- Lease ends changed from the PDF on 34 rows (renewals and month-to-month conversions). M-051, M-052 and M-072 (PDF "At Will") and M-076 (PDF "M2M") are now Fixed term with dates. M-033 is 11/30/26 in the PDF and 2029-11-30 now (possible typo).
- M-045: the PDF lists 1R at 60 - 62 Broad as its own row (0/1, "---"). Delia says it is not a unit.
- City: the PDF writes "Mechaniville". Delia confirmed Mechanicville but left City as "Mechaniville".
- Floors for 218 North 4th (blank in the PDF) are now 1/2/2. 219 Saratoga is still blank.
- The PDF has no tenants, phones, owners, Selling or second-utility payer. All of those are new information from her.
- 53 - 57 Broad 1R: the PDF has a blank Who and W/D. Now Gas paid by Tenant and Laundry None.
- No conflict on rent, bed/bath or unit labels (unchanged).

## 7. Import readiness (`rosterMapping.ts` + `import_roster.py`, code read, nothing run)

Blockers:

1. **Header contract**: `import_roster.py` compares the header row with its exact 45-column `COLUMNS` list and stops ("headers differ"). The three new columns (Phone Number, Owners Name, Owners Email Address) need entries in `COLUMNS` (or must be skipped as `None`). `rosterRowValidator` in `rosterMapping.ts` is a strict `v.object` with no phone/owner keys, so sending them fails argument validation. The same applies to Gold and Silver now (the headers were added there too).
2. **The importer reads the local workbook**, not the live Sheet. `docs/rosters/518-unit-rosters-normalized.xlsx` must be refreshed from the live Sheet after the fixes.
3. **Empty data cells**: `str()` rejects an empty Lease end (12 rows) and an empty Lease type (M-078). It also rejects Lease end `0` (number) on M-064 and M-070.
4. **Tenants "Vacant"** on 10 vacant rows: rejected ("set on a unit whose Status is not occupied").

Mis-maps (no error, wrong data):

5. **Property splits**: rows are grouped by Property text, so "9 S. Main St, Mechanic(v)ille", "51 Broad(,) St" and "148 Main(, St)" create 35 properties instead of 32.
6. **Two-name tenants joined by " & "** (M-005, M-010) become one resident each.
7. **Owners are not imported**: `MappedProperty` / `desiredProperty` never set `ownerName` / `ownerEmail`, and `assertSameProperty` does not check them. Nothing reads these columns until mapping is added. Because the data is per property, they belong on `properties`.
8. **Phones are not imported**: residents are imported as names only (`source: roster_import`, "no phones"). `residents.phones` expects E.164. The Phone column needs cleaning first (9-digit, missing hyphen, area code 528, a name, "Vacant", "N/A") and mapping to the right resident when a unit has two names.
9. `addressFormatted` repeats the city (Property now includes it and City is appended), e.g. "…St, Waterford, Waterford, NY".
10. `EXPECTED_AVAILABLE` has no `make_up` entry, so the availability guard is skipped. The rule gives 9 offered units (listed in section 3). Add the expected list once Delia confirms.
11. Corrections are never imported, and Source: Manager feedback is empty for Make Up, so her answers leave no provenance unless they are copied into Source: Manager feedback first (as was done for Silver).

What passes as is: en-dash Status values, "Vacant – not rent ready", no "At-will", Rent numeric or "-" (never 0), Floor numbers/"Basement"/"-", Bedrooms/Bathrooms numbers, Lease end stored as real dates (yyyy-mm-dd format) where filled, Category "Make Up", Asset manager "Delia", Source: Section values, unit-key uniqueness inside each building, Row IDs sequential.

**Ready to import?** Not yet. It is ready after: (a) the error-table fixes in section 3; (b) a decision on M-045, M-055 and the empty tenant/floor answers (these can go as "-" if they are not answered); (c) adding the three new columns to the importer contract (`COLUMNS`, `rosterRowValidator`, plus owner mapping to `properties.ownerName/ownerEmail` if wanted now); (d) re-exporting the workbook from the live Sheet. Phone import can be a later step, but the importer must at least accept or skip the column.
