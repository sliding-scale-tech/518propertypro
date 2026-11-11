# Silver owners verification, 2026-11-04

Live Google Sheet "518 property list" (id `1BtIdb_vUprOjXxg1Xk4cBiqcDQL0tWXa8Qd_-63lApg`), tab **Silver** (manager Nikki), read only. Compared with the local mirror `docs/rosters/518-unit-rosters-normalized.xlsx` (Silver tab, saved 2026-11-03 16:35). Importer code read, nothing run. No tenant names, full owner emails or owner names appear below: owners are initials, emails are masked.

## 1. Summary

| Check | Result |
|---|---|
| Rows / properties | 275 data rows (S-001 to S-275), 56 properties. Same Row IDs, same order and same 48 headers as the mirror. |
| Properties with an owner name | 56 of 56 (every one of the 275 rows has a name) |
| Properties with an owner email | 56 of 56 non-empty, but one cell is not an email (see 2). 55 of 56 are usable. |
| Properties missing a name or an email | 0 |
| Properties whose rows disagree, as typed | 4 (9 Union Street, 86 Remsen Street, 687 State Street, 1146 Madison Avenue) |
| Properties that still disagree after the importer's own trim + lowercase | 1 (1146 Madison Avenue, row S-235) |
| Distinct owners after normalization | 17 valid name + email pairs; one more cell holds a single character |
| Two emails in one cell | none. Every cell holds one address, so the ", " separator is never exercised. |
| Placeholders ("n/a", "same", "?", "-") | none found. One cell holds the single character `v` (S-235). |
| Same email with different names | none |
| Same name with different emails | 1 owner (K. S.), but only by letter case and the `v` cell |
| "Please check" | empty on all 275 rows. No new answers from Nikki there. |
| Review columns | Correct? (Y/N): 106 "Y", 169 empty. Corrections: empty. Same as the mirror. |

## 2. Owner checks

1. **Invalid email, blocks the import.** 1146 Madison Avenue unit 4-2A (S-235): the "Owners Email Address" cell is the single character `v`. The other 9 units of the building carry one address (k***@yahoo.com, written with a capital letter on the 9). `parseOwnerEmails` rejects `v`, so the import stops at S-235 with "not valid (***)".
2. **Cosmetic differences between rows of one building (the importer fixes these, no answer needed):**
   - 9 Union Street, S-024: owner name has a trailing space; the other 5 rows do not. `Owners Name` is trimmed at import.
   - 86 Remsen Street, S-082: email has a trailing carriage return + line feed. 687 State Street, S-207: same. JS `trim()` removes them before the split, so the cells match the other rows.
   - Capital letters in the email on the 182, 184, 188 and 190 Remsen Street rows (E***@...), the 479 1st Street rows and 9 of the 10 1146 Madison Avenue rows (K***@...). The importer lowercases.
   The `\r\n` cells are the ones to remember: they do not show in the Sheet grid but they are in the cell value.
3. **Email format.** Every other address passes the importer's pattern (`^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$`, length at most 200).
4. **Several emails in a cell.** None. Separator for two owners is exactly ", " (comma + one space); anything else stops the import.
5. **Placeholders.** None, apart from `v`. No "-" (the importer refuses "-" in owner cells).
6. **Company versus person names.**
   - R. (a single word, looks like a company) is the owner of 15 properties (93 units). The contact email is e***@redburndev.com, a personal-looking address at the company domain.
   - J. B. (j***@redburndev.com, same domain) owns 5 properties (29 units): 204 Lafayette Street, 508, 510, 512 and 514 State Street.
   - Other owners are written as person names. Some email addresses read as a business, not as the person: N. S. (86 Remsen Street), B. B. (6 properties), J. S. (1527 3rd Street), M. B. (687 State Street, the address looks like an LLC mailbox), R. T. (433 3rd Street and 1009 19th Street, a company domain).
   - Other odd addresses: C. G. (538-540 2nd Street) has an address whose local part does not match the name; P. T. (1635 Van Vranken Avenue) has a random-looking local part (9***@tetravine.com).
