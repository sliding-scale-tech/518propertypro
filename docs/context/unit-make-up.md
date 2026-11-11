# Unit Make Up (Delia Management Properties / Delia - Rentals unit roster)

**Source files:** `Unit Make Up.docx`, `Unit Make Up.pdf` (repo root). Same content in two formats; see "Docx vs PDF" below.

## What this doc is

Despite the name, this is NOT a unit turnover / make-ready process. It is a scanned **unit roster / rent roll** for the client's portfolio ("Delia Management Properties" on page 1, "Delia - Rentals" on pages 2-5). For every rentable unit it lists the property address, unit label, floor, bed/bath count, monthly rent, lease expiration (or month-to-month / at-will / vacant status), whether the unit is heated by gas or electric, a "Who" code (T or O), and washer/dryer (W/D) status. The final line gives a total monthly rent of $106,689.00. This is the "unit make up" (the composition of the portfolio) and is the seed data for the units, properties, leases and rent figures in 518 Property Pro. The PDF is a scan (5 landscape pages); the docx is an OCR conversion of the same scan, with OCR errors.

## Key facts & rules

- Scope: 5 PDF pages, 101 unit rows (15 on page 1 under "Delia Management Properties", 86 on pages 2-5 under "Delia - Rentals"). 32 distinct property addresses (53 - 57 Broad and 536 3rd each continue onto the next page).
- Columns (every row): Property, Unit, Floor #, Bed/Bath, Rent, Lease Exp, Gas/Electric, Who, W/D.
- Geography: page 1 properties are in Wynantskill, Troy, Albany and Mechanicville (listed as "Mechaniville" in the source). Pages 2-5 have no city; addresses are street only.
- Bed/Bath is written `beds/baths`, e.g. `2/1`. `0/1` means studio / zero bedrooms (includes offices and COM units).
- Lease Exp values are not only dates. Statuses seen: `M-2-M` or `M2M` (month-to-month; both spellings appear), `At Will`, `Vacant`, a blank cell (not stated), and `---` / `-------` (no rent or lease, used for two units in 60 - 62 Broad). The model must allow a non-date lease-end value and a missing lease-end.
- Gas/Electric values seen: `Gas`, `Electric`, `Both`. Gas is the vast majority.
- "Who" values seen: `T` and `O`. Meaning is not defined in the document. Inferred (NOT confirmed): T = tenant, O = owner, probably who pays/holds the utilities. `O` appears only for 66 Second St (all 11 units), 536 3rd (all 4 units) and the two no-rent units at 60 - 62 Broad. Blank for 53 - 57 Broad unit 1R. Confirm with the client before relying on it.
- W/D values seen: `No`, `BLDG` (building laundry, inferred), `H/U` / `H/U In unit` / `H/U In Unit` (hook-up, inferred, in unit), `H/K` (probably hook-ups/kitchen; unclear, inferred), `W/D` (has washer/dryer, inferred). Capitalisation and spacing are inconsistent in the source ("In unit" vs "In Unit"). Normalise on import but keep the raw value.
- `COM` appears in a separate column on page 3 next to units 6, 7 (53 - 57 Broad) and Office, 62-1 (60 - 62 Broad). Inferred: commercial unit. Not defined in the doc.
- Pages 3 and 5 start with units that have no property label (the label was on the previous page). They are 53 - 57 Broad (3F, 3R, 6, 7, Fl 3) and 536 3rd (2F, 2R). Do not import them as property-less units.
- "Total Monthly" = $106,689.00. Verified by summing the rent column: this equals the sum of pages 2-5 ONLY. The 15 units on page 1 (Delia Management Properties, $19,785.00 rent) are NOT included in the total. Overall rent on all five pages would be $126,474.00. The two 60 - 62 Broad units with no rent (`---`) add nothing to the sum. Units with expired lease dates are still counted. The Vacant unit on page 1 (169 Myrtle Ave unit 2) carries a rent of $1,650.00.
- Data-quality flags a developer must not paper over: `9/31/27` (24-2 Crockett Ave) is not a real date (September has 30 days); several lease dates are already in the past relative to 2026-10-28 (e.g. 21 William St unit 2 `3/31/25`, 38 Warsaw `4/30/25` and `6/30/25`, 1502 7th unit 2 `6/1/25`); 17 Harrison Ave 2F is `0/1`; 218 North 4th and 219 Saratoga have no floor numbers; 19 Newark unit 1, 66 Second St units 5 and 7, 152 Main unit 2, 182 Hill St unit 2, 218 North 4th unit 1 and 536 3rd unit 1R have blank lease expiry; 53 - 57 Broad 1R has blank Who and W/D.
- Names are exactly as in the source (e.g. "Mechaniville", "Elsworth", "Vanderheyden", "Fl 3", "1 (R)", "2 (L)"). Do not auto-correct IDs or labels; correct only in display layers, if at all.
- Rent values are whole-dollar USD with `.00`. Rent ranges from $750.00 to $1,900.00.
- No contacts, tenant names, phone numbers, SMS rules, process steps, checklists, roles, prices other than rent, or timelines appear in this document.

