# Gold tab: verification of the manager's edits, 2026-11-04

This is a read-only check of the live Google Sheet "518 property list" (spreadsheet `1BtIdb_vUprOjXxg1Xk4cBiqcDQL0tWXa8Qd_-63lApg`), tab "Gold" (sheetId `284976210`, confirmed from the tab metadata). The manager is Nina. Nothing in the Sheet or on Drive was changed. The hidden "Read me" tab was not opened for editing.

Baselines:
- **Mirror:** `docs/rosters/518-unit-rosters-normalized.xlsx`, the fresh export of the live Sheet from 2026-11-03.
- **Original build:** the 2026-10-29 workbook (`~/Desktop/518-unit-rosters-normalized-2.xlsx`, read only). It has 95 Gold rows with a question, which matches the spec.

The mirror already holds part of Nina's edits, so changes are reported against both baselines.

Contract: `docs/rosters/unit-fields-spec.md`, including the Silver convention (2026-10-30) and the Make Up pass (2026-11-03). Importer files read: `dashboard/scripts/roster/import_roster.py`, `dashboard/convex/rosterMapping.ts`, `dashboard/convex/rosterFields.ts`, `dashboard/convex/rosterImport.ts`. Nothing was run against Convex.

Privacy: no tenant names appear below. "Tenant filled" means a name is present. The owner columns are empty on Gold, so there are no emails to mask. The Phone Number column is empty.

## 1. Structure

| Check | Result |
|---|---|
| Header row | 48 columns. They match the importer's `COLUMNS` list exactly (name, spelling, order), and are the same as Silver and Make Up. |
| Rows | 205 data rows, the same as before. None were added, removed or reordered. Row IDs run G-001…G-205 in order and are unique. |
| Properties | **59** (was 58). 39A/39B moved from "37 Mulberry Street" to "39 Mulberry Street" (see section 4). |
| Source columns | **No Source: cell changed** against either baseline (all 20 Source columns). Source: Manager feedback is **empty on every Gold row**. |
| New columns | Phone Number, Owners Name and Owners Email Address are empty on all 205 rows. |
| Review columns | **Nina did not use Correct? (Y/N) or Corrections**: both are empty on every row. She wrote her answers **into "Please check"**: she deleted our question, wrote over it, or added to it. She wrote one answer into Notes (G-027). |
| Highlight | The yellow row highlight was removed almost everywhere. Of the 20 rows that still have Please check text, only G-196 and G-197 are highlighted. Report only. |
| Dropdowns | Unit type, Status, Lease type, Rent paid to, Heating fuel, Gas/Electric paid by, Laundry, Selling and Correct? still use the spec's lists. Status uses the en dash. One cell holds a value that is not in its list (G-205 Rent paid to, see section 3). |
| Cell types | Lease end dates are real dates (format `yyyy-mm-dd`, 98 cells). Every other Lease end cell is "-". Rent is numeric, or "-" (11 rows), or **empty on G-199**. Floor, Bedrooms and Bathrooms are numbers, "-" or "Basement". |

## 2. Changed cells

### 2a. Live vs the 2026-11-03 mirror (what the task asked for)

This comparison finds 396 changed cells. 192 of them are on 76 rows. The other 204 are the Rent paid to cells: every row except G-106 now has a value. A further 140 Rent cells differ only in display format (for example "1,250.00" against "1250"); the number is the same and they are not counted.

| Column | Cells | What changed |
|---|---|---|
| Rent paid to | 204 | "-" → "518 Property Pro" on 203 rows. "-" → **"Property Pro"** on G-205. G-106 stays "-". |
| Please check | 76 | 59 questions deleted. 17 overwritten or extended with her answer. G-043 got new text ("commerical "). |
| Notes | 43 | All 43 **deleted**. These were our "Rent:", "Bed/bath:", "Lease end:", "Other:" and laundry notes. |
| Rent | 31 | "-" → an asking rent on 28 vacant rows. "-" → a rent on G-127 and G-157 (now occupied). 2600 → **empty** on G-199. |
| Tenants | 20 | Cut-off names completed on 15 rows. G-097: the trailing "--" removed. G-127 and G-157: filled (newly occupied). G-198 and G-199: **emptied** (empty cell, not "-"). |
| Laundry | 6 | Unknown → Provided in unit (G-100). "-" → Hookups in unit (G-120, G-121, G-160, G-161). "-" → Provided in unit (G-139). |
| Lease type | 4 | "-" → Fixed term (G-127, G-157). Month-to-month → **Vacant** (G-198, G-199). |
| Lease end | 2 | "-" → 2027-10-31 (G-127, G-157). |
| Status | 2 | Vacant → Occupied (G-127, G-157). |
| Bedrooms / Bathrooms | 3 / 2 | G-037 (commercial): "-" → 0 / 0. G-143: "-" → 0 / 0. G-045: Bedrooms "-" → 1. |
| Floor | 2 | "-" → 1 (G-198). "-" → 2 (G-199). |
| Unit | 1 | G-143: "5" → **"5- COM"**. |

Unchanged since the mirror: Row ID, Property, Category, City, Unit type, Heating fuel, Gas/Electric paid by, Selling, Asset manager, owner and phone columns, Correct?/Corrections, and every Source column.

### 2b. Edits already in the mirror (made between the 10-29 build and the 11-03 export)

The author of these edits is not recorded. They look like Nina's, but see question 2.

