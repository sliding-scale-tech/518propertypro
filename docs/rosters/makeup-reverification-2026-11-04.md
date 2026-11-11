# Make Up (Delia) tab: re-verification after Delia's answers, 2026-11-04

Read-only check of the live Google Sheet "518 property list" (spreadsheet `1BtIdb_vUprOjXxg1Xk4cBiqcDQL0tWXa8Qd_-63lApg`), tab "Make Up (Delia)" (sheetId `2128282752`, confirmed from the tab metadata). Nothing in the Sheet was changed; the hidden "Read me" tab was not touched. The sheet revision id was identical at the start and the end of this check, so nobody edited it while it ran.

Baseline: the local mirror `docs/rosters/518-unit-rosters-normalized.xlsx` (last saved 2026-11-03 16:35, after the previous verification and after our fixes). Contract: `docs/rosters/unit-fields-spec.md`. Importer read, not run: `dashboard/scripts/roster/import_roster.py`, `dashboard/convex/rosterMapping.ts`, `rosterFields.ts`, `rosterImport.ts`. Previous report: `makeup-verification-2026-11-03.md`. Questions asked: `questions-for-delia-2026-11-03.md`.

Privacy: no tenant names; owner emails are masked; phone numbers are not printed.

## 1. Summary

- Delia answered 5 of the 6 questions, but only by editing cells. She did not clear "Please check", did not use "Correct? (Y/N)" / "Corrections" for the new answers, and wrote nothing in "Source: Manager feedback".
- The live tab differs from the mirror in **9 real cells** on 8 rows (plus one cosmetic difference on M-005, see section 2).
- **Import-ready now: M-001, M-013, M-016, M-084, M-085, M-097** (6 of the 7).
- **Not ready: M-055.** The tenant name she entered is exactly the name that was on M-057 (unit 8, same building) in the mirror, and M-057 now holds a different name. See Question 1.
- **One already-imported row changed: M-057** (Tenants). It needs a re-import once Question 1 is settled.
- **Gas question for the electric-heated units is unanswered.** Gas paid by is still "-" on M-030, M-037, M-040, M-041, M-099 (importer accepts "-").
- Full validation of the live tab against the importer rules: **0 errors**, 101 rows, 32 properties. New warnings are only those in section 5.

## 2. Every cell changed since the mirror

| Row | Column | Mirror | Live | Already imported? |
|---|---|---|---|---|
| M-001 | Owners Email Address | empty | filled (`s***@outlook.com`) | No (flagged row, skipped) |
| M-013 | Lease end | 2026-10-31 | 2028-10-31 | No (flagged) |
| M-016 | Lease end | 2026-09-30 | 2027-12-31 | No (flagged) |
| M-055 | Tenants | `-` | a name (same text as M-057 had in the mirror) | No (flagged) |
| M-057 | Tenants | one name | a different name (not a case or spacing change) | **Yes** |
| M-084 | Floor | `-` | 1 | No (flagged) |
| M-084 | Lease end | 2026-10-31 | 2027-11-30 | No (flagged) |
| M-085 | Floor | `-` | 2 | No (flagged) |
| M-097 | Lease end | 2026-10-31 | 2027-12-31 | No (flagged) |
| M-005 | Corrections | date value 2027-09-30 | text `9/30/27` | Not a real change. The mirror's openpyxl read turned her text into a date. The live text is what she typed; the importer never reads Corrections. |

Everything else is identical, including all 20 Source columns, Notes, Please check, Correct?, Corrections, Rent (sum still $126,474.00 over 99 rents), and the 48 headers. Structure is unchanged: 101 rows M-001 to M-101, filter A1:AV1000, column groups unchanged, no cell notes, no merges. Lease end cells are real dates (numeric) and Floor/Rent are numbers, not text.

"Already imported" = the 94 rows without a "Please check" question. The 7 flagged rows (M-001, M-013, M-016, M-055, M-084, M-085, M-097) were skipped by `--skip-flagged`.

## 3. Her answers, question by question