## Docx vs PDF

The two files are the same document. The PDF is a scanned image (5 pages), the docx is an OCR conversion of that scan (text laid out in text boxes). All content in the docx is also in the PDF; the docx adds nothing. The docx has OCR damage and was NOT used as the primary source; the PDF values were transcribed. Differences found:

- Docx has OCR errors: "H/W In unit" for 17 Harrison Ave 1R (PDF: "H/U In unit"); `$1.300.00` for 81 Elsworth unit 2 (PDF: `$1,300.00`); `$1,195,00` for 9 S. Main St 2-4 (PDF: `$1,195.00`); `$1,900,00` for 218 North 4th unit 2; "NNN -" noise near 53 - 57 Broad; stray tokens such as "22", "55", "222", "EF", "O OFFE", "P.", "FF".
- Docx lost or scrambled some cells (floor numbers, W/D, Who, lease dates) in places because of the text-box layout, for example 66 Second St unit 6, 133 North 3rd, 523 Central Ave and 53 - 57 Broad. The PDF image is clear in those spots.
- Docx heading "86-88 4th" vs PDF "86 - 88 4th". Docx 66 Second St unit 11 Who shown as a lowercase "о". Docx page 3 has ".COM" for unit 7. No substantive content differences.

## Full content (transcribed from the PDF)

Column legend (as written in the source header): Property | Unit | Floor # | Bed/Bath | Rent | Lease Exp | Gas/Electric | Who | W/D. Blank cells in the source are left blank. Where a property name is blank in a row, the row belongs to the property above it.

### Page 1 - "Delia Management Properties"

| Property | Unit | Floor # | Bed/Bath | Rent | Lease Exp | Gas/Electric | Who | W/D |
|---|---|---|---|---|---|---|---|---|
| 1 N. Liberty, Wynantskill | 1 | 1 | 2/1 | $1,650.00 | 2/28/27 | Gas | T | H/U |
| 22-24 Crockett Ave, Troy | 22-1 | 1 | 2/1 | $1,350.00 | 7/31/27 | Gas | T | No |
|  | 22-2 | 2 | 3/1 | $1,500.00 | 10/31/27 | Gas | T | No |
|  | 24-1 | 1 | 2/1 | $1,350.00 | M-2-M | Gas | T | No |
|  | 24-2 | 2 | 3/1 | $1,650.00 | 9/31/27 | Gas | T | No |
| 19 Spring St, Troy | 1 | 1 | 2/1 | $950.00 | M-2-M | Gas | T | H/K |
|  | 2 | 2 | 3/1 | $1,100.00 | M-2-M | Gas | T | No |
| 169 Myrtle Ave, Albany | 1 | 1 | 3/1 | $1,650.00 | 8/31/27 | Gas | T | No |
|  | 2 | 2 | 3/1 | $1,650.00 | Vacant | Gas | T | No |
| 9 S. Main St, Mechaniville | 1-1 | 1 | 4/1 | $1,695.00 | 4/30/27 | Gas | T | No |
|  | 1-2 | 1 | 3/1 | $1,395.00 | 4/30/27 | Gas | T | No |
|  | 2-1 | 2 | 2/1 | $875.00 | M-2-M | Gas | T | No |
|  | 2-2 | 2 | 1/1 | $875.00 | 10/31/26 | Gas | T | No |
|  | 2-4 | 2 | 2/1 | $1,195.00 | 11/30/27 | Gas | T | No |
|  | 3 | 3 | 1/1 | $900.00 | 9/30/27 | Gas | T | No |

