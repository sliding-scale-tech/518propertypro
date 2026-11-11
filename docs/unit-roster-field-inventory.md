# Unit roster field inventory: Gold, Silver and Delia

**Purpose.** Field-by-field inventory of every distinct value in the client's three unit rosters, so the team can see exactly how the three files differ and plan one normalized unit format with no data lost. Counts below come from a script that parsed every table row in the three Markdown transcriptions. Nothing here changes the source files. Tenant names are deliberately not listed (personal data); only value kinds and counts are shown, plus business names where they matter.

## Sources and row totals

| Doc | Source transcription | Source PDF | Properties | Unit rows | Notes |
|---|---|---|---|---|---|
| Gold | `docs/context/gold-property-ai-info.md` | `GOLD Property AI info.pdf` (10 pages, exported from Google Sheets, has a text layer) | 58 | 205 | Matches the expected 205. |
| Silver | `docs/context/unit-information-silver-team.md` | `Unit Information Silver Team.pdf` (23 pages, scanned image, no text layer) | 55 | 275 | Matches the expected 275. 69 tables because 14 properties continue across page breaks. |
| Delia | `docs/context/unit-make-up.md` | `Unit Make Up.pdf` (5 pages, scanned image, no text layer) | 32 | 101 | Matches the expected 101: 15 rows in Delia Management Properties (5 properties) + 86 rows in Delia - Rentals (27 properties). The Total Monthly line is not a unit row and is excluded. The file contains no docx-vs-pdf comparison table (the differences are a bullet list), so nothing had to be excluded for that. |

**Reconciliation.** No difference from the expected totals: Gold 205, Silver 275, Delia 101 (total 581 rows). Rent sums also reconcile with what the transcriptions state: Gold $209,262.73; Delia rentals $106,689.00 plus Delia Management Properties $19,785.00 = $126,474.00. Silver sums to $321,270.04 over 255 rows that carry a rent.

**How raw values were taken.** Values are the transcription text, trimmed. Where the PDF disagreed with the transcription I used the PDF (see "Corrections made while building this inventory"). Case and spacing variants are listed as separate raw values. A blank cell is shown as `(blank)`.

**Legend for the "Meaning" column.**

- **Confirmed**: the document itself states it (a word on the page, a header, or a statement in the transcription of what the PDF says).
- **Inferred**: our reading of the pattern. Needs client confirmation before it is hard-coded.
- **Unknown**: no safe reading. Keep the raw text and ask.

"Proposed normalized value" is a proposal only; nothing is decided.

## Field map

| Concept | Gold column | Silver column | Delia column | Present in |
|---|---|---|---|---|
| Property / address | Section heading (address only) | Section heading (address only) | Property (blank on continuation rows). City appended on page 1 only | All three |
| Section / group | — (whole file is "GOLD") | — (whole file is "Silver Team"; page header "AI Information") | Page title: "Delia Management Properties" (p1) / "Delia - Rentals" (p2-5) | Delia only has an in-file section |
| Unit label | Unit | Unit | Unit (plus a separate unnamed "COM" column on page 3 only) | All three |
| Floor | Floor # | Floor | Floor # | All three |
| Tenants | Tenants | Tenants | — | Gold, Silver |
| Lease end | Lease End | Lease End | Lease Exp | All three |
| Bedrooms / bathrooms | Bed/Bath | Bed/Bath | Bed/Bath | All three |
| Rent | Rent | Rent | Rent | All three |
| Vacancy | Tenants = VACANT (plus blank lease, $0.00 rent) | Tenants = VACANT (plus blank lease, blank rent) | Lease Exp = "Vacant" (1 row); blank lease ambiguous | All three, expressed differently |
| Gas / electric: who pays | G/E & T/L (one combined code) | Gas Paid + Electric Paid (two columns) | Who (T/O, meaning not defined) | Gold, Silver (Delia only if "Who" means this) |
| Heating fuel (gas vs electric) | — | — | Gas/Electric (Gas / Electric / Both) | Delia only |
| Laundry | LMAT | Laundry | W/D | All three |
| Commercial flag | No column. Seen in unit label and Bed/Bath text | No column. Seen in unit label and Bed/Bath text | COM column (page 3 only) and unit label "Office" | Inconsistent |
| City | — | — | Only inside Property text on page 1 | Delia p1 only |
| Notes / flags | Yellow row highlight + merged "selling" note cell; "-new" in a heading | — | — | Gold only |
| Source page | Not marked in transcription (10 PDF pages) | PDF page markers in transcription | Page markers in transcription | Silver, Delia |

None of the three files has: lease start date, tenant phone or email, owner, asset manager, state or zip, square footage, deposit, or a unit/property ID.

## 1. Property / address: all three (Gold: section heading / Silver: section heading / Delia: Property)

Counts are properties (not units) per doc; a property can carry several tags.

| Format / pattern | Gold | Silver | Delia | Examples |
|---|---|---|---|---|
| range, spaced ("N - M") | 2 | — | 3 | gold: `1 - 4 Strong Place`, `46 - 48 South Lake Avenue`; delia: `53 - 57 Broad`, `60 - 62 Broad`, `86 - 88 4th` |
| range, unspaced ("N-M") | 2 | 1 | 1 | gold: `15-17 2nd Street`, `171-175 town garage road`; silver: `538-540 2nd Street`; delia: `22-24 Crockett Ave, Troy` |
| city after comma | — | — | 5 | delia: `1 N. Liberty, Wynantskill`, `22-24 Crockett Ave, Troy`, `19 Spring St, Troy` |
| trailing "-new" | 1 | — | — | gold: `208 Elm Street -new` |
| full street type (Street, Avenue, Lane...) | 55 | 55 | — | gold: `1 - 4 Strong Place`, `1 Colonial Woods Lane`, `2 Colonial Woods Lane`; silver: `1 Washington Avenue`, `4 Union Street`, `9 Lexington Court` |
| abbreviated street type (St, Ave) | 1 | — | 10 | gold: `166 2nd St`; delia: `22-24 Crockett Ave, Troy`, `19 Spring St, Troy`, `169 Myrtle Ave, Albany` |
| no street type (name only) | 2 | — | 22 | gold: `502 Broadway`, `1447 Broadway`; delia: `1 N. Liberty, Wynantskill`, `5 Museum`, `7 Museum` |
| spelled-out ordinal ("Second") | 1 | — | 1 | gold: `46 Second Avenue`; delia: `66 Second St` |
| numeric ordinal street name (2nd, 4th) | 12 | 8 | 9 | gold: `15-17 2nd Street`, `24 107th Street`, `27 7th Street`; silver: `433 3rd Street`, `457 4th Avenue`, `477 1st Street`; delia: `86 - 88 4th`, `119 South 2nd`, `133 North 3rd` |
| spelled-out direction | 5 | 8 | 3 | gold: `3 South Marshall Street`, `8 South Main Street`, `46 - 48 South Lake Avenue`; silver: `11 North Church Street`, `21 North College Street`, `23 North College Street`; delia: `119 South 2nd`, `133 North 3rd`, `218 North 4th` |
| abbreviated direction with period ("N.", "S.") | — | — | 2 | delia: `1 N. Liberty, Wynantskill`, `9 S. Main St, Mechaniville` |
| all-lowercase words | 1 | — | — | gold: `171-175 town garage road` |

Distinct properties: Gold 58, Silver 55, Delia 32. Full lists with unit counts are in Appendix A.

### Differences across docs

- **No property appears in more than one doc.** After normalizing case, punctuation, St/Street, Ave/Avenue, Second/2nd, S./South (0 exact address matches). So the three files are three disjoint portfolios, not three views of the same one.
- The same street name does appear in more than one doc with different house numbers (15 street names), e.g. Saratoga (Gold 6 properties, Delia `219 Saratoga`), Washington (Gold + Silver), State (Gold + Silver), Main (Gold + Delia), Madison (Gold + Silver), Spring (Gold + Delia), Hill (Silver + Delia). Because Silver and Gold carry no city, we cannot tell if these are the same city. Do not match on street name alone.
- Possible near-duplicate (Inferred, needs client confirmation): Delia `9 S. Main St, Mechaniville` vs Gold `9 Main Street` and `8 South Main Street`. Different house numbers or a different city, so treated as different.
- **City**: only Delia page 1 puts a city in the property text (Wynantskill, Troy, Albany, Mechaniville). Gold and Silver have street only. The Silver and Delia docs say the area looks like the Capital Region NY but that is not stated anywhere.
- **Street type**: Gold and Silver almost always write the full type (Street, Avenue). Delia pages 2-5 mostly drop it (`5 Museum`, `536 3rd`, `148 Main`) or abbreviate (`St`, `Ave`).
- **Ordinals**: spelled `Second` in Gold `46 Second Avenue` and Delia `66 Second St`, but numeric `2nd` in Gold `166 2nd St`, `15-17 2nd Street`, `531 2nd Street`. Same street name, three spellings.
- **Ranges**: Gold `1 - 4 Strong Place` and `46 - 48 South Lake Avenue` (spaced) vs `15-17 2nd Street` and `171-175 town garage road` (unspaced). Silver `538-540 2nd Street` (unspaced). Delia `53 - 57 Broad`, `60 - 62 Broad`, `86 - 88 4th` (spaced) and `22-24 Crockett Ave, Troy` (unspaced).
- **One heading, several buildings**: Silver `477 1st Street` is labelled "includes 477-x and 479-x units"; Gold `37 Mulberry Street` has units `37A/37B/39A/39B`; Gold `171-175 town garage road` has `171A..175B`; Delia `22-24 Crockett Ave`, `60 - 62 Broad`, `86 - 88 4th` carry the building number inside the unit label. So a "property" in these files can be several street numbers.
- **Odd names**: Gold `171-175 town garage road` is all lowercase and contains the word "garage" (its units are normal 2 bed/1 bath apartments, not garages). Gold `208 Elm Street -new` has a trailing note. Delia `9 S. Main St, Mechaniville` has a misspelled city (confirmed against the PDF, page 1). Delia `5 Museum` and `7 Museum` are two separate properties.
- **Continuation rows**: Delia pages 3 and 5 start with rows that have no property text (they belong to `53 - 57 Broad` and `536 3rd`). Silver has three such places (page 4 top rows after `11 North Church Street`; page 10 top rows after `184 Remsen Street`; page 21 top rows after `1211 Dean Street`): the transcription attaches them to the property above and marks them inferred. The header of `184 Remsen Street` and `361 Washington Avenue` sits at the very bottom of the previous page, rows on the next.

### Normalization notes

- Target: `Property` as its own record (id, display name, street number(s), street name, city, state) with units pointing at it. Do not use the heading text as the key.
- Keep `propertyNameRaw` exactly as printed. Derive a cleaned display name (full street type, numeric ordinals) separately.
- Parse out: a `-new` or similar suffix into a flag, not into the name; the city into `city`; ranges into `streetNumberFrom/To`.
- Open questions: Is "Mechaniville" Mechanicville NY? What city are Gold and Silver properties in? Is a heading like `477 1st Street` one property or two? Which team owns the Delia properties (the file has no team name)?

## 2. Section / group: Gold: (whole file) / Silver: (whole file) / Delia: page title

| Section / group | Properties | Unit rows | How it shows up | Meaning | Proposed normalized value |
|---|---|---|---|---|---|
| Gold (whole file) | 58 | 205 | File title "GOLD TEAM PROPERTY INFORMATION:" | Confirmed (title); what "Gold team" means for assignment is Unknown | `team=gold` on every row |
| Silver (whole file) | 55 | 275 | Filename "Silver Team"; page header "AI Information" | Confirmed (filename); meaning Unknown | `team=silver` on every row |
| Delia Management Properties | 5 | 15 | Page 1 title; cities in property text; excluded from the "Total Monthly" line | Meaning of the split is Unknown | `section="Delia Management Properties"` |
| Delia - Rentals | 27 | 86 | Pages 2-5 title; no cities; Total Monthly = sum of these rows only | Meaning of the split is Unknown | `section="Delia - Rentals"` |

### Differences across docs

- Gold and Silver are one section each; the "team" is only in the file name or title. Delia is the only file with two in-file sections, and the title uses "Delia" (a person or company name, not a team colour). Whether Delia maps to a team, an owner, or an asset manager is **Unknown**.
- Section is the only place the Delia split lives: the two sections differ in format (cities present vs absent) and in the "Total Monthly" treatment, so the split is probably meaningful (Inferred) and must be stored.

### Normalization notes

- Store `sourceFile` (gold / silver / delia), `sourceSection` (raw), and `sourcePage` on every unit so nothing is lost; decide team/owner mapping separately with the client.
- Open question: are "Delia Management Properties" vs "Delia - Rentals" two business lines (managed for owners vs rented as owner)? Ask.

## 3. Unit label: Gold: Unit / Silver: Unit / Delia: Unit

Every unit label is text. Counts are unit rows per doc.