7. **Company-owned versus managed.** The Sheet does not say. By the spec (decision 3b) every Silver property imports as `managed`. Nikki's owner columns carry no extra signal for it.
8. **Owner per property, not per unit.** Confirmed in the code (`assertSameProperty`). Four owners hold several properties, consistently: K. S. 6 properties (173 Western Avenue, 318 Quail Street, 361 Washington Avenue, 477 and 479 1st Street, 1146 Madison Avenue), B. B. 6, R. 15, J. B. 5. 477 1st Street and 479 1st Street are separate properties (the 2026-10-30 split) with the same owner.
9. **Not owner fields.** The "Owner name (per manager): ..." text in Notes on 182, 184 and 188 Remsen Street COM1 and 512 State Street NEST (S-111, S-113, S-117, S-195) is the commercial tenant's owner. It is not read by the importer and not compared here.

## 3. Other changes since the baseline (mirror vs live)

Cell-for-cell comparison of all 48 columns on 275 rows (dates, numbers and "1" versus "1.0" type noise ignored). The only differences besides the two owner columns:

| Column | Mirror | Live | Rows |
|---|---|---|---|
| Rent paid to | "-" | "518 Property Pro" | 245 |
| Rent paid to | "-" | "Owner directly" | 5 (S-197 514 State Street S1, S-200 538-540 2nd Street 540-1, S-252 1226 Wendell Avenue 2R, S-263 1356 Union Street Basement, S-265 1406 5th Avenue 2) |
| Heating fuel | "-" | Gas 224, Both 26, Electric 18 | 268 |
| Selling | "-" | "Yes" | 12 (every unit of 108 Jackson Avenue, 132 Johnston Avenue, 433 3rd Street and 538-540 2nd Street) |

Not changed: Status, Tenants, Rent, Lease type and end, City, Notes, Please check, Correct?, Corrections, every Source column, Source: Manager feedback. The mirror is the 2026-11-03 build; whether Nikki or someone else made these edits cannot be seen with the read-only tools.

Still "-" after the change: Rent paid to on 6 rows (S-004, S-098, S-112, S-127, S-169 vacant or not rent ready, S-172 leaving), and Heating fuel on 7 rows (S-042, S-098, S-112, S-127, S-137, S-247, S-248). Heating fuel differs between units within 10 properties.

These conflict with the spec as written: "Heating fuel ... '-' for Gold and Silver (they do not say)" (Confirmed), and "Rent paid to ... Every other row is '-'" (Silver, 2026-10-30).

## 4. Will the importer pick up the owner columns as-is?

- **Headers:** yes. The live header row equals the importer's `COLUMNS` list exactly (48 headers, "Owners Name" and "Owners Email Address" included). Columns are found by name.
- **Separator:** ", " only. The Sheet has no two-email cells, so nothing to split. If Nikki later adds a second owner, it must be ", " exactly.
- **Normalization:** name trimmed, emails trimmed (including `\r\n`) and lowercased. That settles every difference in section 2.2.
- **Blocker 1:** S-235 (`v`). The run stops until it is fixed.
- **Blocker 2:** `import_roster.py` reads the local workbook, not the live Sheet. The mirror has empty owner columns, so it must be refreshed from the live Sheet first (needs your go-ahead; I did not touch it).
- **Side effects of a refresh and re-import:** it also writes the new Rent paid to, Heating fuel and Selling values to the dev database (see section 3), and `verify` against the refreshed workbook is the check. Selling does not change the availability rule (Vacant + Residential + rent stated), so the 11 expected available units are unaffected, but two of them (538-540 2nd Street 538-1 and 538-2) now sit in a "selling" building.

## 5. Questions for Umar