| # | Question | What the sheet now shows | Resolved? |
|---|---|---|---|
| 1 | 5 Museum Lane unit 1 (R), M-016: new lease end after January renewal | Lease end 2027-12-31. Lease type Fixed term. No comment. Notes still say "new end date to confirm". | Yes, with a low-priority check (Question 4) |
| 2a | 9 S. Main St 2-2, M-013 | Lease end 2028-10-31 (a 2-year renewal) | Yes, read as "renewed" (Question 3) |
| 2b | 219 Saratoga Ave 1, M-084 | Lease end 2027-11-30 | Yes, read as "renewed" (Question 3) |
| 2c | 1021 24th St 2, M-097 | Lease end 2027-12-31 | Yes, read as "renewed" (Question 3) |
| 3 | 66 Second St unit 6 tenant, M-055 | Tenants is filled (two words, letters only, not a placeholder) but it is the same text that M-057 had. M-057 now has a different name. Phone is still empty. | **No**, ambiguous (Question 1) |
| 4 | 219 Saratoga Ave floors | M-084 Floor 1, M-085 Floor 2. Both numbers, valid. | Yes |
| 5 | Electric-heated units: gas service and who pays | No change. Gas paid by is `-` on M-030, M-037, M-040, M-041, M-099. These rows have no "Please check" text, so the question was only in our message, not in the sheet. | **No, unanswered** (Question 5) |
| 6 | 1 N. Liberty Ave owner email, M-001 | Filled, one address, valid syntax, no extra spaces, appears nowhere else. The local part matches the owner name. It is the only unit of this building, so there is nothing to disagree with. | Yes |

Her Correct?/Corrections text on the 7 rows is the same as before (M-001 "Ave", M-016 "Lane - ...", M-084 and M-085 "Fixed"; M-013, M-055, M-097 empty). The new answers exist only as cell edits.

## 4. Import readiness of the 7 held rows

| Row | Ready? | Notes |
|---|---|---|
| M-001 | Ready | Owner email now present. Row passes all mapping rules. |
| M-013 | Ready | Lease end is a future date, Fixed term. |
| M-016 | Ready | Lease end is a future date. Notes text "new end date to confirm" is now stale (does not block). |
| M-055 | **Hold** | Tenant name is in doubt (Question 1). Occupied, Fixed term to 2027-06-30. Phone is empty (phones are not imported anyway). |
| M-084 | Ready | Floor 1, lease 2027-11-30. Laundry note "Meaning unknown" in Notes is stale. |
| M-085 | Ready | Floor 2. Tenants uses the "A & B Surname" shared-surname form, which imports as one resident (Silver convention). |
| M-097 | Ready | Lease end is a future date. |

To import them, `--skip-flagged` still skips all 7 because "Please check" is not empty. Either clear "Please check" on the ready rows in the Sheet and refresh the mirror, or run with `--include-rows M-001,M-013,M-016,M-084,M-085,M-097` (the importer accepts only flagged rows there, which these are). `--expect-skipped` would then be `M-055` only. Either way, copy her answers into "Source: Manager feedback" first if you want provenance (Question 6). The mirror must be re-exported from the live Sheet before any import.

## 5. Changes to already-imported rows, new errors and warnings

**Already-imported row changed: M-057 (66 Second St unit 8), Tenants.** The resident imported into dev (a different name) no longer matches the sheet. A re-import of M-057 is needed. `rosterImport.ts` calls `syncRosterResidents`, which reports created / updated / deactivated, so a changed name should replace the resident, but this was read, not tested. Hold until Question 1 is answered. Its Phone is still the old value (area code 528, probably a typo for 518), and its Notes and Lease end did not change.

No other already-imported row changed.

**Errors:** none. All Status, Lease type, Laundry, Unit type, Selling, payer and Rent paid to values are dropdown values. No empty data cell, no `0`, no "Vacant" in Tenants, no " & " pairs of full names split wrongly, Property spellings consistent (32 properties), owners consistent inside every building (101 of 101 rows now have both an owner name and email).