### Page 2 - "Delia - Rentals"

| Property | Unit | Floor # | Bed/Bath | Rent | Lease Exp | Gas/Electric | Who | W/D |
|---|---|---|---|---|---|---|---|---|
| 5 Museum | 1 (R) | 1 | 2/1 | $1,475.00 | 9/30/26 | Gas | T | No |
| 7 Museum | 2 (L) | 1 | 3/1 | $1,750.00 | 6/30/26 | Gas | T | No |
| 17 Harrison Ave | 1F | 1 | 3/1 | $1,075.00 | M2M | Gas | T | H/U In unit |
|  | 2F | 2 | 0/1 | $925.00 | M2M | Gas | T | No |
|  | 1R | 1 | 3/1 | $950.00 | M2M | Gas | T | H/U In unit |
|  | 2R | 2 | 2/1 | $1,350.00 | 6/30/27 | Gas | T | No |
| 19 Newark | 1 | 1 | 2/1 | $1,250.00 |  | Gas | T | No |
|  | 2 | 2 | 2/1 | $1,250.00 | 5/31/27 | Gas | T | No |
| 21 Vanderheyden | 1 | 1 | 1/1 | $1,050.00 | 01/31/27 | Gas | T | BLDG |
|  | 2 | 2 | 3/1 | $1,350.00 | M2M | Gas | T | H/U In Unit |
| 21 William St | 1 | 1 | 4/1 | $1,417.00 | At Will | Gas | T | H/U In Unit |
|  | 2 | 2 | 4/1 | $1,730.00 | 3/31/25 | Gas | T | H/U In Unit |
|  | Basement | B | 1/1 | $1,050.00 | At Will | Gas | T | BLDG |
| 26 Knight St | 1 | 1 | 2/1 | $1,400.00 | 6/30/26 | Gas | T | BLDG |
|  | 2 | 2 | 2/1 | $1,300.00 | 7/31/26 | Electric | T | BLDG |
| 38 Warsaw | 1 | 1 | 2/1 | $1,100.00 | 4/30/25 | Gas | T | No |
|  | 2 | 2 | 2/1 | $1,660.00 | 6/30/25 | Gas | T | No |
| 51 Broad | Office | 1 | 0/1 | $1,000.00 | 11/30/26 | Gas | T | No |
|  | 2 | 2 | 2/1 | $1,350.00 | 12/26/26 | Electric | T | H/U In Unit |
|  | 3 | 3 | 2/1 | $1,350.00 | 5/31/26 | Electric | T | H/U In Unit |
| 53 - 57 Broad | 1R | 1 | 0/1 | $1,000.00 |  | Gas |  |  |
|  | 2E | 2 | 1/1 | $950.00 | M2M | Electric | T | No |
|  | 2R | 2 | 1/1 | $1,200.00 | 5/31/26 | Gas | T | No |
|  | 2W | 2 | 1/1 | $950.00 | 2/28/26 | Gas | T | No |

### Page 3 - "Delia - Rentals"