| Column | Cells | What changed |
|---|---|---|
| City | 204 | "-" → a city on every row except **G-087** (see section 3) |
| Please check | 18 | Cleared: 8 cut-off-name rows, 6 vacant-rent rows (G-002, G-007, G-008, G-022, G-027, G-028), 39A/39B (Mulberry), G-001, G-030 |
| Tenants | 9 | Cut-off names completed (G-001, G-010, G-020, G-029, G-042, G-044, G-050, G-071, G-089) |
| Rent | 5 | Asking rents on G-002, G-007, G-008, G-022 and G-027. G-028 stays "-" |
| Notes | 7 | 6 deleted. G-027 replaced with "not renting. staying vacant. " |
| Property | 2 | G-072 and G-073 changed from "37 Mulberry Street" to "39 Mulberry Street" |
| Lease end | 1 | G-030: 2027-05-01 → 2027-04-30 |
| Lease type | 65 | At-will → Month-to-month. This is our decision 3, not Nina's. |

**Against the 10-29 build, every one of the 205 rows has been touched**: City on 204 rows and Rent paid to on 204. **96 rows have edits beyond those two columns.** These are all 95 rows that had a question, plus G-043. Rent sum: $209,262.72 in the build, $252,562.72 now (193 rows with a rent).

## 3. Value and consistency check

### Errors (must fix before import)

| Row ID(s) | Column | Value | Problem | Suggested value (our conventions) |
|---|---|---|---|---|
| G-010, G-097, G-101, G-102, G-115, G-125, G-127, G-129, G-152, G-157, G-176 (11) | Tenants | name with a trailing space | The importer rejects a padded name ("has an empty or padded name") and stops the batch. | Trim |
| G-198, G-199 | Tenants | empty cell | The importer rejects an empty data cell. Status is still Occupied. | `-` (and Status per question 17) |
| G-199 | Rent | empty cell | The importer rejects it (`numberOrDash`). | `-` |
| G-205 | Rent paid to | `Property Pro` | Not in the dropdown or the importer's table, so it is rejected. | `518 Property Pro` (question 24) |
| G-087 vs G-076…G-089 | City | `-` vs `Troy ` | One building has two cities. `assertSameProperty` stops the import for 46 - 48 South Lake Avenue. | The building's city (question 3) |
| G-103 vs G-104 (89 Howard Street) | City | `Cohoes` vs `Cohoes ` | The trailing space alone makes the two values differ, so the property import stops. | `Cohoes` |
| 185 rows | City | trailing space (`Troy `, `Albany `…) | Not rejected, but stored as is. `address.formatted` becomes "…, Troy , NY". | Trim |
| 53 rows | City | lowercase (`troy`, `albany`, `mechanicville`, `rensselaer`) | One city is spelled two ways across properties ("Troy"/"troy", "Albany"/"albany", "Mechanicville"/"mechanicville"). | Capitalise (question 3) |
| G-198, G-199 | Status / Lease type | Occupied / `Vacant` | The tenant was removed but Status still says Occupied. Lease type "Vacant" on an occupied unit contradicts it. Gold vacant rows use Lease type "-". | Question 17 |
| G-001 | Tenants | two full names with no separator | Imports as **one** resident. | `Full Name 1; Full Name 2` (question 9) |
| G-127 | Tenants | two full names joined by " and " | Imports as one resident. Make Up converted " & " between two full names to "; ". | `Full Name 1; Full Name 2` (question 9) |
| G-129 | Tenants | 4 names: "; " once, then ", " twice | The second "resident" would hold three names. | `"; "` between all four (question 9) |
| G-037, G-143 | Bedrooms / Bathrooms | 0 / 0 | Commercial space. 0 bedrooms imports as `bedrooms = "studio"`. On Silver, commercial units have "-" / "-" with a "Bed/bath:" note. | `-` / `-` (questions 11, 12) |

### Warnings (decide, or ask Nina)

- **G-027** (3 South Marshall Street 1): Vacant + Residential + Rent 1350, so **Sarah would offer it**. But Notes say "not renting. staying vacant." (Question 4.)
- **Questions cleared with no visible answer** (the data is unchanged):
  - G-028: rent still "-".
  - G-047: lease end 2029-09-26 is not a month end.
  - Cut-off names on 9 rows: G-070, G-080, G-082, G-111, G-123, G-128, G-159, G-183, G-203.
  - Laundry on G-101 and G-138 (still "-").
  - "-new" on G-156.
  - G-045 bedrooms: answered (1), but Unit type is still Unknown.

  `--skip-flagged` would import all of these as resolved. (Questions 5–7, 13, 22, 23.)
- **Still flagged with no new text:** G-029 and G-089 still carry the cut-off-name question, although their names were completed before 11-03. (Question 7.)
- **Leases ended 2026-10-31, still Occupied, never asked:** G-020 (2 Prout Avenue 4), G-063 (35 Viall Avenue 2), G-084 (46 - 48 South Lake Avenue 10), G-113 (109 Washington Street 3), G-134 (166 2nd St 3), G-136 (166 2nd St 5). (Question 25.)
- **Unit type:**
  - G-043 (9 Main Street S1) is Storefront, but Nina wrote "commerical".
  - G-143 (171 Saratoga Avenue 5) is Unknown, but she says "Commerical space."
  - G-045 is Unknown with 1 bed / 1 bath.

  (Questions 10, 11, 13.)
