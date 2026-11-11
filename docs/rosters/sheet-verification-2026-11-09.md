# Sheet verification, 2026-11-09 (Gold, Silver, Make Up)

Read-only check of the live Google Sheet `1BtIdb_vUprOjXxg1Xk4cBiqcDQL0tWXa8Qd_-63lApg`, tabs Gold (sheetId `284976210`), Silver (`1139911461`) and Make Up (Delia) (`2128282752`). The user says the managers have finished their updates, so this report lists every change since our last writes on 2026-11-04 and checks each one against our conventions. Nothing was written to the Sheet, nothing was imported, and no Convex command, code change or mirror refresh was made. The hidden "Read me" tab was not used, apart from a hash check that it is unchanged (it is). Tenant names are shown as [name], owners as initials, and emails masked.

## 0. How it was read, and the baselines used

- **Access.** The Google Sheets connector was "not connected" and the Google Drive connector's session had expired. The Sheet is shared so that **anyone with the link can view it**: an unauthenticated read-only xlsx export (`/export?format=xlsx`) returned the whole file, and that export was used. See question Q1. Snapshot (values and cell fills of every tab): `scratchpad/verify_1109/dl/live_2026-11-09.xlsx` and `scratchpad/verify_1109/live_2026-11-09_grid.json`.
- **Baselines.** The session scratchpad files named in the brief (`owners/fill/`, `silver/owners_decisions/`, `makeup/fix/`) are gone: the scratchpad was empty. Fallbacks:
  - **Gold and Make Up:** `docs/rosters/518-unit-rosters-normalized.xlsx`, the mirror exported at 17:55 on 2026-11-04 after the Gold owners fill. It is the after-read state of both tabs, because neither tab was written again after that export.
  - **Silver:** the same mirror plus the documented owner-decision write (`silver-owners-verification-2026-11-04.md`, "Owner decisions applied 2026-11-04": 309 value cells and 151 rows × A–AB flag yellow), because the mirror was not refreshed after that write. The live tab differs from the mirror in **exactly** those 309 cells and 4,228 background cells, each one as documented. So the reconstruction is confirmed and the baseline is exact.
- **Structure (all three tabs):** headers identical to the baseline (48 columns), same Row IDs in the same order (Gold 205, Silver 275, Make Up 101), no new, deleted or reordered rows, dropdowns (data validations), freeze panes and autofilter unchanged. The export has no cell comments or notes. Note: Google comment threads may not be carried into an xlsx export, and the Drive connector could not be used to check them.
- **Mapping port.** A Python port of `rosterMapping.ts` (`mapRosterRow`, owner email parsing, `assertSameProperty`) and of `import_roster.py` (`read_tab`, `--skip-flagged`, `expected_available`), run with `python3 -I` on the live export: `scratchpad/verify_1109/scripts/port.py`. A simulation with the Gold blank cells set to "-" (a local copy only, `sim_gold_dash_fix.xlsx`) shows what the tab gives once the formatting fixes are made.

## 1. Summary

| Tab | Changed since 2026-11-04 | Import-ready now? | After the formatting fixes |
|---|---|---|---|
| Gold | 6 held rows only: 18 value cells + 168 background cells (Nina) | **No**: 5 rows fail the importer (blank Lease end; 2 also blank Tenants) | 0 errors. 205 rows, 59 properties, available **33** (expected list says 31) |
| Silver | **Nothing.** Nikki made no edit in the Sheet | Not until the 6 Nikki items are settled (151 rows still flagged) | Mapping is clean now: 0 errors, 56 properties, 9 available |
| Make Up (Delia) | **Nothing** | Yes (re-import is a no-op) | 0 errors, 32 properties, 9 available = expected |

## 2. Gold

### 2a. Every changed cell (all on the 6 held rows)