| Pattern | Gold | Silver | Delia | Examples |
|---|---|---|---|---|
| Plain number (`1`, `2`, `12`) | 129 | 147 | 53 | gold: `1`, `2`, `3`; silver: `1`, `2`, `3`; delia: `1`, `2`, `3` |
| Number + letter (`1A`, `2R`, `1L`, `171B`, `6P`) | 42 | 43 | 21 | gold: `1A`, `1B`, `2A`; silver: `1N`, `1S`, `2N`; delia: `1F`, `2F`, `1R` |
| Number-hyphen-number (`22-1`, `477-1`, `15-2`, `1-1`) | 4 | 8 | 16 | gold: `15-2`, `17-1`, `17-2`; silver: `477-1`, `477-2`, `479-1`; delia: `22-1`, `22-2`, `24-1` |
| Letter + number (`A1`, `B4`, `S1`, `R1`) | 6 | 14 | — | gold: `A1`, `A2`, `A3`; silver: `A1`, `A2`, `S1` |
| Single letter (`A`, `B`, `F`, `R`) | 10 | 4 | 5 | gold: `A`, `B`, `C`; silver: `A`, `B`, `F`; delia: `A`, `B`, `C` |
| Three-digit number (`101`..`117`) | — | 17 | — | silver: `101`, `102`, `103` |
| Commercial or office token (`COM`, `COM1`, `6 - COM`, `15-Com.`, `Office`, `NEST`) | 2 | 9 | 2 | gold: `6 - COM`, `15-Com.`; silver: `COM`, `COM B`, `COM1`; delia: `Office` |
| Building-floor-letter (`4-1A`, `15-3F`) | 2 | 10 | — | gold: `15-3F`, `15-3R`; silver: `4-1A`, `4-1B`, `4-1C` |
| Position words (`1 - rear`, `1 Back`, `2nd  Front`, `B Rear Left`) | 6 | 4 | — | gold: `1 - rear`, `1- front`, `2 - front`; silver: `2nd  Front`, `2nd  rear`, `B Rear Left` |
| Floor words (`1st Floor`, `3rd floor`, `2nd floor L`, `FL 1`, `Fl 3`) | 2 | 4 | 1 | gold: `FL 1`, `2nd floor L`; silver: `1st Floor`, `2nd Floor`, `3rd Floor`; delia: `Fl 3` |
| Basement / garden level (`Basement`, `Garden`) | 1 | 4 | 1 | gold: `Basement`; silver: `Garden`, `A  Basement ( F`, `Basement`; delia: `Basement` |
| Number-hyphen-letters (`1- FFF`, `2-FFR`, `5- BF`) | — | 6 | — | silver: `1- FFF`, `2-FFR`, `3-SFF` |
| Garage (`Garage`, `Garage #2`) | — | 4 | — | silver: `Garage`, `Garage #2`, `Garage #3` |
| Parenthesized (`1 (R)`, `2 (L)`, `1A (Effic.)`) | 1 | — | 2 | gold: `1A (Effic.)`; delia: `1 (R)`, `2 (L)` |
| Clipped address text (`9 Lexington Cou`) | — | 1 | — | silver: `9 Lexington Cou` |

Distinct unit labels (across all properties): Gold 76, Silver 111, Delia 45. Full lists are in Appendix B.

### Differences across docs

- **Collisions inside a property after lowercasing and stripping spaces/punctuation: 0.** Exact duplicate labels inside one property: 0. So a (property, unit label) pair is a safe unique key in all three files, but only per property: `1`, `2`, `A`, `1R`, `S1` repeat across many properties.
- **Same unit, different spelling for the same idea.** Left/right/front/rear: `1L/1R` (Gold, Silver), `1F/1R` (Gold, Delia), `1 - rear`, `1- front`, `1 Back`, `1 Front` (Gold), `2nd  Front` / `2nd  rear` (Silver, two spaces), `B Rear Left`, `C Rear Right` (Silver), `F` / `R` (Silver), `2 (L)` (Delia). Floor words: `1st Floor` (Silver), `2nd floor L` (Gold), `FL 1` (Gold), `Fl 3` (Delia), `3rd floor` vs `3rd Floor` (Silver, case differs).
- **Spacing/case variants inside Gold** (found in the PDF text layer, not in the transcription): `1 L`, `1 R`, `2 L`, `2 R` at 19 Garner Street and 502 Broadway, `1 F`, `1 R` at 521 1st Street (a space between the digit and the letter), while the same kinds of labels are written without a space in other Gold properties (`1R`, `2R`, `3R`, `1F` at `36 Spring Street`). Gold also has `1 - rear` (spaces around the dash) next to `1- front` (no space before the dash).
- **Hyphen styles differ.** Gold `15-2`, `17-1`; Silver `477-1`, `538-1`, `4-1A`; Delia `22-1`, `86-1`, `60-2`, `1-1`. In these the number before the hyphen is a street number, a floor or a building depending on the property. Do not parse it generically.
- **Unit label does not equal floor.** In plain-number properties the number is a sequence (e.g. unit `7` on floor 2). In letter-suffix labels the leading digit disagrees with the Floor column for 6 Gold rows (`1 - 4 Strong Place`: `1B` is on floor 2, `2A` on floor 1, ...) and 2 Silver rows (`204 Lafayette Street`: `1A` is BSMT, `1B` is floor 2). Never derive floor from the label.
- **Commercial / office / storefront labels are not consistent.** Silver `COM`, `COM B`, `COM1`, `Office`, `NEST`, `S1`, `S2` (`S1` and `S2` are commercial at `204 Lafayette Street`, `508 State Street`, `514 State Street`, but Gold `9 Main Street` `S1` has Bed/Bath `n/a` and a $1,000 rent, Inferred storefront). Gold `6 - COM`, `15-Com.`. Delia `Office` (2 rows) and `COM` in a separate column (4 rows).
- **Silver `COM1` is not reliably commercial.** At `182 Remsen Street`, `184 Remsen Street` and `188 Remsen Street` the `COM1` rows carry normal residential Bed/Bath values (`2 Bed/1 Bath`, `1 Bed/1 Bath`); only `190 Remsen Street` `COM1` has the `'- / -` placeholder.
- **Clipped labels (Silver, confirmed on the PDF).** `9 Lexington Court` unit label is cut to `9 Lexington Cou` (whole-house rental, Inferred), and `308 East Street` unit `A` is cut to `A  Basement ( F` (so the real label is longer and the floor column says `1`, not basement). The transcription marked both with an ellipsis and a note; the PDF has no ellipsis.
- **Garages are units in Silver** (`Garage`, `Garage #2`, `Garage #3`, 4 rows, rent $50-$61.67, no floor/laundry/utilities) but not in Gold or Delia.
- **Delia only**: `Basement` has Floor `B`; `1 (R)` and `2 (L)` use parentheses and sit in single-unit buildings (`5 Museum`, `7 Museum`).

### Normalization notes

- Key: (propertyId, `unitLabelNormalized`); store `unitLabelRaw` exactly as printed. Do not auto-correct.
- `unitLabelNormalized`: trim, collapse internal whitespace, lowercase for matching only. Keep punctuation. Collisions after this step: 0 today, so safe, but re-check after every import.
- Add separate fields rather than parsing the label: `unitKind` (apartment / commercial / office / garage / storefront / whole-house), `floorLevel`, `position` (front/rear/left/right) only when the client confirms.
- Open questions: Does `S1`/`S2` mean storefront? Is Silver `COM1` at 182/184/188 Remsen really commercial? Are 4 Silver garage rows rentable units that should count as units?

## 4. Floor: Gold: Floor # / Silver: Floor / Delia: Floor #

| Raw value | Gold | Silver | Delia | Meaning | Proposed normalized value |
|---|---|---|---|---|---|
| `(blank)` | 2 | 4 | 5 | Unknown. Blank cell. | floorLevel=null |
| `1` | 97 | 108 | 44 | Confirmed floor number. | floorLevel=1 |
| `2` | 81 | 100 | 44 | Confirmed floor number. | floorLevel=2 |
| `3` | 19 | 46 | 7 | Confirmed floor number. | floorLevel=3 |
| `4` | — | 3 | — | Confirmed floor number. | floorLevel=4 |
| `5` | — | 3 | — | Confirmed floor number. | floorLevel=5 |
| `6` | — | 1 | — | Confirmed floor number. | floorLevel=6 |
| `bsmt` | 6 | — | — | Inferred: basement. | floorLevel=-1, isBasement=true |
| `BSMT` | — | 7 | — | Inferred: basement. | floorLevel=-1, isBasement=true |
| `B` | — | — | 1 | Inferred: basement (Delia unit `Basement` has this). | floorLevel=-1, isBasement=true |
| `ARAGE` | — | 2 | — | Unknown: left-clipped text in the PDF (23 North College Street, `COM` and `COM B`). Likely "GARAGE" (Inferred), odd for a commercial unit. | floorLevel=null, floorNote="GARAGE (clipped)"; keep raw |
| `RRIAGE` | — | 1 | — | Unknown: left-clipped text in the PDF (11 North Church Street unit 8). Likely "CARRIAGE" (Inferred): a carriage house. | floorLevel=null, floorNote="CARRIAGE (clipped)"; keep raw |

### Differences across docs

- Basement is spelled three ways: `bsmt` (Gold, lowercase), `BSMT` (Silver, uppercase), `B` (Delia). Same meaning (Inferred).
- Blank floors: Gold 2 rows (all of `531 2nd Street`), Silver 4 rows (the 4 garage rows), Delia 5 rows (`218 North 4th` units 1-3 and `219 Saratoga` units 1-2). Silver garages have no floor on purpose (Inferred); the others look like missing data.
- Silver has two cells clipped on the left in the scan (`ARAGE` x2, `RRIAGE` x1). The transcription marks them `[clipped; likely ...]`; those bracket notes are the transcriber's, not the PDF's. Confirmed in the PDF on pages 3 and 4. Floor `ARAGE` on a commercial unit (`23 North College Street` `COM`, `COM B`) is surprising and unresolved.
- Floors above 3 only exist in Silver (4: 3 rows, 5: 3 rows, 6: 1 row, all at `508 State Street`). Delia and Gold max out at 3.
- Silver `308 East Street` unit `A  Basement ( F` has Floor `1` although the label says basement.
- A unit label may say a floor while the Floor column disagrees: see Unit label section.

### Normalization notes

- Type: integer `floorLevel` (basement = -1 or 0 with `isBasement`, client choice) + `floorRaw` text. Allow null.
- Do not drop `BSMT`/`bsmt`/`B`; map all to the same value but keep the raw string.
- Open questions: What are the clipped values (`ARAGE`, `RRIAGE`)? Is a floor blank for a reason (garage) or missing (531 2nd Street, 218 North 4th, 219 Saratoga)?

## 5. Tenants: Gold: Tenants / Silver: Tenants / Delia: (no such column)

| Value kind | Gold | Silver | Delia | Meaning | Proposed normalized value |
|---|---|---|---|---|---|
| VACANT (literal) | 44 | 20 | — | Confirmed (stated in the cell) | `occupancy="vacant"`, no tenants |
| Single name (one person) | 123 | 190 | — | Inferred (one name, no comma) | one tenant record |
| Several names separated by comma | 35 | 54 | — | Inferred: co-tenants | one tenant record per name; keep `tenantsRaw` |
| Two names separated by " / " (one cell) | 1 | 0 | — | Inferred: two co-tenants | split on slash only if client confirms |
| Business / organization name | 1 | 11 | — | Inferred (name looks like a business) | `tenantType="business"` |
| Odd entry | 1 | 0 | — | Unknown (`Troy --`) | keep raw; flag for review |

Total: Gold 205, Silver 275. Delia has no Tenants column (101 rows with no tenant information at all).

**People per multi-name cell** (comma-separated; a clipped last name still counts as one):

| Names in cell | Gold cells | Silver cells |
|---|---|---|
| 2 | 35 | 54 |

Every multi-name cell in both files shows exactly two names: the column width cuts off anything after the second name, so the number of people per cell is a minimum, not a count.

**Clipped, blank and style variants.**

| Condition | Gold | Silver | Delia | Meaning |
|---|---|---|---|---|
| Cell visibly cut at the column edge (multi-name) | 28 (confirmed absent from the PDF text layer) | 53 of 55 comma cells (marked `…` in the transcription) | — | Confirmed for Silver and for the 28 Gold cells. Gold has 35 comma cells in all, all 24-29 characters wide (the column width), so the other 7 may be clipped too (Inferred) |
| Single-name cell cut at the column edge | 0 | 3 | — | Silver: 3 cells: 2 organizations (`Arte Industrial Tattoo Studi`, `The Creative Collective Jo`) and 1 person with a long single name. All cut mid-word |
| Blank tenant cell | 0 | 0 | — | No blank tenants in Gold or Silver. Blank only appears where the word VACANT is used |
| ALL CAPS name (not VACANT) | 1 | 0 | — | Case style differs from "First Last" |
| Lower-case first letter | 2 | 0 | — | Gold: 2 rows written all in lower case |
| Surname-first / initial style | 1 | 0 | — | Gold: 1 row that is one word plus a one-letter initial (Inferred: surname then initial) |