- **Unit label renamed:** on G-143, "5" became "5- COM". The unit key changes from `5` to `5com`. Source: Unit stays "5". On Silver, labels were never renamed. (Question 11.)
- **City spellings:** "Vooreshville" (8 South Main Street), "Delamar" (106 Elsmere Avenue) and "Saratoga" (109 Washington Street) need confirmation. (Question 3.)
- **Rent paid to:** G-106 (105 West Street 2) is "-" while all 203 other rows are "518 Property Pro". (Question 24.)
- **Same tenant on two units:** G-168 and G-171 (300 State Street 1A (Effic.) and 4). Nina confirmed "YES". No other duplicate name on the tab.
- **Not month-end:** only G-047 (2029-09-26; the question was cleared, see above). No lease date is impossible. The latest is 2029-09-26.
- **Rents:** all positive with at most 2 decimals. The range is 420–3,000; the 2,832.22 value is G-047 (commercial, unchanged). The rents Nina added (900–1,650) look plausible.
- **Units Sarah would offer** (Vacant + Residential + rent stated): **32**:
  - 1 - 4 Strong Place 1B, 4A, 4B
  - 2 Prout Avenue 6
  - 3 South Marshall Street 1 (G-027, see above)
  - 8 South Main Street 2A
  - 15-17 2nd Street 15-3R, 17-1
  - 19 Garner Street 2 L, 2 R
  - 24 107th Street 1, 2
  - 36 Spring Street 1F, 2F, 3F
  - 46 - 48 South Lake Avenue 2, 3, 5, 11
  - 52 Bassett Street 2, 3
  - 89 Howard Street 1, 2
  - 106 Elsmere Avenue 2
  - 166 2nd St 1
  - 171 Saratoga Avenue 1
  - 187 Saratoga Avenue 2
  - 208 Elm Street 1
  - 427 1st Street 2
  - 448 5th Avenue 1
  - 521 1st Street 1 F
  - 1815 Highland Avenue 2

  In the build, Gold had none. Every rent except G-027's was typed by Nina in answer to "what is the asking rent?". G-037 (8 South Main 6 - COM, vacant, 1,500) is commercial, so it is not offered.
- Unchanged and fine:
  - Every enum value is in its list (except G-205).
  - Row IDs are sequential.
  - Property text is clean (no padding, no double spaces).
  - Unit keys are unique inside every property, including 39 Mulberry and "5- COM".
  - Selling = Yes is on exactly the 8 units of 54 Alexander, 280 9th and 281 Ontario.
  - No Tenants on vacant rows (the empty G-198/G-199 cells are an error, see above).
  - Every Fixed term row has a date, and no other row does.
  - Heating fuel is "-" everywhere.
  - Payers are as in the source.

## 4. Nina's answers, row by row

Key: ✅ the data now shows the answer · 🟡 partly, or the answer needs a decision · ❌ question cleared with no answer · ⏳ still flagged (her text is in Please check, so `--skip-flagged` skips the row).

"Silver convention" means:
- the answer is applied to the data;
- our Notes are kept, with a "Manager: …" note appended;
- her words are copied verbatim into Source: Manager feedback;
- Please check is cleared, the highlight removed, and Correct? = Y.

On Gold, every row departs from the convention on the last three points (no Manager feedback, no Correct?, Notes deleted on 50 rows: 49 deleted plus G-027 replaced). The "Silver?" column below covers the data only.