**Warnings (unchanged from 2026-11-03 unless said):**
- Vacant units Sarah would offer: 9, and the list equals `EXPECTED_AVAILABLE["make_up"]` in `import_roster.py` (169 Myrtle Ave 2, 19 Newark St 1, 53 - 57 Broad St 1R, 66 Second St 5 and 7, 152 Main St 2, 182 Hill St 2, 218 North 4th St 1, 536 3rd St 1R).
- Tenant cells with "&" or "and" (one resident each): M-004, M-085, M-093 (shared surname, fine); M-035, M-069, M-071 (first names only, kept as is by earlier user decision).
- Phone column (not imported, report only): M-029 has 9 digits; M-079 and M-095 are missing a hyphen; M-057 has area code 528; M-074 holds a name instead of a number; M-043 says "N/A"; M-055 is empty; 10 vacant rows say "Vacant".
- Still open from last time and untouched by Delia: M-033 lease end 2029-11-30 (confirm), M-045 / M-046 (office, not a unit), M-017 exact date, the 8 unconfirmed vacant-unit rents, stale Notes on resolved rows, "Rent paid to = 518 Property Pro" on all 101 rows.
- Lease ends in the past with status Occupied: none now (M-013, M-016, M-084, M-097 were the last four).

## 6. Questions for Umar (not resolved by me)

1. **M-055 and M-057 (66 Second St units 6 and 8): which is right?** The name now on unit 6 (M-055) is exactly the name that was on unit 8 (M-057) in the mirror, and unit 8 now holds a different name. Possible readings:
   a. Delia moved that tenant to unit 6 and a new tenant lives in unit 8. Then both rows are correct, M-057's phone may belong to the tenant who moved, and M-057 needs a re-import.
   b. She typed or pasted into the wrong row, and one of the two rows is wrong.
   c. Keep M-055 Tenants as "-" (occupied, name unknown) and leave M-057 as imported until she confirms.
   Option: send Delia a short message asking who lives in unit 6 and who lives in unit 8, and the phone for each. Until then M-055 is held and M-057 is not re-imported.
2. **M-057 phone** `528-...`: is this a typo for 518, and whose number is it (see Question 1)? Phones are not imported yet, so this does not block.
3. **M-013, M-084, M-097: accept the new lease end as "renewed"?** Delia only changed the date. She did not say "renewed", "month-to-month" or "moved out". Options: (a) accept the date as the renewal answer (my reading; the three new dates are valid and in the future); (b) ask her to confirm in one line. M-013 is a two-year renewal (2028-10-31), the others about 13 to 14 months.
4. **M-016: accept 2027-12-31?** She said "renewing for January" and then entered 2027-12-31, with no comment. A January 2027 start with a 12-month term fits, but she did not state it. Options: (a) accept; (b) ask her to confirm the date.
5. **Electric-heated units (M-030, M-037, M-040, M-041, M-099): no gas answer.** The question was only in our message, not in the sheet. Options: (a) import with Gas paid by `-` as now (already imported that way); (b) ask again, adding the question to "Please check" on these 5 rows so she sees it in the sheet. If she answers later, these 5 already-imported units need a re-import.
6. **Provenance and the review flags.** Her answers are not in "Source: Manager feedback" and "Please check" is still filled on all 7 rows. Options: (a) clear "Please check" on the 6 ready rows and copy her answers into "Source: Manager feedback" (dates `read 2026-11-04`), then refresh the mirror and import; (b) leave the sheet and use `--include-rows` for the 6 rows. Which do you want, and who edits the Sheet?
7. **Stale Notes** (M-016 "new end date to confirm", M-084 and M-085 "Meaning unknown", and the older "Date has passed" notes): clean them in the Sheet before import, or import as is? They do not block the import.

---

## Second check, 2026-11-04 (later edits)

Run at about 16:33 to 16:36 local time (Google modified-time field 11:33 UTC). Read-only again: no writes to Google, the hidden "Read me" tab, Gold and Silver were not opened, no Convex commands, no importer runs, no code edits. Tenant names are not printed; owner emails are masked.

### Result: no new edits since the first check

**The live Make Up tab is cell-for-cell identical to the state described in sections 1 to 5 above.** Delia has not changed anything on this tab since the earlier check.