| Row | Unit | Column | Before → after |
|---|---|---|---|
| G-020 | 2 Prout Avenue 4 | Lease type | Fixed term → Month-to-month |
| G-020 | | Lease end | 2026-10-31 → *(empty)* |
| G-020 | | Please check | our question → *(empty)* |
| G-063 | 35 Viall Avenue 2 | Lease type | Fixed term → Month-to-month |
| G-063 | | Lease end | 2026-10-31 → *(empty)* |
| G-084 | 46 - 48 South Lake Avenue 10 | Lease type | Fixed term → Month-to-month |
| G-084 | | Lease end | 2026-10-31 → *(empty)* |
| G-113 | 109 Washington Street 3 | Status | Occupied → Vacant |
| G-113 | | Tenants | [name] → *(empty)* |
| G-113 | | Lease type | Fixed term → "-" |
| G-113 | | Lease end | 2026-10-31 → *(empty)* |
| G-113 | | Rent | 2000 → **1900** |
| G-113 | | Please check | our question → our question + " tenant is moved out " (her answer appended, trailing space) |
| G-134 | 166 2nd St 3 | Status | Occupied → Vacant |
| G-134 | | Tenants | [name] → *(empty)* |
| G-134 | | Lease type | Fixed term → **Vacant** |
| G-134 | | Lease end | 2026-10-31 → *(empty)* |
| G-136 | 166 2nd St 5 | Lease end | 2026-10-31 → **2027-10-31** (Lease type stays Fixed term) |

Backgrounds: the flag yellow (`FFF2CC`) was removed from A–AB on all six rows (28 cells each, 168 cells). Correct?/Corrections on these rows now have no fill. That is the same as 92 other Gold rows, so this is cosmetic only. No other Gold cell changed. Notes, Correct? (Y/N), Corrections and Source: Manager feedback are empty on all six rows, and Nina wrote nothing in them.

### 2b. Nina's answer per held lease, and whether the row is consistent

| Row | Her answer (from the data) | Flag text / highlight | Consistent? |
|---|---|---|---|
| G-020 | **Month-to-month** | Question cleared, highlight removed | Yes, apart from Lease end left empty instead of "-" |
| G-063 | **Month-to-month** | Question **still there**, highlight removed | Data yes (Lease end empty instead of "-"); flag not cleared |
| G-084 | **Month-to-month** | Question **still there**, highlight removed | Same as G-063 |
| G-113 | **Moved out** ("tenant is moved out" written in Please check) | Question + her answer, highlight removed | Status Vacant, Lease type "-" (the Gold convention for vacant rows) are right. Tenants and Lease end left empty instead of "-". Rent changed 2000 → 1900, unexplained (new asking rent?) |
| G-134 | **Moved out** (data only, no text) | Question **still there**, highlight removed | Status Vacant is right. Tenants and Lease end empty instead of "-". Lease type "Vacant" is a valid value, but every other vacant Gold row uses "-". Rent 1125 kept: is it the asking rent? |
| G-136 | **Renewed, new end 2027-10-31** | Question **still there**, highlight removed | Yes |

Because none of the six rows was ever imported (they were held), the moved-out tenants on G-113 and G-134 have no resident record on dev. Nothing needs to be deactivated.

### 2c. Mapping port (live tab as it is)

- All 205 rows: **5 errors**: `G-020, G-063, G-084, G-113, G-134: Lease end null must be text or "-"`. G-113 and G-134 would also fail next on `Tenants` (empty).
- `--skip-flagged` (the 5 rows with a question are skipped: G-063, G-084, G-113, G-134, G-136): **1 error** (G-020 Lease end). The current Gold command's `--expect-skipped G-020,...,G-136` would also stop, because G-020 is no longer flagged.
- After the dash fixes (simulated): 205 rows, **0 errors**, 59 properties, 199 roster residents (194 + 5). Available = **33**: the 31 in `EXPECTED_AVAILABLE["gold"]` plus **109 Washington Street 3 ($1,900)** and **166 2nd St 3 ($1,125)**, so Sarah would offer two more Gold units. `import_roster.py` stops when the rule result differs from `EXPECTED_AVAILABLE`, so a full import needs that list updated (a code change). With `--skip-flagged` after the fixes: 200 rows, 0 errors, 31 available (= expected).
- Owners: unchanged; identical across each property's units on 59/59 properties; 15 two-email cells, all valid with ", ".

### 2d. Formatting fixes needed (Gold)