1. **1146 Madison Avenue 4-2A (S-235):** the owner email cell is `v`. Is it a typo for the building's address (k***@yahoo.com, used on the other 9 units), a different owner, or should it be empty? (If empty, the importer then sees a property with 9 emails and 1 empty, which also stops the import; the cell would have to match the others.)
2. **Row-level whitespace and case (9 Union Street S-024, 86 Remsen Street S-082, 687 State Street S-207, capitals on Remsen, 479 1st Street and 1146 Madison Avenue):** leave as is (the importer cleans it), or ask Nikki / clean the Sheet so the Sheet itself is consistent?
3. **"R." owner of 15 properties (93 units):** the name is a single word that looks like a company. Is the stored owner name meant to be the company name, or a person? The contact address is personal-looking at the company domain.
4. **J. B. (j***@redburndev.com) owns 204 Lafayette Street and 508 to 514 State Street:** is this the same company as "R." (so the name should match), or a separate owner? Options: keep both as written, or ask Nikki.
5. **Business-looking addresses with a person name** (N. S. 86 Remsen Street, B. B. six properties, J. S. 1527 3rd Street, M. B. 687 State Street, R. T. two properties): is the name a person or a company, and who should Sarah expect on the phone? Options: keep as written, or ask Nikki for "contact person" separately.
6. **C. G. at 538-540 2nd Street and P. T. at 1635 Van Vranken Avenue:** the first email's local part does not match the name; the second looks auto-generated. Are both addresses the right ones for the owner? Option: ask Nikki to confirm these two.
7. **Second owners:** no property has two emails. On Make Up the pairs were common. Do any Silver buildings have co-owners who should also be matched by email? Option: ask Nikki.
8. **Company-owned or managed:** the owner columns do not say. Keep every Silver property `managed` (spec), or is any (for example the R. properties) owned by the company or an affiliate?
9. **Who changed Rent paid to, Heating fuel and Selling, and are they right?** 245 rows now say "518 Property Pro" and 5 "Owner directly" (the mirror had "-"); 268 rows have a heating fuel although the confirmed rule is "-" for Silver; 12 rows say Selling = Yes. Options: accept all three, accept some, or revert to the spec rule.
10. **The 5 new "Owner directly" units** (514 State Street S1, 538-540 2nd Street 540-1, 1226 Wendell Avenue 2R, 1356 Union Street Basement, 1406 5th Avenue 2): no note or manager answer explains them. Intended?
11. **Rent paid to "-" and Heating fuel "-" on the vacant, not-rent-ready and leaving units** (list in section 3): leave "-" or fill in?
12. **Selling = Yes on 108 Jackson Avenue, 132 Johnston Avenue, 433 3rd Street and 538-540 2nd Street:** should Sarah still offer vacant units there (538-1 and 538-2 are on the expected available list)? Per the spec, `available` is not derived from Selling. Keep, or exclude selling buildings?
13. **Refresh the mirror from the live Sheet** before any re-import (needs your OK). Re-import also overwrites the dev Silver rows that now differ (section 3).

## 6. Property by property

Owner is initials, email masked. "Cell issues" lists only differences between rows of one building as typed.