How this was checked:
- Baseline: the live snapshot the earlier check took (about 15:36, scratchpad `makeup/live.json`, A1:AV105, 102 rows including the header). Its state matches the earlier report exactly (the same 9 real cells differ from the pre-check mirror; I re-ran that diff against the mirror backup `gold/import/mirror_backup_before_gold_import_2026-11-04.xlsx` and got the same 9 cells plus the cosmetic M-005 Corrections difference). The main .xlsx was not read.
- Fresh snapshot: `scratchpad/makeup/live_1633.json` (A1:AV200, 102 rows). Cell-by-cell comparison of all 48 columns: **0 changed cells**, headers identical.
- Second, independent read at about 16:36 with full grid data (`scratchpad/makeup/grid_1636.json`, includes cell notes and formatted values): formatted values equal the first fresh snapshot (0 mismatches), **0 cell notes, 0 formulas**. Cell-level comments (the Google comment threads) could not be listed with the available Sheets tool (it rejects the field), so a comment thread added in the Sheet UI would not show up here. Edits made to the other tabs (Gold, Silver) were out of scope.
- Possible explanations for the mismatch with what you were told, none verified: she edited a different tab; she has not saved yet; she replied by message or comment instead of in the cells; or the changes reported are the ones already captured in the first check.

### Cells changed since the earlier check

None. (Row, column, before, after: nothing to list.)

### Status of the earlier questions

| # | Topic | Status after second check | Her answer |
|---|---|---|---|
| 1 | M-055 / M-057 tenant names, 66 Second St units 6 and 8 | **Still open** | Unit 6 still holds the name that was on unit 8 before the first check. Unit 8 still holds the different name. No comment, no Notes text, no Manager feedback. |
| 2 | M-057 phone starting 528 | **Still open** | Phone unchanged (area code 528). |
| 3 | M-013, M-084, M-097 lease ends | Same as first check: dates changed to 2028-10-31, 2027-11-30, 2027-12-31. No comment or Notes text saying "renewed". Judgement call stays with Umar (first-check Question 3). | Date only |
| 4 | M-016 lease end | Same as first check: 2027-12-31, no comment (first-check Question 4). | Date only |
| 5 | Gas on electric-heated units M-030, M-037, M-040, M-041, M-099 | **Still open** | Heating fuel Electric and Gas paid by "-" on all five, unchanged. |
| 6 | Provenance, flags | Unchanged: "Please check" still filled on M-001, M-013, M-016, M-055, M-084, M-085, M-097. "Correct?", "Corrections", "Source: Manager feedback" and "Notes" have no new edits. | None |

No question was newly resolved by this check.

### Import readiness

Unchanged from section 4: ready M-001, M-013, M-016, M-084, M-085, M-097; hold M-055. Rows needing re-import: **M-057 only** (Tenants changed after its first import; hold until the 66 Second St question is answered). If gas answers arrive later, M-030, M-037, M-040, M-041, M-099 would need a re-import.

### Mapping-rule port over all 101 rows (live_1633.json, python3 -I)

- Errors: **0**. Rows 101, properties 32 (M-001 to M-101 sequential, all dropdown values valid, no empty data cells, no past lease end on an occupied unit).
- Warnings: 6 tenant cells with "&" or "and" (M-004, M-035, M-069, M-071, M-085, M-093), the same as before.
- Status: Occupied 91, Vacant 9, Vacant - not rent ready 1. Lease type: Fixed term 51, Month-to-month 40, "-" 9, Vacant 1. Rent sum $126,474.00 over 99 rents, same as before.
- Available units: **9, equal to `EXPECTED_AVAILABLE["make_up"]`** (169 Myrtle Ave 2, 19 Newark St 1, 53 - 57 Broad St 1R, 66 Second St 5 and 7, 152 Main St 2, 182 Hill St 2, 218 North 4th St 1, 536 3rd St 1R). The 2026-11-04 rule (units in Selling = Yes properties are never available) holds: Selling = Yes is only on M-001, M-006, M-007, and none of them is vacant.
- Phone column (not imported): same odd values as before; M-055 empty, M-057 area code 528.

### Questions for Umar (still open, nothing decided here)

