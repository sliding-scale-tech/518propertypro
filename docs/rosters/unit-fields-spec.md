# Unit fields spec: normalized unit roster columns

**Status:** proposal, built from the three client rosters on 2026-10-29. Companion to the workbook `docs/rosters/518-unit-rosters-normalized.xlsx`, which the property managers will verify. Updated 2026-10-29 with the client's confirmed decisions (below), and again the same day when the managers' sheet was slimmed (decision 9). Updated 2026-10-30 with the Silver asset manager's answers, two new columns ("Rent paid to", "Source: Manager feedback") and widened Status values (see "Manager feedback applied 2026-10-30 (Silver)"). The column list below is the planned basis for the property/unit database fields and for Sarah's configuration. Background analysis: `docs/unit-roster-field-inventory.md`.

**Sources (treated as the source of truth):** `GOLD Property AI info.pdf` (text layer), `Unit Information Silver Team.pdf` (scan, 23 pages), `Unit Make Up.pdf` (scan, 5 pages). The `docs/context/*.md` transcriptions were used as a starting point for Silver and Make Up and corrected against the page images (see "Corrections to the transcriptions").

## Decisions recorded 2026-10-29

Confirmed by the client on 2026-10-29 and applied to the workbook and this spec:

- **1. Owner = Landlord** (Confirmed): Owner and Landlord mean the same thing; we use "Landlord" everywhere. T = Tenant, O = Landlord, L = Landlord. Gold "G/E ; T" = gas and electric paid by Tenant; "G/E ; L" = both paid by Landlord; "E;T / G;L" = electric paid by Tenant, gas paid by Landlord. Silver Gas Paid / Electric Paid: T = Tenant, O = Landlord.
- **2. Make Up "Who"** (Confirmed): "Who" is who pays the utility named in the "Gas/Electric" column, and only that one. Gas -> Gas paid by = Who, Electric paid by = "-". Electric -> Electric paid by = Who, Gas paid by = "-". Both -> both columns = Who. If Who or Gas/Electric is blank, the affected payer column is "-". The old column "Utility payer, utility not specified" is removed; the original value stays in "Source: Who". Heating fuel still copies Gas/Electric.
- **3. At-will and Month-to-month** (Confirmed; merged 2026-10-30): Kept separate on 2026-10-29 until the client confirmed. **Client answer, 2026-10-30 (Delia's email, cc Patrick): "At-will and Month-to-Month agreements are the same."** They are now one lease type, "Month-to-month" (DB enum `month_to_month`). In the Google Sheet every "At-will" Lease type cell on Gold (65), Silver (95) and Make Up (13) was changed to "Month-to-month" and "At-will" was removed from the Lease type dropdown. "Source: Lease End/Exp" is unchanged, so the original "at-will" / "At Will" / "M2M" text survives.
- **3b. Make Up sections** (Confirmed 2026-10-30): **Client answer, 2026-10-30 (Delia's email, cc Patrick):** "Delia - Rentals" is a portfolio owned by the company's owners; "Delia Management Properties" is managed for other owners, the same management as Nina's (Gold) and Nikki's (Silver). Gold and Silver are therefore managed too (same management model). At import this becomes a property-level field, e.g. `properties.ownership`: `company_owned` | `managed` (see "Source: Section" below).
- **4. Rent not stated** (Confirmed): Rent shows "-" for every unit whose rent the roster does not state: 87 units in all (Gold vacant units written $0.00, Silver vacant units with a blank rent, and units written $0.00, $0.01 or "---"). "Notes" says what the roster showed (after "Rent:"), and each of these rows asks you for the rent (or the asking rent if vacant). Make Up 169 Myrtle Ave #2 (vacant, $1,650.00) keeps 1,650.00.
- **5. "-" for not stated** (Confirmed): Every one of our data columns shows "-" when the roster does not state a value, including City, Floor, Bedrooms, Bathrooms, Status, Tenants, Lease type (replaces the old "Blank"), Lease end, Rent, Heating fuel, Gas/Electric paid by, Laundry and Selling. "Unknown" is kept for a value we cannot classify. Selling is "Yes" where the roster marks it, otherwise "-".
- **6. Storefront** (Confirmed; the name "Storefront" to confirm with Pat): Units labelled S1/S2 with no "COMMERCIAL" marking are "Storefront": Gold 9 Main Street S1 and Silver 204 Lafayette Street S1 and S2. Units the roster marks commercial stay Commercial, garages stay Garage, offices stay Office; all remain normal unit rows. **Updated 2026-10-30 (Silver):** the Silver manager confirmed 204 Lafayette Street S1 and S2 are commercial spaces, so every Silver "Storefront" is now "Commercial" (Silver has no Storefront rows left). Gold 9 Main Street S1 is unchanged and still "Storefront" until Nina answers.
- **7. City** (Confirmed): City shows "-" where the roster does not state one (only Make Up page 1 gives cities).
- **8. Asset managers** (Confirmed): Asset managers confirmed 2026-10-29: Gold = Nina, Silver = Nikki, Make Up = Delia (also accountant). Every row of a tab carries its category's asset manager in the "Asset manager" column.
- **9. Columns slimmed 2026-10-29** (Confirmed): Removed from the managers' sheet, with no information lost: "Tenant count" (derived: count the names in Tenants), "Tenant name cut off in source" (each of those rows still asks for the full name in "Please check"), "New" (the "-new" note stays, as printed, in "Source: Property heading"), and "Unit key", "Street number" and "Street name" (generated at import from Property and Unit; rules kept below). Moved: "Source section" and "Source page" are now "Source: Section" and "Source: Page", hidden in an inner group inside the Source column group (values unchanged). Merged: "Bed/bath note", "Lease end note", "Rent note" and "Other notes" are now one "Notes" column; each note starts with its topic ("Bed/bath:", "Lease end:", "Rent:", "Other:") and notes are joined with "; ". The Source column group is closed when the file opens.

**"-" convention:** "-" means "not stated in the source document" and is used in every derived data column. In the database it is null (absent), never 0 or an empty string. "Unknown" is different: the roster has a value we cannot classify (e.g. Gold LMAT "Hookups or W/D in unit", Make Up W/D "H/K", lease "-------"; Silver laundry "IN UNIT" was Unknown until the manager confirmed it on 2026-10-30). Columns that stay empty when there is nothing: Notes, Please check, Correct? (Y/N), Corrections, and every Source: column that holds original text (verbatim). Source: Section shows "-" for Gold and Silver.

## Manager feedback applied 2026-10-30 (Silver)

Source: `Software Answers.pdf`, Nikki's answers for the Silver tab. Applied to the live Google Sheet by cell and range edits (same file, same link) and mirrored to the local workbook. Gold and Make Up data are unchanged apart from the two new columns. Every Silver row she answered keeps her answer word for word (typos included) in the hidden "Source: Manager feedback" column.

- **New column "Rent paid to"** (after Rent, all tabs): 518 Property Pro / Owner directly / Included in another unit's rent / -. Silver 301 Green Street (17 units) = Owner directly: the owners collect the rent, it is not entered in Buildium, and the manager keeps a separate ledger, so Rent stays "-". Silver 204 Lafayette Street 1B (the apartment inside the law firm The Legal Project) and 508 State Street 2C (rented by the restaurant The Nest) = Included in another unit's rent, with Rent "-". Every other row is "-".
- **New hidden column "Source: Manager feedback"** (last column, inside the Source group): the manager's answer, word for word, for each row she answered (100 Silver rows). Empty elsewhere.
- **Status widened** (all tabs, dropdown updated): Occupied / Occupied – leaving (eviction or moving out) / Vacant (empty and available) / Vacant – not rent ready / -. Silver now: Occupied 258, Occupied – leaving 2 (433 3rd Street 2, in eviction; 204 Lafayette Street S1, salon vacating), Vacant 13, Vacant – not rent ready 2 (1 Washington Avenue 4; 718 East Street 5-BF). For a "not rent ready" or "leaving" unit, Rent holds the future or listing rent where she gave one; 433 3rd Street 2 keeps Rent "-" with the planned $1,250 in Notes.
- **Tenant names:** the cut-off names are replaced with her full names, exactly as she wrote them. Two full names are separated by "; "; a shared-surname pair stays as written ("Robert & Melanie Yeates"). Commercial tenants are the business name, with "Owner name (per manager): ..." in Notes.
- **Rents:** vacant units now carry the listing rent she gave; newly rented units (11 North Church Street 6, 477 1st Street 477-1, 551 5th Avenue 1 and 2) are Occupied with tenant and rent.
- **Commercial:** 182, 184 and 188 Remsen Street COM1 have Bedrooms and Bathrooms "-" (Notes: "Source lists x Bed/y Bath; manager says commercial space"); 204 Lafayette Street S1/S2 are Commercial; 23 North College Street COM and COM B are floor 1 (garage space at the back).
- **Laundry:** Silver "IN UNIT" means an actual washer and dryer in the unit (confirmed), so those 64 rows are "Provided in unit" and their Notes say "Laundry: manager confirmed washer and dryer in unit".
- **City:** Silver City is filled from her list of spreadsheet row ranges for 265 rows (53 properties). Her ranges split two properties, so those stay "-" with a question: 9 Union Street (rows 23–28: 23–27 Schenectady, 28 Albany) and 10 Madison Place (rows 29–32: 29–31 Albany, 32 Schenectady).
- **Review columns:** on the 79 rows her answers fully resolved, "Please check" was cleared, the highlight removed, and "Correct? (Y/N)" set to "Y" (all were empty before). Silver rows with a question went from 99 to 27.
- **Still asked (not applied):** 687 State Street B units (she lists B2, B3, B4 vacant at $550 per room; the roster shows B1, B3, B4 vacant); 86 Remsen Street 1 (lease end unclear); 477-479 1st Street (should 479-1 and 479-2 move to the address 479 1st Street?); 1146 Madison Avenue 3A/3B vs 4-3A/4-3B; 188 Remsen Street COM1 (keep lease end 6/9/2030?); 308 East Street A (is the unit name just "A"?); the city splits above; plus the questions she did not answer (for example 508 State Street 2C names, the high rents at 204 Lafayette S2 and 512 State Street, 301 Green Street 114 lease end).
- **Second pass (2026-10-30, client decisions on the questions above):**
  - City: her ranges were off by one at two boundaries. All of 9 Union Street (rows 23–28) is Schenectady and all of 10 Madison Place (rows 29–32) is Albany; every other row keeps her ranges. Every Silver property now has one city, and none is blank.
  - 687 State Street: B1–B4 are all Vacant for now (B2 changed from Occupied, its tenant cleared; the original is still in "Source: Tenants"). B2, B3 and B4 have Rent 550 (her listing price per room); B1 stays "-". The four rows keep one question: which B units are actually vacant.
  - 86 Remsen Street 1: Lease end 9/14/2027 kept (she confirmed 9/14). Notes add "Manager: owner rented this unit directly".
  - 188 Remsen Street COM1: Lease end 6/9/2030 kept.
  - 1146 Madison Avenue: her "3A"/"3B" are units 4-3A/4-3B (unit names unchanged). Both are Occupied at $1,180, with the tenants she named.
  - 477-479 1st Street: units 479-1 and 479-2 are now Property "479 1st Street"; 477-1 and 477-2 stay "477 1st Street". Unit labels, Row IDs and Source columns are unchanged.
  - 508 State Street 2C: Tenants = "The Nest" (the restaurant downstairs); Rent paid to stays "Included in another unit's rent".
  - Kept as entered by the managers: 204 Lafayette Street S2 rent ($11,708) and 512 State Street NEST rent ($7,012.37); 301 Green Street 114 lease end 8/10/2027; 308 East Street unit name "A  Basement ( F" (verbatim from the source).
  - Review columns: 21 more rows resolved ("Please check" cleared, highlight removed, "Correct? (Y/N)" = "Y"). Silver now has Occupied 259, Occupied – leaving 2, Vacant 12, Vacant – not rent ready 2. 6 rows still have a question: 687 State Street B1–B4, and the cut-off tenant names at 43 Washington Avenue 3S and 718 East Street 3-SFF.
- **Third pass (2026-10-30, her last three answers):**
  - 687 State Street: it is one apartment rented per room. B1 is rented, so B1 is now Occupied (Tenants and Rent stay "-": she gave neither); B2, B3 and B4 stay Vacant at 550. B1–B4 Notes add "Manager: one apartment rented per room"; her answer is appended to "Source: Manager feedback"; the question is cleared and the rows are marked "Y".
  - 43 Washington Avenue 3S and 718 East Street 3-SFF: Tenants replaced with the full names she gave (the cut-off names are gone); her answers are appended to "Source: Manager feedback"; questions cleared, rows marked "Y".
  - Silver now has Occupied 260, Occupied – leaving 2, Vacant 11, Vacant – not rent ready 2 (275 rows). No Silver row has a question left.

## Manager feedback applied 2026-11-03 (Make Up)

Source: Delia's own edits in the live Google Sheet (tab "Make Up (Delia)"), checked in `docs/rosters/makeup-verification-2026-11-03.md`. The user's decisions of 2026-11-03 were applied to the live Sheet by cell and range edits (same file, same link), and `518-unit-rosters-normalized.xlsx` was then replaced with a fresh export of the live Sheet (all tabs). Gold, Silver and the hidden "Read me" tab were not changed. Phone numbers were not edited.

- **Three new columns on all tabs** (added in the Sheet before this pass; the header row now has 48 columns, not 45): **"Phone Number"** (column D, after Unit), **"Owners Name"** (W) and **"Owners Email Address"** (X), both after Asset manager and before Notes. The Source group moved two columns to the right (outer group AC:AV, inner group AT:AV). On Make Up the user hid Phone Number on purpose; it stays hidden and is not used yet. On Gold and Silver the three columns are empty. The column table above still uses the old 45-column numbering. Owners are per property (one owner pair per building), so they map to `properties.ownerName` / `ownerEmail`. A cell with two owner emails keeps them in one cell, separated by ", ".
- **Rent paid to = "518 Property Pro" on all 101 Make Up rows.** This is Delia's decision, including the 15 "Delia Management Properties" rows managed for outside owners and the company's own office at 60 - 62 Broad St. Kept as she set it.
- **Also kept as Delia set them:** the Electric paid by values (Tenant 81, Landlord 11 at 66 Second St), Gas paid by on 53 - 57 Broad St / 51 Broad St, Selling = Yes on 1 N. Liberty Ave and 19 Spring St, and 60 - 62 Broad St 1R as an Office unit (she says it is not a separate unit, part of the office; the row stays).
- **Mechanical fixes:**
  - Lease end: an empty cell became "-" on 12 rows (M-027, M-031, M-032, M-038, M-041, M-043, M-053, M-067, M-068, M-078, M-098, M-099), and "0" became "-" on M-064 and M-070. Lease type: empty became "-" on M-078.
  - Tenants: the word "Vacant" became "-" on the 10 vacant rows. Two full names joined by " & " became "Name 1; Name 2" on M-005 and M-010. Shared-surname pairs ("A & B Surname") stay as written, as on Silver.
  - Property: one spelling per building. "9 S. Main St, Mechanicville" (M-010–M-015), "51 Broad St, Waterford" (M-033), "148 Main St, Cohoes" (M-076), "218 North 4th St, Mechanicville" (M-081–M-083). Make Up now has 32 distinct Property strings, one per building. Known format differences, left as they are: "86 - 88 4th St. Waterford" (no comma) and "17 Harrison Ave" (no city in the text).
  - City: "Mechaniville" became "Mechanicville" (26 rows). "Rennselaer" became "Rensselaer" (M-018–M-021).
  - Owners Name / Owners Email Address: leading and trailing spaces trimmed (only "Robert Howell " on M-006 and M-007 had one). Capitalisation kept as written. The name/email spelling mismatch at 22-24 Crockett Ave was not changed.
- **Her answers recorded:** for each of the 55 rows where she wrote in Corrections or set Correct? (Y/N), her words were copied verbatim into the hidden "Source: Manager feedback" column as `Delia, in the sheet (read 2026-11-03): <her text>`. For the two rows where she only set Y (M-024, M-027), the text is `Correct? (Y/N) = Y (no correction text)`. Her "Correct? (Y/N)" and "Corrections" cells were not changed. ("Fixed" in her Corrections means "I fixed the row", not the lease type.)
- **Notes:** where her edit made a note out of date, a manager note was appended after "; " rather than deleting the old one, as on Silver. For example, "Lease end: Date has passed (as of 2026-10-29); Manager: now month-to-month", "...; Manager: renewed, new lease end 2027-06-30", M-005 "...; Manager: corrected to 2027-09-30", M-034 "...; Manager: corrected to 2026-12-31", M-009 "...; Manager: rent is the asking rent", M-045 "...; Manager: not a separate unit, part of the office", M-099 "...; Manager: vacant, not rent ready", and the H/K laundry rows (M-006, M-084, M-085). 34 Notes cells in all.
- **Review columns (Silver convention):** a row counts as answered only if every question is answered and the data now shows the answer. On the 40 answered rows, "Please check" was cleared, the highlight was removed from A–Z, the review columns AA–AB went back to pale `FFFBEA`, and "Correct? (Y/N)" was set to Y where she had left it empty (M-009, M-045).
- **Still asked (7 rows after the 2026-11-03 decisions below, highlighted, one short question each in "Please check"; the first pass of this step listed 21):** M-001 (owner email); M-013, M-097 (lease ended 10/31/26: renewed, month-to-month or moved out?); M-084 (same, plus floor); M-085 (floor); M-016 (new lease end after the January renewal); M-055 (occupied, no tenant name). M-035, M-069, M-071 (first names only), M-046 (office) and M-033 (lease end 2029) are resolved, see below. M-006 (laundry) and the 8 vacant rows M-022, M-036, M-054, M-056, M-078, M-080, M-081, M-091 (is the rent shown the current asking rent?) were in the first 21 and are resolved, see the next two lines. M-013, M-055, M-069, M-071 and M-097 had no question before and were newly highlighted. The message for Delia is in `docs/rosters/questions-for-delia-2026-11-03.md`. It also asks a general question that is not tied to a row: do the electric-heated units have gas service (Gas paid by stays "-" until she answers)? Phone-number problems are not asked about for now.
- **M-006 resolved (2026-11-03, imported on dev):** Delia's "In Unit" answer and her own Laundry edit stand. "H/K" = hookups, located in the unit, so Laundry stays "Hookups in unit". Decision by the user, per Delia's own edit; "Please check" cleared, highlight removed, Notes now "Laundry: manager confirmed H/K = hookups in unit". After this, 20 Make Up rows still carried a question; 12 of them were not imported.
- **Vacant rows: asking rent confirmed (2026-11-03, user decision, re-imported on dev):** on the "Make Up (Delia)" tab, Delia's "Correct? (Y/N)" = Y means the whole row is right, rent included. So for the 8 vacant rows that were highlighted only for "is the rent shown the current asking rent?" (M-022, M-036, M-054, M-056, M-078, M-080, M-081, M-091), every row with Correct? = Y counts as confirmed. All 8 had Y: "Please check" cleared, highlight removed the same way as M-006/M-007, Notes set to "Manager: Correct? = Y, rent confirmed as asking rent" (Notes were empty); Correct? and Corrections untouched; rents unchanged, `available` unchanged (9). Only the Notes text in `unitSourceRows` changed on dev.
- **First names and own office resolved (2026-11-03, user decisions, imported on dev):** M-035, M-069, M-071: tenants listed by first name only are acceptable, names kept as they are; "Please check" cleared, highlight removed, Notes get "Manager: first names only, kept as is (user decision)". M-046 (60 - 62 Broad St, Waterford, Office) is 518 Property Pro's own office: tenant "Property Pro Realty Group", owners Pat Fiore & Alex Buell, no rent charged; Status Occupied and Rent "-" stay, "Please check" cleared, Notes get "Other: 518 Property Pro's own office (Property Pro Realty Group); no rent charged". It is an Office unit, so it is never `available`.
- **M-033 resolved (2026-11-03, user decision, imported on dev):** 51 Broad St, Waterford, Office: Delia set the lease end to 11/30/2029 herself, so it is correct and kept (multi-year office lease). "Please check" cleared, highlight removed, Notes now "Manager: lease end 2029-11-30 confirmed (set by manager; multi-year office lease)"; Correct? and Corrections untouched; no data value changed. It is an Office unit, so it is never `available` (still 9 Make Up, 20 org-wide).
- **Make Up now:** 101 rows, 32 properties, Occupied 91, Vacant 9, Vacant – not rent ready 1, 7 rows with a question (these 7 not imported yet, waiting on Delia; the other 94 are imported). Rent is unchanged (sum $126,474.00).
- **2026-11-04 (user decision):** units in a property marked Selling = Yes are never available/offered, on all tabs. The importer now derives `units.available` as Vacant + Residential + rent stated + property not Selling.

## Row counts

| Tab | Rows | Properties | Occupied | Vacant | Status "-" | Rent "-" | Rows with a "Please check" question |
|---|---|---|---|---|---|---|---|
| Gold | 205 | 58 | 161 | 44 | 0 | 46 | 95 |
| Silver | 275 | 55 | 255 | 20 | 0 | 39 | 99 |
| Make Up (Delia) | 101 | 32 | 0 | 1 | 100 | 2 | 56 |
| Total | 581 | 145 | | | | 87 | |

Counts above are as built on 2026-10-29. After the Silver manager feedback (2026-10-30) Silver has Occupied 260, Occupied – leaving 2, Vacant 11, Vacant – not rent ready 2, Rent "-" 21, 56 properties (479 1st Street was split from 477 1st Street) and no row with a question left; Gold and Make Up are unchanged. Totals match the expected Gold 205, Silver 275, Make Up 101 (15 "Delia Management Properties" + 86 "Delia - Rentals"). Rent sums from the Source: Rent column reconcile: Gold $209,262.73; Silver $321,270.04; Make Up Rentals $106,689.00 (= the roster's "Total Monthly" line, which covers pages 2-5 only) and Make Up Management Properties $19,785.00.

**Gold imported on dev 2026-11-04** (`--skip-flagged`, 6 held rows G-020, G-063, G-084, G-113, G-134, G-136 skipped): 199 of 205 rows, 59 properties, 199 units, 194 residents, 199 source rows, 31 available; `verify` 0 differences in 8,756 cells. Org totals on dev: 144 properties, 568 units, 51 available. Details: `gold-verification-2026-11-04.md`, "Import 2026-11-04".

**Make Up re-imported on dev 2026-11-04** (all 101 rows, none flagged): Delia's answers on M-001, M-013, M-016, M-055, M-084, M-085, M-097 recorded in Source: Manager feedback, questions cleared, highlight removed, 32 stale Notes cleaned; M-055/M-057 (66 Second St 6 and 8) accepted as a move. 32 properties, 101 units, 93 active residents (1 deactivated on M-057), 9 available; `verify` 0 differences in 4,444 cells. Org totals on dev: 147 properties, 575 units, 49 available. Details: `makeup-reverification-2026-11-04.md`, "Fixes and import 2026-11-04".

**Silver re-imported on dev 2026-11-04** (all 275 rows, none flagged): Nikki's Rent paid to, Heating fuel and Selling edits accepted (Selling = Yes on 108 Jackson Avenue, 132 Johnston Avenue, 433 3rd Street and 538-540 2nd Street, never offered); owner columns cleaned in the sheet (S-024 name trimmed, S-082/S-207 CR/LF removed, emails lowercased, 25 cells). 56 properties (all updated, owners on 56/56), 275 units (272 updated), 306 residents and 275 source rows unchanged, 9 available; `verify` 0 differences in 12,100 cells. Org totals on dev: 147 properties, 575 units, 49 available. Details: `silver-owners-verification-2026-11-04.md`, "Fixes and import 2026-11-04".

**Gold owners filled and re-imported on dev 2026-11-04**: Owners Name / Owners Email Address filled on all 205 Gold rows from Nina's owners list (person form, "&" for two people, emails lowercased, two as "a, b"; 410 cells, one write; Silver and Make Up not touched). Same 199 rows imported (6 held rows skipped): 59 properties updated (owner fields only, owners on 59/59, 15 with two emails), units, residents and source rows unchanged, 31 available; `verify` 0 differences in 8,756 cells. Org totals on dev: 147 properties, 575 units, 49 available. Details: `owners-fill-proposal-2026-11-04.md`, "Owners filled 2026-11-04".

**Silver owner decisions in the Sheet only, 2026-11-04 (NOT imported, pending Nikki's confirmation)**: second owner email added on B. B.'s 6 properties and on 301 Green Street (P. P. & P. S.), 1527 3rd Street named "J. S. & M. J. S.", the 15 Redburn properties renamed to the contact E. Y. J. (emails unchanged), 433 3rd Street, 1009 19th Street and the Remsen Street buildings unchanged; 151 rows flagged in Please check with the flag yellow (309 value cells, one write). Dev still has the earlier Silver owners; a later `--skip-flagged` import would skip these 151 rows. Details: `silver-owners-verification-2026-11-04.md`, "Owner decisions applied 2026-11-04".

**Silver owner decisions reverted and Gold's 6 held leases imported on dev 2026-11-09**: Nikki confirmed her original Silver owner entries, so the Sheet was reverted to them (309 cells, 151 flags and highlights removed; Silver tab equals the 2026-11-04 mirror, nothing to import, Silver dry run 0 changes, `verify` 0 differences in 12,100 cells). Nina's 6 held Gold leases accepted: G-020, G-063, G-084 month-to-month, G-136 renewed to 2027-10-31, G-113 and G-134 moved out (Vacant, offered). Gold imported (`--skip-flagged`, 0 rows skipped): 205 rows, 59 properties unchanged, 6 units and 6 source rows created, 5 residents created (0 deactivated), 33 available; `verify` 0 differences in 9,020 cells. Make Up `verify` 0 differences in 4,444 cells. Org totals on dev: 147 properties, 581 units, 51 available. Details: `sheet-verification-2026-11-09.md`, section 7.

## Final column list

Same columns, same order, on every data tab. "Filled by" lists the rosters where the column has at least one value other than "-". The column "Utility payer, utility not specified" was removed on 2026-10-29 (decision 2); the original Make Up value stays in "Source: Who". The sheet was slimmed on 2026-10-29 (decision 9): see "Fields generated at import" and "Not stored" below the table for the columns that left the sheet.

| # | Column | Group | Type | Allowed values | Filled by | Meaning / rule | Future database field |
|---|---|---|---|---|---|---|---|
| 1 | Row ID | Identity | string | G-001.., S-001.., M-001.. | Gold, Silver, Make Up | Our row number, in source order. G = Gold, S = Silver, M = Make Up. | import provenance only (`unitSourceRows.rowId`); not a business key |
| 2 | Property | Identity | string | Text | Gold, Silver, Make Up | Property address as written in the roster, extra spaces removed. A note in the heading (Gold "-new") is left out of Property; the heading exactly as printed, "-new" included, is in "Source: Property heading". | `properties.name` (display); key the property by its own id, never by this text |
| 3 | Unit | Identity | string | Text | Gold, Silver, Make Up | Unit label exactly as written (spaces kept). | `units.unitNumber` (exact label) |
| 4 | Category | Identity | enum | Gold / Silver / Make Up | Gold, Silver, Make Up | Which roster the row came from. | property-level `portfolio` / team: gold \| silver \| make_up (on `properties`, not on units) |
| 5 | City | Identity | string, nullable | Text / - | Silver, Make Up | City, only where the roster gives it (Make Up page 1) or the asset manager supplied it (Silver, 2026-10-30, by row range). Spelling kept as written. "-" where not stated. | `properties.address` city (to be filled by the managers / Places) |
| 6 | Unit type | Unit | enum | Residential / Commercial / Storefront / Garage / Office / Other (not used so far) / Unknown | Gold, Silver, Make Up | Kind of unit, only from explicit words in the roster (see rules). Storefront = a unit labelled S1/S2... with no "COMMERCIAL" marking (value name to confirm with Pat). Silver Storefront units became Commercial on 2026-10-30 (manager confirmed); only Gold 9 Main Street S1 is Storefront now. | new `units.unitType` enum: residential \| commercial \| storefront \| garage \| office \| other \| unknown ("storefront" name to confirm with Pat) |
| 7 | Floor | Unit | integer or enum/text, nullable | Whole number / Basement / text / - | Gold, Silver, Make Up | Floor number, "Basement", or the original text when it cannot be read as a floor. "-" when the Floor cell is blank. | `units.floor` (number, optional). Basement needs a decision (0 or -1); keep `units.floorRaw` for text such as "ARAGE" |
| 8 | Bedrooms | Unit | integer, nullable | Whole number / - | Gold, Silver, Make Up | Number of bedrooms. 0 = studio (for a commercial or office unit 0 just means no bedrooms). "-" when the roster does not give a number. | `units.bedrooms` (today a string; store "0"/"studio" consistently) plus a numeric copy for filtering |
| 9 | Bathrooms | Unit | decimal, nullable | Number / - | Gold, Silver, Make Up | Number of bathrooms (half baths as .5). "-" when the roster does not give a number. | `units.bathrooms` (number; .5 steps) |
| 10 | Status | Occupancy and lease | enum | Occupied / Occupied – leaving / Vacant / Vacant – not rent ready / - | Gold, Silver, Make Up | Occupied when a tenant name is listed, Vacant only where the roster says vacant (empty and available). Occupied – leaving = tenant in eviction or moving out; Vacant – not rent ready = empty but not ready to rent (both widened 2026-10-30, set only from a manager's answer). "-" where the roster does not say (Make Up has no tenant column). | new `units.occupancy` enum: occupied \| occupied_leaving \| vacant \| vacant_not_ready, null when not stated ("-"). Drives `units.available` only after the client confirms (Sarah offers ONLY when available = true) |
| 11 | Tenants | Occupancy and lease | list of strings | Text / - | Gold, Silver | Tenant names exactly as written, separated by "; ". "-" when vacant or not stated (Make Up). Where a name may be cut off in the roster, "Please check" asks for the full name. | one `residents` row per name (`residents.fullName`); cut-off names must be completed by the managers first |
| 12 | Lease type | Occupancy and lease | enum | Fixed term / Month-to-month / Vacant / Unknown / - | Gold, Silver, Make Up | Kind of lease from the Lease End / Lease Exp cell. "-" when the cell is blank. At-will and Month-to-month are the same thing (client answer 2026-10-30, Delia's email, cc Patrick: "At-will and Month-to-Month agreements are the same."), so both are "Month-to-month"; the original text stays in Source: Lease End/Exp. | new `units.leaseType` (or on residents) enum: fixed \| month_to_month \| vacant \| unknown, null when blank ("-") |
| 13 | Lease end | Occupancy and lease | date (YYYY-MM-DD), nullable | Date / - | Gold, Silver, Make Up | Lease end date (YYYY-MM-DD). 2-digit years are read as 20xx. "-" when no (valid) date is given. | `residents.leaseEnd` (YYYY-MM-DD) |
| 14 | Rent | Rent | decimal(10,2), nullable | Number / - | Gold, Silver, Make Up | Monthly rent in dollars (no $ sign). "-" when the roster does not state a rent (blank, "---", $0.00 or $0.01). | `units.rent` (number, dollars; consider cents as integer); "-" (not stated: blank, ---, $0.00, $0.01) imports as null, never 0 |
| 15 | Rent paid to | Rent | enum | 518 Property Pro / Owner directly / Included in another unit's rent / - | Silver | Who collects this unit's rent (added 2026-10-30). Owner directly = the owners collect it and it is not in Buildium (Silver 301 Green Street). Included in another unit's rent = the unit is rented as part of another tenant's lease (Silver 204 Lafayette Street 1B, 508 State Street 2C). "-" when not stated. Set only from a manager's answer. | new `units.rentPaidTo` enum: company \| owner_direct \| included_in_other_unit, null when "-" |
| 16 | Heating fuel | Utilities | enum, nullable | Gas / Electric / Both / - | Make Up | From the Make Up "Gas/Electric" column only. "-" for Gold and Silver (they do not say). | new `units.heatingFuel` enum: gas \| electric \| both (Make Up only so far; whether Gas/Electric means heating is still to confirm) |
| 17 | Gas paid by | Utilities | enum, nullable | Tenant / Landlord / - | Gold, Silver, Make Up | Who pays gas. Gold: "G/E & T/L"; Silver: "Gas Paid"; Make Up: "Who" when "Gas/Electric" says Gas or Both. "-" when not stated. | new `units.gasPaidBy` enum: tenant \| landlord (likely property-level in practice: identical within 58/58 Gold and 48/55 Silver properties) |
| 18 | Electric paid by | Utilities | enum, nullable | Tenant / Landlord / - | Gold, Silver, Make Up | Who pays electric. Gold: "G/E & T/L"; Silver: "Electric Paid"; Make Up: "Who" when "Gas/Electric" says Electric or Both. "-" when not stated. | new `units.electricPaidBy` enum: tenant \| landlord |
| 19 | Laundry | Laundry | enum, nullable | None / Shared in building / Hookups in unit / Provided in unit / Unknown / - | Gold, Silver, Make Up | Laundry for the unit, only where the roster value is clear. "-" when the roster cell is blank (or holds a non-laundry note); Unknown when it has a value we cannot classify. | new `units.laundry` enum: none \| shared_building \| hookups \| provided \| unknown; Sarah can quote it in `leasingFacts` |
| 20 | Selling | Flags | boolean (Yes / -) | Yes / - | Gold | Yes when the roster marks the property "selling"; otherwise "-". | property-level flag `properties.selling`; units in a Selling = Yes property are never `available` (decision 2026-11-04) |
| 21 | Asset manager | Management | reference (user), nullable | Nina / Nikki / Delia | Gold, Silver, Make Up | Asset manager for the property, set by category (confirmed 2026-10-29): Gold = Nina, Silver = Nikki, Make Up = Delia. | `properties.defaultAssetManagerUserId` / `units.assetManagerUserId` (Gold: Nina's user; Silver: Nikki's user; Make Up: Delia's user) |
| 22 | Notes | Notes | string, nullable | Text / empty | Gold, Silver, Make Up | Our notes about the row in one cell, joined with "; ". Each note starts with its topic, in this order: "Bed/bath:" (what the Bed/Bath cell said when it was not a bed/bath count), "Lease end:" (anything about the lease cell that Lease type and Lease end cannot hold), "Rent:" (what the Rent cell said when Rent is "-", or why the rent needs a second look), "Other:" (anything else in the roster that the other columns do not capture). Example: `Bed/bath: Not given ("- / -" in source); Rent: Not stated in source (written as $0.00)`. Empty when there is nothing to note. Replaces Bed/bath note, Lease end note, Rent note and Other notes (decision 9). | `unitSourceRows` notes (split on the topic prefixes if needed); not a business field. The raw bed/bath text for `units.bedBathRaw` comes from Source: Bed/Bath; a vacant unit's asking rent is a separate value to collect |
| 23 | Please check | For the property manager | review only | Text / empty | Gold, Silver, Make Up | Our questions about this row. | not stored (review workflow only) |
| 24 | Correct? (Y/N) | For the property manager | review only | Y / N | (managers) | You fill in: Y if the whole row is right, N if anything needs changing. | not stored (review workflow only) |
| 25 | Corrections | For the property manager | review only | Text | (managers) | You fill in: what is wrong and the right value, plus any missing information or units. | not stored; applied by hand or by a reviewed import |
| 26 | Source: Unit | Source (grouped) | text | verbatim | Gold, Silver, Make Up | Verbatim original cell (Gold: Unit; Silver: Unit; Make Up: Unit) | `unitSourceRows.raw` (keep every original cell for audit) |
| 27 | Source: COM (unlabeled column) | Source (grouped) | text | verbatim | Make Up | Verbatim original cell (Make Up: COM) | `unitSourceRows.raw` (keep every original cell for audit) |
| 28 | Source: Floor | Source (grouped) | text | verbatim | Gold, Silver, Make Up | Verbatim original cell (Gold: Floor #; Silver: Floor; Make Up: Floor #) | `unitSourceRows.raw` (keep every original cell for audit) |
| 29 | Source: Tenants | Source (grouped) | text | verbatim | Gold, Silver | Verbatim original cell (Gold: Tenants; Silver: Tenants) | `unitSourceRows.raw` (keep every original cell for audit) |
| 30 | Source: Lease End/Exp | Source (grouped) | text | verbatim | Gold, Silver, Make Up | Verbatim original cell (Gold: Lease End; Silver: Lease End; Make Up: Lease Exp) | `unitSourceRows.raw` (keep every original cell for audit) |
| 31 | Source: Bed/Bath | Source (grouped) | text | verbatim | Gold, Silver, Make Up | Verbatim original cell (Gold: Bed/Bath; Silver: Bed/Bath; Make Up: Bed/Bath) | `unitSourceRows.raw` (keep every original cell for audit) |
| 32 | Source: Rent | Source (grouped) | text | verbatim | Gold, Silver, Make Up | Verbatim original cell (Gold: Rent; Silver: Rent; Make Up: Rent) | `unitSourceRows.raw` (keep every original cell for audit) |
| 33 | Source: G/E & T/L | Source (grouped) | text | verbatim | Gold | Verbatim original cell (Gold: G/E & T/L) | `unitSourceRows.raw` (keep every original cell for audit) |
| 34 | Source: LMAT | Source (grouped) | text | verbatim | Gold | Verbatim original cell (Gold: LMAT) | `unitSourceRows.raw` (keep every original cell for audit) |
| 35 | Source: Laundry | Source (grouped) | text | verbatim | Silver | Verbatim original cell (Silver: Laundry) | `unitSourceRows.raw` (keep every original cell for audit) |
| 36 | Source: Gas Paid | Source (grouped) | text | verbatim | Silver | Verbatim original cell (Silver: Gas Paid) | `unitSourceRows.raw` (keep every original cell for audit) |
| 37 | Source: Electric Paid | Source (grouped) | text | verbatim | Silver | Verbatim original cell (Silver: Electric Paid) | `unitSourceRows.raw` (keep every original cell for audit) |
| 38 | Source: Gas/Electric | Source (grouped) | text | verbatim | Make Up | Verbatim original cell (Make Up: Gas/Electric) | `unitSourceRows.raw` (keep every original cell for audit) |
| 39 | Source: Who | Source (grouped) | text | verbatim | Make Up | Verbatim original cell (Make Up: Who) | `unitSourceRows.raw` (keep every original cell for audit) |
| 40 | Source: W/D | Source (grouped) | text | verbatim | Make Up | Verbatim original cell (Make Up: W/D) | `unitSourceRows.raw` (keep every original cell for audit) |
| 41 | Source: Property heading | Source (grouped) | text | verbatim | Gold, Silver, Make Up | Verbatim original cell (Gold: (heading); Silver: (heading); Make Up: Property) | `unitSourceRows.raw` (keep every original cell for audit) |
| 42 | Source: Layout notes | Source (grouped) | text | verbatim | Gold, Silver, Make Up | Our description of non-text evidence (merged cells, highlight, heading on another page, wrapped text) | `unitSourceRows.raw` (keep every original cell for audit) |
| 43 | Source: Section | Source (grouped, hidden) | enum, nullable | Delia Management Properties / Delia - Rentals / - | Make Up | Page title inside the roster (Make Up only). Client answer 2026-10-30 (Delia's email, cc Patrick): "Delia - Rentals" = a portfolio owned by the company's owners; "Delia Management Properties" = managed for other owners, the same management as Nina's and Nikki's. "-" for Gold and Silver (no page titles). Hidden by default: inner group at the right end of the Source group (was "Source section" among the identity columns until decision 9; values unchanged). | property-level `sourceSection` (Make Up only), and derive a property-level `properties.ownership` (`company_owned` \| `managed`) from it at import: "Delia - Rentals" -> `company_owned`; "Delia Management Properties" -> `managed`; every Gold and Silver property -> `managed` |
| 44 | Source: Page | Source (grouped, hidden) | integer | Number | Gold, Silver, Make Up | PDF page the row is printed on. Hidden by default: inner group at the right end of the Source group (was "Source page" among the identity columns until decision 9; values unchanged). | import provenance (`unitSourceRows.page`) |
| 45 | Source: Manager feedback | Source (grouped, hidden) | text | verbatim | Silver | The asset manager's answer for this row, word for word, typos included (added 2026-10-30; Silver from `Software Answers.pdf`). Empty when the manager has not answered for the row. Hidden: last column, inside the inner Source group. | import provenance (`unitSourceRows.managerFeedback`); never parsed as data |

The Source group (columns 26-45) is collapsed when the workbook opens. Source: Section, Source: Page and Source: Manager feedback sit in an inner group (outline level 2) at its right end and stay hidden until that inner group is opened too. (Column numbers shifted by one on 2026-10-30 when "Rent paid to" was added after Rent.)

### Fields generated at import (not in the managers' sheet)

These were columns of the workbook until decision 9. They are not in the managers' sheet any more; the importer generates them from Property and Unit with the rules below (the same rules that produced the earlier workbook values).

| Field | Type | Generated from | Rule | Future database field |
|---|---|---|---|---|
| Unit key | string | Unit | Unit label in lowercase with only letters and digits, for matching (e.g. "1 L" and "1L" both give "1l"). | `units.unitNumberKey`: same output as `normalizeUnitKey()` in `dashboard/convex/units.ts` for every label in these rosters; unique per property (checked: 0 collisions) |
| Street number | string | Property | House number(s) from the address; a range is written N-M. "-" if the address has no number. | `properties.address` street number (store range as text, e.g. "46-48") |
| Street name | string | Property | Street name with abbreviations spelled out (St = Street, Ave = Avenue, N. = North, S. = South), spelled ordinals as numbers (Second = 2nd), all-lowercase words capitalised. A street type is never added when the roster has none. | `properties.address` street; final value should come from Google Places once confirmed |

Street name rule details: "St"/"St." = Street, "Ave"/"Ave." = Avenue, "N." = North, "S." = South, "Second" = 2nd; an all-lowercase name is capitalised ("town garage road" -> "Town Garage Road"); a street type is never added when the roster has none (Make Up mostly has none: asked per property in "Please check").

### Not stored (removed in decision 9)

- **Tenant count:** derived, not stored: the number of names in Tenants ("; "-separated), 0 when the roster says VACANT, unknown for Make Up (no tenant column). In the database it is the count of active residents.
- **Tenant name cut off in source:** not stored as a column. Every row where a name may be cut off (Gold: text reaches the right edge of the Tenants column in the PDF, 32 rows; Silver: name visibly cut by the column edge on the scan, 56 rows) carries a "Please check" question asking for the full name, and the managers write it in "Corrections". Names must be completed before residents are imported.
- **New:** recorded only in the source heading: "Source: Property heading" keeps "208 Elm Street -new" exactly as printed, and Property is "208 Elm Street". What "-new" means is an open question; if it turns out to matter, it becomes a property-level flag.
- **Bed/bath note, Lease end note, Rent note, Other notes:** merged into Notes (each value kept verbatim after its topic prefix).

## Mapping rules

"Confirmed" = the roster states it or the client decided it on 2026-10-29. "Our reading, please confirm" = our interpretation of a code; flagged for the managers in the Read me tab. "Pat to confirm" = decided, but the final name or a possible merge is still to be confirmed with Pat. The same table is in the workbook. The import-only rules for Unit key, Street number and Street name are in "Fields generated at import" above.

| Column | Raw value | Normalized value | Status |
|---|---|---|---|
| Any of our data columns | Not stated (empty cell, or the roster has no such column) | "-" (Notes, Please check, your columns and Source: columns stay empty) | Confirmed |
| Source: Section / City | Gold and Silver (no page title and no city in the roster) | "-" | Confirmed |
| Status | Tenants = "VACANT" (Gold, Silver) | Vacant | Confirmed |
| Status | Tenants has a name (Gold, Silver) | Occupied | Confirmed |
| Status | Lease Exp = "Vacant" (Make Up) | Vacant | Confirmed |
| Status | Any other Make Up row (no tenant column) | "-" | Confirmed |
| Tenants | Names separated by ", " or " / " | Same names separated by "; " | Confirmed |
| Tenants | Tenants = "VACANT" (Gold, Silver) | "-" | Confirmed |
| Tenants | Make Up (no tenant column) | "-" | Confirmed |
| Please check | Tenant name may be cut off. Gold: text reaches the right edge of the Tenants column in the PDF. Silver: name visibly cut by the column edge on the scan | A question asking for the full name | Confirmed |
| Lease type | "at-will" | Month-to-month | Confirmed (at-will = month-to-month, client 2026-10-30) |
| Lease type | "At Will" | Month-to-month | Confirmed (at-will = month-to-month, client 2026-10-30) |
| Lease type | "M2M" | Month-to-month | Confirmed |
| Lease type | "M-2-M" | Month-to-month | Confirmed |
| Lease type | "Vacant" | Vacant | Confirmed |
| Lease type | "-------" | Unknown | Our reading, please confirm |
| Lease type | (blank) | "-" | Confirmed |
| Lease type / Lease end | A date, e.g. 7/31/2027 or 2/28/27 | Fixed term + the date (2-digit year = 20xx) | Confirmed |
| Lease type / Lease end | A date that does not exist (9/31/27) | Fixed term, Lease end "-", Notes "Lease end: Invalid date ..." | Confirmed |
| Lease end | No date in the cell (at-will, M2M, Vacant, blank, "-------") | "-" | Confirmed |
| Notes (Lease end:) | Date before 2026-10-29 | "Lease end: Date has passed ..." | Confirmed |
| Rent | $1,250.00 or $1250.00 | 1250.00 | Confirmed |
| Rent | (blank) | "-", Notes "Rent: Not stated in source (blank)" | Confirmed |
| Rent | "---" | "-", Notes "Rent: Not stated in source (written as "---")" | Confirmed |
| Rent | "$0.00" | "-", Notes "Rent: Not stated in source (written as $0.00)" | Confirmed |
| Rent | "$0.01" | "-", Notes "Rent: Not stated in source (written as $0.01)" | Confirmed |
| Notes (Rent:) | Vacant row with a rent amount (Make Up 169 Myrtle Ave #2) | Rent kept (1650.00), Notes "Rent: Vacant but rent listed" | Confirmed |
| Floor | 1, 2, 3 ... | Same number | Confirmed |
| Floor | "bsmt" | Basement | Our reading, please confirm |
| Floor | "BSMT" | Basement | Our reading, please confirm |
| Floor | "B" | Basement | Our reading, please confirm |
| Floor | (blank) | "-" | Confirmed |
| Floor | Anything else (e.g. cut-off "ARAGE", "RRIAGE") | Kept as written | Confirmed |
| Bedrooms / Bathrooms | "2 Bed/1 Bath", "Studio/1 Bath" | 2 and 1; Studio = 0 bedrooms | Confirmed |
| Bedrooms / Bathrooms | "2/1 Bath", "2 /1 Bath", "2/1", "2 / 1", "2/ 1", "2 Bed/ 1", "0/1" ... | First number = bedrooms, second = bathrooms (0 = studio) | Our reading, please confirm |
| Bedrooms / Bathrooms | "- /1 Bath" | Bedrooms "-", Bathrooms 1, "Bed/bath:" note in Notes | Confirmed |
| Bedrooms / Bathrooms | "- / -", "'- / -", "n/a" | Both "-", "Bed/bath:" note in Notes | Confirmed |
| Bedrooms / Bathrooms | "COMMERCIAL", "commerical", "GARAGE" | Both "-", "Bed/bath:" note in Notes; sets Unit type | Confirmed |
| Unit type | Unit label "Office" | Office | Confirmed |
| Unit type | Unit label contains "Garage", or Bed/Bath "GARAGE" | Garage | Confirmed |
| Unit type | Unit label contains "COM" ("COM", "COM B", "COM1", "6 - COM", "15-Com."), Make Up COM column, or Bed/Bath "COMMERCIAL" / "commerical" | Commercial | Our reading, please confirm |
| Unit type | Otherwise, unit label S1, S2 ... (Gold 9 Main Street S1; Silver 204 Lafayette Street S1, S2) | Storefront; Silver S1/S2 changed to Commercial 2026-10-30 (manager confirmed commercial space) | Confirmed; value name to confirm with Pat |
| Unit type | Otherwise, Bed/Bath gives a bedroom count (incl. Studio / 0) | Residential | Our reading, please confirm |
| Unit type | Otherwise ("n/a", "- / -", "- /1 Bath") | Unknown | Confirmed |
| Gas paid by / Electric paid by (Gold "G/E & T/L") | "G/E ; T" (any spacing) | Gas: Tenant, Electric: Tenant (G = gas, E = electric, T = tenant pays both) | Confirmed |
| Gas paid by / Electric paid by (Gold "G/E & T/L") | "G/E ; L" (any spacing) | Gas: Landlord, Electric: Landlord (L = landlord pays both) | Confirmed |
| Gas paid by / Electric paid by (Gold "G/E & T/L") | "E;T / G;L" (any spacing) | Gas: Landlord, Electric: Tenant (electric: tenant pays; gas: landlord pays) | Confirmed |
| Gas paid by / Electric paid by (Silver) | "T" / "O" / blank | Tenant / Landlord / "-" | Confirmed |
| Gas paid by / Electric paid by (Make Up "Who") | Gas/Electric "Gas", Who "T" / "O" | Gas paid by Tenant / Landlord; Electric paid by "-" | Confirmed |
| Gas paid by / Electric paid by (Make Up "Who") | Gas/Electric "Electric", Who "T" / "O" | Electric paid by Tenant / Landlord; Gas paid by "-" | Confirmed |
| Gas paid by / Electric paid by (Make Up "Who") | Gas/Electric "Both", Who "T" / "O" | Gas paid by and Electric paid by both Tenant / Landlord | Confirmed |
| Gas paid by / Electric paid by (Make Up "Who") | Who blank, or Gas/Electric blank | The affected payer column(s) "-" | Confirmed |
| Heating fuel (Make Up "Gas/Electric") | "Gas" / "Electric" / "Both" | Gas / Electric / Both | Our reading, please confirm |
| Heating fuel | Gold and Silver (no such column) | "-" | Confirmed |
| Laundry (Gold "LMAT") | "Com.  Bsmt" | Shared in building | Our reading, please confirm |
| Laundry (Gold "LMAT") | "comm. bsmt" | Shared in building | Our reading, please confirm |
| Laundry (Gold "LMAT") | "Hookups" | Hookups in unit | Our reading, please confirm |
| Laundry (Gold "LMAT") | "hookups" | Hookups in unit | Our reading, please confirm |
| Laundry (Gold "LMAT") | "W/D in unit" | Provided in unit | Our reading, please confirm |
| Laundry (Gold "LMAT") | "n/a" | None | Our reading, please confirm |
| Laundry (Gold "LMAT") | "N/A" | None | Our reading, please confirm |
| Laundry (Gold "LMAT") | "Hookups or W/D in unit" | Unknown | Confirmed |
| Laundry (Gold "LMAT") | (blank) | "-" | Confirmed |
| Laundry (Gold "LMAT") | "selling" | "-"; Selling = Yes; "Other:" note in Notes | Confirmed |
| Laundry (Gold "LMAT") | "selling property" | "-"; Selling = Yes; "Other:" note in Notes | Confirmed |
| Laundry (Silver "Laundry") | "BLDG" | Shared in building | Our reading, please confirm |
| Laundry (Silver "Laundry") | "NO" | None | Our reading, please confirm |
| Laundry (Silver "Laundry") | "N/A" | None | Our reading, please confirm |
| Laundry (Silver "Laundry") | "IN UNIT" | Provided in unit (washer and dryer in the unit; Notes "Laundry: manager confirmed washer and dryer in unit") | Confirmed by the Silver manager 2026-10-30 (was Unknown) |
| Laundry (Silver "Laundry") | (blank) | "-" | Confirmed |
| Laundry (Make Up "W/D") | "No" | None | Our reading, please confirm |
| Laundry (Make Up "W/D") | "BLDG" | Shared in building | Our reading, please confirm |
| Laundry (Make Up "W/D") | "H/U" | Hookups in unit | Our reading, please confirm |
| Laundry (Make Up "W/D") | "H/U In unit" | Hookups in unit | Our reading, please confirm |
| Laundry (Make Up "W/D") | "H/U In Unit" | Hookups in unit | Our reading, please confirm |
| Laundry (Make Up "W/D") | "W/D" | Provided in unit | Our reading, please confirm |
| Laundry (Make Up "W/D") | "H/K" | Unknown | Confirmed |
| Laundry (Make Up "W/D") | (blank) | "-" | Confirmed |
| Selling | Gold yellow block with merged note "selling" / "selling property" | Yes on every unit of that property (otherwise "-") | Our reading, please confirm |
| Property | Gold heading ending in "-new" | "-new" left out of Property; kept as printed in "Source: Property heading" | Our reading, please confirm |
| Asset manager | Gold roster (the roster names none; confirmed 2026-10-29) | Nina | Confirmed |
| Asset manager | Silver roster (the roster names none; confirmed 2026-10-29) | Nikki | Confirmed |
| Asset manager | Make Up roster | Delia | Confirmed |

Additional rules:

- **Nothing is inferred across rosters.** Heating fuel is filled only from Make Up "Gas/Electric" ("-" for Gold and Silver); Gas/Electric paid by comes from Gold "G/E & T/L", Silver "Gas Paid"/"Electric Paid" and, for Make Up, "Who" applied only to the utility named in "Gas/Electric" (Gas, Electric or Both; the other payer column is "-"). Make Up has no tenant column, so Status is "-" except the one row whose lease cell says "Vacant".
- **Vacant is only ever taken from the word "VACANT"/"Vacant".** Rent of $0.00 never makes a unit vacant (20 occupied units show $0.00; their Rent is "-").
- **Property-level questions** (missing street type, city spelling, selling, -new) are asked once, on the first row of each property.
- **Page-top rows without a heading** belong to the property printed before them in the roster (the rosters are continuous printouts); this is recorded in "Source: Layout notes".
- **Tenant name cut off (Gold):** the Gold PDF is a Google Sheets export; text that ends at or past x = 355 pt (the Tenants column edge is about 363 pt) gets a "Please check" question asking for the full name, because the sheet clips text at the column edge and the clipped part is not in the PDF. 32 rows. Silver: 56 cells visibly cut on the scan, asked the same way.
- **Gold "selling":** each of the three yellow blocks has one merged LMAT cell with the note; the note is copied into Source: LMAT on every unit the merged cell covers, Laundry is "-" and Selling = Yes.
- **Lease dates** are compared with 2026-10-29 ("Date has passed"); dates that are not a month-end are flagged for confirmation (most leases end on the last day of a month).

## Database mapping notes

- Split into **properties** (address, portfolio/category, source section, asset manager, selling flag ("-new" meaning still open), gas/electric payer if the client confirms these are property-level), **units** (label, key generated at import, type, floor, bed/bath, rent, occupancy, laundry, utilities) and **residents** (one row per tenant name with lease end). The current Convex schema already has `units.unitNumber`, `units.unitNumberKey`, `units.floor`, `units.bedrooms` (string), `units.bathrooms`, `units.rent`, `units.available`, `units.assetManagerUserId`, `residents.fullName`, `residents.leaseEnd`; the rest are new fields.
- Keep an import-provenance table (suggested `unitSourceRows`: rowId, category, page, every `Source:` cell, notes) so any value can be traced back to the roster. Never import "Please check", "Correct?" or "Corrections" as data.
- `units.available` (what Sarah offers) is derived at import (decision 2: Vacant + Residential + rent stated), and since 2026-11-04 (user decision) never for a unit in a property marked Selling = Yes. Earlier note "set only from an explicit manager decision" is superseded.
- Enum values should stay separate where the client has not said they are the same (Unknown vs "-"/null). At-will and Month-to-month are the same (client 2026-10-30), so there is no `at_will` value.
- Utilities look property-level (identical for every unit in 58/58 Gold and 48/55 Silver properties) but are stored per unit until the client confirms.
- **Owner columns (added 2026-11-03, user decisions of 2026-11-03):** "Owners Name" and "Owners Email Address" are property-level (every row of a building names the same owner; rows that disagree stop the import, without printing the values). "Owners Name" -> `properties.ownerName`, trimmed. "Owners Email Address" -> `properties.ownerEmails` (string array: each address trimmed, lowercased and validated; two owners share one cell, separated by ", " exactly, and any other separator or an invalid address stops the import with the address masked) and `properties.ownerEmail` = the first of them, so existing readers keep working. Lowercase so a later lookup (for example a caller saying an owner email before being transferred to Pat) can match EITHER address with a plain comparison; Convex cannot index array members, so that lookup reads the team's properties (`by_org`) and checks `ownerEmails`. An empty owner cell means "not known": the import then leaves any owner typed on the Property page alone (Gold and Silver cells are all empty today). "-" is refused in the owner cells (leave them empty). The lossless check compares the name trimmed and the emails lowercased; every other column compares exactly. Editing the owner email on the Property page replaces the first address in `ownerEmails` and keeps the second; clearing it clears both.
- **Phone Number (column D, added 2026-11-03):** accepted and ignored (user decision 2026-11-03: not imported yet; the Make Up values need cleaning first, see `makeup-verification-2026-11-03.md`). It is never sent to Convex and no phone is stored. Roster residents stay names only.
- **Columns by header name (2026-11-03):** the importer finds every column by its header, so a column moved in the Sheet does not break it. A header it does not know, a missing header, a header that appears twice, or a value in a column with no header stops the import naming that column. The sheet now has 48 columns on every tab (the 45 above plus Phone Number, Owners Name and Owners Email Address).
- **Make Up `address.formatted` (2026-11-03):** Make Up Property text already includes the city ("19 Spring St, Troy"), so the importer drops a trailing city (after a comma or a space, case-insensitive) and writes "<street>, <City>, NY" once: "86 - 88 4th St. Waterford" -> "86 - 88 4th St., Waterford, NY"; "17 Harrison Ave" (no city in Property) -> "17 Harrison Ave, Rensselaer, NY" from the City column. `properties.name` stays the Sheet's Property text exactly. Gold and Silver addresses are unchanged (their Property never ends with the city).
- **Rows still under review (2026-11-03):** `import_roster.py --skip-flagged` leaves out every row whose "Please check" is not empty (no unit, resident or `unitSourceRows` row; a property only exists once one of its rows is imported); `--include-rows` imports named flagged rows anyway; `--expect-skipped` stops the run unless exactly the named rows are skipped. Make Up was imported this way on 2026-11-03 (88 of 101 rows; see BACKLOG B3 / B37).

## Deviations from the proposed design

- **Identity column order:** Property and Unit moved to columns 2 and 3 (right after Row ID) so Row ID + Property + Unit can be frozen and every row stays identifiable while scrolling. All proposed identity columns are kept.
- **"Source: Property heading/notes" split in two:** "Source: Property heading" (verbatim heading text / Make Up Property cell) and "Source: Layout notes" (our description of merged cells, highlight, continuation across pages, wrapped text). This keeps every other Source column purely verbatim.
- **Added "Source: COM (unlabeled column)":** Make Up page 3 prints "COM" in a column with no header next to 4 units; it is not part of the unit label, so it needs its own Source column to be lossless.
- **Source: Section value is "Delia - Rentals"** with a plain hyphen, exactly as printed (the brief wrote an en dash).
- **Property for Gold "208 Elm Street -new"** is "208 Elm Street"; the "-new" note is kept only in Source: Property heading, exactly as printed (the New column was removed in decision 9). Make Up Property keeps the city as written ("19 Spring St, Troy").
- **Rent is "-" wherever the roster does not state a rent** (blank, "---", $0.00 or $0.01; 87 rows, decision 4), with a "Rent:" note in Notes saying what the roster showed and a question asking for the rent, so $0 is never read as a real or asking rent.
- **Laundry is "-" when the source cell is blank** (or holds the "selling" note) instead of "Unknown"; Unknown is used only for a value whose meaning is unclear (Gold "Hookups or W/D in unit", Make Up "H/K"; Silver "IN UNIT" was Unknown until the manager confirmed it means a washer and dryer, 2026-10-30).
- **Lease type for an impossible date (9/31/27)** is Fixed term with Lease end "-" and the note "Invalid date"; "-------" gives Unknown.
- **Street name** (generated at import, not in the managers' sheet) also turns a spelled ordinal into a number (Second -> 2nd) and capitalises an all-lowercase name ("town garage road" -> "Town Garage Road"); a missing street type is never added (Make Up mostly has none: asked per property).
- **Unit type "Storefront"** (decision 6, name to confirm with Pat) for S-labelled units without a COMMERCIAL marking: Gold 9 Main Street S1 (Silver 204 Lafayette Street S1 and S2 became Commercial on 2026-10-30). **"Other"** is kept as an allowed value but no row uses it; Silver "COM1" units with apartment bed/bath are Commercial (label evidence) with a question to the manager.
- **"-" for not stated** in every derived data column (decision 5), including City and the Make Up Tenants/Status; Source: Section also shows "-" for Gold and Silver.
- **Managers' sheet slimmed (decision 9):** Tenant count, Tenant name cut off in source, New, Unit key, Street number and Street name left the sheet (derived, asked in Please check, kept in the source heading, or generated at import); Source section / Source page moved into the Source group as hidden "Source: Section" / "Source: Page"; the four note columns merged into Notes with topic prefixes. The verifier below proves every value survived.
- **IN UNIT (Silver laundry, 64 rows)** was asked once in the Read me open questions rather than on every row; answered 2026-10-30 (washer and dryer in the unit), now "Provided in unit".

## Corrections to the transcriptions

The PDFs are the source of truth. 157 corrections were made to the extracted dataset (the `docs/context/*.md` files were not edited). Tenant names are not repeated here; rows are identified by Row ID.

| Roster | Field | What the transcription had | What the PDF shows | Rows | Row IDs |
|---|---|---|---|---|---|
| Gold | LMAT | `Com. Bsmt` | `Com.  Bsmt` | 37 | G-009, G-010, G-011, G-012, G-013, G-014, G-015, G-016, G-076, G-077, G-078, G-079, G-080, G-081, G-082, G-083, G-084, G-085, G-086, G-087, G-088, G-089, G-132, G-133, G-134, G-135, G-136, G-137, G-167, G-168, G-169, G-170, G-171, G-172, G-173, G-174, G-175 |
| Gold | G/E & T/L | `E;T / G;L` | `E;T /  G;L` | 2 | G-038, G-039 |
| Gold | Unit | `1L` | `1 L` | 2 | G-051, G-188 |
| Gold | Unit | `1R` | `1 R` | 3 | G-052, G-189, G-195 |
| Gold | Unit | `2L` | `2 L` | 2 | G-053, G-190 |
| Gold | Unit | `2R` | `2 R` | 2 | G-054, G-191 |
| Gold | Bed/Bath | `2/1` | `2 / 1` | 2 | G-063, G-072 |
| Gold | Bed/Bath | `1/1` | `1 / 1` | 2 | G-070, G-071 |
| Gold | LMAT | blank on the other units of the block | one merged yellow cell "selling property" covering every unit of the property | 2 | G-093, G-095 |
| Gold | Bed/Bath | `-/-` | `- / -` | 1 | G-094 |
| Gold | Bed/Bath | `5/1` | `5 / 1` | 1 | G-117 |
| Gold | LMAT | blank on the other units of the block | one merged yellow cell "selling" covering every unit of the property | 2 | G-162, G-164 |
| Gold | G/E & T/L | `E;T / G;L` | `E;T   /   G;L` | 9 | G-167, G-168, G-169, G-170, G-171, G-172, G-173, G-174, G-175 |
| Gold | Unit | `1F` | `1 F` | 1 | G-194 |
| Silver | Tenants | name ends with "…" (added by the transcriber) | name cut by the column edge, no ellipsis | 56 | S-014, S-018, S-019, S-023, S-024, S-028, S-029, S-042, S-043, S-052, S-055, S-063, S-067, S-071, S-075, S-076, S-077, S-078, S-083, S-084, S-100, S-110, S-113, S-115, S-116, S-124, S-128, S-129, S-130, S-136, S-143, S-144, S-148, S-149, S-150, S-151, S-153, S-156, S-171, S-173, S-181, S-183, S-195, S-205, S-211, S-213, S-217, S-218, S-224, S-225, S-226, S-230, S-241, S-249, S-255, S-263 |
| Silver | Property heading | heading with a transcriber note, e.g. "(continued)", "(rows)", "(includes 477-x and 479-x units)" | plain address heading (continuation recorded in Source: Layout notes) | 17 | S-016, S-027, S-040, S-051, S-077, S-088, S-099, S-112, S-123, S-136, S-151, S-162, S-175, S-188, S-210, S-232, S-247 |
| Silver | Unit | `9 Lexington Cou… (unit cell truncated; whole house)` | `9 Lexington Cou` | 1 | S-017 |
| Silver | Floor | `RRIAGE [clipped; likely "CARRIAGE"]` | `RRIAGE` | 1 | S-039 |
| Silver | Floor | `ARAGE [clipped; likely "GARAGE"]` | `ARAGE` | 2 | S-047, S-048 |
| Silver | Electric Paid | `(blank)` | (empty cell) | 1 | S-055 |
| Silver | Bed/Bath | `'- / -'` | `'- / -` | 4 | S-119, S-128, S-129, S-275 |
| Silver | Unit | `A  Basement ( F… (unit cell truncated)` | `A  Basement ( F` | 1 | S-155 |
| Make Up | Property | `53 - 57 Broad (continued; property name not repeated in the scan)` | (empty cell) | 1 | M-040 |
| Make Up | Unit | `6 [COM]` | `6 (and "COM" in a separate unlabeled column)` | 1 | M-042 |
| Make Up | Unit | `7 [COM]` | `7 (and "COM" in a separate unlabeled column)` | 1 | M-043 |
| Make Up | Unit | `Office [COM]` | `Office (and "COM" in a separate unlabeled column)` | 1 | M-046 |
| Make Up | Unit | `62-1 [COM]` | `62-1 (and "COM" in a separate unlabeled column)` | 1 | M-048 |
| Make Up | Property | `536 3rd (continued; property name not repeated in the scan)` | (empty cell) | 1 | M-092 |

How each roster was checked:

- **Gold:** every row was rebuilt from the PDF text layer (word boxes from `pdftotext -bbox`), with spaces restored from the glyph gaps, so double spaces ("Com.  Bsmt", "E;T   /   G;L") and the spaces in "1 L", "2 / 1", "- / -" are exact. All 10 page images were also viewed (yellow "selling" blocks on pages 5 and 8). The transcription's tenant names matched the text layer exactly.
- **Silver:** all 23 page images were read and every row compared cell by cell with the transcription. All differences were transcriber notes, ellipses and the two cell-format issues in the brief; no value was misread.
- **Make Up:** all 5 page images were read and every row compared; values matched; the corrections are layout (blank Property cells at page tops, the separate COM column).

Points checked at higher zoom (300 dpi crops):

- Make Up, 21 William St / unit 1 (page 2): A small speck sits left of the Floor value; read as "1" (scan noise, not a dash).
- Make Up, 53 - 57 Broad / unit Fl 3 (page 3): Read as "Fl 3"; the scan cannot fully separate a lowercase l from a capital I.
- Make Up, 60 - 62 Broad / 1R and Office (page 3): Zoomed at 300 dpi: Rent shows 3 dashes ("---") and Lease Exp 7 dashes ("-------").
- Silver, 132 Johnston Avenue / 2nd  Front, 2nd  rear (page 8): Zoomed: gap after "2nd" is wider than one space; kept as two spaces as transcribed.
- Silver, 308 East Street / A  Basement ( F (page 13): Zoomed: text is cut by the column edge right after "( F"; the rest of the label is not in the PDF.
- Silver, 23 North College Street COM, COM B / 11 North Church Street 8: Floor cells are cut on the left in the scan ("ARAGE", "RRIAGE"); the missing letters are not recoverable.

Nothing on any page was unreadable. Text that is cut off in the PDFs themselves (Silver tenant names, two Silver unit labels, three Silver floor cells, Gold tenant names at the column edge) cannot be recovered from the PDFs and is flagged for the managers.

## Lossless verification (scripted, run on the saved .xlsx)

Run on 2026-10-29 against the saved workbook after the columns were slimmed (decision 9). Two scripts run on the file itself:

1. The full rule and lossless verifier (the earlier 133-point run, with its expectations updated for the column changes only: the dropped columns are no longer checked, Notes is read by topic prefix, Source: Section / Source: Page are compared under their old names, unit keys are generated from Source: Unit). It now has 127 checks; the per-column "Read me documents column ..." checks are counted but not listed (43 columns instead of 52).
2. A column-change check against the saved previous workbook: kept columns and every Source cell identical (value, type and style), Notes equal to the four old note columns with their topic prefixes, Source: Section / Source: Page identical to the old columns and hidden in the Source group, highlights, freeze panes, autofilter, dropdowns, widths and the Read me.

A scratch copy with 2 deliberately corrupted cells (the "Rent:" part removed from one Silver Notes cell, and one Make Up Source: Section value changed) was run through both scripts, and both cells were caught by each.

```
PASS 127  FAIL 0
ok   tab names and order
ok   Gold: same columns in same order as the other tabs
ok   Gold: 205 rows (expected 205)
ok   Gold: freeze panes at D2
ok   Gold: autofilter
ok   Gold: header bold
ok   Gold: Source columns grouped
ok   Gold: Y/N dropdown
ok   Gold: highlight exactly on rows with Please check
ok   Silver: same columns in same order as the other tabs
ok   Silver: 275 rows (expected 275)
ok   Silver: freeze panes at D2
ok   Silver: autofilter
ok   Silver: header bold
ok   Silver: Source columns grouped
ok   Silver: Y/N dropdown
ok   Silver: highlight exactly on rows with Please check
ok   Make Up (Delia): same columns in same order as the other tabs
ok   Make Up (Delia): 101 rows (expected 101)
ok   Make Up (Delia): freeze panes at D2
ok   Make Up (Delia): autofilter
ok   Make Up (Delia): header bold
ok   Make Up (Delia): Source columns grouped
ok   Make Up (Delia): Y/N dropdown
ok   Make Up (Delia): highlight exactly on rows with Please check
ok   Gold: every original cell value is verbatim in its Source: column, other Source columns empty (1640 cells)
ok   Gold: Source cells stored as text (0 non-text; Source: Page is the page number)
ok   Silver: every original cell value is verbatim in its Source: column, other Source columns empty (2475 cells)
ok   Silver: Source cells stored as text (0 non-text; Source: Page is the page number)
ok   Make Up (Delia): every original cell value is verbatim in its Source: column, other Source columns empty (1010 cells)
ok   Make Up (Delia): Source cells stored as text (0 non-text; Source: Page is the page number)
ok   Gold: every row found on its PDF page in the text layer (pdftotext -layout, spaces ignored), cells in order ([])
ok   Gold: every space (and double space) inside Source cells matches the glyph spacing in the PDF ([])
ok   Gold: every word of every Source cell is a word in the PDF text layer of that page ([])
ok   Silver: Source cells equal the transcription except the 66 logged corrections (unlogged diffs: [])
ok   Make Up (Delia): Source cells equal the transcription except the 6 logged corrections (unlogged diffs: [])
ok   Make Up: 4 COM markers kept
ok   Gold rent sum $209262.73 = $209,262.73
ok   Silver rent sum $321270.04 = $321,270.04
ok   Make Up Rentals rent sum $106689.00 = Total Monthly $106,689.00
ok   Make Up Management Properties rent sum $19785.00 = $19,785.00
ok   Make Up 15 + 86 rows by section
ok   Gold: 58 properties
ok   Silver: 55 properties
ok   Make Up (Delia): 32 properties
ok   Removed column "Utility payer, utility not specified" is gone from every data tab
ok   Columns removed, merged or renamed on 2026-10-29 are gone from every data tab ([])
ok   Notes: every part starts with a topic (Bed/bath, Lease end, Rent, Other), each topic at most once, in that order ([])
ok   Every normalized value follows its documented rule and none contradicts its source (0 violations: [])
ok   No empty cell in any derived data column; only note columns, Please check, manager and Source columns may be empty (0 empty: [])
ok   Utility payers: only Tenant / Landlord / "-"; Gold and Silver match their source codes; every Make Up row follows the Who + Gas/Electric rule (0 violations: [])
ok   No "Owner" value remains in any data column or dropdown ([] [])
ok   Storefront applied to exactly Gold 9 Main Street S1 and Silver 204 Lafayette Street S1, S2 ([('Gold', '9 Main Street', 'S1'), ('Silver', '204 Lafayette Street', 'S1'), ('Silver', '204 Lafayette Street', 'S2')])
ok   Rent "-" on exactly 87 rows (Gold 46, Silver 39, Make Up 2)
ok   Every Rent "-" row has source rent $0.00 / $0.01 / blank / "---"
ok   Make Up 169 Myrtle Ave #2 (vacant) keeps rent 1650
ok   Gold: same Row IDs in the same order as the previous build
ok   Silver: same Row IDs in the same order as the previous build
ok   Make Up (Delia): same Row IDs in the same order as the previous build
ok   Every Source: cell is identical (value and type) to the previous build (0 differences: [])
ok   No Rent changed except the 87 not-stated rows ([])
ok   Every other change from the previous build is one of the decided transitions (blank -> "-", Owner -> Landlord, Blank -> "-", Make Up Unknown status -> "-", Make Up payers, Storefront) (0 unexpected: [])
ok   Previous build had the columns removed, merged or renamed on 2026-10-29 (sanity)
ok   Column widths, freeze panes, zoom and header height match the previous build ([])
ok   Tab order matches the previous build
ok   Unit key (generated at import from Unit) is unique within each property ([])
ok   Read me contains "Purpose"
ok   Read me contains "Column dictionary"
ok   Read me contains "Code mappings"
ok   Read me contains "Row counts"
ok   Read me contains "Open questions"
ok   Read me contains "Our reading, please confirm"
ok   Read me contains "Confirmed"
ok   Read me contains "Decisions recorded 2026-10-29"
ok   Read me contains "not stated in the source document"
ok   Read me contains "Landlord"
ok   Read me contains "Storefront"
ok   Read me contains "Pat to confirm"
ok   Read me no longer contains the answered/old text "Do T, O and L mean"
ok   Read me no longer contains the answered/old text "Which bill does "Who""
ok   Read me no longer contains the answered/old text "Tenant / Owner"
ok   Read me column dictionary no longer lists "Utility payer, utility not specified"
ok   Read me column dictionary no longer lists the columns removed, merged or renamed on 2026-10-29
ok   Read me column dictionary lists every column of the data tabs
```

```
PASS 91  FAIL 0
ok   tab order unchanged: ['Read me', 'Gold', 'Silver', 'Make Up (Delia)']
ok   Gold: header = the agreed column list, then the 17 Source columns in their old order, then Source: Section, Source: Page
ok   Gold: 205 data rows (before 205, after 205)
ok   Gold: dropped / merged / renamed columns absent ([])
ok   Gold: same Row IDs in the same order
ok   Gold: every Source cell identical to before (value and type), 3485 cells (0 diffs: [])
ok   Gold: every Source cell keeps its style/format (0 diffs: [])
ok   Gold: Source: Section / Source: Page values identical (value and type) to the old Source section / Source page (0 diffs: [])
ok   Gold: all Source columns contiguous, right after Corrections
ok   Gold: the 17 original Source columns are in the Source group (outline level 1) and closed (hidden)
ok   Gold: Source: Section and Source: Page hidden, in an inner group (outline level 2) inside the Source group
ok   Gold: group shown as collapsed (collapsed flag on Corrections and on Source: Layout notes; summary columns on the left)
ok   Gold: outline summary columns on the left (as before)
ok   Gold: no non-Source column hidden or grouped ([])
ok   Gold: every kept column existed before
ok   Gold: every kept column identical to before (value and type): 23 columns x 205 rows (0 diffs: [])
ok   Gold: every kept column keeps its cell style, fill and number format (0 diffs: [])
ok   Gold: every non-empty value of the 4 old note columns is in Notes verbatim after its topic prefix (66 of 66)
ok   Gold: Notes contains nothing else and keeps the column order Bed/bath, Lease end, Rent, Other (0 diffs: [])
ok   Gold: Notes empty exactly where all four old note columns were empty
ok   Gold: Notes wraps, width 50
ok   Gold: yellow highlight exactly on rows with non-empty Please check, on every non-Source cell, never on Source cells (95 rows) ([])
ok   Gold: row heights unchanged ([])
ok   Gold: freeze panes D2 (Row ID, Property, Unit stay frozen)
ok   Gold: autofilter covers every column and row (A1:AQ206)
ok   Gold: zoom unchanged
ok   Gold: dropdowns identical except the removed New column (9 dropdowns)
ok   Gold: every column keeps its width ([])
ok   Silver: header = the agreed column list, then the 17 Source columns in their old order, then Source: Section, Source: Page
ok   Silver: 275 data rows (before 275, after 275)
ok   Silver: dropped / merged / renamed columns absent ([])
ok   Silver: same Row IDs in the same order
ok   Silver: every Source cell identical to before (value and type), 4675 cells (0 diffs: [])
ok   Silver: every Source cell keeps its style/format (0 diffs: [])
ok   Silver: Source: Section / Source: Page values identical (value and type) to the old Source section / Source page (0 diffs: [])
ok   Silver: all Source columns contiguous, right after Corrections
ok   Silver: the 17 original Source columns are in the Source group (outline level 1) and closed (hidden)
ok   Silver: Source: Section and Source: Page hidden, in an inner group (outline level 2) inside the Source group
ok   Silver: group shown as collapsed (collapsed flag on Corrections and on Source: Layout notes; summary columns on the left)
ok   Silver: outline summary columns on the left (as before)
ok   Silver: no non-Source column hidden or grouped ([])
ok   Silver: every kept column existed before
ok   Silver: every kept column identical to before (value and type): 23 columns x 275 rows (0 diffs: [])
ok   Silver: every kept column keeps its cell style, fill and number format (0 diffs: [])
ok   Silver: every non-empty value of the 4 old note columns is in Notes verbatim after its topic prefix (125 of 125)
ok   Silver: Notes contains nothing else and keeps the column order Bed/bath, Lease end, Rent, Other (0 diffs: [])
ok   Silver: Notes empty exactly where all four old note columns were empty
ok   Silver: Notes wraps, width 50
ok   Silver: yellow highlight exactly on rows with non-empty Please check, on every non-Source cell, never on Source cells (99 rows) ([])
ok   Silver: row heights unchanged ([])
ok   Silver: freeze panes D2 (Row ID, Property, Unit stay frozen)
ok   Silver: autofilter covers every column and row (A1:AQ276)
ok   Silver: zoom unchanged
ok   Silver: dropdowns identical except the removed New column (9 dropdowns)
ok   Silver: every column keeps its width ([])
ok   Make Up (Delia): header = the agreed column list, then the 17 Source columns in their old order, then Source: Section, Source: Page
ok   Make Up (Delia): 101 data rows (before 101, after 101)
ok   Make Up (Delia): dropped / merged / renamed columns absent ([])
ok   Make Up (Delia): same Row IDs in the same order
ok   Make Up (Delia): every Source cell identical to before (value and type), 1717 cells (0 diffs: [])
ok   Make Up (Delia): every Source cell keeps its style/format (0 diffs: [])
ok   Make Up (Delia): Source: Section / Source: Page values identical (value and type) to the old Source section / Source page (0 diffs: [])
ok   Make Up (Delia): all Source columns contiguous, right after Corrections
ok   Make Up (Delia): the 17 original Source columns are in the Source group (outline level 1) and closed (hidden)
ok   Make Up (Delia): Source: Section and Source: Page hidden, in an inner group (outline level 2) inside the Source group
ok   Make Up (Delia): group shown as collapsed (collapsed flag on Corrections and on Source: Layout notes; summary columns on the left)
ok   Make Up (Delia): outline summary columns on the left (as before)
ok   Make Up (Delia): no non-Source column hidden or grouped ([])
ok   Make Up (Delia): every kept column existed before
ok   Make Up (Delia): every kept column identical to before (value and type): 23 columns x 101 rows (0 diffs: [])
ok   Make Up (Delia): every kept column keeps its cell style, fill and number format (0 diffs: [])
ok   Make Up (Delia): every non-empty value of the 4 old note columns is in Notes verbatim after its topic prefix (42 of 42)
ok   Make Up (Delia): Notes contains nothing else and keeps the column order Bed/bath, Lease end, Rent, Other (0 diffs: [])
ok   Make Up (Delia): Notes empty exactly where all four old note columns were empty
ok   Make Up (Delia): Notes wraps, width 50
ok   Make Up (Delia): yellow highlight exactly on rows with non-empty Please check, on every non-Source cell, never on Source cells (56 rows) ([])
ok   Make Up (Delia): row heights unchanged ([])
ok   Make Up (Delia): freeze panes D2 (Row ID, Property, Unit stay frozen)
ok   Make Up (Delia): autofilter covers every column and row (A1:AQ102)
ok   Make Up (Delia): zoom unchanged
ok   Make Up (Delia): dropdowns identical except the removed New column (9 dropdowns)
ok   Make Up (Delia): every column keeps its width ([])
ok   Silver: headers identical to Gold
ok   Make Up (Delia): headers identical to Gold
ok   Read me has decision "9. Columns slimmed 2026-10-29"
ok   Decision 9 lists every removed, moved and merged column
ok   Read me mentions no removed/old column name outside decision 9 ([])
ok   Read me column dictionary lists every column of the data tabs (43)
ok   Read me: Notes entry explains the topic prefixes and the "; " separator
ok   Read me: Source: Section and Source: Page entries say they are hidden and how to show them
ok   Read me explains the closed Source group and how to unhide the inner group
```

Corruption test:

```
verify.py on corrupted copy: exit 1, PASS 122  FAIL 5
    FAIL Make Up Rentals rent sum $105739.00 = Total Monthly $106,689.00
    FAIL Make Up 15 + 86 rows by section
    FAIL Every normalized value follows its documented rule and none contradicts its source (2 violations: [('Silver', 'S-138', 'rent not stated -> "-" with note'), ('Make Up
    FAIL Every Source: cell is identical (value and type) to the previous build (1 differences: [('M-020', 'Source: Section')])
    FAIL Every other change from the previous build is one of the decided transitions (blank -> "-", Owner -> Landlord, Blank -> "-", Make Up Unknown status -> "-", Make Up p
    caught: {'S-138 Notes': True, 'M-020 Source: Section': True}
verify_v4.py on corrupted copy: exit 1, PASS 88  FAIL 3
    FAIL Silver: every non-empty value of the 4 old note columns is in Notes verbatim after its topic prefix (124 of 125)
    FAIL Silver: Notes contains nothing else and keeps the column order Bed/bath, Lease end, Rent, Other (1 diffs: ['S-138'])
    FAIL Make Up (Delia): Source: Section / Source: Page values identical (value and type) to the old Source section / Source page (1 diffs: [('M-020', 'Source: Section')])
    caught: {'S-138 Notes': True, 'M-020 Source: Section': True}
CORRUPTION TEST PASS
```

## Open questions

- **Rent not stated:** 87 units show "-" in Rent because the roster does not state a rent (Gold vacant units written $0.00, Silver vacant units left blank, all of Silver 301 Green Street #101-117 and a few others written $0.00, Gold 300 State Street #1A (Effic.) written $0.01, two Make Up rows written "---"). Please write the monthly rent for each, or the asking rent if the unit is vacant. If a tenant really pays no rent (for example a staff unit, or a unit the landlord uses), say so.
- **Make Up "Gas/Electric":** We now read "Gas/Electric" as the utility that "Who" pays (decision 2). Does it also say how the unit is heated? The Heating fuel column copies it (Gas / Electric / Both) until you confirm. For units where only one utility is named, who pays the other one?
- **Storefront:** Pat to confirm the name "Storefront" for Gold 9 Main Street S1 and Silver 204 Lafayette Street S1 and S2 (units labelled S1/S2 that the roster does not mark COMMERCIAL).
- **Laundry codes:** Silver "IN UNIT": washer/dryer provided, or only hookups? Gold "n/a" and Silver "N/A": no laundry? Gold "Com.  Bsmt" = shared basement laundry? Make Up "H/K": what does it mean? Make Up "W/D": machines provided?
- **Bed/Bath:** In "2/1" style values, is the first number bedrooms and the second bathrooms? Does "0/1" mean a studio? (Make Up also uses 0/1 for offices and COM units.)
- **Basement:** Do "bsmt", "BSMT" and Make Up floor "B" all mean basement?
- **Make Up occupancy:** The Make Up roster has no tenant names, so Status and Tenants are "-" for every row except the one marked Vacant. Please add tenant names or "vacant".
- **Make Up lease dates:** 27 Make Up lease dates are already in the past. Are those tenants now month-to-month, renewed, or gone?
- **Cities:** Which city or town is each Gold and Silver property in, and the Make Up properties on pages 2-5?
- **Selling and new:** Gold marks 3 properties "selling" (54 Alexander Street, 280 9th Street, 281 Ontario Street) and one heading "-new" (208 Elm Street). What does each mean, and should Sarah treat those units differently?
- **Unit types:** Silver: are "COM1" units at 182, 184 and 188 Remsen Street commercial (they list apartment bed/bath)? Should garages count as units? 5 units have no bedroom count and nothing else that says what they are, so Unit type stays "Unknown" (each of those rows asks).
- **Cut-off text:** Some tenant names, two Silver unit labels and three Silver floor cells are cut off in our copies. Each of those rows asks about it in "Please check"; please write the full text.