| # | Property | Units | Owner (initials) | Owner email (masked) | Cell issues |
|---|---|---|---|---|---|
| 1 | 1 Washington Avenue | 6 | R. | e***@redburndev.com | none |
| 2 | 4 Union Street | 10 | R. | e***@redburndev.com | none |
| 3 | 9 Lexington Court | 1 | K. W. | w***@gmail.com | none |
| 4 | 9 Madison Place | 4 | G. A. | l***@gmail.com | none |
| 5 | 9 Union Street | 6 | R. | e***@redburndev.com | name trailing space on S-024 |
| 6 | 10 Madison Place | 4 | G. A. | l***@gmail.com | none |
| 7 | 11 North Church Street | 11 | R. | e***@redburndev.com | none |
| 8 | 21 North College Street | 2 | R. | e***@redburndev.com | none |
| 9 | 23 North College Street | 4 | R. | e***@redburndev.com | none |
| 10 | 25 North Ferry Street | 7 | R. | e***@redburndev.com | none |
| 11 | 32 North Ferry Street | 9 | R. | e***@redburndev.com | none |
| 12 | 33 North Ferry Street | 5 | R. | e***@redburndev.com | none |
| 13 | 43 Washington Avenue | 6 | R. | e***@redburndev.com | none |
| 14 | 58 Washington Avenue | 5 | R. | e***@redburndev.com | none |
| 15 | 86 Remsen Street | 3 | N. S. | i***@gmail.com | email trailing CR/LF on S-082 |
| 16 | 90 Hill Street | 2 | L. P. | l***@gmail.com | none |
| 17 | 108 Jackson Avenue | 3 | A. N. | a***@nyeproperties.com | none |
| 18 | 113 Front Street | 6 | R. | e***@redburndev.com | none |
| 19 | 132 Johnston Avenue | 3 | A. N. | a***@nyeproperties.com | none |
| 20 | 173 Western Avenue | 12 | K. S. | k***@yahoo.com | none |
| 21 | 182 Remsen Street | 2 | E. M. | e***@manulifeam.com | email has capital letter |
| 22 | 184 Remsen Street | 2 | E. M. | e***@manulifeam.com | email has capital letter |
| 23 | 188 Remsen Street | 4 | E. M. | e***@manulifeam.com | email has capital letter |
| 24 | 190 Remsen Street | 2 | E. M. | e***@manulifeam.com | email has capital letter |
| 25 | 204 Lafayette Street | 10 | J. B. | j***@redburndev.com | none |
| 26 | 208 Union Street | 5 | R. | e***@redburndev.com | none |
| 27 | 250 Green Street | 3 | R. | e***@redburndev.com | none |
| 28 | 301 Green Street | 17 | P. P. | p***@yahoo.com | none |
| 29 | 308 East Street | 3 | A. N. | a***@nyeproperties.com | none |
| 30 | 318 Quail Street | 4 | K. S. | k***@yahoo.com | none |
| 31 | 361 Washington Avenue | 9 | K. S. | k***@yahoo.com | none |
| 32 | 433 3rd Street | 2 | R. T. | s***@blockbuilderproperties.com | none |
| 33 | 457 4th Avenue | 2 | L. P. | l***@gmail.com | none |
| 34 | 477 1st Street | 2 | K. S. | k***@yahoo.com | none |
| 35 | 479 1st Street | 2 | K. S. | k***@yahoo.com | email has capital letter |
| 36 | 508 State Street | 15 | J. B. | j***@redburndev.com | none |
| 37 | 510 State Street | 1 | J. B. | j***@redburndev.com | none |
| 38 | 512 State Street | 1 | J. B. | j***@redburndev.com | none |
| 39 | 514 State Street | 2 | J. B. | j***@redburndev.com | none |
| 40 | 538-540 2nd Street | 4 | C. G. | t***@gmail.com | none |
| 41 | 551 5th Avenue | 2 | L. P. | l***@gmail.com | none |
| 42 | 687 State Street | 7 | M. B. | m***@gmail.com | email trailing CR/LF on S-207 |
| 43 | 718 East Street | 6 | A. N. | a***@nyeproperties.com | none |
| 44 | 858 Union Street | 2 | L. P. | l***@gmail.com | none |
| 45 | 1009 19th Street | 2 | R. T. | s***@blockbuilderproperties.com | none |
| 46 | 1084 Wendell Avenue | 5 | B. B. | u***@gmail.com | none |
| 47 | 1114 Union Street | 5 | B. B. | u***@gmail.com | none |
| 48 | 1146 Madison Avenue | 10 | K. S. | k***@yahoo.com | S-235 email invalid; other 9 rows differ in case only |
| 49 | 1211 Dean Street | 8 | R. | e***@redburndev.com | none |
| 50 | 1226 Wendell Avenue | 5 | B. B. | u***@gmail.com | none |
| 51 | 1238 Union Street | 5 | B. B. | u***@gmail.com | none |
| 52 | 1356 Union Street | 5 | B. B. | u***@gmail.com | none |
| 53 | 1406 5th Avenue | 3 | D. S. | d***@yahoo.com | none |
| 54 | 1527 3rd Street | 3 | J. S. | n***@gmail.com | none |
| 55 | 1581 Van Vranken Avenue | 3 | B. B. | u***@gmail.com | none |
| 56 | 1635 Van Vranken Avenue | 3 | P. T. | 9***@tetravine.com | none |

## Fixes and import 2026-11-04

Applied with the user's approval: formatting fixes on the live Silver tab (sheetId `1139911461`) only, then a re-import of Silver only to the Convex **dev** deployment `brilliant-badger-615`. Gold, Make Up and the hidden "Read me" tab were not touched; no sharing, dropdown, column, filter or number-format change. Gold and Make Up were not imported. No ElevenLabs call. Owners are initials, emails masked, no tenant names.

### User decisions applied