**Business / organization names present (not personal):** Silver: `Electric City Athletics`, `Tacos N Stuff`, `The Daisy 182 LLC`, `Arte Industrial Tattoo Studi` (clipped), `Nocturnal Cookies`, `Legal Project Apartment`, `The Creative Collective Jo` (clipped), `The Legal Project LLC, To` (clipped; followed by a person), `The Legal Project`, `Lorraine Made LLC`, `Mr Halal`. Gold: `Mr. Windshield` (Inferred business; unit `171 Saratoga Avenue` #5 rent $420, Bed/Bath `n/a`). Odd: Gold `Troy --` (68 Jefferson Street unit 2).

### Differences across docs

- **Delia has no tenant information.** There is no tenant name, no VACANT marker, no occupancy field. Occupancy for Delia can only be inferred from Lease Exp (`Vacant`) and it is unknown for the rest.
- Gold and Silver both say VACANT in capitals, both leave Lease End blank for those rows (see Vacancy).
- Silver puts commercial tenants (businesses and individuals) in the same column; Gold has only one commercial tenant (`15-Com.`, a person) and one business-looking name.
- Names are clipped at the column edge in both files (Silver 56 cells, Gold at least 28). The full names are not recoverable from these PDFs. A count of people per cell is therefore a minimum for clipped cells.
- Cell separators: comma in both; Gold also has one cell with a slash between two people.
- Same person on more than one unit exists (Gold `300 State Street` units 1A and 4). Do not treat tenant name as a unique key.

### Normalization notes

- Keep `tenantsRaw` verbatim (including clipped text and trailing `…` if the transcription added it; Silver cells ending `…` were cut by the scan, the PDF itself shows no ellipsis).
- Split into a `tenants[]` list only for display; flag `tenantsClipped=true` for the Silver `…` cells and for Gold cells that are missing from the PDF text layer. Never invent the missing part.
- `tenantType`: person / business / unknown. Rule: the text `VACANT` is not a tenant; set occupancy instead.
- Treat all names as personal data (no logging, no public bundles).
- Open questions: Are `Mr Halal` / `Mr. Windshield` businesses? What is `Troy --`? Is `Legal Project Apartment` (rent $0.00) an apartment held by an organization?

## 6. Lease end: Gold: Lease End / Silver: Lease End / Delia: Lease Exp

**a) Non-date values**

| Raw value | Gold | Silver | Delia | Meaning | Proposed normalized value |
|---|---|---|---|---|---|
| `(blank)` | 44 | 20 | 8 | Gold/Silver: blank only on VACANT rows (Inferred: no lease). Delia: Unknown (8 rows: not stated, not marked Vacant). | leaseType=null (Gold/Silver vacant) or "unknown" (Delia) |
| `at-will` | 65 | 95 | — | Inferred: no fixed end date (the docs read it as month-to-month); no legend. | leaseType="month_to_month", leaseEnd=null |
| `At Will` | — | — | 13 | Inferred: same as `at-will` (Delia spelling). | leaseType="month_to_month", leaseEnd=null |
| `M2M` | — | — | 13 | Inferred: month-to-month. | leaseType="month_to_month", leaseEnd=null |
| `M-2-M` | — | — | 4 | Inferred: month-to-month (Delia page 1 spelling). | leaseType="month_to_month", leaseEnd=null |
| `Vacant` | — | — | 1 | Confirmed: stated in the cell that the unit is vacant (Delia `169 Myrtle Ave` unit 2, which still shows $1,650 rent). | status="vacant", leaseEnd=null |
| `-------` | — | — | 2 | Unknown: dashes, used on the two no-rent units at `60 - 62 Broad` (`1R` and `Office`). | leaseType="none", leaseEnd=null |

**b) Date formats** (every date parses as month/day/year; none parses as day/month)

| Format | Gold | Silver | Delia | Examples |
|---|---|---|---|---|
| M/D/YYYY | 96 | 160 | — | gold: `7/31/2027`, `11/30/2027`, `2/28/2027`; silver: `1/31/2027`, `6/30/2027`, `2/28/2027` |
| M/D/YY | — | — | 59 | delia: `2/28/27`, `7/31/27`, `10/31/27` |
| MM/DD/YY (zero-padded) | — | — | 1 | delia: `01/31/27` |

Delia uses a **two-digit year** (`M/D/YY`). Gold and Silver use four digits. Delia has `01/31/27` (zero-padded) on `21 Vanderheyden` unit 1, the only zero-padded date in any file.

**c) Ranges and quality** (today = 2026-10-28)

| Measure | Gold | Silver | Delia |
|---|---|---|---|
| Valid dates | 96 | 160 | 59 |
| Earliest | 2026-10-31 | 2026-10-31 | 2025-02-28 |
| Latest | 2029-09-26 | 2030-06-09 | 2027-12-31 |
| Before 2026-10-28 (already past) | 0 | 0 | 27 |
| 2026-10-28 to 2026-12-31 | 17 | 29 | 5 |
| 2027 or later | 79 | 131 | 27 |
| Impossible dates | 0 | 0 | 1 |
| Not on a month-end (odd days) | 2 | 5 | 3 |
| Non-date tokens (at-will / M2M / Vacant / dashes) | 65 | 95 | 33 |
| Blank | 44 | 20 | 8 |

Impossible date: Delia `9/31/27` (`22-24 Crockett Ave, Troy`, unit `24-2`). Confirmed on the PDF page 1: it really reads 9/31/27 (September has 30 days). Keep raw; likely 9/30/27 (Inferred).

Non-month-end dates (almost every other date is a month-end, so these may be typos or one-off terms; Inferred): gold `6 Orchard Lane` #B `5/1/2027`; gold `15-17 2nd Street` #15-Com. `9/26/2029`; silver `86 Remsen Street` #1 `9/14/2027`; silver `188 Remsen Street` #COM1 `6/9/2030`; silver `301 Green Street` #114 `8/10/2027`; silver `508 State Street` #4A `1/8/2027`; silver `508 State Street` #4C `1/6/2027`; delia `51 Broad` #2 `12/26/26`; delia `66 Second St` #4 `4/28/26`; delia `1502 7th` #2 `6/1/25`.

Delia dates already past (27 of 59, relative to 2026-10-28) include 10 in 2025. Gold and Silver have none in the past (both start at 2026-10-31). Inferred: Delia's roster is older or not refreshed; Gold and Silver look like a late-Oct 2026 snapshot.

### Differences across docs

- **Month-to-month is written four ways**: `at-will` (Gold, Silver, lowercase with a hyphen), `At Will` (Delia, two words, title case), `M2M` (Delia), `M-2-M` (Delia page 1 only). Delia uses `At Will` 13 times and M2M/M-2-M 17 times in the same column, so it is not clear whether the client treats these as one status or two.
- Gold/Silver blank lease end appears only on VACANT rows (44 and 20); Delia blank (8 rows) is not tied to vacancy.
- Year width: 2-digit (Delia) vs 4-digit (Gold, Silver).
- Silver `2027` dates `1/8/2027` and `1/6/2027` are not month-ends; both are unusual (everything else near them is a month-end); confirm with the client (Inferred: possible typos).

### Normalization notes

- Store `leaseEndDate` (ISO date, nullable), `leaseType` (fixed / month_to_month / vacant / none / unknown) and `leaseEndRaw` (exact text). Parse only M/D/YYYY and M/D/YY; expand YY to 20YY only for Delia; reject impossible dates into `leaseEndRaw` with `leaseDateValid=false`.
- Keep Delia `9/31/27` raw and set date null (do not auto-correct to 9/30).
- Store `at-will` vs `M2M` separately in `leaseEndRaw`; map both to `month_to_month` only after the client confirms they are the same.
- Open questions: Does `at-will` equal `M2M`? What does a blank Delia lease end mean (vacant? unknown? holdover)? Are Delia past dates holdovers that should now be month-to-month?

## 7. Bedrooms / bathrooms: Gold: Bed/Bath / Silver: Bed/Bath / Delia: Bed/Bath

This is the key normalization field: every raw value is listed in full (spacing variants are separate rows).

| Raw value | Gold | Silver | Delia | Meaning | Proposed normalized value |
|---|---|---|---|---|---|
| `1 Bed/1 Bath` | 25 | 111 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=1, baths=1 |
| `1 Bed/1.5 Bath` | — | 1 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=1, baths=1.5 |
| `2 Bed/1 Bath` | 28 | 71 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=2, baths=1 |
| `2 Bed/1.5 Bath` | — | 1 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=2, baths=1.5 |
| `2 Bed/2 Bath` | 2 | 21 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=2, baths=2 |
| `3 Bed/1 Bath` | 19 | 14 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=3, baths=1 |
| `3 Bed/1.5 Bath` | 2 | — | — | Confirmed: words "Bed" and "Bath" are printed. | beds=3, baths=1.5 |
| `3 Bed/2 Bath` | — | 3 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=3, baths=2 |
| `3 Bed/2.5 Bath` | — | 1 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=3, baths=2.5 |
| `4 Bed/1 Bath` | 6 | 6 | — | Confirmed: words "Bed" and "Bath" are printed. | beds=4, baths=1 |
| `2 Bed/ 1` | 2 | — | — | Confirmed bedrooms ("Bed" printed); bath count Inferred (word "Bath" omitted). | beds=2, baths=1 |
| `Studio/1 Bath` | 5 | 29 | — | Confirmed: "Studio" printed; 1 bath printed. | beds=0, baths=1, isStudio=true |
| `0 /1 Bath` | 2 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). 0 bedrooms is read as studio (Inferred). | beds=0, baths=1, isStudio=true |
| `0/1 Bath` | 3 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). 0 bedrooms is read as studio (Inferred). | beds=0, baths=1, isStudio=true |
| `1 /1 Bath` | 4 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=1, baths=1 |
| `1/1 Bath` | 19 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=1, baths=1 |
| `2 /1 Bath` | 22 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=2, baths=1 |
| `2/1 Bath` | 13 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=2, baths=1 |
| `2/1.5 Bath` | 1 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=2, baths=1.5 |
| `3 /1 Bath` | 8 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=3, baths=1 |
| `3/1 Bath` | 6 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=3, baths=1 |
| `4 /1 Bath` | 1 | — | — | Inferred: first number = bedrooms, second = bathrooms ("Bath" is printed after the second). | beds=4, baths=1 |
| `0/1` | — | — | 12 | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. 0 bedrooms is read as studio (Inferred). In Delia, `0/1` is also used for offices and COM units, so it is not always a studio apartment. | beds=0, baths=1, isStudio=true |
| `1 / 1` | 2 | — | — | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=1, baths=1 |
| `1/ 1` | 1 | — | — | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=1, baths=1 |
| `1/1` | 3 | — | 29 | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=1, baths=1 |
| `2 / 1` | 2 | — | — | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=2, baths=1 |
| `2/ 1` | 1 | — | — | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=2, baths=1 |
| `2/1` | 13 | — | 35 | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=2, baths=1 |
| `3 /1` | 1 | — | — | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=3, baths=1 |
| `3/1` | 4 | — | 20 | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=3, baths=1 |
| `3/1.5` | 1 | — | — | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=3, baths=1.5 |
| `4/1` | — | — | 5 | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=4, baths=1 |
| `5 / 1` | 1 | — | — | Inferred: beds/baths. Delia doc states "beds/baths"; Gold/Silver by analogy. | beds=5, baths=1 |
| `- /1 Bath` | 3 | — | — | Inferred: bedrooms not entered, 1 bath printed (2 on vacant units at `281 Ontario Street`, 1 on occupied `15-3F` at `15-17 2nd Street`). | beds=null, baths=1 |
| `'- / -` | — | 4 | — | Unknown: beds and baths not entered ("-" placeholder). Silver values start with an apostrophe (a spreadsheet text-escape artifact, Inferred); all 4 rows are commercial-type units. | beds=null, baths=null |
| `- / -` | 1 | — | — | Unknown: beds and baths not entered ("-" placeholder). Gold: vacant unit at `54 Alexander Street` (note "selling property"). | beds=null, baths=null |
| `COMMERCIAL` | — | 9 | — | Confirmed: commercial. | beds=null, baths=null, unitKind="commercial" |
| `GARAGE` | — | 4 | — | Confirmed: garage. | beds=null, baths=null, unitKind="garage" |
| `commerical` | 1 | — | — | Confirmed: commercial (the cell is misspelled "commerical"). | beds=null, baths=null, unitKind="commercial" |
| `n/a` | 3 | — | — | Unknown / not applicable (Inferred). Gold rows: `6 - COM` (vacant commercial), `9 Main Street` S1, `171 Saratoga Avenue` 5. | beds=null, baths=null; `unitKind` from the label |

Distinct raw values: Gold 32, Silver 13, Delia 5; 41 distinct overall.

### Differences across docs