1. Lease end empty → "-" on G-020, G-063, G-084, G-113, G-134 (spec: no empty cell in a derived data column; the importer refuses it).
2. Tenants empty → "-" on G-113, G-134.
3. G-134 Lease type "Vacant" → "-", to match the 40 other vacant Gold rows. Q5 asks first, because "Vacant" is a valid dropdown value.
4. Provenance, following the Make Up/Gold conventions, once the answers are accepted. Source: Manager feedback = `Nina, in the sheet (read 2026-11-09): <what she changed>` (for G-113 her text "tenant is moved out", trimmed). Notes add `Lease end: Manager: now month-to-month` (G-020, G-063, G-084) or `Lease end: Manager: renewed, new lease end 2027-10-31` (G-136). Clear Please check on the rows we accept. Highlight is already off.
5. Unchanged from before, info only: G-027 Notes has a trailing space (Nina's text, there since 2026-11-04). The double spaces in Source: LMAT / Source: G/E & T/L are verbatim from the PDF and stay.

## 3. Silver

### 3a. Changes

**None since our 2026-11-04 owner-decision write.** The live tab is identical, value for value and fill for fill, to the documented post-write state. Nikki changed no cell: no Please check, Correct? (Y/N), Corrections, Notes or Source: Manager feedback cell on any of the 151 flagged rows. All 151 rows still carry our "Please confirm: ..." note and the flag yellow on A–AB.

The message to Nikki (`questions-for-nikki-2026-11-04.md`) asked her to **reply to the message**, not to edit the Sheet. So her answers may exist outside the Sheet (Q7).

### 3b. The six Nikki items

| # | Properties | Status | Owner values in the Sheet now |
|---|---|---|---|
| 1 | B. B.: 1084 Wendell Ave, 1226 Wendell Ave, 1114 Union St, 1238 Union St, 1356 Union St, 1581 Van Vranken Ave (28 rows) | **Unanswered** (still flagged) | Name B. B.; emails "u\*\*\*@gmail.com, b\*\*\*@gmail.com" |
| 2 | 301 Green Street (17 rows) | **Unanswered** (still flagged) | Name "P. P. & P. S."; emails "p\*\*\*@yahoo.com, p\*\*\*@pvslaw.com" |
| 3 | 433 3rd Street, 1009 19th Street (spelling R. T.) | **Unanswered** (never flagged in the Sheet; asked only in the message) | Silver spelling kept; s\*\*\*@blockbuilderproperties.com |
| 4 | 1527 3rd Street (3 rows) | **Unanswered** (still flagged) | Name "J. S. & M. J. S."; email n\*\*\*@gmail.com |
| 5 | 15 Redburn properties (93 rows) | **Unanswered** (still flagged) | Name "E. Y. J." (was "Redburn"); email e\*\*\*@redburndev.com |
| 6 | 182, 184, 188, 190 Remsen Street (10 rows) | **Unanswered** (still flagged) | E. M., e\*\*\*@manulifeam.com (unchanged) |

Owner checks: values are identical across each property's units on 56/56 properties. Every email is valid and lowercase. Both two-email forms use ", " exactly (7 properties). No name is padded or longer than 120 characters.

### 3c. Mapping port

- All 275 rows: **0 errors**, 56 properties, 306 roster residents, available 9 = `EXPECTED_AVAILABLE["silver"]` (unchanged).
- `--skip-flagged`: 124 rows, 151 skipped, 29 properties, rule-available **8**. 184 Remsen Street 2 is on a flagged row, so the importer would **stop** with "availability rule gives ... expected ..." (8 ≠ 9). A `--skip-flagged` Silver import is not possible as things stand.
- Flagged rows remaining: 151.

### 3d. Formatting fixes needed (Silver)

None. The only double spaces are the verbatim unit labels S-096 "2nd  Front", S-097 "2nd  rear" and S-155 "A  Basement ( F", kept on purpose (renaming them would rename units).

## 4. Make Up (Delia)

- **No change** since the 2026-11-04 import: 0 value cells, 0 backgrounds, same header, rows and dropdowns. Please check is empty on all 101 rows.
- Mapping port: 101 rows, **0 errors**, 32 properties, 93 roster residents, available 9 = `EXPECTED_AVAILABLE["make_up"]`. Flagged rows: 0.
- Formatting: no padding in data columns. Delia's own Corrections text on M-006 and M-009 has a trailing space (a review column, never imported; leave it).

## 5. What a re-import would change on dev (per tab, for approval)

Current dev, from the 2026-11-04 reports: 147 properties, 575 units, 49 available (Gold 31, Silver 9, Make Up 9). Gold has 199 rows imported (the 6 held rows are not on dev). Silver has the owners from before the owner decisions.

**Gold** (only after the dash fixes; otherwise the import stops on G-020 or on all five rows):
- *Option A, all 205 rows* (Please check cleared on the accepted rows, or `--include-rows`), plus `EXPECTED_AVAILABLE["gold"]` updated to 33: properties 0 created, 0 updated (the six rows' property columns equal their buildings'). Units **6 created** (G-020, G-063, G-084, G-113, G-134, G-136), 199 unchanged. Residents **5 created** (G-020 two names, G-063, G-084, G-136 one each; G-113 and G-134 are vacant, so none). Source rows **6 created**. Available Gold **31 → 33** (+109 Washington Street 3 at $1,900, +166 2nd St 3 at $1,125). Org: 575 → 581 units, 49 → 51 available.
- *Option B, `--skip-flagged`* (as the tab stands after the dash fixes: only G-020 unflagged): unit G-020 created, 2 residents created, 1 source row created. Available stays 31. `--expect-skipped` must become `G-063,G-084,G-113,G-134,G-136`. Org: 576 units, 49 available.

**Silver:**
- *All 275 rows, no `--skip-flagged`* (only if the owner decisions are accepted without Nikki): **23 properties updated**, owner fields only: B. B. ×6 (second email added; `ownerEmail`, the first address, is unchanged), 301 Green Street (name + second email; first email unchanged), 1527 3rd Street (name), 15 Redburn properties (name). Remsen Street: no change. Units, residents and source rows: 0 changed (Please check is never imported; Notes and Manager feedback are unchanged). Available 9 (unchanged).
- *`--skip-flagged`*: stops (available 8 ≠ 9, see 3c). If it were forced, it would change nothing on dev (the 124 unflagged rows are already identical).
- *After Nikki answers:* the changes depend on her answers. Each answer is an owner-field update on the affected properties only.

**Make Up:** a re-import changes nothing (0 created, 0 updated; 49 available org-wide unchanged). No re-import is needed.

## 6. Questions for Umar

1. **Sheet sharing.** The Sheet can be read by anyone with its link, without signing in (tenant names, owner names and emails, the hidden Make Up phone column). (a) Restrict it to named people (the managers, you, Pat); (b) keep link sharing as is. Also, the Google Sheets connector is disconnected and the Drive connector's session has expired. Reconnecting them is needed for any future write.
2. **G-020** (MTM, Nina cleared the question herself). (a) Accept as month-to-month: Lease end "-", provenance note, import; (b) ask Nina to confirm.
3. **G-063, G-084** (data now MTM, but our question text is left and the highlight removed). (a) Treat the data as her answer: Lease end "-", clear Please check, import; (b) ask Nina to confirm and clear the flag herself.
4. **G-136** (renewed to 2027-10-31, question left). (a) Accept: clear Please check, add the renewal note, import; (b) ask Nina.
5. **G-134** (166 2nd St 3, moved out, from the data only). (a) Accept as Vacant, Tenants "-", Lease end "-", and Lease type "Vacant" → "-" (Gold convention); (b) the same but keep Lease type "Vacant"; (c) ask Nina first.
6. **G-113 and G-134 rent and readiness.** Accepting them as "Vacant" makes Sarah **offer** them: 109 Washington Street 3 at **$1,900** (Nina lowered it from $2,000; reason not given) and 166 2nd St 3 at **$1,125** (the old tenant's rent, kept). (a) Treat both rents as asking rents and both units as rent ready: offered, `EXPECTED_AVAILABLE["gold"]` becomes 33 (code change); (b) set them "Vacant – not rent ready" until Nina confirms: not offered, stays 31; (c) import as Vacant but ask Nina to confirm the asking rents before Sarah goes live.
7. **Silver: Nikki has not answered in the Sheet.** We asked her to reply to the message. (a) Check whether she replied by email or text, and pass the reply on; (b) chase her; (c) accept our 2026-11-04 decisions without her: clear the 151 flags and import all 275 rows (23 properties' owners change); (d) revert the 309 cells to her original values and drop the questions.
8. **Silver item 3** (R. T. spelling, 433 3rd Street / 1009 19th Street). It is not flagged in the Sheet, so a Sheet-only review will never surface it. (a) Leave it to her message reply; (b) add a Please check flag on those rows.
9. **Silver import while waiting.** A `--skip-flagged` Silver import would stop (184 Remsen Street 2 is flagged, so 8 ≠ 9 available). (a) Do no Silver import until item 7 is settled (recommended by the data: nothing on dev would change anyway); (b) allow a temporary `EXPECTED_AVAILABLE` exception (code change).
10. **Gold import shape.** (a) Option A (all 205 rows, after the decisions above); (b) Option B (only G-020 now, the rest after Nina confirms).

Not decided here: none of the above was applied. The formatting fixes in 2d need your approval and a working Sheets connection.

## 7. Revert and import 2026-11-09

Approved by the user. Dev deployment `brilliant-badger-615` only. No ElevenLabs call, no commit. Tenant names and owner values are not shown.

**Step 1: Silver reverted (done).** Nikki confirmed her original owner entries are correct, so everything added from Nina's owners list was reverted on the live Silver tab (sheetId `1139911461`). Baseline: the mirror exported 2026-11-04 17:55, before the owner decisions. Before writing, all 309 changed cells (Owners Name 113, Owners Email Address 45, Please check 151) were checked against the 2026-11-04 write: every one held our value, 0 skipped. One atomic `batchUpdate` (43 `repeatCell` requests, guarded by the revision id of the snapshot; values and backgrounds only): Owners Name and Owners Email Address back to the mirror's values on the 113 / 45 cells that had changed, Please check cleared on all 151 rows, flag yellow removed from A-AB and each row's A-AB backgrounds restored to its own original from the mirror (all three patterns exist on unflagged Silver rows: no fill, white in Owners Email Address, pale tint `FFFBEA` on Correct? / Corrections; 20 of the 151 rows had the white cell). Remsen Street rows: owners unchanged, only note and highlight cleared. After-read and diff: all 275 rows x 48 columns equal the mirror's Silver values (0 differences), 0 yellow cells left, 4,228 background cells changed (151 rows x A-AB, nothing outside), and every background equals the mirror's. Snapshots: `scratchpad/run_1109/silver_live_grid_snapshot.json` and `silver_live_grid_after.json`.

**Step 2: Gold, Nina's 6 lease answers accepted (done).** Live Gold tab (sheetId `284976210`), one atomic `batchUpdate` guarded by the revision id of the read before it, 19 value cells, no background change (no flag yellow was left on the six rows). G-020, G-063, G-084: month-to-month kept, Lease end "-". G-113 and G-134: moved out, Vacant; Lease end "-", Tenants "-"; G-134 Lease type "Vacant" -> "-"; rents 1900 and 1125 kept as asking rents (these two units will be offered). G-136: renewed, Lease end 2027-10-31 kept. Source: Manager feedback = `Nina, in the sheet (read 2026-11-09): <answer>` on all six (answers: "month-to-month" x3, "tenant is moved out", "moved out", "renewed, new lease end 2027-10-31"). Please check cleared on G-063, G-084, G-113, G-134, G-136 (G-020 was already empty). Re-read and diff: exactly these 19 cells changed, 0 background changes, 0 Please check text left on the tab.

**Step 3: import (done, after the user refreshed the Convex login).**
- `import_roster.py`: "109 Washington Street 3" and "166 2nd St 3" added to `EXPECTED_AVAILABLE["gold"]` (now 33 units).
- Mirror: backed up (`scratchpad/run_1109/mirror_backup_before_refresh_2026-11-09.xlsx`) and replaced with a fresh full Drive xlsx export of the live Sheet. Against the old mirror: Read me 0, Silver 0, Make Up 0 differences; Gold 28 value cells and 168 fills (Nina's edits and these writes). The export's Silver and Gold equal the live after-reads.
- The first attempt failed on Convex access ("You don't have access to the selected project", expired CLI login). After `npx convex login`, a read-only `rosterImport:stats` call on `brilliant-badger-615` worked.
- **Gold** (`--skip-flagged`, batched, 4 batches): dry run 0 errors, 205 rows, 0 skipped, 59 properties, rule-available 33. Predicted: properties 0 created / 0 updated, units 6 created / 199 unchanged, residents 5 created / 0 deactivated, source rows 6 created. Apply (4 batches) gave exactly that (the six held rows G-020, G-063, G-084, G-113, G-134, G-136; G-113 and G-134 are vacant, so no resident). `verify`: 205 sheet rows, 205 DB rows, 9,020 cells, **0 differences**; available set equals `EXPECTED_AVAILABLE["gold"]` (33, now including 109 Washington Street 3 and 166 2nd St 3); 199 roster residents active, none inactive.
- **Silver** (`--skip-flagged`, batched, 5 batches): dry run 0 errors, 275 rows, 0 skipped, 56 properties, rule-available 9; properties, units, residents and source rows all unchanged (0 created, 0 updated, 0 deactivated), so nothing was applied. `verify`: 275 rows, 12,100 cells, **0 differences**.
- **Make Up** (verify only): 101 rows, 4,444 cells, **0 differences**.
- **Org totals on dev:** 147 properties, 581 units, **51 available** (Gold 33, Silver 9, Make Up 9).