- **S1 (questions 9 to 12):** Nikki's edits accepted as they are in the sheet: Rent paid to (245 rows "518 Property Pro", 5 rows "Owner directly"), Heating fuel (Gas 224, Both 26, Electric 18; "-" kept on the 7 rows that do not say), Selling = Yes on every unit of 108 Jackson Avenue, 132 Johnston Avenue, 433 3rd Street and 538-540 2nd Street (imported, never offered: the 2026-11-04 Selling rule). No cell was changed for these. Every value is one of the tab's dropdown values and one of the importer's labels (Rent paid to: 518 Property Pro 245, Owner directly 22, Included in another unit's rent 2, "-" 6; Heating fuel: Gas 224, Both 26, Electric 18, "-" 7; Selling: Yes 12, "-" 263). None had to be reported.
- **S2 (question 1):** S-235 (1146 Madison Avenue 4-2A) was fixed in the sheet by the user before this step: its email is now the building's address (k***@yahoo.com), the same as the other 9 units after trim and lowercase. It was the only Silver cell that differed from the 15:36 read of this report.
- **S3:** "R." (Redburn) imported as written. **S4:** every Silver property `managed`. **S5:** the two unusual addresses (C. G., P. T.) imported as written.
- "Please check" is empty on all 275 rows (checked before and after the write).

### How it was written

- Snapshot before the write (values, types, number formats and backgrounds of A1:AV300): `scratchpad/silver/fix/snapshot_before_2026-11-04_grid.json`. Against this report's 15:36 read it differed in 1 cell only (S-235 owner email, the user's fix), so every target cell matched the report and **no cell was skipped**.
- One `batchUpdate` of 25 `updateCells` requests (field mask `userEnteredValue` only, so formatting is kept), guarded by the snapshot's revision id. It applied on the first try.
- After-read (`after_2026-11-04_grid.json`): exactly the **25 planned value cells** changed, no other value, number format or background changed. Plan and requests: `plan.json`, `requests.json` in the same folder; builder `scratchpad/silver/scripts/build_fix.py`.
- Nothing was written to Source: Manager feedback (pure formatting).

### Cells changed (25, owner columns only)

- Owners Name, trailing space trimmed (1): S-024 (9 Union Street).
- Owners Email Address, trailing CR/LF removed (2): S-082 (86 Remsen Street), S-207 (687 State Street).
- Owners Email Address, lowercased (22): S-110, S-111 (182 Remsen Street), S-112, S-113 (184 Remsen Street), S-114 to S-117 (188 Remsen Street), S-118, S-119 (190 Remsen Street), S-177, S-178 (479 1st Street), S-231 to S-240 (1146 Madison Avenue, S-235 included).
- Result: every property's owner name and owner email cells are now identical across its units as typed (0 properties with more than one raw value). No owner cell was filled or otherwise changed; there were no empty owner cells.

**Left as they are (not padding):** the double spaces in Unit and Source: Unit on S-096 "2nd  Front", S-097 "2nd  rear" (132 Johnston Avenue) and S-155 "A  Basement ( F" (308 East Street) are verbatim from the source (see unit-fields-spec, Silver section and the transcription notes); changing them would rename units. The line breaks inside Source: Manager feedback on 12 rows (S-143 to S-153, S-175, S-207 to S-210) separate two answers (the Silver convention). No other Silver cell has leading or trailing spaces, double spaces or non-breaking spaces.

### Mirror

`518-unit-rosters-normalized.xlsx` was replaced with a fresh xlsx export of the whole live Sheet (Drive export, all tabs). The previous mirror (17:03, after the Make Up import) is backed up at `scratchpad/silver/import/mirror_backup_before_silver_import_2026-11-04.xlsx`; the export is also at `scratchpad/silver/import/export/live_2026-11-04_silver.xlsx`. Against the backup: **Silver 25 cells** (exactly the edits above), Gold 0, Make Up 0, Read me 0.

### Dry run, import, verify

Command (from `dashboard/`, same org and admin stand-in as before, `intendedAssetManagerName` "Nikki"): `python3 -I scripts/roster/import_roster.py dry-run|apply|verify --category silver --skip-flagged --org <orgId> --deployment brilliant-badger-615` (plus `--asset-manager <admin usersId>` for dry-run/apply). `--skip-flagged` skipped **0 rows**. Script: `scratchpad/silver/scripts/imp_silver.sh`.