| Property | Unit | Floor # | Bed/Bath | Rent | Lease Exp | Gas/Electric | Who | W/D |
|---|---|---|---|---|---|---|---|---|
| 53 - 57 Broad (continued; property name not repeated in the scan) | 3F | 3 | 1/1 | $1,300.00 | At Will | Electric | T | No |
|  | 3R | 3 | 0/1 | $1,050.00 | 7/31/26 | Electric | T | No |
|  | 6 [COM] | 1 | 0/1 | $1,000.00 | 12/31/27 | Gas | T | No |
|  | 7 [COM] | 1 | 0/1 | $1,000.00 | 2/28/25 | Gas | T | No |
|  | Fl 3 | 3 | 1/1 | $1,200.00 | 2/28/26 | Gas | T | No |
| 60 - 62 Broad | 1R | 1 | 0/1 | --- | ------- | Gas | O | No |
|  | Office [COM] | 1 | 0/1 | --- | ------- | Gas | O | No |
|  | 60-2 | 2 | 4/1 | $1,600.00 | At Will | Gas | T | H/U In Unit |
|  | 62-1 [COM] | 1 | 0/1 | $750.00 | At Will | Gas | T | No |
|  | 62-2 | 2 | 1/1 | $1,100.00 | M2M | Gas | T | H/U In Unit |
| 66 Second St | 1 | 1 | 1/1 | $1,050.00 | 11/30/25 | Gas | O | BLDG |
|  | 2 | 1 | 1/1 | $850.00 | At Will | Gas | O | BLDG |
|  | 3 | 2 | 1/1 | $1,200.00 | At Will | Gas | O | BLDG |
|  | 4 | 2 | 1/1 | $1,300.00 | 4/28/26 | Gas | O | BLDG |
|  | 5 | 2 | 0/1 | $1,250.00 |  | Gas | O | BLDG |
|  | 6 | 2 | 1/1 | $1,350.00 | 6/30/27 | Gas | O | BLDG |
|  | 7 | 1 | 1/1 | $1,400.00 |  | Gas | O | BLDG |
|  | 8 | 1 | 1/1 | $1,260.00 | 11/30/25 | Gas | O | BLDG |
|  | 9 | 3 | 0/1 | $1,250.00 | 2/28/27 | Gas | O | BLDG |
|  | 10 | 2 | 1/1 | $1,200.00 | 2/28/27 | Gas | O | BLDG |
|  | 11 | 2 | 1/1 | $1,230.00 | M2M | Gas | O | BLDG |
| 81 Elsworth | 1 | 1 | 2/1 | $1,000.00 | At Will | Gas | T | W/D |
|  | 2 | 2 | 2/1 | $1,300.00 | 2/28/27 | Gas | T | H/U In Unit |
| 86 - 88 4th | 86-1 | 1 | 2/1 | $900.00 | At Will | Both | T | No |
|  | 86-2 | 2 | 2/1 | $1,407.00 | 7/31/26 | Gas | T | H/U In Unit |
|  | 88-1 | 1 | 2/1 | $1,400.00 | 8/31/26 | Gas | T | No |
|  | 88-2 | 2 | 2/1 | $1,600.00 | 7/31/27 | Gas | T | No |

### Page 4 - "Delia - Rentals"