| Row ID | Unit | Our question | Nina's answer | Data satisfies? | Silver? |
|---|---|---|---|---|---|
| G-001 | 1 - 4 Strong Place 1A | Name looks incomplete | (cleared, before 11-03) two full names written in | ✅ names | ❌ no "; " between them (Q9) |
| G-002, G-007, G-008 | 1 - 4 Strong Place 1B, 4A, 4B | Vacant: asking rent? | (cleared, before 11-03) 1350, 1250, 1350 | ✅ | ✅ data; Notes deleted |
| G-022 | 2 Prout Avenue 6 | Vacant: asking rent? | (cleared, before 11-03) 1300 | ✅ | ✅ data; Notes deleted |
| G-027 | 3 South Marshall Street 1 | Vacant: asking rent? | Rent 1350; Notes "not renting. staying vacant. " | 🟡 contradicts itself | ❌ offered by Sarah (Q4) |
| G-028 | 3 South Marshall Street 2 | Vacant: asking rent? | (cleared, before 11-03) nothing; Rent still "-" | ❌ | Q5 |
| G-010, G-020, G-042, G-044, G-050, G-071 | various | Name cut off | (cleared, before 11-03) names completed | ✅ | ✅ (G-010: trim a trailing space) |
| G-029, G-089 | 6 Orchard Lane A; 46 - 48 South Lake Avenue 15 | Name cut off | Names completed before 11-03, but the question is **still there** | ✅ data | ⏳ Q7 |
| G-030 | 6 Orchard Lane B | 5/1/2027 not a month end | (cleared, before 11-03) 2027-04-30 | ✅ | ✅ data; Notes deleted |
| G-034, G-046, G-048, G-053, G-054, G-059, G-060, G-064, G-066, G-068, G-076, G-077, G-079, G-085, G-091, G-092, G-103, G-104, G-108, G-132, G-155, G-185, G-186, G-194, G-205 (25) | vacant units | Vacant: asking rent? | (cleared) rent typed in | ✅ | ✅ data; Notes deleted. G-205 Rent paid to "Property Pro" |
| G-037 | 8 South Main Street 6 - COM | Vacant: asking rent? | (cleared) 1500; Bed/Bath "-" → 0/0 (not asked) | ✅ rent | ❌ commercial bed/bath should be "-" (Q12) |
| G-043 | 9 Main Street S1 | (none) | Wrote "commerical " in Please check; our "Bed/bath: n/a" note deleted | 🟡 Unit type still Storefront | ⏳ Silver S1/S2 → Commercial (Q10) |
| G-045 | 15-17 2nd Street 15-3F | "- /1 Bath": apartment or commercial, bed/bath? | (cleared) Bedrooms 1 | 🟡 Unit type still Unknown | Q13 |
| G-047 | 15-17 2nd Street 15-Com. | 9/26/2029 not a month end | (cleared, and the note deleted) date unchanged | ❌ / implicit confirm | Q6 |
| G-070, G-080, G-082, G-111, G-123, G-128, G-159, G-183, G-203 (9) | various | Name cut off | (cleared) name **unchanged** | ❌ / implicit "complete" | Q7 |
| G-072, G-073 | 39A, 39B | Unit label 39 but address 37 Mulberry? | (cleared, before 11-03) Property → "39 Mulberry Street" | ✅ | ✅ same as Silver 479 1st Street (labels and Source unchanged) |
| G-093, G-094, G-095 | 54 Alexander Street 1, 2, 3 | Selling? Asking rent? (G-094 also bed/bath) | "Property is in the process of being sold. Do not include. Leaving vacant. " | 🟡 data unchanged | ⏳ Q14 |
| G-097 | 68 Jefferson Street 2 | Tenant name incomplete | "Do not have full name - leave as is. " The "--" was removed, leaving the first name only, with a trailing space | ✅ as far as possible | ⏳ like Make Up M-035 (Q8) |
| G-098, G-102, G-107, G-112, G-115, G-125, G-145, G-152, G-169, G-176, G-177, G-190 | various | Name cut off | (cleared) names completed | ✅ | ✅ (trim G-102, G-115, G-125, G-152, G-176) |
| G-100 | 74 Cooks Court 1 | Hookups or W/D? | (cleared) Laundry → Provided in unit | ✅ | ✅ data; Notes deleted |
| G-101 | 77 Viall Avenue 1 | Name cut off; LMAT blank | (cleared) name completed; **Laundry still "-"** | 🟡 | Q22 (trim) |
| G-120, G-160, G-161 | 138 North 2nd Avenue 1; 252 Saratoga Avenue 2, 3 | LMAT blank | (cleared) Hookups in unit | ✅ | ✅ |
| G-121 | 138 North 2nd Avenue 2 | Name cut off; LMAT blank | (cleared) name completed; Hookups in unit | ✅ | ✅ |
| G-127 | 165 Saratoga Avenue 2 | Vacant: asking rent? | (cleared) now Occupied: tenant filled, Fixed term to 2027-10-31, 1600 | ✅ | 🟡 " and " separator, trim (Q9, Q19) |
| G-129 | 165 Saratoga Avenue 4 | Name cut off | (cleared) 4 names, two of them after ", " | 🟡 | ❌ separator (Q9) |
| G-137 | 166 2nd St 6 | Vacant: asking rent? | "Leave as 0.00 for now. Owner is doing construction on the inside. " | ✅ Rent "-" stays | ⏳ Silver used "Vacant – not rent ready" (Q16) |
| G-138 | 171 Saratoga Avenue 1 | Vacant: asking rent?; LMAT blank | (cleared) 1300; **Laundry still "-"** | 🟡 | Q22 |
| G-139 | 171 Saratoga Avenue 2 | LMAT blank | (cleared) Provided in unit | ✅ | ✅ |
| G-143 | 171 Saratoga Avenue 5 | "n/a": apartment or commercial? | "Commerical space." Unit → "5- COM", bed/bath 0/0, Unit type still Unknown | 🟡 | ⏳ Silver: Commercial, "-"/"-", label unchanged (Q11) |
| G-156 | 208 Elm Street 1 | "-new" meaning; asking rent? | (cleared) 1100; "-new" **not answered** | 🟡 | Q23 |
| G-157 | 208 Elm Street 2 | Vacant: asking rent? | "Tenant moving into the apt 11/15" — Occupied, tenant filled, Fixed term to 2027-10-31, 1350 | ✅ | ⏳ Q18 (trim) |
| G-162, G-164 | 280 9th Street 1, 3 | Selling? Asking rent? | "Leave as is. Selling property." | ✅ as is | ⏳ Q15 |
| G-165, G-166 | 281 Ontario Street 1, 2 | Selling? Bed/bath? Asking rent? | "Leave as is. Selling property." | 🟡 bed/bath unanswered | ⏳ Q15 |
| G-168 | 300 State Street 1A (Effic.) | $0.01: rent? Same tenant as unit 4? | Added after our text: "NO RENT." / "YES." | ✅ Rent "-" | ⏳ Q20 |
| G-171 | 300 State Street 4 | Same tenant as 1A? | Added after our text: "YES." | ✅ | ⏳ Q20 |
| G-196, G-197 | 521 1st Street 2, 3 | LMAT blank | Added after our text: "UNKNOWN AT THIS TIME." | ✅ Laundry "-" | ⏳ Q21 |
| G-198 | 531 2nd Street 1 | Occupied at $0.00: rent?; floor? | "Leave blank for now. Owner re-doing unit and will let me know new rent when done. " Floor 1; tenant **deleted** (empty); Lease type Vacant; Status still Occupied | 🟡 | ⏳ Q17 |
| G-199 | 531 2nd Street 2 | Floor? | Same text as G-198. Floor 2; tenant deleted; Lease type Vacant; Rent 2600 → empty; Status still Occupied | 🟡 | ⏳ Q17 |

Totals:
- Of the 95 rows that had a question, 76 were cleared, 17 have her text in Please check, and 2 (G-029, G-089) are unchanged.
- One row with no question (G-043) got text.
- 20 rows now have Please check text.

## 5. Owner name / owner email

The owner columns are empty on all 205 Gold rows. The importer treats an empty cell as "not known" and leaves any owner typed on the Property page alone, so this does not block the import. There is nothing to validate or mask. Gold owners still have to be collected.

## 6. Conflicts with the source transcription (`docs/context/gold-property-ai-info.md` / the PDF)

Our Source columns still match the PDF, unchanged. Where Nina's data differs from the PDF, it is treated as the newer information.

- **Rents:** the PDF shows $0.00 on 44 vacant units. 35 of them now carry a rent, including G-127 and G-157, which are now occupied.
- **G-199** (531 2nd Street 2): the PDF lists a tenant, at-will, at $2,600.00. Now there is no tenant and no rent. **G-198:** the PDF lists a tenant at $0.00; now there is no tenant. For both, the PDF lease cell "at-will" is now Lease type "Vacant".
- **G-127, G-157:** VACANT in the PDF, now occupied with new leases.
- **G-072, G-073:** printed under the "37 Mulberry Street" heading, now Property "39 Mulberry Street". The Source: Property heading cell still says 37.
- **G-030:** the PDF says 5/1/2027, now 2027-04-30.
- **G-143:** the PDF says unit "5", Bed/Bath "n/a". Now "5- COM", 0/0.
- **G-037:** the PDF says Bed/Bath "n/a", now 0/0.
- **G-045:** the PDF says "- /1 Bath", now 1 bedroom.
- **Laundry:**
  - G-100: the PDF says "Hookups or W/D in unit", now Provided in unit.
  - G-120, G-121, G-139, G-160, G-161: blank in the PDF, now filled.