- **Batched dry run** (5 batches): 0 errors, 275 rows, 56 properties, rule-available 9 = `EXPECTED_AVAILABLE["silver"]`.
- **Single-batch dry run** (fits for Silver, not truncated): same totals; the re-run in the same transaction changed nothing; lossless read-back 275 rows, 12,100 cells, **0 differences**; 49 units offered org-wide. Probes unchanged in behaviour: 184 Remsen Street 2, 479 1st Street 479-1, 687 State Street B2 and "687 State St, Albany" / "apartment b 2" match; 477 1st Street 479-1 does not match (suggests 477-1, the 2026-10-30 split); "Remsen Street" alone is ambiguous across the 5 Remsen buildings. No Silver probe changed. (The "9 South Main Street Mechanicville" 1-1 change, now two suggestions, is a Make Up probe and comes from the Gold import; not touched.)
- **Apply** (5 batches): properties 0 created, **56 updated** (owner name and email on all 56; Selling on the 4 selling properties), 0 unchanged; units 0 created, **272 updated** (Rent paid to and/or Heating fuel), 3 unchanged (S-098, S-112, S-127: "-" in both columns before and after); residents 0 created, 0 updated, 0 deactivated, **306 unchanged**; source rows 0 created, 0 updated, **275 unchanged**; available 9. A dry run afterwards reported everything unchanged.
- **Verify:** lossless 275 sheet rows vs 275 DB rows, 12,100 cells, **0 differences**; available set equals `EXPECTED_AVAILABLE["silver"]`. Silver on dev: 56 properties, 275 units, 275 source rows; Occupied 260, Occupied – leaving 2, Vacant 11, Vacant – not rent ready 2; Residential 255, Commercial 15, Garage 4, Office 1; Fixed 161, Month-to-month 95, "-" 19; 306 active roster residents, 0 inactive; ownership managed 56; **owners on 56 of 56 properties** (name and one email each).
- **Available (9):** 173 Western Avenue 1, 184 Remsen Street 2, 204 Lafayette Street 3C, 361 Washington Avenue 8, 687 State Street B2, B3, B4, 718 East Street 6- BR, 1635 Van Vranken Avenue 1. 538-540 2nd Street 538-1 and 538-2 are **not** available (Selling = Yes).

### Org totals on dev afterwards