| Property | Unit | Floor # | Bed/Bath | Rent | Lease Exp | Gas/Electric | Who | W/D |
|---|---|---|---|---|---|---|---|---|
| 119 South 2nd | A | 2 | 1/1 | $1,150.00 | 7/31/26 | Gas | T | No |
|  | B | 1 | 1/1 | $1,155.00 | 6/30/25 | Gas | T | H/U In Unit |
|  | C | 1 | 2/1 | $1,450.00 | 5/31/27 | Gas | T | H/U In Unit |
|  | D | 2 | 2/1 | $950.00 | 4/30/25 | Gas | T | No |
|  | E | 3 | 2/1 | $1,350.00 | 4/30/27 | Gas | T | W/D |
| 133 North 3rd | 1 | 1 | 3/1 | $1,660.00 | At Will | Gas | T | No |
|  | 2F | 2 | 1/1 | $1,150.00 | 4/30/27 | Gas | T | No |
|  | 2R | 2 | 1/1 | $1,085.00 | M2M | Gas | T | No |
| 148 Main | 1 | 1 | 2/1 | $1,250.00 | M2M | Gas | T | BLDG |
|  | 2 | 2 | 3/1 | $1,260.00 | M2M | Gas | T | BLDG |
| 152 Main | 1 | 1 | 3/1 | $1,650.00 | 3/31/26 | Gas | T | BLDG |
|  | 2 | 2 | 3/1 | $1,750.00 |  | Gas | T | BLDG |
| 182 Hill St | 1 | 1 | 2/1 | $1,100.00 | 12/31/25 | Gas | T | H/U In Unit |
|  | 2 | 2 | 2/1 | $1,400.00 |  | Gas | T | H/U In Unit |
| 218 North 4th | 1 |  | 3/1 | $1,750.00 |  | Gas | T | BLDG |
|  | 2 |  | 4/1 | $1,900.00 | 4/30/27 | Gas | T | BLDG |
|  | 3 |  | 1/1 | $1,000.00 | 2/28/26 | Gas | T | BLDG |
| 219 Saratoga | 1 |  | 3/1 | $1,550.00 | 10/31/26 | Gas | T | H/K |
|  | 2 |  | 3/1 | $1,750.00 | 6/30/27 | Both | T | H/K |
| 523 Central Ave | 1F | 1 | 1/1 | $1,250.00 | 6/30/27 | Gas | T | No |
|  | 2F | 2 | 0/1 | $1,050.00 | At Will | Gas | T | No |
|  | 2R | 2 | 1/1 | $1,050.00 | At Will | Gas | T | No |
|  | 1R | 1 | 1/1 | $975.00 | 7/31/27 | Gas | T | No |
| 536 3rd | 1F | 1 | 1/1 | $1,200.00 | M2M | Gas | O | BLDG |
|  | 1R | 1 | 2/1 | $1,300.00 |  | Gas | O | H/U In Unit |

### Page 5 - "Delia - Rentals"

| Property | Unit | Floor # | Bed/Bath | Rent | Lease Exp | Gas/Electric | Who | W/D |
|---|---|---|---|---|---|---|---|---|
| 536 3rd (continued; property name not repeated in the scan) | 2F | 2 | 1/1 | $1,000.00 | M2M | Gas | O | BLDG |
|  | 2R | 2 | 2/1 | $1,375.00 | 5/31/27 | Gas | O | H/U In Unit |
| 580 6th | 1 | 1 | 2/1 | $1,400.00 | M2M | Gas | T | H/U In Unit |
|  | 2 | 2 | 3/1 | $1,500.00 | 1/31/27 | Gas | T | H/U In Unit |
| 1021 24th | 1 | 1 | 3/1 | $1,350.00 | At Will | Gas | T | BLDG |
|  | 2 | 2 | 3/1 | $1,600.00 | 10/31/26 | Gas | T | H/U In Unit |
| 1502 7th | 1 | 1 | 2/1 | $1,400.00 | 4/30/26 | Gas | T | No |
|  | 2 | 2 | 2/1 | $1,400.00 | 6/1/25 | Electric | T | No |
| 1126 24th | 1 | 1 | 2/1 | $1,350.00 | 9/30/27 | Gas | T | No |
|  | 2 | 2 | 2/1 | $1,350.00 | 5/31/26 | Gas | T | No |

### Total line (page 5)

| Total Monthly | | | | $106,689.00 | | | | |
|---|---|---|---|---|---|---|---|---|

Note: $106,689.00 is the sum of the Rent column for pages 2-5 only (86 rows; checked). Page 1 ("Delia Management Properties", 15 rows, $19,785.00) is not in the total.

### Transcription notes

- `[COM]` marks a "COM" label that the scan prints in a separate column next to the unit (page 3). It is not part of the unit label.
- Page 1 (15 rows) uses the title "Delia Management Properties"; pages 2-5 use "Delia - Rentals".
- No unreadable cells were found in the PDF. Blank cells are blank in the source.
- Page 1 W/D for "1 N. Liberty, Wynantskill" is `H/U` (no "In unit" suffix).