- **Tenant names:** completed on 25 rows where the PDF clips them. On G-097, the PDF's trailing "--" was dropped.
- **City:** the PDF has none, and the transcription agrees. All the cities are new information from Nina.
- **No conflict** on bed/bath counts (other than the rows above), lease dates (other than G-030 and the new leases), payers, Selling or unit labels (other than G-143).

## 7. Import readiness

**Header contract: the importer handles the Gold tab as is.** All 48 headers match `COLUMNS` (found by name). Phone Number is ignored. The empty owner cells are accepted. Category "Gold", Asset manager "Nina" and Source: Section "-" pass. Dates are real dates, rents are numbers, Floor "Basement" is accepted, and bathrooms are in .5 steps.

Before any run:
1. **Re-export the workbook.** `import_roster.py` reads `docs/rosters/518-unit-rosters-normalized.xlsx`, not the live Sheet. The mirror predates 76 of the changed rows.
2. **Fix the importer-rejected cells** (section 3): 11 padded tenant names; empty Tenants on G-198/G-199; empty Rent on G-199; "Property Pro" on G-205; the city mismatch at 46 - 48 South Lake Avenue (G-087) and 89 Howard Street. Each of these aborts its whole property batch. With `--skip-flagged`, G-097, G-157, G-198 and G-199 are skipped. The other failures still fire.
3. **Silent mis-maps:**
   - City padding and case. This affects all but 20 rows and makes `address.formatted` read "…, Troy , NY".
   - G-001 and G-127 would each become one resident with two names; G-129 would have a resident holding three names.
   - G-037 and G-143 would get bedrooms "studio".
   - G-027 would be offered.
4. **`EXPECTED_AVAILABLE` has no `gold` entry**, so the availability guard is skipped. Add the agreed list (32 units today, section 3) once G-027 is decided. There are no `PROBES` for Gold either.
5. **Provenance:** Corrections is never imported, and Source: Manager feedback is empty on Gold. Her answers and 50 of our Notes (49 deleted, G-027 replaced) would leave no trace unless they are restored and copied first (question 1).

**Rows (with the tab-wide City trim/capitalise counted as one mechanical fix):**