- **Three incompatible styles.** Silver is always `N Bed/M Bath` (or a word: `COMMERCIAL`, `GARAGE`). Delia is always bare `N/M` (5 distinct values, `0/1` to `4/1`). Gold has 32 distinct raw spellings, for example `2 Bed/1 Bath`, `2/1 Bath`, `2 /1 Bath`, `2/1`, `2 / 1`, `2/ 1`, `2 Bed/ 1`, `Studio/1 Bath`, `0/1 Bath`, `- /1 Bath`, `n/a`, `commerical`, ... Spacing around the slash is not consistent even inside one Gold property (`37 Mulberry Street`: `1 / 1`, `1 / 1`, `2 / 1`, `1/ 1`).
- **Studio**: Gold `Studio/1 Bath` (5) and `0/1 Bath` / `0 /1 Bath` (5); Silver `Studio/1 Bath` (29); Delia has no word, only `0/1` (12 rows). In Delia, `0/1` is also used for offices and COM units (`51 Broad` Office, `60 - 62 Broad` Office, 53-57 Broad units 6 and 7), so it cannot be read as "studio apartment" without the label.
- **Half baths** appear in Gold (`2/1.5 Bath`, `3/1.5`, `3 Bed/1.5 Bath`) and Silver (`1 Bed/1.5 Bath`, `2 Bed/1.5 Bath`, `3 Bed/2.5 Bath`); Delia has none (only `/1`). Bathrooms need a decimal type.
- **Max bedrooms**: Gold `5/1` (115 Round Lake Avenue; PDF shows `5 / 1`), Silver `4 Bed/1 Bath`, Delia `4/1`.
- **Kind is in the Bed/Bath cell in Silver** (`COMMERCIAL` 9, `GARAGE` 4) but not in Gold or Delia, and Silver has `'- / -` on 4 commercial rows (`190 Remsen Street` COM1, `204 Lafayette Street` S1/S2, `1635 Van Vranken Avenue` COM). Gold uses `commerical` (1), `n/a` (3), `-/-` (1). Delia has no commercial value at all in this column.
- **Silver stores `'- / -` with a leading apostrophe** (confirmed on the PDF, pages 10, 11, 23). The transcription wrote `'- / -'` with a closing quote that is not in the PDF.

### Normalization notes

- Target: `bedrooms` (integer, nullable), `bathrooms` (decimal, nullable), `isStudio` (boolean), `unitKind` (apartment / commercial / office / garage / unknown), plus `bedBathRaw` exactly as printed.
- Parse rule: capture the first number as bedrooms and the second (with optional `.5`) as bathrooms for all numeric styles; ignore whitespace around `/`; `Studio` or bedrooms `0` sets `isStudio`.
- `unitKind` must come from several signals together (unit label, Bed/Bath word, Delia COM column), not from Bed/Bath alone.
- Open questions: Does `0/1` mean studio or "no bedrooms because it is an office"? Do `n/a` and `- /1 Bath` mean "unknown" or "not applicable"? Is `5/1` (Gold) really 5 bedrooms?

## 8. Rent: Gold: Rent / Silver: Rent / Delia: Rent

**a) Formats**

| Format | Gold | Silver | Delia | Examples |
|---|---|---|---|---|
| $1,234.00 style (thousands comma, 2 decimals, value 1,000 or more) | 139 | 3 | 86 | Gold `$1,250.00`; Silver `$2,050.00` (only on the 3 rows of `86 Remsen Street`); Delia `$1,650.00` |
| $1234.00 style (no thousands comma, value 1,000 or more) | — | 193 | — | Silver `$1025.00`, `$1273.00`, `$11708.00` |
| $850.00 style (under 1,000) | 18 | 36 | 13 | `$650.00`, `$945.00`, `$750.00` |
| Has cents other than .00 (e.g. $2,832.22, $1375.50) | 2 | 4 | — | Gold `$2,832.22`, `$1,417.50`; Silver `$7012.37`, `$61.67`, `$1375.50`, `$997.50` |
| $0.00 | 45 | 19 | — | Gold vacant rows; Silver 301 Green Street 101-117 |
| $0.01 | 1 | — | — | Gold `300 State Street` unit `1A (Effic.)` |
| Blank cell | — | 20 | — | Silver vacant rows |
| `---` | — | — | 2 | Delia `60 - 62 Broad` units `1R` and `Office` |

**b) Ranges** (min and mean exclude `$0.00`, `$0.01` is kept)

| Measure | Gold | Silver | Delia |
|---|---|---|---|
| Rows with a numeric rent | 205 | 255 | 99 |
| Rows with `$0.00` | 45 | 19 | 0 |
| Minimum above zero | $0.01 | $50.00 | $750.00 |
| Maximum | $3,000.00 | $11,708.00 | $1,900.00 |
| Mean above zero | $1,307.89 | $1,361.31 | $1,277.52 |
| Sum of the column | $209,262.73 | $321,270.04 | $126,474.00 |

**c) Special values**

| Raw value | Gold | Silver | Delia | Meaning | Proposed normalized value |
|---|---|---|---|---|---|
| `$0.00` | 45 | 19 | — | Gold: vacant units (44 rows) and 1 occupied unit (`531 2nd Street` #1). Silver: occupied units only (19 rows: `301 Green Street` 101-117, `508 State Street` 2C, `204 Lafayette Street` 1B). Meaning Unknown for occupied rows: free unit, staff/org-held, rent not entered, or subsidy. | `rent=0`, `rentRaw="$0.00"`; do not treat 0 as vacancy |
| `$0.01` | 1 | — | — | Gold `300 State Street` `1A (Effic.)`, occupied until 7/31/2028. Unknown (placeholder or related to the same tenant holding unit 4). | `rent=0.01`, flag `rentSuspicious` |
| `(blank)` | — | 20 | — | Silver: blank only on VACANT rows (all 20). Inferred: no rent set while vacant. | `rent=null` |
| `---` | — | — | 2 | Unknown: no rent entered, on two units that also have `-------` lease end. | `rent=null` |

**d) Outliers**

Rents of $3,000 or more: silver `204 Lafayette Street` #`S2` $11708.00; silver `512 State Street` #`NEST` $7012.37; silver `508 State Street` #`S1` $3470.00; silver `204 Lafayette Street` #`S1` $3440.00; silver `508 State Street` #`6P` $3033.00; gold `109 Washington Street` #`1` $3,000.00.