1. **Is the Make Up tab what you expected?** Delia's later edits are not on this tab. Options: (a) ask her which tab or cells she changed and whether she saved; (b) check whether she answered by comment or message; (c) proceed on the first-check state.
2. **M-055 / M-057 (66 Second St units 6 and 8).** Unit 6 holds the name that was on unit 8; unit 8 holds a different name. Options: (a) ask Delia who lives in each unit and the phone for each; (b) import M-055 with Tenants "-" and leave M-057 as imported until she answers; (c) treat it as a real move and re-import M-057. Hold M-055 until you pick.
3. **M-057 phone (528).** Typo for 518, and whose number? Does not block (phones are not imported).
4. **M-013, M-084, M-097: accept the changed lease end as "renewed"?** Options: (a) accept the dates; (b) ask Delia for a one-line confirmation.
5. **M-016: accept 2027-12-31?** Options: (a) accept; (b) ask her to confirm.
6. **Gas service on electric-heated units M-030, M-037, M-040, M-041, M-099.** Options: (a) leave Gas paid by "-"; (b) add the question to "Please check" on those five rows so she sees it in the Sheet.
7. **Flags and provenance.** Options: (a) clear "Please check" on the six ready rows and record her answers in "Source: Manager feedback", then refresh the mirror and import; (b) leave the Sheet alone and use `--include-rows M-001,M-013,M-016,M-084,M-085,M-097`. Who edits the Sheet?
8. **Stale Notes** on M-016, M-084, M-085 and older "Date has passed" notes: clean before import, or import as is?

---

## Fixes and import 2026-11-04

Applied with the user's approval: edits on the live Make Up tab (sheetId `2128282752`) only, then an import of Make Up only to the Convex **dev** deployment `brilliant-badger-615`. Gold, Silver and the hidden "Read me" tab were not touched; no sharing, dropdown, column, filter or number-format change. Silver and Gold were not imported. No ElevenLabs call. Tenant names are shown as "[name]"; emails are not shown.

### User decisions applied

1. Delia's answers accepted: M-001 owner email; M-013 (2028-10-31), M-084 (2027-11-30), M-097 (2027-12-31) as renewals; M-016 new lease end 2027-12-31; M-084 Floor 1, M-085 Floor 2. No data cell was changed (her values were already in the cells).
2. M-055 / M-057 (66 Second St units 6 and 8): a real move. M-055 keeps the name she entered, M-057 keeps its new name, and M-057 was re-imported.
3. Gas paid by stays "-" on the electric-heated units M-030, M-037, M-040, M-041, M-099. No question was added.
4. Stale Notes cleaned (below).
5. Provenance and flags on the 7 resolved rows (below).
6. Formatting: no padding or case problem was left on the tab (all data columns and Manager feedback scanned: 0 leading/trailing/double spaces; every dropdown column uses one spelling). The two known address formats ("86 - 88 4th St. Waterford", "17 Harrison Ave") were left as they are, as decided on 2026-11-03, because changing Property text renames the property.

### How it was written

- Snapshot before the write: `scratchpad/makeup/fix/snapshot_before_2026-11-04_grid.json` (values, types, number formats and backgrounds of A1:AV102). It was cell-for-cell identical to the second check's snapshot (`live_1633.json`), so every target cell matched this report and **no cell was skipped**.
- The first guarded `batchUpdate` was refused because the file's revision id had moved (an edit elsewhere in the file; see "Mirror" below). Nothing was written. The tab was read again (`snapshot2_grid.json`): 0 of 4,848 cells and 0 backgrounds differed from the first snapshot, so the same 67 requests were sent again, guarded by the new revision id, and applied atomically.
- After-read (`after_2026-11-04_grid.json`): exactly the **46 planned value cells** changed and no other; **175 background cells** changed, all planned; number formats unchanged; no row has "Please check" text any more. Plan and requests: `plan.json`, `requests.json` in the same folder; builder `scratchpad/makeup/scripts/build_fix.py`.

### Cells changed (46)

**Please check cleared (7):** M-001, M-013, M-016, M-055, M-084, M-085, M-097.