| Tier | Rows | Row IDs |
|---|---|---|
| Import-ready (after the City fix only) | **129** | every row not listed below |
| Ready after a row-level mechanical fix, no decision needed | 10 | G-010, G-102, G-115, G-125, G-152, G-176 (trim name); G-129 ("; "); G-103, G-104 (city trim, 89 Howard Street); G-205 (Rent paid to, to confirm) |
| Waiting on a decision by Umar | 46 | G-001, G-020, G-027, G-028, G-037, G-045, G-047, G-063, G-070, G-080, G-082, G-084 and the rest of 46 - 48 South Lake Avenue (G-076–G-088; city of G-087), G-101, G-106, G-111, G-113, G-123, G-127, G-128, G-134, G-136, G-138, G-156, G-159, G-183, G-203, and the city spellings for 8 South Main Street (G-032–G-037) and 106 Elsmere Avenue (G-107–G-110) and 109 Washington Street (G-111–G-113) |
| Still flagged (Nina's text in Please check; skipped by `--skip-flagged`) | 20 | G-029, G-043, G-089, G-093, G-094, G-095, G-097, G-137, G-143, G-157, G-162, G-164, G-165, G-166, G-168, G-171, G-196, G-197, G-198, G-199 |

Blocked: 76 rows (46 + 20 + 10 until fixed). 24 of the 59 properties are fully ready. 10 properties have no ready row:
- 3 South Marshall Street
- 8 South Main Street
- 46 - 48 South Lake Avenue
- 54 Alexander Street
- 77 Viall Avenue
- 89 Howard Street
- 106 Elsmere Avenue
- 109 Washington Street
- 281 Ontario Street
- 531 2nd Street

Of the 32 offered units, 20 are in the ready tier.

**Ready to import?** Not as is. It is ready after:
- (a) the error fixes in section 3;
- (b) the decisions below;
- (c) restoring the Notes and recording her answers per the Silver convention, if wanted;
- (d) re-exporting the workbook;
- (e) adding the Gold `EXPECTED_AVAILABLE` list.

A partial `--skip-flagged` import would still fail on the padded names and the two city mismatches unless those are fixed first.

## Questions for Umar

1. **Tab-wide, process (Silver convention):** Nina answered inside "Please check". She deleted 76 questions, wrote over or extended 17, and deleted 49 of our Notes (G-027's was replaced). She never set Correct? or Corrections. Source: Manager feedback is empty. Options:
   - (a) the full Silver treatment: restore our Notes from the build, append "Manager: …", copy her text verbatim into Source: Manager feedback, and set Correct? = Y and clear the highlight on resolved rows;
   - (b) only record her answers in Source: Manager feedback and accept the deleted notes;
   - (c) leave it as she left it.
2. **Edits before the 11-03 export** (section 2b: City on 204 rows, 18 questions cleared, 9 names, 5 rents, the 39 Mulberry split, the G-030 date): were these Nina's? Should they be recorded as manager answers too?
3. **City:**
   - (a) Trim the trailing spaces (185 rows) and capitalise the lowercase values (53 rows)? Or keep them as typed?
   - (b) G-087 (46 - 48 South Lake Avenue 13) is "-": is it Troy like the other 13 rows of that building?
   - (c) Spellings:
     - "Vooreshville" (8 South Main Street): Voorheesville?
     - "Delamar" (106 Elsmere Avenue): Delmar?
     - "Saratoga" (109 Washington Street): Saratoga Springs, or keep "Saratoga"?
4. **G-027** (3 South Marshall Street 1): Rent 1350, but Notes say "not renting. staying vacant." Sarah would offer it. Options:
   - (a) Status "Vacant – not rent ready" (not offered) and keep the rent;
   - (b) Rent "-";
   - (c) keep it offered;
   - (d) ask Nina.
5. **G-028** (3 South Marshall Street 2): the asking-rent question was cleared with no rent. Accept Vacant with Rent "-" (not offered), or ask again? Is it also "staying vacant" like G-027?
6. **G-047** (15-17 2nd Street 15-Com.): the question about 2029-09-26 not being a month end was cleared without a change. Accept the date as confirmed?
7. **Cut-off names:**
   - (a) Questions cleared with the name unchanged on G-070, G-080, G-082, G-111, G-123, G-128, G-159, G-183, G-203: accept the names as complete, or ask again?
   - (b) G-029 and G-089: the names were completed, but the question is still there. Treat as resolved and clear?
8. **G-097** (68 Jefferson Street 2): "Do not have full name - leave as is." The tenant is now a first name only. Accept it, as was decided for Make Up M-035/M-069/M-071?
9. **Tenant separators:**
   - G-001: two full names with no separator. Split into "Name 1; Name 2" (please confirm where the split is).
   - G-127: two full names joined by " and ". Change to "; "?
   - G-129: four names, the last three separated by ", ". Change to "; "?
10. **G-043** (9 Main Street S1, Storefront): Nina wrote "commerical" (no question had been asked). Change Unit type to Commercial, as was done for Silver 204 Lafayette Street S1/S2? Or keep Storefront (the name is still to be confirmed with Pat)? Gold would then have no Storefront unit.
11. **G-143** (171 Saratoga Avenue 5): "Commerical space."
    - (a) Unit type Unknown → Commercial?
    - (b) Bedrooms/Bathrooms 0/0 → "-"/"-", with Notes `Bed/bath: "n/a" in source; Manager: commercial space` (Silver Remsen COM1)?
    - (c) Unit label: keep her "5- COM" (the unit key changes from `5` to `5com`; Source: Unit stays "5"), or revert to "5" (Silver never renamed labels)?
12. **G-037** (8 South Main Street 6 - COM): Bedrooms/Bathrooms were changed from "-" to 0/0 without a question. Revert to "-" (Silver convention for commercial units)?
13. **G-045** (15-17 2nd Street 15-3F): now 1 bed / 1 bath, but Unit type is still Unknown. Residential?
14. **54 Alexander Street** (G-093–G-095): "Property is in the process of being sold. Do not include. Leaving vacant." Options:
    - (a) do not import the property at all;
    - (b) import it with Selling = Yes, Vacant, Rent "-" (never offered), and clear the questions. G-094's bed/bath stays "-"/Unknown.
15. **280 9th Street** (G-162, G-164) and **281 Ontario Street** (G-165, G-166): "Leave as is. Selling property."
    - (a) Accept as is and clear the questions? G-165/G-166 bedrooms stay "-" and Unit type Unknown.
    - (b) Does "Do not include" (54 Alexander) apply to these two properties as well, or only to 54 Alexander?
16. **G-137** (166 2nd St 6): "Leave as 0.00 for now. Owner is doing construction on the inside." Rent "-" stays, as the convention requires. Should Status become "Vacant – not rent ready", as on Silver 1 Washington Avenue 4 and 718 East Street 5- BF, or stay Vacant?
17. **531 2nd Street** (G-198, G-199): "Leave blank for now. Owner re-doing unit and will let me know new rent when done." The tenants were deleted (empty cells), Lease type is "Vacant", Status is still Occupied, and G-199's Rent (PDF $2,600) was cleared.
    - (a) Have both tenants moved out?
    - (b) Status "Vacant – not rent ready" or "Vacant"?
    - (c) Lease type "-" (the Gold vacant convention) or keep "Vacant"?
    - (d) Tenants "-" and Rent "-", with Notes "Manager: owner renovating, new rent to come"?
18. **G-157** (208 Elm Street 2): "Tenant moving into the apt 11/15". It is now Occupied with a new tenant, Fixed term to 2027-10-31, rent 1350. Keep it Occupied now (not offered) and clear the question, or leave it Vacant until 11/15? Is the lease end 2027-10-31 right?
19. **G-127** (165 Saratoga Avenue 2): formerly vacant, now Occupied with a lease to 2027-10-31 at 1600, with no comment. Accept as a new lease (separator, see question 9)?
20. **G-168 / G-171** (300 State Street): "NO RENT" and "YES". Accept: Rent "-" stays, Notes "Manager: no rent charged" on G-168, the same tenant on both units confirmed, and both questions cleared?
21. **G-196 / G-197** (521 1st Street 2, 3): laundry is "UNKNOWN AT THIS TIME". Keep "-" (not stated), or set "Unknown"? Clear the questions?
22. **G-101** (77 Viall Avenue 1) and **G-138** (171 Saratoga Avenue 1): the laundry question was cleared without an answer and Laundry is still "-". Accept, or ask again?
23. **G-156** (208 Elm Street 1): the "-new" question was cleared without an answer. Drop it, or ask again?
24. **Rent paid to:**
    - (a) G-205: change "Property Pro" to "518 Property Pro"?
    - (b) G-106 (105 West Street 2) is "-" while every other Gold row is "518 Property Pro". Same value?
    - (c) Confirm "518 Property Pro" for all of Gold. It was set without a question, as on Make Up.
25. **Leases ended 2026-10-31, still Occupied** (never asked, because they were in the future on 10-29): G-020 (2 Prout Avenue 4), G-063 (35 Viall Avenue 2), G-084 (46 - 48 South Lake Avenue 10), G-113 (109 Washington Street 3), G-134 (166 2nd St 3), G-136 (166 2nd St 5). Ask Nina (renewed with a new date, month-to-month, or moving out) and hold them back as on Make Up, or import as is?
26. **Offered units:** confirm the 32 vacant units Sarah would offer (section 3; 31 if G-027 is changed) as the Gold `EXPECTED_AVAILABLE` list.

## Fixes applied 2026-11-04

Applied to the live Gold tab (sheetId `284976210`) with the user's approval, in one atomic `batchUpdate`. Only the Gold tab was touched; Silver, Make Up and the hidden "Read me" tab, sharing, dropdowns, columns and number formats were not changed. Before writing, the whole tab was re-read and compared with the snapshot (0 of 9,840 cells differed), so no cell was skipped. Afterwards the tab was read again: exactly the 253 planned value cells changed, and no other cell changed. Nothing was imported and no Convex command was run. Tenant names are shown as "[name]".

Snapshot for revert (values, types, number formats and backgrounds of A1:AV206 before the write): `scratchpad/gold/fix/snapshot_before_2026-11-04_grid.json` (plus `..._values.json`, the displayed values). The plan is `plan.json`, the requests `requests2.json`, and the after-read `after_2026-11-04_grid.json`, all in the same folder.

**Formatting (208 cells: 12 Tenants, 196 City)**
- Tenants, trimmed (a trailing space removed): G-010, G-097, G-101, G-102, G-115, G-125, G-127, G-129, G-152, G-157, G-176 (11). No other Gold Tenants cell had padding.
- Tenants, separators:
  - G-001: "[name] [name]" (4 words, no separator) → "[name]; [name]" (2 + 2 words). Every word is capitalised, no surname is shared, and word 3 appears as a first name on 3 other Gold rows, so the second name clearly starts at word 3.
  - G-127: "[name] and [name]" → "[name]; [name]".
  - G-129: "[name]; [name], [name], [name]" → "[name]; [name]; [name]; [name]" (4 residents of 2 words each).
- City, 196 cells (every row whose value changed):
  - Trailing space trimmed: "Troy " 48, "Mechanicville " 29, "Albany " 20, "Cohoes " 9, "Guilderland " 8, "East Nassau " 6, "Hoosick Falls " 4, "Waterford " 3, "Clifton Park " 2.
  - Trimmed and capitalised: "mechanicville " 18, "albany " 17, "troy " 16, "rensselaer " 2.
  - Spellings: "Vooreshville" → "Voorheesville" (8 South Main Street, G-032–G-037). "Delamar" → "Delmar" (106 Elsmere Avenue, G-107–G-110). "Saratoga " → "Saratoga Springs" (109 Washington Street, G-111–G-113).
  - G-087: "-" → "Troy" (the city of the rest of 46 - 48 South Lake Avenue).
  - 89 Howard Street (G-103, G-104) is now "Cohoes" on both rows.
  - Result: 13 distinct cities, each spelled one way, and one city per property.

**Section A**
- G-137: Status Vacant → Vacant – not rent ready.
- G-198: Status Occupied → Vacant – not rent ready; Tenants (empty) → "-"; Lease type Vacant → "-". Rent and Lease end were already "-". Floor 1 kept.
- G-199: Status Occupied → Vacant – not rent ready; Tenants (empty) → "-"; Rent (empty) → "-"; Lease type Vacant → "-". Lease end was already "-". Floor 2 kept.
- G-143: Unit type Unknown → Commercial; Bedrooms 0 → "-"; Bathrooms 0 → "-"; Unit "5- COM" → "5" (stored as text).
- G-037: Bedrooms 0 → "-"; Bathrooms 0 → "-".
- G-043: Unit type Storefront → Commercial.
- G-045: Unit type Unknown → Residential (Bedrooms 1 kept).
- G-205: Rent paid to "Property Pro" → "518 Property Pro". G-106: "-" → "518 Property Pro".
- G-196, G-197: Laundry "-" → "Unknown" (a dropdown value).

**Sections B and C**
- G-029, G-089: our leftover cut-off-name question cleared (no highlight was left on them).
- G-027: Status Vacant → Vacant – not rent ready; Rent 1350 kept. Her answer stays in Notes ("not renting. staying vacant."), so nothing was copied to Manager feedback.
- G-028: unchanged (Vacant, Rent "-"); it had no question left.
- G-157: only the trim above.
- 54 Alexander Street, 280 9th Street, 281 Ontario Street: no change; their questions stay.
- Held, leases ended 2026-10-31 and still Occupied: G-020, G-063, G-084, G-113, G-134, G-136. Please check (empty) → "Lease ended 10/31/26: renewed (new end date), month-to-month, or moved out?" Columns A–AB were highlighted with the sheet's flag yellow (RGB 1 / 0.949 / 0.8, as on G-196/G-197). The data was not changed.

**Provenance.** Her answer is in Source: Manager feedback as `Nina, in the sheet (read 2026-11-04): <her text>` (the Make Up format). Her words are kept and only the trailing spaces were trimmed. Please check was then cleared on each row:
- G-043: "commerical"
- G-137: "Leave as 0.00 for now. Owner is doing construction on the inside."
- G-143: "Commerical space."
- G-157: "Tenant moving into the apt 11/15"
- G-198, G-199: "Leave blank for now. Owner re-doing unit and will let me know new rent when done."
- G-196, G-197: "UNKNOWN AT THIS TIME." (her part only, without our question). The yellow highlight was removed from A–Z, and Correct?/Corrections were given back the light tint that unflagged rows use.

Notes she deleted were not restored. Correct? (Y/N) and Corrections were not touched.

**Still flagged after the fixes** (not resolved here):
- The 6 held rows above.
- G-093, G-094, G-095: "Property is in the process of being sold. Do not include. Leaving vacant."
- G-097: "Do not have full name - leave as is."
- G-162, G-164, G-165, G-166: "Leave as is. Selling property."
- G-168: our two questions, each followed by her answer: "NO RENT." and "YES."
- G-171: our question, followed by "YES."

**Validation** (a Python port of `rosterMapping.ts` `mapRosterRow` + `assertSameProperty`, run over the after-read; on the before snapshot it reproduces the 18 errors listed in section 3):
- All 205 rows: **0 errors**, 59 properties.
- `--skip-flagged`: 189 rows, 16 skipped, 0 errors, 57 properties. 54 Alexander Street and 281 Ontario Street have every row skipped.
- Available units (Vacant + Residential + rent): **31**. This is the section 3 list without 3 South Marshall Street 1 (G-027, now not rent ready). The `expected_available` rule in `import_roster.py`, which also excludes Selling = Yes, gives the same 31.
- Selling properties: none of their 8 units is available under either rule. Seven are vacant with Rent "-", and G-163 (280 9th Street 2) is occupied.

## Import 2026-11-04

Imported to the Convex **dev** deployment `brilliant-badger-615` only, with the user's approval. Silver and Make Up were not imported. No ElevenLabs call was made. Tenant names are not shown.

**Flags cleared first (user decisions), on the live Gold tab only.** One `batchUpdate` of 20 value cells, guarded by the revision id of the after-read above (the tab had not changed since the fixes). For each row, Nina's text went into Source: Manager feedback as `Nina, in the sheet (read 2026-11-04): <her text>` (trailing spaces trimmed; Manager feedback was empty on all ten), and Please check was cleared. No data value changed. These rows carried no flag yellow (A–AB had no background), so no formatting was changed.
- G-093, G-094, G-095 (54 Alexander Street): import, never offered (Selling = Yes). "Property is in the process of being sold. Do not include. Leaving vacant."
- G-162, G-164 (280 9th Street), G-165, G-166 (281 Ontario Street): same. "Leave as is. Selling property."
- G-097 (68 Jefferson Street 2): first name only, accepted as is. "Do not have full name - leave as is."
- G-168 / G-171 (300 State Street 1A (Effic.) / 4): accepted. G-168: `NO RENT. (to: what is the monthly rent?) YES. (to: same tenant also on unit 4?)`; G-171: `YES. (to: same tenant also on unit 1A (Effic.)?)`. Rent "-" stays; the same tenant on both units is confirmed.
- Still flagged and highlighted (held, not imported): G-020, G-063, G-084, G-113, G-134, G-136 (lease ended 10/31/26, still Occupied).

**Mirror.** `518-unit-rosters-normalized.xlsx` was replaced with a fresh xlsx export of the whole live Sheet (Drive export, all tabs), as for Make Up. The previous mirror (2026-11-03 16:35) is backed up at `scratchpad/gold/import/mirror_backup_before_gold_import_2026-11-04.xlsx`. Against the old mirror: Gold 624 cells changed (all of this report's edits), Read me 0, **Silver 1,080** (Rent paid to, Heating fuel, Owners Name/Email, Selling; see `silver-owners-verification-2026-11-04.md`) and **Make Up 9** (see `makeup-reverification-2026-11-04.md`). Those Silver and Make Up edits are in the mirror now but were **not imported**, so `verify` for those two tabs will show differences until they are re-imported.

**Importer.** `EXPECTED_AVAILABLE["gold"]` added (the 31 units in "Validation" above) and Gold `PROBES` (19 Garner 2L, 46 48 South Lake 11, 39 Mulberry 39A, 37 Mulberry 39A, 166 2nd Street 1, 54 Alexander 1, "Saratoga Avenue" 1).

**Command** (from `dashboard/`, same org and admin stand-in as Silver/Make Up; `intendedAssetManagerName` = "Nina"): `python3 -I scripts/roster/import_roster.py dry-run|apply|verify --category gold --skip-flagged --expect-skipped G-020,G-063,G-084,G-113,G-134,G-136 --org <orgId> --deployment brilliant-badger-615` (plus `--asset-manager <admin usersId>` for dry-run/apply).

**Dry run.** `--single-batch` cannot be read for Gold: the Convex CLI cuts the dry-run ConvexError at about 16 KB ("[...truncated]"), so the importer stops with "import failed". The truncated text was read directly: 59 properties, 199 units, 194 residents, 199 source rows created; the same-transaction re-run changed nothing; lossless read-back 199 rows, 8,756 cells, **0 differences**; 51 units offered org-wide; probes as expected (37 Mulberry 39A does not match: 39A/39B are at 39 Mulberry now; "Saratoga Avenue" alone is ambiguous across 6 properties). The normal batched dry run (4 batches) passed: 0 errors, same totals, 31 available. No Gold data was on dev before (0 Gold properties, units or source rows).

**Apply** (4 batches): properties 59 created, units 199 created, residents 194 created, source rows 199 created, **31 available**. A dry run afterwards reported everything unchanged.

**Verify:** lossless 199 sheet rows vs 199 DB rows, 8,756 cells, **0 differences**; available set equals `EXPECTED_AVAILABLE["gold"]`. Gold on dev: Occupied 155, Vacant 40, Vacant – not rent ready 4; Residential 192, Commercial 4, Unknown 3; Fixed 92, Month-to-month 63, "-" 44; 194 roster residents, none with "&"; ownership managed 59; no owners (empty on Gold).

**Org totals after the import:** 144 properties (85 + 59), 568 units (369 + 199), **51 available** (Silver 11, Make Up 9, Gold 31).

Not created yet: no property (every Gold property has at least one imported row). The 6 held rows have no unit, resident or source row on dev. Silver on dev still has 11 available although the Silver `EXPECTED_AVAILABLE` now lists 9 (the 2026-11-04 Selling rule has not been re-applied to Silver on dev); this was not touched.