Garages (Silver): $50.00, $55.00, $60.00, $61.67 (rent for parking, not housing). Gold lowest occupied rent (apart from the `$0.01` row): `$420.00` (`171 Saratoga Avenue` #5, Bed/Bath `n/a`). Commercial rents are not flagged in a separate way: Silver commercial rents range from `$708.00` to `$11708.00`; Gold `15-Com.` is `$2,832.22`; Delia COM/Office rows are `$750` to `$1,000` (or none).

### Differences across docs

- **Vacant units carry different rent values**: Gold `$0.00`, Silver blank, Delia a real rent (`$1,650.00` on the one `Vacant` row). A rent of `$0.00` means "vacant" in Gold but "occupied, zero rent" in Silver.
- **Currency text**: Silver omits the thousands comma on 195 of its 198 rents of $1,000 or more (3 have it); Gold and Delia always include it. A parser that strips `$` and `,` handles all three; one that expects a comma does not.
- **Precision**: only Gold and Silver have non-round rents (3 and 4 values); Delia is whole dollars.
- **Total line**: only Delia prints a "Total Monthly" ($106,689.00, covers pages 2-5 only). The Gold doc states a sum of about $209,262.73 (our script confirms). Neither total should be imported as a unit.

### Normalization notes

- Type: decimal money (cents), nullable, plus `rentRaw`. Strip `$` and thousands commas only; do not round.
- Never use rent = 0 to infer vacancy. Use a separate `occupancyStatus`.
- Flag for review rather than change: `$0.01`, occupied `$0.00` (20 rows), the Silver `$11708.00` outlier, Gold `$420.00`.
- Open questions: What does `$0.00` on an occupied unit mean? Is `$0.01` an error? Is the Delia `Vacant` row rent ($1,650) the asking rent?

## 9. Vacancy: how "vacant" is expressed

| Doc | Tenants cell | Lease end | Rent | Rows |
|---|---|---|---|---|
| Gold | occupied | date | amount | 96 |
| Gold | occupied | at-will | amount | 64 |
| Gold | VACANT | blank | $0.00 | 44 |
| Gold | occupied | at-will | $0.00 | 1 |
| Silver | occupied | date | amount | 144 |
| Silver | occupied | at-will | amount | 92 |
| Silver | VACANT | blank | blank | 20 |
| Silver | occupied | date | $0.00 | 16 |
| Silver | occupied | at-will | $0.00 | 3 |
| Delia | n/a (no Tenants column) | date | amount | 60 |
| Delia | n/a (no Tenants column) | token | amount | 30 |
| Delia | n/a (no Tenants column) | blank | amount | 8 |
| Delia | n/a (no Tenants column) | dashes | --- | 2 |
| Delia | n/a (no Tenants column) | Vacant | amount | 1 |

In the Delia rows, `date` includes the impossible `9/31/27`; `token` means `At Will`, `M2M` or `M-2-M`.

| Signal | Gold | Silver | Delia |
|---|---|---|---|
| Tenants = `VACANT` | 44 | 20 | — (no column) |
| Lease end blank | 44 | 20 | 8 (not all vacant; meaning Unknown) |
| Lease end literally `Vacant` | — | — | 1 |
| Rent `$0.00` on a vacant row | 44 | — (blank instead) | — (rent kept: $1,650) |
| Rent blank on a vacant row | — | 20 | — |
| Occupied with `$0.00` rent | 1 | 19 | 0 |
| Vacant rows total (confirmed) | 44 | 20 | 1 confirmed; up to 9 if blanks count (Unknown) |

### Differences across docs

- Gold and Silver agree on the word (`VACANT`) and on a blank Lease End; they disagree on rent (`$0.00` vs blank).
- Delia has **no** tenant column, so `Vacant` appears in the **lease column** instead, once. Eight other Delia rows have a blank lease end with a rent listed; they might be vacant, holdover, or simply not filled in.
- The Delia `-------` rows (2) have no rent and no lease: Inferred "not rentable now / not applicable" (they are `1R` and `Office` at `60 - 62 Broad`, Who = `O`).
- Gold "selling" flags sit mostly on vacant rows: the yellow "selling" groups cover 5 rows (4 vacant, 1 occupied), and `54 Alexander Street` #2 (vacant) says "selling property" in the laundry column (see Flags).

### Normalization notes

- Derive a single `occupancyStatus` = occupied / vacant / unknown. Rules: Gold or Silver Tenants = `VACANT` gives vacant; Delia Lease Exp = `Vacant` gives vacant; any Delia row with a blank lease end gives `unknown`, not vacant.
- Keep `rent` null for vacant Silver rows and 0 for vacant Gold rows only if the target accepts both; better, set `rent=null` and `rentRaw="$0.00"` when the row is vacant and the raw was `$0.00`.
- Open question: For Delia, is a blank lease end vacant? Is the Delia `Vacant` row's $1,650 an asking rent?

## 10. Utilities (gas and electric): Gold: G/E & T/L / Silver: Gas Paid + Electric Paid / Delia: Gas/Electric + Who

**The three files do not record the same fact.** Gold and Silver record **who pays** (two utilities, each tenant or owner/landlord). Delia records **which fuel** the unit uses (`Gas`, `Electric`, `Both`; the Delia doc describes it as "heated by gas or electric") plus a single `Who` letter whose meaning the doc never defines. Delia therefore cannot fill "gas paid by" and "electric paid by" without client confirmation.

| Field | Raw value | Gold | Silver | Delia | Meaning | Proposed normalized value |
|---|---|---|---|---|---|---|
| Gold `G/E & T/L` | `G/E ; T` | 188 | — | — | Inferred: G = gas, E = electric, T = tenant pays. Reads "gas and electric, tenant". Gold doc: "likely reading, unconfirmed". | gasPaidBy=tenant, electricPaidBy=tenant |
| Gold `G/E & T/L` | `G/E ; L` | 6 | — | — | Inferred: gas and electric, L = landlord pays. All 6 are `166 2nd St`. | gasPaidBy=owner, electricPaidBy=owner |
| Gold `G/E & T/L` | `E;T / G;L` | 11 | — | — | Inferred: electric tenant, gas landlord. 11 rows: `9 Leach Avenue` (2), `300 State Street` (9). Spacing around the slash varies in the PDF. | gasPaidBy=owner, electricPaidBy=tenant |
| Silver `Gas Paid` | `T` | — | 185 | — | Inferred: tenant pays (no legend). | gasPaidBy=tenant |
| Silver `Gas Paid` | `O` | — | 86 | — | Inferred: owner pays (no legend). | gasPaidBy=owner |
| Silver `Gas Paid` | `(blank)` | — | 4 | — | 4 garage rows (unit is a garage; Inferred not applicable). | gasPaidBy=null (n/a) |
| Silver `Electric Paid` | `T` | — | 246 | — | Inferred: tenant pays. | electricPaidBy=tenant |
| Silver `Electric Paid` | `O` | — | 24 | — | Inferred: owner pays. All 24 are also Gas Paid = O. | electricPaidBy=owner |
| Silver `Electric Paid` | `(blank)` | — | 5 | — | 4 garage rows plus `25 North Ferry Street` unit 7 (gas T, electric blank: looks like missing data). The transcription printed this one cell as "(blank)". | electricPaidBy=null |
| Delia `Gas/Electric` | `Gas` | — | — | 92 | Inferred: unit uses gas. | heatingFuel="gas" |
| Delia `Gas/Electric` | `Electric` | — | — | 7 | Inferred: unit uses electric. | heatingFuel="electric" |
| Delia `Gas/Electric` | `Both` | — | — | 2 | Unknown whether this means both fuels present or "gas heat + electric". Rows: `86 - 88 4th` 86-1, `219 Saratoga` 2. | heatingFuel="both" (keep raw) |
| Delia `Who` | `T` | — | — | 83 | Inferred: tenant. What it pays (gas? both? all utilities?) is not defined. | `whoRaw="T"`; do not map to a payer yet |
| Delia `Who` | `O` | — | — | 17 | Inferred: owner. `66 Second St` (11), `536 3rd` (4), `60 - 62 Broad` (2, the two no-rent units). | `whoRaw="O"`; do not map to a payer yet |
| Delia `Who` | `(blank)` | — | — | 1 | Unknown. `53 - 57 Broad` unit `1R` (also blank W/D). | `whoRaw=null` |

**Cross-tabs**

| Silver: Gas Paid | Silver: Electric Paid | Rows |
|---|---|---|
| `T` | `T` | 184 |
| `O` | `T` | 62 |
| `O` | `O` | 24 |
| `(blank)` | `(blank)` | 4 |
| `T` | `(blank)` | 1 |

| Delia: Gas/Electric | Delia: Who | Rows |
|---|---|---|
| `Gas` | `T` | 74 |
| `Gas` | `O` | 17 |
| `Electric` | `T` | 7 |
| `Both` | `T` | 2 |
| `Gas` | `(blank)` | 1 |

Property-level pattern: the code is identical for every unit in 58 of 58 Gold properties and in 48 of 55 Silver properties. The 7 Silver exceptions are `11 North Church Street`, `23 North College Street`, `58 Washington Avenue`, `173 Western Avenue` (mixed apartments), `25 North Ferry Street` (one blank electric), `250 Green Street` and `1211 Dean Street` (garages with blank utilities). The Delia `Who` letter is identical for every unit in 30 of 32 Delia properties (exceptions: `53 - 57 Broad` has one blank, `60 - 62 Broad` has 2 `O` and 3 `T`); the Delia fuel varies inside 6 of 32 properties. So utilities look like property-level facts typed on every row (Inferred).

### Differences across docs

- **Gold**: one cell, three codes, two utilities fused (`G/E ; T`). **Silver**: two columns, `T`/`O`. **Delia**: fuel in one column, `T`/`O` in another. Letter for the non-tenant payer is `L` in Gold, `O` in Silver and Delia: `L` = landlord, `O` = owner (same meaning, Inferred).
- Silver's combination "owner pays gas, tenant pays electric" (62 rows, e.g. `4 Union Street`) corresponds to Gold's `E;T / G;L` (11 rows). "Owner pays both" is Silver `O`/`O` (24 rows) and Gold `G/E ; L` (6 rows). Nobody has a row where the tenant pays gas and the owner pays electric.
- Delia has no way to say who pays electric separately from gas. If `Who` = who pays the listed fuel, then `Electric` rows say who pays electric but nothing about gas, and `Both` is ambiguous.
- Delia is the only file that says what fuel the unit uses; Gold and Silver never say whether a unit has gas at all, only who pays (Inferred).
- Silver garage rows have blank utilities, Gold and Delia have no garage rows.

### Normalization notes

- Target fields: `heatingFuel` (gas / electric / both / unknown), `gasPaidBy` (tenant / owner / unknown), `electricPaidBy` (tenant / owner / unknown), plus raw columns kept as `utilitiesRawGold`, `gasPaidRaw`, `electricPaidRaw`, `fuelRaw`, `whoRaw`.
- Gold: parse the code into the two payer fields with a small lookup (3 values), never by regex on letters.
- Delia: fill `heatingFuel` only; leave payers `unknown` and keep `whoRaw` until the client says what `Who` covers.
- Open questions: What do `T`, `O`, `L` mean exactly? Does Delia `Who` mean who pays the fuel on the same row? Does `Both` mean both fuels or "gas heat, electric hot water"? Do blank Silver utilities on garages mean "not applicable"?

## 11. Laundry: Gold: LMAT / Silver: Laundry / Delia: W/D

The team already decided laundry is low priority and should be stored as raw text only. It is inventoried here so nothing is lost. Gold's header `LMAT` is not defined in the PDF; calling it laundry is **Inferred** (its values are laundry words). `W/D` in Delia could mean "washer/dryer present" or be the column name; both readings appear in the same column.

| Field | Raw value | Gold | Silver | Delia | Meaning | Proposed normalized value |
|---|---|---|---|---|---|---|
| Gold `LMAT` | `Com. Bsmt` | 37 | — | — | Inferred: common (shared) basement laundry. The PDF shows two spaces between the words. | laundryType="shared" |
| Gold `LMAT` | `comm. bsmt` | 6 | — | — | Inferred: same as `Com. Bsmt` (lowercase, abbreviated differently). All 6 are `36 Spring Street`. | laundryType="shared" |
| Gold `LMAT` | `Hookups` | 21 | — | — | Inferred: hookups available. | laundryType="hookups" |
| Gold `LMAT` | `hookups` | 34 | — | — | Inferred: same, lowercase. | laundryType="hookups" |
| Gold `LMAT` | `W/D in unit` | 34 | — | — | Inferred: washer/dryer provided in the unit. | laundryType="provided" |
| Gold `LMAT` | `Hookups or W/D in unit` | 1 | — | — | Confirmed text (74 Cooks Court; wrapped over two lines in the PDF). Inferred: unit has hookups or a machine; not decided. | laundryType="unknown" (keep raw) |
| Gold `LMAT` | `n/a` | 52 | — | — | Inferred: no laundry for the unit / not applicable (also on residential units, so not only commercial). | laundryType="none" |
| Gold `LMAT` | `N/A` | 3 | — | — | Inferred: same as `n/a` (uppercase). All 3 are `114 Washington Street`. | laundryType="none" |
| Gold `LMAT` | `(blank)` | 13 | — | — | Unknown. Blank cell, 13 rows: `54 Alexander Street` (2), `138 North 2nd Avenue` (2), `171 Saratoga Avenue` (2), `252 Saratoga Avenue` (2), `521 1st Street` (2), `77 Viall Avenue` (1), `280 9th Street` (2, under the merged "selling" note). | laundryType="unknown" |
| Gold `LMAT` | `selling` | 3 | — | — | **Misuse**: a note, not a laundry value. Merged yellow cell on `280 9th Street` and `281 Ontario Street`. | `flag="selling"`; laundryType="unknown" |
| Gold `LMAT` | `selling property` | 1 | — | — | **Misuse**: a note, on `54 Alexander Street` unit 2. | `flag="selling"`; laundryType="unknown" |
| Silver `Laundry` | `BLDG` | — | 104 | — | Inferred: laundry in the building (shared). | laundryType="shared" |
| Silver `Laundry` | `IN UNIT` | — | 64 | — | Inferred: washer/dryer (or hookups) in the unit; "in unit" does not say if machines are included. | laundryType="provided" (or hookups; confirm) |
| Silver `Laundry` | `NO` | — | 101 | — | Inferred: no laundry. | laundryType="none" |
| Silver `Laundry` | `N/A` | — | 2 | — | Inferred: not applicable (both rows are the commercial units at `23 North College Street`). | laundryType="none" or n/a |
| Silver `Laundry` | `(blank)` | — | 4 | — | 4 garage rows; Inferred not applicable. | laundryType="unknown" |
| Delia `W/D` | `No` | — | — | 49 | Inferred: no laundry. | laundryType="none" |
| Delia `W/D` | `BLDG` | — | — | 25 | Inferred: building laundry (the Delia doc says so). | laundryType="shared" |
| Delia `W/D` | `H/U` | — | — | 1 | Inferred: hook-up. Page 1 only (`1 N. Liberty, Wynantskill`). | laundryType="hookups" |
| Delia `W/D` | `H/U In unit` | — | — | 2 | Inferred: hook-up in the unit (lowercase "unit"; `17 Harrison Ave` 1F, 1R; confirmed on the PDF). | laundryType="hookups" |
| Delia `W/D` | `H/U In Unit` | — | — | 18 | Inferred: same, capital "Unit". | laundryType="hookups" |
| Delia `W/D` | `H/K` | — | — | 3 | Unknown: confirmed on the PDF as `H/K` (page 1: `19 Spring St` unit 1; page 4: `219 Saratoga` 1 and 2). Maybe a typo for `H/U`. | laundryType="unknown" (keep raw) |
| Delia `W/D` | `W/D` | — | — | 2 | Inferred: washer/dryer present (`81 Elsworth` 1; `119 South 2nd` E). | laundryType="provided" |
| Delia `W/D` | `(blank)` | — | — | 1 | Unknown. `53 - 57 Broad` unit `1R` (also blank Who). | laundryType="unknown" |

Distinct raw laundry values: Gold 11, Silver 5, Delia 8. Counts add up to the row totals (Gold 205, Silver 275, Delia 101).

### Differences across docs

- **Vocabulary does not overlap at all**: Gold `hookups`/`Hookups`/`W/D in unit`/`Com. Bsmt`; Silver `BLDG`/`IN UNIT`/`NO`; Delia `H/U`/`BLDG`/`No`/`W/D`/`H/K`. Only `BLDG` (Silver, Delia) and the idea of "none" (`n/a`, `NO`, `No`) line up.
- **"W/D" means different things.** Gold `W/D in unit` = machines in the unit (Inferred). Delia `W/D` = a column title, and the value `W/D` alone (2 rows) is read as machines present.
- **Gold has case variants of the same value** (`Hookups` 21 / `hookups` 34; `Com. Bsmt` 37 / `comm. bsmt` 6; `n/a` 52 / `N/A` 3). Delia has a case variant (`H/U In unit` 2 / `H/U In Unit` 18).
- **Gold LMAT also holds notes** (`selling`, `selling property`: 4 cells), so it is not purely laundry.
- **"Not applicable" vs "no"**: Silver separates `N/A` (commercial) from `NO` (apartment without laundry). Gold uses `n/a` for both. Delia has no commercial laundry value (COM rows say `No`).

### Normalization notes

- Store `laundryRaw` (exact text) on every unit. Optional derived `laundryType` (none / shared / hookups / provided / unknown) only as a convenience; nothing may depend on it.
- Do not put notes (`selling`) into laundry: move to flags.
- Open questions: Does `IN UNIT` include machines? Is Delia `H/K` really `H/U`? Is `n/a` the same as `none`?

## 12. Flags and notes

| Flag | Where | Doc | Meaning | Proposed normalized value |
|---|---|---|---|---|
| Yellow row highlight + merged note `selling` | `280 9th Street` (3 units), `281 Ontario Street` (2 units); note text sits in the LMAT column | Gold | Confirmed that the sheet marks these as "selling"; the yellow highlight is in the PDF (page 8). Meaning of "selling": property is being sold (Inferred) | `propertyFlag="selling"` on both properties |
| LMAT text `selling property` | `54 Alexander Street` unit 2 (a vacant unit with Bed/Bath `- / -`) | Gold | Same idea written as free text in the laundry column (Inferred) | `unitFlag="selling"`; ask whether the whole property is selling |
| Heading suffix `-new` | `208 Elm Street -new` | Gold | Unknown: probably a recently added property (Inferred). Its units: basement vacant, unit 2 vacant, unit 3 occupied | `propertyFlag="new"`; strip from display name, keep raw |
| Transcriber notes (not in the PDFs) | e.g. Silver `(continued from previous page...)`, `[clipped; likely "GARAGE"]`, `(unit cell truncated)`, `...` | Silver (Gold: `(wrapped over two lines)`) | These are the transcriber's notes, not data. Do not import them as values | — (strip on import) |
| Delia `[COM]` marker | Unit cell on page 3 (53-57 Broad `6`, `7`; 60-62 Broad `Office`, `62-1`) | Delia | Inferred: commercial. In the PDF it is a separate unlabeled column, not part of the unit label. The transcription put it in square brackets | `unitKind="commercial"` |
| Total line | `Total Monthly $106,689.00`, bottom of page 5 | Delia | Confirmed: sum of rent on pages 2-5 only. Not a unit | — (do not import) |

Other things that look like flags but are plain values: Delia `Vacant` (see Lease end), Gold `-new`, `Troy --` (see Tenants).

### Differences across docs

- Only Gold carries notes (highlight, `selling`, `-new`). Silver and Delia carry none.
- The Gold notes sit in the Laundry-type column (`LMAT`) because the merged note cell lives there; they need to be moved, not stored as laundry.

### Normalization notes

- Add `flags[]` (free tags) at property and unit level, with `flagSource` (raw cell text and location). Colour/highlight is not machine-readable in a transcription: note highlight in the raw text field.
- Open questions: What exactly does "selling" mean for the AI (stop quoting? stop leasing?) and for the dashboard? What does `-new` mean?

## 13. Anything present in only one doc

| Item | Doc | Detail | Why it matters |
|---|---|---|---|
| Tenants column | Gold, Silver (not Delia) | Names, VACANT marker | Delia cannot provide occupancy or tenants |
| Separate Gas Paid and Electric Paid | Silver only | Two columns, T/O | Only doc with independent payers per utility |
| Combined `G/E & T/L` code | Gold only | 3 distinct values | Needs a lookup, not a regex |
| Fuel column `Gas/Electric` | Delia only | Gas, Electric, Both | Only doc that says what fuel the unit uses |
| `Who` (T/O) | Delia only | Undefined | Might be who pays utilities; confirm |
| City in property text | Delia p1 only | Wynantskill, Troy, Albany, Mechaniville | Only geographic information in any file |
| COM column | Delia p3 only | 4 rows | Only explicit commercial flag; coverage partial |
| Section titles inside the file | Delia only | 2 sections | Needs a `section` field |
| Total line | Delia only | $106,689.00 | Reconciliation check, not data |
| Garage rows | Silver only | 4 units, $50-$61.67 | Decide if garages are units |
| Commercial Bed/Bath words `COMMERCIAL`, `GARAGE` | Silver only (Gold `commerical`) | 13 rows | Kind lives in the Bed/Bath cell |
| Floors 4, 5, 6 | Silver only | 7 rows, all `508 State Street` | Floor range |
| Half-bath values `1.5`, `2.5` | Gold, Silver (not Delia) | Gold 4 rows, Silver 3 rows | Bathrooms must be decimal |
| Highlight / `selling` / `-new` | Gold only | see Flags | Flags |
| PDF text layer | Gold only (Google Sheets export) | Gold PDF can be read by machine; Silver and Delia are scans | Lets us verify Gold values exactly; Silver and Delia rely on a visual transcription |
| Clipped (cut-off) text | Gold (tenants), Silver (tenants, unit labels, 3 floor cells) | See Tenants, Unit label, Floor | Never "complete" clipped text |
| Page markers | Silver, Delia only | Page numbers in the transcription | Allows storing `sourcePage` (Gold: not recorded) |

## Totally different across docs (red flags)

In priority order for the normalization design:

1. **Delia has no tenants and no occupancy field.** Vacancy is one `Vacant` in the lease column (1 row) plus 8 unexplained blank leases. Gold and Silver say `VACANT` in the Tenants column (44 and 20 rows). A single `occupancyStatus` must be derived per doc, and Delia will have `unknown` for most rows.
2. **Utilities are three different facts.** Gold: one fused code (`G/E ; T`). Silver: two payer columns (`T`/`O`). Delia: a fuel column (`Gas`/`Electric`/`Both`) plus an undefined `Who` (`T`/`O`). Delia cannot fill "gas paid by" and "electric paid by" without the client saying what `Who` means. Keep every raw column.
3. **Vacant rent is stored three ways, and `$0.00` is overloaded.** Gold vacant = `$0.00`; Silver vacant = blank; Delia vacant = real rent. Meanwhile 20 occupied units have `$0.00` (Silver 19, Gold 1) and one has `$0.01`. Rent must never drive vacancy.
4. **Bed/Bath has three incompatible grammars and the unit kind hides inside it.** Silver `N Bed/M Bath` + `COMMERCIAL`/`GARAGE`/`'- / -`; Gold 32 spellings (`2 /1 Bath`, `2 / 1`, `n/a`, `commerical`); Delia bare `N/M` where `0/1` also means office/COM. Commercial is flagged by Bed/Bath word (Silver), by label (Gold `6 - COM`), or by a separate column on one page (Delia).
5. **Lease end vocabulary and date shape differ.** Dates `M/D/YYYY` (Gold, Silver) vs `M/D/YY` (Delia). Month-to-month is `at-will`, `At Will`, `M2M`, `M-2-M`. Delia has an impossible date (`9/31/27`), 8 blanks, `-------`, and 27 dates already in the past (Gold and Silver have none), so Delia looks older or stale (Inferred).
6. **The three portfolios are disjoint and property naming differs.** No address appears in more than one doc. Gold and Silver have no city; Delia has a city only on page 1. Delia often drops the street type (`148 Main`). One heading can cover several buildings (`477 1st Street` includes 479-x units; `37 Mulberry Street` has 39A/39B). A property key cannot be the heading text.
7. **Unit label is only unique per property and does not tell you the floor or kind.** Spacing variants (Gold `1 L` vs `1R`), position words, hyphen styles, `COM1` units with residential Bed/Bath, labels clipped in the scan (Silver `9 Lexington Cou`, `A  Basement ( F`). Collisions inside a property after normalizing: 0, so (property, label) is safe as a key.
8. **Laundry has three non-overlapping vocabularies and Gold LMAT also holds notes (`selling`).** Low priority: store raw text.
9. **Clipped and transcribed text.** Tenant names are clipped in Gold (28 cells) and Silver (56 cells); Silver floor and unit cells are clipped; Silver and Delia PDFs are scans, so values rest on visual transcription (see "Verification against the PDFs").

## Proposed unified unit record

A proposal only. Every normalized field keeps its raw text beside it, so no source value is lost.

| Field | Type | Allowed values | Filled by | Raw field kept alongside |
|---|---|---|---|---|
| `sourceFile` | enum | `gold`, `silver`, `delia` | all | — |
| `sourceSection` | string | Gold/Silver: file name; Delia: `Delia Management Properties` or `Delia - Rentals` | all | section text as printed |
| `sourcePage` | int, nullable | 1-23 | Silver, Delia (Gold: not recorded in the transcription) | — |
| `propertyId` | id | generated | all | — |
| `propertyNameRaw` | string | as printed (e.g. `1 N. Liberty, Wynantskill`, `208 Elm Street -new`) | all | itself |
| `streetNumberFrom` / `streetNumberTo` | int, nullable | e.g. 53 and 57 | all (parsed) | `propertyNameRaw` |
| `city` | string, nullable | e.g. Troy | Delia p1 only | `propertyNameRaw` |
| `unitLabelRaw` | string | exactly as printed incl. spaces and clipped text | all | itself |
| `unitLabelKey` | string | trimmed, whitespace collapsed, lowercased (matching only) | all | `unitLabelRaw` |
| `unitKind` | enum | apartment, commercial, office, garage, storefront, whole_house, unknown | Gold/Silver from label + Bed/Bath; Delia from COM column + label | `bedBathRaw`, `unitLabelRaw`, `comMarkerRaw` |
| `comMarkerRaw` | string, nullable | `COM` | Delia page 3 only | itself |
| `floorLevel` | int, nullable | 1-6, -1 = basement | all | `floorRaw` |
| `isBasement` | bool | true for `bsmt`, `BSMT`, `B` | all | `floorRaw` |
| `bedrooms` | int, nullable | 0-5 | all (parsed) | `bedBathRaw` |
| `bathrooms` | decimal, nullable | 1, 1.5, 2, 2.5 | all (parsed) | `bedBathRaw` |
| `isStudio` | bool | true for `Studio` or bedrooms 0 (Inferred) | all | `bedBathRaw` |
| `rentAmount` | decimal(10,2), nullable | >= 0 | all | `rentRaw` |
| `occupancyStatus` | enum | occupied, vacant, unknown | Gold/Silver Tenants; Delia Lease Exp `Vacant`; else unknown | `tenantsRaw`, `leaseEndRaw` |
| `tenantsRaw` | string, nullable | as printed (may be clipped) | Gold, Silver | itself |
| `tenantsClipped` | bool | true if cell cut at column edge | Gold, Silver | `tenantsRaw` |
| `tenantType` | enum | person, business, unknown (per name; list `tenants[]` for display only) | Gold, Silver | `tenantsRaw` |
| `leaseEndDate` | date, nullable | valid ISO date | all | `leaseEndRaw` |
| `leaseType` | enum | fixed, month_to_month, vacant, none, unknown | all | `leaseEndRaw` |
| `leaseDateValid` | bool | false for `9/31/27` | all | `leaseEndRaw` |
| `heatingFuel` | enum | gas, electric, both, unknown | Delia only | `fuelRaw` |
| `gasPaidBy` | enum | tenant, owner, unknown | Gold, Silver (Delia only if `Who` is confirmed) | `utilitiesRaw`, `gasPaidRaw` |
| `electricPaidBy` | enum | tenant, owner, unknown | Gold, Silver (Delia only if `Who` is confirmed) | `utilitiesRaw`, `electricPaidRaw` |
| `utilitiesRaw` | string, nullable | Gold `G/E ; T`, `G/E ; L`, `E;T / G;L` | Gold | itself |
| `gasPaidRaw` / `electricPaidRaw` | string, nullable | `T`, `O`, blank | Silver | themselves |
| `whoRaw` | string, nullable | `T`, `O`, blank | Delia | itself |
| `laundryRaw` | string, nullable | as printed (incl. `selling` in Gold LMAT, flagged) | all | itself |
| `laundryType` | enum, optional | none, shared, hookups, provided, unknown (convenience only) | all | `laundryRaw` |
| `flags` | string[] | selling, new | Gold | `flagRaw` (e.g. `selling property`, `-new`) |
| `dataQuality` | string[] | impossible_date, rent_zero_occupied, rent_penny, clipped_text, clipped_unit_label, missing_floor, bedbath_unknown | all (computed) | — |

Fields not in any source and so not proposed as required: lease start, deposit, tenant phone/email, owner, asset manager, state/zip, unit square footage.

## Verification against the PDFs

**Checked on the PDF pages** (page images read for the Gold, Silver and Delia PDFs):

- Gold: pages 2, 3, 4, 8 (also the whole Gold text layer, extracted with `pdftotext`, compared row by row to the transcription: Rent, G/E & T/L, LMAT, Floor, Lease End, Bed/Bath, Unit and all 58 headings; 28 clipped tenant cells found on their own lines in the text layer).
- Silver: pages 2, 3, 4, 5, 10, 11, 13, 16, 18, 21, 23 (the pages with clipped cells, `'- / -`, the blank electric cell, garages, commercial and basement rows).
- Delia: pages 1, 2, 3 (`9/31/27`, `H/K`, `01/31/27`, `Mechaniville`, `Vacant`, `-------`, `[COM]` column, `Basement`/`B`).

**Corrections made while building this inventory** (the source files in `docs/context/` were not edited):

| Doc | Where | Transcription says | PDF shows | Rows |
|---|---|---|---|---|
| Gold | Unit labels at `19 Garner Street`, `502 Broadway` | `1L`, `1R`, `2L`, `2R` | `1 L`, `1 R`, `2 L`, `2 R` (space) | 8 |
| Gold | Unit labels at `521 1st Street` | `1F`, `1R` | `1 F`, `1 R` (space) | 2 |
| Gold | Bed/Bath at `35 Viall Avenue` #2, `37 Mulberry Street` 39A | `2/1` | `2 / 1` | 2 |
| Gold | Bed/Bath at `37 Mulberry Street` 37A, 37B | `1/1` | `1 / 1` | 2 |
| Gold | Bed/Bath at `54 Alexander Street` #2 | `-/-` | `- / -` | 1 |
| Gold | Bed/Bath at `115 Round Lake Avenue` #1 | `5/1` | `5 / 1` | 1 |
| Silver | Bed/Bath at `190 Remsen Street` COM1, `204 Lafayette Street` S1/S2, `1635 Van Vranken Avenue` COM | `'- / -'` (closing quote) | `'- / -` (leading apostrophe only) | 4 |
| Silver | Electric Paid at `25 North Ferry Street` #7 | `(blank)` (literal text) | empty cell | 1 |
| Silver | Clipped unit labels | `9 Lexington Cou…`, `A  Basement ( F…`, with notes in the cell | `9 Lexington Cou`, `A  Basement ( F` (no ellipsis; "whole house" is the transcriber's reading) | 2 |
| Silver | Clipped floor cells | `ARAGE [clipped; likely "GARAGE"]`, `RRIAGE [clipped; likely "CARRIAGE"]` | `ARAGE`, `RRIAGE` (bracket text is the transcriber's) | 3 |
| Silver | Clipped tenant names | trailing `…` | cut text with no ellipsis | 56 |

These 16 Gold rows are whitespace-only differences, so no meaning changes, but a parser that compares raw text should know. Gold counts in the Bed/Bath table above use the PDF text. Whitespace inside Gold `Com. Bsmt` (two spaces) and `E;T   /   G;L` (varying spaces) is collapsed in the text layer and in the transcription; treated as the same value.

**Other transcription observations (no edit needed):**

- Gold doc, Key facts: lists `-/-` and `5/1` as Bed/Bath values; the PDF has `- / -` and `5 / 1`.
- Silver doc, Key facts: says Bed/Bath `'- / -'` (with a closing quote) and says "Garage rows leave both blank"; the garages also leave Floor and Laundry blank.
- Silver doc counts and Delia doc counts (205 / 275 / 101, 55 / 32 properties, vacant counts, rent totals) all match this script. The Gold doc's "17 occupied units with a 2026 lease end" and "65 at-will" also match.

**What could not be confirmed:**

- Silver pages not viewed (1, 6-9, 12, 14, 15, 17, 19, 20, 22) and Delia pages 4-5 were read only through the transcription. Silver and Delia have no text layer, so every value there rests on a visual transcription. Gold text-layer checks cover Gold fully.
- Silver dates `1/8/2027` and `1/6/2027` (`508 State Street` 4A and 4C) are on page 15 or 16, not viewed; could be typos.
- Delia `Fl 3` (`53 - 57 Broad`): the scan cannot distinguish `Fl 3` from `FI 3` (lowercase L vs uppercase i).
- Silver clipped floor cells `ARAGE`/`RRIAGE`: the missing first letter(s) cannot be recovered from the PDF.
- Which Gold tenants cells beyond the 28 found are clipped (7 more comma cells at the same width) cannot be told from the PDF text layer alone.
- All "Meaning" entries marked Inferred need client confirmation, especially: `G/E ; T` / `E;T / G;L`, Silver `T`/`O`, Delia `Who`, `at-will` vs `M2M`, `0/1`, `BLDG`, `H/K`, `Both`, `$0.00` on occupied units.

## Appendix A. Distinct properties per doc with unit counts

### Gold (58 properties, 205 units)

| # | Property (as printed) | Units |
|---|---|---|
| 1 | `1 - 4 Strong Place` | 8 |
| 2 | `1 Colonial Woods Lane` | 4 |
| 3 | `2 Colonial Woods Lane` | 4 |
| 4 | `2 Prout Avenue` | 6 |
| 5 | `3 Simmons Avenue` | 4 |
| 6 | `3 South Marshall Street` | 2 |
| 7 | `6 Orchard Lane` | 2 |
| 8 | `7 Stoney Creek Drive` | 1 |
| 9 | `8 South Main Street` | 6 |
| 10 | `9 Leach Avenue` | 2 |
| 11 | `9 Main Street` | 4 |
| 12 | `15-17 2nd Street` | 7 |
| 13 | `19 Garner Street` | 4 |
| 14 | `21 Lincoln Avenue` | 2 |
| 15 | `22 Lincoln Avenue` | 2 |
| 16 | `24 107th Street` | 2 |
| 17 | `27 7th Street` | 1 |
| 18 | `35 Viall Avenue` | 2 |
| 19 | `36 Spring Street` | 6 |
| 20 | `37 Mulberry Street` | 4 |
| 21 | `46 Second Avenue` | 2 |
| 22 | `46 - 48 South Lake Avenue` | 14 |
| 23 | `52 Bassett Street` | 3 |
| 24 | `54 Alexander Street` | 3 |
| 25 | `68 Jefferson Street` | 3 |
| 26 | `73 Tallow Wood Drive` | 1 |
| 27 | `74 Cooks Court` | 1 |
| 28 | `77 Viall Avenue` | 2 |
| 29 | `89 Howard Street` | 2 |
| 30 | `105 West Street` | 2 |
| 31 | `106 Elsmere Avenue` | 4 |
| 32 | `109 Washington Street` | 3 |
| 33 | `114 Washington Street` | 3 |
| 34 | `115 Round Lake Avenue` | 3 |
| 35 | `138 North 2nd Avenue` | 5 |
| 36 | `165 Saratoga Avenue` | 7 |
| 37 | `166 2nd St` | 6 |
| 38 | `171 Saratoga Avenue` | 6 |
| 39 | `171-175 town garage road` | 6 |
| 40 | `173 Saratoga Avenue` | 2 |
| 41 | `185 Saratoga Avenue` | 2 |
| 42 | `187 Saratoga Avenue` | 2 |
| 43 | `208 Elm Street -new` | 3 |
| 44 | `252 Saratoga Avenue` | 3 |
| 45 | `280 9th Street` | 3 |
| 46 | `281 Ontario Street` | 2 |
| 47 | `300 State Street` | 9 |
| 48 | `322 Park Avenue` | 5 |
| 49 | `368 Madison Avenue` | 3 |
| 50 | `427 1st Street` | 2 |
| 51 | `448 5th Avenue` | 2 |
| 52 | `502 Broadway` | 4 |
| 53 | `506 6th Avenue` | 2 |
| 54 | `521 1st Street` | 4 |
| 55 | `531 2nd Street` | 2 |
| 56 | `622 1st Avenue` | 2 |
| 57 | `1447 Broadway` | 2 |
| 58 | `1815 Highland Avenue` | 2 |

### Silver (55 properties, 275 units)

| # | Property (as printed) | Units |
|---|---|---|
| 1 | `1 Washington Avenue` | 6 |
| 2 | `4 Union Street` | 10 |
| 3 | `9 Lexington Court` | 1 |
| 4 | `9 Madison Place` | 4 |
| 5 | `9 Union Street` | 6 |
| 6 | `10 Madison Place` | 4 |
| 7 | `11 North Church Street` | 11 |
| 8 | `21 North College Street` | 2 |
| 9 | `23 North College Street` | 4 |
| 10 | `25 North Ferry Street` | 7 |
| 11 | `32 North Ferry Street` | 9 |
| 12 | `33 North Ferry Street` | 5 |
| 13 | `43 Washington Avenue` | 6 |
| 14 | `58 Washington Avenue` | 5 |
| 15 | `86 Remsen Street` | 3 |
| 16 | `90 Hill Street` | 2 |
| 17 | `108 Jackson Avenue` | 3 |
| 18 | `113 Front Street` | 6 |
| 19 | `132 Johnston Avenue` | 3 |
| 20 | `173 Western Avenue` | 12 |
| 21 | `182 Remsen Street` | 2 |
| 22 | `184 Remsen Street` | 2 |
| 23 | `188 Remsen Street` | 4 |
| 24 | `190 Remsen Street` | 2 |
| 25 | `204 Lafayette Street` | 10 |
| 26 | `208 Union Street` | 5 |
| 27 | `250 Green Street` | 3 |
| 28 | `301 Green Street` | 17 |
| 29 | `308 East Street` | 3 |
| 30 | `318 Quail Street` | 4 |
| 31 | `361 Washington Avenue` | 9 |
| 32 | `433 3rd Street` | 2 |
| 33 | `457 4th Avenue` | 2 |
| 34 | `477 1st Street` | 4 |
| 35 | `508 State Street` | 15 |
| 36 | `510 State Street` | 1 |
| 37 | `512 State Street` | 1 |
| 38 | `514 State Street` | 2 |
| 39 | `538-540 2nd Street` | 4 |
| 40 | `551 5th Avenue` | 2 |
| 41 | `687 State Street` | 7 |
| 42 | `718 East Street` | 6 |
| 43 | `858 Union Street` | 2 |
| 44 | `1009 19th Street` | 2 |
| 45 | `1084 Wendell Avenue` | 5 |
| 46 | `1114 Union Street` | 5 |
| 47 | `1146 Madison Avenue` | 10 |
| 48 | `1211 Dean Street` | 8 |
| 49 | `1226 Wendell Avenue` | 5 |
| 50 | `1238 Union Street` | 5 |
| 51 | `1356 Union Street` | 5 |
| 52 | `1406 5th Avenue` | 3 |
| 53 | `1527 3rd Street` | 3 |
| 54 | `1581 Van Vranken Avenue` | 3 |
| 55 | `1635 Van Vranken Avenue` | 3 |

### Delia (32 properties, 101 units)

| # | Property (as printed) | Section | Units |
|---|---|---|---|
| 1 | `1 N. Liberty, Wynantskill` | Delia Management Properties | 1 |
| 2 | `22-24 Crockett Ave, Troy` | Delia Management Properties | 4 |
| 3 | `19 Spring St, Troy` | Delia Management Properties | 2 |
| 4 | `169 Myrtle Ave, Albany` | Delia Management Properties | 2 |
| 5 | `9 S. Main St, Mechaniville` | Delia Management Properties | 6 |
| 6 | `5 Museum` | Delia - Rentals | 1 |
| 7 | `7 Museum` | Delia - Rentals | 1 |
| 8 | `17 Harrison Ave` | Delia - Rentals | 4 |
| 9 | `19 Newark` | Delia - Rentals | 2 |
| 10 | `21 Vanderheyden` | Delia - Rentals | 2 |
| 11 | `21 William St` | Delia - Rentals | 3 |
| 12 | `26 Knight St` | Delia - Rentals | 2 |
| 13 | `38 Warsaw` | Delia - Rentals | 2 |
| 14 | `51 Broad` | Delia - Rentals | 3 |
| 15 | `53 - 57 Broad` | Delia - Rentals | 9 |
| 16 | `60 - 62 Broad` | Delia - Rentals | 5 |
| 17 | `66 Second St` | Delia - Rentals | 11 |
| 18 | `81 Elsworth` | Delia - Rentals | 2 |
| 19 | `86 - 88 4th` | Delia - Rentals | 4 |
| 20 | `119 South 2nd` | Delia - Rentals | 5 |
| 21 | `133 North 3rd` | Delia - Rentals | 3 |
| 22 | `148 Main` | Delia - Rentals | 2 |
| 23 | `152 Main` | Delia - Rentals | 2 |
| 24 | `182 Hill St` | Delia - Rentals | 2 |
| 25 | `218 North 4th` | Delia - Rentals | 3 |
| 26 | `219 Saratoga` | Delia - Rentals | 2 |
| 27 | `523 Central Ave` | Delia - Rentals | 4 |
| 28 | `536 3rd` | Delia - Rentals | 4 |
| 29 | `580 6th` | Delia - Rentals | 2 |
| 30 | `1021 24th` | Delia - Rentals | 2 |
| 31 | `1502 7th` | Delia - Rentals | 2 |
| 32 | `1126 24th` | Delia - Rentals | 2 |

## Appendix B. Distinct unit labels per doc

Format: `label` (number of properties using it, only if more than 1). Sorted by label.

**Gold** (76 distinct):

`1` (42), `1 - rear`, `1 Back`, `1 F`, `1 Front`, `1 L` (2), `1 R` (3), `1- front`, `10`, `11`, `12`, `13`, `14`, `15`, `15-2`, `15-3F`, `15-3R`, `15-Com.`, `17-1`, `17-2`, `17-3`, `171A`, `171B`, `173A`, `173B`, `175A`, `175B`, `1A`, `1A (Effic.)`, `1B` (2), `1C`, `1F`, `1R`, `2` (40), `2 - front`, `2 - rear`, `2 L` (2), `2 R` (2), `2A` (2), `2B` (2), `2C` (2), `2E`, `2F`, `2R`, `2W`, `2nd floor L`, `3` (17), `37A`, `37B`, `39A`, `39B`, `3A`, `3B`, `3F`, `3R`, `4` (8), `4A`, `4B`, `5` (7), `6` (4), `6 - COM`, `7` (2), `8` (2), `9`, `A` (3), `A1`, `A2`, `A3`, `B` (3), `Basement`, `C` (2), `D` (2), `FL 1`, `R1`, `R2`, `S1`

**Silver** (111 distinct):

`1` (33), `1- FFF`, `10` (2), `101`, `102`, `103`, `104`, `105`, `106`, `107`, `108`, `109`, `11`, `110`, `111`, `112`, `113`, `114`, `115`, `116`, `117`, `12`, `1A` (2), `1B`, `1L` (3), `1N`, `1R` (4), `1S`, `1st Floor`, `2` (32), `2-FFR`, `2A` (2), `2B`, `2C` (2), `2L` (4), `2N`, `2R` (5), `2S`, `2nd  Front`, `2nd  rear`, `2nd Floor`, `3` (24), `3-SFF`, `3A` (2), `3B` (2), `3C` (2), `3N`, `3S`, `3rd Floor`, `3rd floor`, `4` (14), `4-1A`, `4-1B`, `4-1C`, `4-1D`, `4-2A`, `4-2B`, `4-2C`, `4-2D`, `4-3A`, `4-3B`, `4-SFR`, `477-1`, `477-2`, `479-1`, `479-2`, `4A`, `4B`, `4C`, `5` (14), `5- BF`, `538-1`, `538-2`, `540-1`, `540-2`, `5A`, `5B`, `5C`, `6` (11), `6- BR`, `6P`, `7` (6), `8` (5), `9` (4), `9 Lexington Cou`, `A`, `A  Basement ( F`, `A1` (2), `A2` (2), `A3`, `B`, `B Rear Left`, `B1`, `B2`, `B3`, `B4`, `Basement`, `C Rear Right`, `COM` (2), `COM B`, `COM1` (4), `F`, `Garage` (2), `Garage #2`, `Garage #3`, `Garden` (2), `NEST`, `Office`, `R`, `S1` (3), `S2` (2)

**Delia** (45 distinct):

`1` (20), `1 (R)`, `1-1`, `1-2`, `10`, `11`, `1F` (3), `1R` (5), `2` (19), `2 (L)`, `2-1`, `2-2`, `2-4`, `22-1`, `22-2`, `24-1`, `24-2`, `2E`, `2F` (4), `2R` (5), `2W`, `3` (4), `3F`, `3R`, `4`, `5`, `6` (2), `60-2`, `62-1`, `62-2`, `7` (2), `8`, `86-1`, `86-2`, `88-1`, `88-2`, `9`, `A`, `B`, `Basement`, `C`, `D`, `E`, `Fl 3`, `Office` (2)

## Appendix C. Distinct lease-end values per doc

Dates in chronological order (count if more than 1), then non-date values.

**Gold** (21 distinct values; 19 date strings, 2 non-date values):

`10/31/2026` (6), `11/30/2026` (8), `12/31/2026` (3), `1/31/2027`, `2/28/2027` (6), `3/31/2027` (10), `4/30/2027` (11), `5/1/2027`, `5/31/2027` (8), `6/30/2027` (4), `7/31/2027` (13), `8/31/2027` (7), `9/30/2027` (6), `10/31/2027` (6), `11/30/2027`, `2/29/2028`, `5/31/2028`, `7/31/2028` (2), `9/26/2029`

Non-date: `(blank)` (44), `at-will` (65)

**Silver** (26 distinct values; 24 date strings, 2 non-date values):

`10/31/2026` (7), `11/30/2026` (7), `12/31/2026` (15), `1/6/2027`, `1/8/2027`, `1/31/2027` (13), `2/28/2027` (10), `3/31/2027` (10), `4/30/2027` (13), `5/31/2027` (10), `6/30/2027` (12), `7/31/2027` (17), `8/10/2027`, `8/31/2027` (17), `9/14/2027`, `9/30/2027` (7), `10/31/2027` (11), `11/30/2027`, `12/31/2027`, `4/30/2028`, `7/31/2028`, `9/30/2028`, `10/31/2028`, `6/9/2030`

Non-date: `(blank)` (20), `at-will` (95)

**Delia** (38 distinct values; 32 date strings, 6 non-date values):

`2/28/25`, `3/31/25`, `4/30/25` (2), `6/1/25`, `6/30/25` (2), `11/30/25` (2), `12/31/25`, `2/28/26` (3), `3/31/26`, `4/28/26`, `4/30/26`, `5/31/26` (3), `6/30/26` (2), `7/31/26` (4), `8/31/26`, `9/30/26`, `10/31/26` (3), `11/30/26`, `12/26/26`, `01/31/27`, `1/31/27`, `2/28/27` (4), `4/30/27` (5), `5/31/27` (3), `6/30/27` (4), `7/31/27` (3), `8/31/27`, `9/31/27`, `9/30/27` (2), `10/31/27`, `11/30/27`, `12/31/27`

Non-date: `(blank)` (8), `-------` (2), `At Will` (13), `M-2-M` (4), `M2M` (13), `Vacant` (1)

## Appendix D. Distinct rent values (frequency table)

211 distinct raw rent strings across the three docs (Gold 71, Silver 132, Delia 38). Sorted by amount; `(blank)` and `---` first.

| Rent (raw) | Gold | Silver | Delia |
|---|---|---|---|
| `(blank)` | — | 20 | — |
| `---` | — | — | 2 |
| `$0.00` | 45 | 19 | — |
| `$0.01` | 1 | — | — |
| `$50.00` | — | 1 | — |
| `$55.00` | — | 1 | — |
| `$60.00` | — | 1 | — |
| `$61.67` | — | 1 | — |
| `$420.00` | 1 | — | — |
| `$500.00` | — | 2 | — |
| `$550.00` | — | 4 | — |
| `$590.00` | — | 1 | — |
| `$600.00` | — | 1 | — |
| `$650.00` | 1 | — | — |
| `$660.00` | — | 1 | — |
| `$700.00` | — | 2 | — |
| `$708.00` | — | 1 | — |
| `$725.00` | 1 | — | — |
| `$750.00` | 2 | 2 | 1 |
| `$776.00` | — | 1 | — |
| `$800.00` | 3 | 2 | — |
| `$825.00` | — | 1 | — |
| `$830.00` | — | 1 | — |
| `$845.00` | — | 1 | — |
| `$847.00` | 1 | — | — |
| `$850.00` | — | 1 | 1 |
| `$856.00` | — | 1 | — |
| `$860.00` | — | 1 | — |
| `$875.00` | — | — | 2 |
| `$883.00` | — | 1 | — |
| `$900.00` | 4 | 4 | 2 |
| `$925.00` | — | — | 1 |
| `$945.00` | — | 2 | — |
| `$950.00` | 1 | 1 | 5 |
| `$956.00` | — | 1 | — |
| `$960.00` | 1 | — | — |
| `$970.00` | 1 | — | — |
| `$975.00` | — | 1 | 1 |
| `$985.00` | 1 | — | — |
| `$995.00` | 1 | — | — |
| `$997.50` | — | 1 | — |
| `$1,000.00` | 5 | — | 7 |
| `$1000.00` | — | 12 | — |
| `$1011.00` | — | 1 | — |
| `$1012.00` | — | 1 | — |
| `$1017.00` | — | 2 | — |
| `$1,020.00` | 1 | — | — |
| `$1,025.00` | 3 | — | — |
| `$1025.00` | — | 2 | — |
| `$1036.00` | — | 1 | — |
| `$1,050.00` | 7 | — | 6 |
| `$1050.00` | — | 9 | — |
| `$1070.00` | — | 1 | — |
| `$1,075.00` | — | — | 1 |
| `$1075.00` | — | 2 | — |
| `$1081.00` | — | 1 | — |
| `$1,085.00` | — | — | 1 |
| `$1095.00` | — | 1 | — |
| `$1,100.00` | 11 | — | 4 |
| `$1100.00` | — | 9 | — |
| `$1118.00` | — | 1 | — |
| `$1124.00` | — | 1 | — |
| `$1,125.00` | 4 | — | — |
| `$1125.00` | — | 1 | — |
| `$1131.00` | — | 1 | — |
| `$1133.00` | — | 1 | — |
| `$1140.00` | — | 1 | — |
| `$1141.00` | — | 1 | — |
| `$1145.00` | — | 4 | — |
| `$1,150.00` | 2 | — | 2 |
| `$1150.00` | — | 2 | — |
| `$1,155.00` | 3 | — | 1 |
| `$1,166.00` | 1 | — | — |
| `$1177.00` | — | 1 | — |
| `$1,180.00` | 1 | — | — |
| `$1184.00` | — | 1 | — |
| `$1,195.00` | — | — | 1 |
| `$1,200.00` | 9 | — | 5 |
| `$1200.00` | — | 10 | — |
| `$1203.00` | — | 1 | — |
| `$1204.00` | — | 1 | — |
| `$1,208.00` | 1 | — | — |
| `$1217.00` | — | 2 | — |
| `$1,225.00` | 3 | — | — |
| `$1,230.00` | — | — | 1 |
| `$1230.00` | — | 1 | — |
| `$1231.00` | — | 2 | — |
| `$1236.00` | — | 1 | — |
| `$1,250.00` | 14 | — | 6 |
| `$1250.00` | — | 10 | — |
| `$1255.00` | — | 1 | — |
| `$1257.00` | — | 1 | — |
| `$1,260.00` | 1 | — | 2 |
| `$1260.00` | — | 4 | — |
| `$1269.00` | — | 1 | — |
| `$1273.00` | — | 1 | — |
| `$1,275.00` | 1 | — | — |
| `$1275.00` | — | 1 | — |
| `$1278.00` | — | 1 | — |
| `$1,280.00` | 1 | — | — |
| `$1280.00` | — | 1 | — |
| `$1295.00` | — | 4 | — |
| `$1,300.00` | 11 | — | 5 |
| `$1300.00` | — | 4 | — |
| `$1315.00` | — | 2 | — |
| `$1325.00` | — | 3 | — |
| `$1,330.00` | 1 | — | — |
| `$1,335.00` | 1 | — | — |
| `$1338.00` | — | 1 | — |
| `$1,350.00` | 7 | — | 11 |
| `$1350.00` | — | 5 | — |
| `$1,362.00` | 1 | — | — |
| `$1362.00` | — | 1 | — |
| `$1,370.00` | 1 | — | — |
| `$1,374.00` | 1 | — | — |
| `$1,375.00` | 2 | — | 1 |
| `$1375.00` | — | 2 | — |
| `$1375.50` | — | 1 | — |
| `$1,378.00` | 1 | — | — |
| `$1378.00` | — | 1 | — |
| `$1380.00` | — | 1 | — |
| `$1389.00` | — | 1 | — |
| `$1391.00` | — | 1 | — |
| `$1,395.00` | — | — | 1 |
| `$1395.00` | — | 3 | — |
| `$1,400.00` | 4 | — | 7 |
| `$1400.00` | — | 4 | — |
| `$1,407.00` | — | — | 1 |
| `$1,415.00` | 1 | — | — |
| `$1415.00` | — | 2 | — |
| `$1,417.00` | 1 | — | 1 |
| `$1417.00` | — | 1 | — |
| `$1,417.50` | 1 | — | — |
| `$1418.00` | — | 2 | — |
| `$1,425.00` | 2 | — | — |
| `$1,428.00` | 1 | — | — |
| `$1445.00` | — | 1 | — |
| `$1,450.00` | 2 | — | 1 |
| `$1450.00` | — | 3 | — |
| `$1,455.00` | 1 | — | — |
| `$1466.00` | — | 1 | — |
| `$1,470.00` | 1 | — | — |
| `$1470.00` | — | 1 | — |
| `$1,475.00` | — | — | 1 |
| `$1488.00` | — | 2 | — |
| `$1495.00` | — | 3 | — |
| `$1,500.00` | 5 | — | 2 |
| `$1500.00` | — | 5 | — |
| `$1,520.00` | 1 | — | — |
| `$1525.00` | — | 1 | — |
| `$1530.00` | — | 1 | — |
| `$1546.00` | — | 1 | — |
| `$1,550.00` | 2 | — | 1 |
| `$1550.00` | — | 2 | — |
| `$1560.00` | — | 1 | — |
| `$1563.00` | — | 1 | — |
| `$1,575.00` | 1 | — | — |
| `$1595.00` | — | 1 | — |
| `$1,600.00` | 1 | — | 3 |
| `$1605.00` | — | 1 | — |
| `$1633.00` | — | 1 | — |
| `$1,650.00` | 1 | — | 5 |
| `$1,660.00` | — | — | 2 |
| `$1,690.00` | 1 | — | — |
| `$1,695.00` | — | — | 1 |
| `$1696.00` | — | 1 | — |
| `$1,698.00` | 1 | — | — |
| `$1,700.00` | 3 | — | — |
| `$1700.00` | — | 1 | — |
| `$1,725.00` | 1 | — | — |
| `$1,730.00` | — | — | 1 |
| `$1,750.00` | 3 | — | 4 |
| `$1750.00` | — | 3 | — |
| `$1780.00` | — | 1 | — |
| `$1,800.00` | 1 | — | — |
| `$1800.00` | — | 3 | — |
| `$1873.00` | — | 1 | — |
| `$1878.00` | — | 1 | — |
| `$1,900.00` | 1 | — | 1 |
| `$1,925.00` | 1 | — | — |
| `$1926.00` | — | 1 | — |
| `$1,940.00` | 1 | — | — |
| `$1,950.00` | — | 1 | — |
| `$1950.00` | — | 2 | — |
| `$2,000.00` | 3 | — | — |
| `$2000.00` | — | 2 | — |
| `$2020.00` | — | 1 | — |
| `$2022.00` | — | 1 | — |
| `$2045.00` | — | 1 | — |
| `$2,050.00` | — | 1 | — |
| `$2050.00` | — | 1 | — |
| `$2060.00` | — | 1 | — |
| `$2,100.00` | 1 | — | — |
| `$2125.00` | — | 2 | — |
| `$2140.00` | — | 1 | — |
| `$2150.00` | — | 1 | — |
| `$2,200.00` | 1 | — | — |
| `$2200.00` | — | 1 | — |
| `$2210.00` | — | 1 | — |
| `$2,400.00` | — | 1 | — |
| `$2,600.00` | 1 | — | — |
| `$2600.00` | — | 1 | — |
| `$2,800.00` | 1 | — | — |
| `$2,832.22` | 1 | — | — |
| `$2925.00` | — | 1 | — |
| `$3,000.00` | 1 | — | — |
| `$3033.00` | — | 1 | — |
| `$3440.00` | — | 1 | — |
| `$3470.00` | — | 1 | — |
| `$7012.37` | — | 1 | — |
| `$11708.00` | — | 1 | — |