**Source: Manager feedback (7).** Make Up format `Delia, in the sheet (read 2026-11-04): <what she changed>`. Where the cell already held her 2026-11-03 answer, the new line was appended after a line break (Silver convention), so the earlier answer is kept:
- M-001: (kept `... (read 2026-11-03): Ave`) + `owner email added in Owners Email Address (was empty)`
- M-013: `Lease end changed from 2026-10-31 to 2028-10-31 (accepted as renewed, user decision 2026-11-04)`
- M-016: (kept `... (read 2026-11-03): Lane - She is renewing for January`) + `Lease end changed from 2026-09-30 to 2027-12-31 (new lease end after the January renewal, accepted, user decision 2026-11-04)`
- M-055: `tenant name entered in Tenants (was "-"); it is the name that was on unit 8 (M-057), which now has a new tenant. Accepted as a real move (user decision 2026-11-04)`
- M-084: (kept `... (read 2026-11-03): Fixed`) + `Floor set to 1 (was "-"); Lease end changed from 2026-10-31 to 2027-11-30 (accepted as renewed, user decision 2026-11-04)`
- M-085: (kept `... (read 2026-11-03): Fixed`) + `Floor set to 2 (was "-")`
- M-097: `Lease end changed from 2026-10-31 to 2027-12-31 (accepted as renewed, user decision 2026-11-04)`

M-057's Manager feedback (her 2026-11-03 "Fixed") was not changed; the move is recorded on M-055.

**Notes (32 cells), before → after.** Only the out-of-date part was removed or updated; the manager notes and every other topic were kept. "Lease end: Date has passed (as of 2026-10-29); " was removed on 26 rows where the manager note now says what happened; each kept "new lease end" date was checked against Lease end and each "now month-to-month" against Lease type (all agree).
- M-016: `Lease end: Date has passed (as of 2026-10-29); Manager: tenant renewing in January (new end date to confirm)` → `Lease end: Manager: tenant renewing in January, new lease end 2027-12-31`
- M-017, M-029: `Lease end: Date has passed (as of 2026-10-29); Manager: renewed, new lease end 2027-06-30` → `Lease end: Manager: renewed, new lease end 2027-06-30`
- M-030: same, 2027-07-31. M-039: same, 2027-02-28. M-044, M-050, M-083: same, 2027-11-30. M-057, M-065, M-077, M-079, M-101: same, 2027-12-31.
- M-035: `Lease end: Date has passed (as of 2026-10-29); Manager: renewed, new lease end 2027-05-31; Manager: first names only, kept as is (user decision)` → `Lease end: Manager: renewed, new lease end 2027-05-31; Manager: first names only, kept as is (user decision)`
- M-027, M-031, M-032, M-038, M-041, M-064, M-067, M-068, M-070, M-098: `Lease end: Date has passed (as of 2026-10-29); Manager: now month-to-month` → `Lease end: Manager: now month-to-month`
- M-043: `Lease end: Date has passed (as of 2026-10-29); Other: "COM" is printed in an unlabeled column next to the unit; Manager: now month-to-month` → `Lease end: Manager: now month-to-month; Other: "COM" is printed in an unlabeled column next to the unit` (topic order kept: Lease end before Other)
- M-053: `Lease end: Date has passed (as of 2026-10-29); Not a month-end date; Manager: now month-to-month` → `Lease end: Manager: now month-to-month` (the old date is gone, Lease end is "-")
- M-099: `Lease end: Date has passed (as of 2026-10-29); Not a month-end date; Manager: vacant, not rent ready` → `Lease end: Manager: vacant, not rent ready`
- M-034: `Lease end: Not a month-end date; Manager: corrected to 2026-12-31` → `Lease end: Manager: corrected to 2026-12-31`
- M-084: `Other: Laundry "H/K": Meaning unknown (maybe a typo for H/U); Manager: H/K = hookups in unit` → `Lease end: Manager: renewed, new lease end 2027-11-30; Laundry: manager confirmed H/K = hookups in unit` (laundry wording as on M-006; renewal note added, 2026-11-03 convention)
- M-085: same laundry note → `Laundry: manager confirmed H/K = hookups in unit`
- M-013 (empty) → `Lease end: Manager: renewed, new lease end 2028-10-31`; M-097 (empty) → `Lease end: Manager: renewed, new lease end 2027-12-31` (renewal notes added, 2026-11-03 convention)

Kept as is because they describe the source correctly: M-005 (`Invalid date "9/31/27" in source; Manager: corrected to 2027-09-30`), M-009, M-045, M-046, and the other manager notes.

**Highlight removed (175 background cells)** on the 7 resolved rows, the same way as the 2026-11-03 fixes: flag yellow cleared on A–C and E–Z (Y–Z included), Correct?/Corrections (AA–AB) set back to the pale `FFFBEA`. Column D (hidden Phone Number) was not touched; it keeps the background it had, as on M-006, M-022, M-033 and the other rows resolved on 2026-11-03. Correct? (Y/N) and Corrections values were not touched.