147 properties, 575 units, **49 available**: Silver 9, Make Up 9, Gold 31 (unchanged; Silver's 9 had been set on dev by hand before, now it is also what the import computes).

Noted, not changed: 6 Silver units on dev carry a different asset manager user id than the admin stand-in (269 vs 6). The import did not touch that field (it is not in any unit's change list), so it predates this run.

## Owner decisions applied 2026-11-04

The user's answers to the six Silver/Nina owner conflicts (`questions-for-nikki-2026-11-04.md`) were written to the live Silver tab (sheetId `1139911461`) with the user's approval. **These changes are in the Sheet only. They wait for Nikki's confirmation and were NOT imported:** no mirror refresh, no `import_roster.py` run and no Convex command (the user changed scope before any import step started). The dev database still has the earlier Silver owners (the "Fixes and import 2026-11-04" values above). Gold, Make Up and the hidden "Read me" tab were not touched. No ElevenLabs call. People are initials and emails are masked, as above.

### Decisions

| # | Properties | Change in the Sheet | Flagged |
|---|---|---|---|
| 1 | B. B.: 1084 Wendell Avenue, 1226 Wendell Avenue, 1114 Union Street, 1238 Union Street, 1356 Union Street, 1581 Van Vranken Avenue (28 rows) | Owners Email Address "u***@gmail.com" → "u***@gmail.com, b***@gmail.com" (Nikki's first, then Nina's list). Name unchanged. | yes |
| 2 | 301 Green Street (17 rows) | Owners Name "P. P." → "P. P. & P. S."; Owners Email Address "p***@yahoo.com" → "p***@yahoo.com, p***@pvslaw.com" | yes |
| 3 | 433 3rd Street, 1009 19th Street | none (Silver spelling kept) | no |
| 4 | 1527 3rd Street (3 rows) | Owners Name "J. S." → "J. S. & M. J. S."; email unchanged | yes |
| 5 | the 15 Redburn properties (93 rows) | Owners Name "Redburn" → "E. Y. J." (the Redburn Stockade, LP contact in Nina's list); email unchanged | yes |
| 6 | 182, 184, 188, 190 Remsen Street (10 rows) | none (E. M. kept) | yes |

Every name and email was taken from `owners.json` (Nina's PDF) and the Sheet, and checked against both before the write: the PDF block names, the two-person form "First Last & First Last", the property lists of blocks 5 (B. B.) and 12 (Redburn Stockade, LP) and Nikki's current values all matched. No mismatch.

### Flags for Nikki

"Please check" was empty on all 151 rows, so each note was written new (nothing appended). Columns A–AB of each row got the sheet's flag yellow (RGB 1 / 0.949 / 0.8, as on Gold). The values in Correct? (Y/N), Corrections, Notes and the Source columns were not changed. The notes:

1. "Please confirm: added a second owner email from Nina's rental owners list (b***@gmail.com). Silver sheet had only u***@gmail.com; both are kept."
2. "Please confirm: from Nina's rental owners list we added a second owner (P. S., Window Factory Lofts) and a second email (p***@pvslaw.com). Silver sheet had P. P., p***@yahoo.com only."
4. "Please confirm: Nina's rental owners list names M. J. S. (North Country Property Rentals LLC); added her name next to J. S."
5. "Please confirm: owner name changed from 'Redburn' to E. Y. J., the contact for Redburn Stockade, LP in Nina's rental owners list (same email)."
6. "Please confirm: Nina's rental owners list also shows this building under R. (B.) B. (b***@gmail.com). We kept E. M. as in the Silver sheet."

(In the Sheet the notes carry the full names and addresses.)

Flagged rows (151): 1084 Wendell Avenue S-221–S-225, 1114 Union Street S-226–S-230, 1226 Wendell Avenue S-249–S-253, 1238 Union Street S-254–S-258, 1356 Union Street S-259–S-263, 1581 Van Vranken Avenue S-270–S-272; 301 Green Street S-138–S-154; 1527 3rd Street S-267–S-269; 1 Washington Avenue S-001–S-006, 4 Union Street S-007–S-016, 9 Union Street S-022–S-027, 11 North Church Street S-032–S-042, 21 North College Street S-043–S-044, 23 North College Street S-045–S-048, 25 North Ferry Street S-049–S-055, 32 North Ferry Street S-056–S-064, 33 North Ferry Street S-065–S-069, 43 Washington Avenue S-070–S-075, 58 Washington Avenue S-076–S-080, 113 Front Street S-089–S-094, 208 Union Street S-130–S-134, 250 Green Street S-135–S-137, 1211 Dean Street S-241–S-248; 182 Remsen Street S-110–S-111, 184 Remsen Street S-112–S-113, 188 Remsen Street S-114–S-117, 190 Remsen Street S-118–S-119.

### How it was written

- Snapshot of Silver A1:AV300 (values, formatted values, backgrounds, number formats) before the write. It was identical to the after-read of the morning's fixes (0 differences). All 151 target rows still held the expected (Nikki's) owner values, so **no cell was skipped**.
- The file's revision id moved between the snapshot and the write, so Silver was read again in full: it was identical to the snapshot (values and formats). The edit was elsewhere in the file. The write was guarded by the new revision id.
- One `batchUpdate` of 33 `repeatCell` requests over contiguous row ranges (field mask `userEnteredValue` for values, `userEnteredFormat.backgroundColor,backgroundColorStyle` for the highlight, so no other formatting changed), all on sheetId `1139911461`. It applied on the first try.
- After-read and diff: exactly **309 value cells** changed (Owners Name 113 = 93 Redburn + 17 Green + 3 Spadaccini; Owners Email Address 45 = 28 B. B. + 17 Green; Please check 151) and **4,228 background cells** (151 rows × A–AB). Every one equals the plan, and nothing else changed. All 56 properties still have identical owner cells across their units.
- Static check against the importer's rules (code read, not run): both two-email cells split on ", " into two valid, lowercase, distinct addresses; the new names are trimmed, single-spaced and well under 120 characters.
- Files (session scratchpad, full values): `silver/owners_decisions/snapshot_before_owner_decisions_2026-11-04_grid.json` (for revert), `snapshot2_grid.json`, `plan.json`, `requests_compact.json`, `after_owner_decisions_2026-11-04_grid.json`; scripts in `silver/owners_decisions/scripts/`.

### Before a later Silver import

- The 151 rows now have "Please check" text. The earlier Silver command (`--skip-flagged`, `imp_silver.sh`) would **skip them all** (most of the tab). After Nikki answers, either clear the notes (and the highlight) first, or import without `--skip-flagged`, or pass all 151 Row IDs to `--include-rows`.
- The mirror `518-unit-rosters-normalized.xlsx` was not refreshed, so it still has the earlier Silver owner values.