### Mirror

`518-unit-rosters-normalized.xlsx` was replaced with a fresh xlsx export of the whole live Sheet (Drive export, all tabs). The previous mirror (16:33, after the Gold import) is backed up at `scratchpad/makeup/import/mirror_backup_before_makeup_import_2026-11-04.xlsx`; the export is also at `scratchpad/makeup/import/export/live_2026-11-04_makeup.xlsx`. Against the backup: Make Up 46 cells (exactly the edits above), Gold 0, Read me 0, **Silver 1**: S-235 (1146 Madison Avenue) Owners Email Address changed from "v" to an address. That edit was made by someone else in the Silver tab between the snapshot and the write (it is the revision change that refused the first write). It is in the mirror now but **Silver was not imported**.

### Dry run, import, verify

Command (from `dashboard/`, same org and admin stand-in as before, `intendedAssetManagerName` "Delia"): `python3 -I scripts/roster/import_roster.py dry-run|apply|verify --category make_up --skip-flagged --org <orgId> --deployment brilliant-badger-615` (plus `--asset-manager <admin usersId>` for dry-run/apply). `--skip-flagged` skipped **0 rows**. Script: `scratchpad/makeup/scripts/imp_makeup.sh`.

- **Batched dry run** (2 batches): 0 errors, 101 rows, 32 properties, rule-available 9 = `EXPECTED_AVAILABLE["make_up"]`.
- **Single-batch dry run** (fits for Make Up, not truncated): same totals; the re-run in the same transaction changed nothing; lossless read-back 101 rows, 4,444 cells, **0 differences**; 49 units offered org-wide. Probes: 19 Spring St 1 and 2, 218 North 4th St 1, 86 - 88 4th St 86-1 and 17 Harrison Ave 1F match. "Broad Street Waterford" is ambiguous across 3 properties (expected). "9 South Main Street Mechanicville" 1-1 now returns suggestions "9 Main Street" (Gold) and "9 S. Main St" instead of a match; this comes from the Gold import, not from this one.
- **Apply** (2 batches): properties 3 created (1 N. Liberty Ave, 5 Museum Lane, 219 Saratoga Ave), 29 unchanged; units 7 created, 94 unchanged, 0 updated; residents 8 created, 1 deactivated, 85 unchanged; source rows 7 created, 27 updated (the 27 already-imported rows whose Notes were cleaned, M-057 included, which also has the new tenant), 67 unchanged; available 9. A dry run afterwards reported everything unchanged.
- **Verify:** lossless 101 sheet rows vs 101 DB rows, 4,444 cells, **0 differences**; available set equals `EXPECTED_AVAILABLE["make_up"]`. Make Up on dev: 32 properties, 101 units, 101 source rows; Occupied 91, Vacant 9, Vacant – not rent ready 1; Residential 95, Commercial 3, Office 3; Fixed 51, Month-to-month 40, "-" 9, Vacant 1; roster residents 93 active, 1 inactive; owners on 32 of 32 properties.

### 66 Second St, Waterford (residents on dev, names not shown)

| | Units | Active roster residents | Inactive |
|---|---|---|---|
| Before | 10 (unit 6 not imported) | 8 | 0 |
| After | 11 | 9 | 1 |

- Unit 6 (M-055): created, Occupied, one active resident (the name she entered), lease end 2027-06-30.
- Unit 8 (M-057): one active resident with the new name (lease end 2027-12-31). The old record (the name that moved to unit 6) is **deactivated**, not active: `syncRosterResidents` never deletes, it sets `active: false` and drops the record's phones from lookup (it had none). So no stale active resident is left on unit 8; the history row stays.
- Units 5 and 7 are still the two available units.

### Org totals on dev afterwards

147 properties, 575 units, **49 available**: Silver 9, Make Up 9, Gold 31 (Silver had been set to 9 on dev by hand).

### Still open (not changed here)

- M-057 phone (area code 528) and the other Phone column oddities (phones are not imported).
- If Delia later says the electric-heated units have gas, M-030, M-037, M-040, M-041, M-099 need a re-import.
