# GOLD TEAM PROPERTY INFORMATION (GOLD Property AI info)

**Source file:** `GOLD Property AI info.pdf` (repo root; 10 pages, landscape letter, exported from Google Sheets "GOLD Property AI info" on 2026-10-23)

## What this doc is

A rent-roll spreadsheet for the "GOLD" team's portfolio: one table listing every property address and its units, with floor number, current tenant name(s) (or VACANT), lease end date (or "at-will" for month-to-month), bed/bath count, monthly rent, a utilities/responsibility code ("G/E & T/L") and a laundry/mechanical column ("LMAT"). It is the ground-truth property and unit data for the GOLD team that "Sarah" (the AI voice agent) and the 518 Property Pro dashboard need to know about (tenants, vacancies, lease expiries, rents). Column legends are not defined in the PDF; interpretations below are marked as such.

## Key facts & rules

- Title in the sheet: "GOLD TEAM PROPERTY INFORMATION:". Columns: Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT.
- Data is grouped by property address (58 property blocks, 205 unit rows by my count). Unit labels are not uniform (1, 1A, A, 1L/1R, 1F/1R, 1 - rear / 1- front, 1 Back / 1 Front, FL 1, 2nd floor L, S1, R1/R2, Basement, 15-Com., 6 - COM, 1A (Effic.), etc.), so treat unit label as free text unique only within its property.
- 44 units are marked VACANT (rent shown as $0.00); 161 units have a tenant. 65 of the occupied units are "at-will" (no fixed lease end date). Sum of the Rent column is about $209,262.73/month (includes $0.00 vacant rows and a $0.01 row).
- Lease End is either a date (M/D/YYYY) or the literal "at-will". Blank for vacant units. Many leases end 2026-10-31 through 2026-12-31 (17 occupied units, listed below), which matters for renewal outreach (today in project context is late Oct 2026).
- Tenant column can hold several names (co-tenants) separated by commas. In the PDF many long names are visibly cut off at the column edge (e.g. "Chris Bendon, Colleen Huds"); the full names are not recoverable from this PDF. They are transcribed exactly as shown (clipped), not completed.
- Code in the "G/E & T/L" column: most rows are `G/E ; T`; 6 rows at 166 2nd St are `G/E ; L`; rows at 9 Leach Avenue and 300 State Street are `E;T / G;L`. The PDF gives no legend. Likely reading (unconfirmed): G = gas, E = electric, T = tenant pays, L = landlord pays. Do not hard-code this meaning without client confirmation.
- "LMAT" column values: Hookups / hookups, Com. Bsmt / comm. bsmt (common basement laundry), W/D in unit, n/a / N/A, "Hookups or W/D in unit" (74 Cooks Court), or blank. Legend not given (likely laundry/machine info; unconfirmed).
- Commercial units: 15-Com. at 15-17 2nd Street (Luis Medina, lease end 9/26/2029, rent $2,832.22, Bed/Bath "commerical" [sic]) and 6 - COM at 8 South Main Street (VACANT).
- Properties flagged "selling" in the sheet: 280 9th Street (3 units, row group highlighted yellow, note "selling"), 281 Ontario Street (2 units, highlighted yellow, note "selling"), and 54 Alexander Street unit 2 (LMAT "selling property"). Also "208 Elm Street -new" is labelled "-new" in the property header.
- Data oddities a developer must not silently "fix": 531 2nd Street unit 1 (Wayne Smith, at-will) has rent $0.00 although occupied; 300 State Street 1A (Effic.) has rent $0.01 (and the same tenant, Tachauntae Arrington, 7/31/2028, also holds unit 4); 171 Saratoga Avenue unit 5 tenant is "Mr. Windshield" (Rent $420.00, Bed/Bath n/a, lease 12/31/2026); 68 Jefferson Street unit 2 tenant is "Troy --"; 531 2nd Street units have no floor value; 1 - 4 Strong Place unit 1A tenant is "Josephson M". Bed/Bath is free text ("2 /1 Bath", "2/1", "2 Bed/1 Bath", "Studio/1 Bath", "0/1 Bath", "- /1 Bath", "-/-", "5/1", "3 Bed/1.5 Bath", "n/a"), not normalized.
- Floor # values: 1, 2, 3, "bsmt", or blank. No phone numbers, emails, owner or contact details appear in this document. Tenant data is PII; keep it out of logs and public bundles.
- Occupied units whose lease ends in the 2026 calendar year (Oct-Dec 2026): 2 Prout Avenue #4 (10/31/2026); 3 Simmons Avenue 2 - rear (11/30/2026); 22 Lincoln Avenue #1 (11/30/2026); 35 Viall Avenue #2 (10/31/2026); 37 Mulberry Street 39A (11/30/2026); 46 Second Avenue #1 (11/30/2026); 46 - 48 South Lake Avenue #10 (10/31/2026), #12 (11/30/2026), #15 (11/30/2026); 52 Bassett Street #1 (11/30/2026); 109 Washington Street #3 (10/31/2026); 166 2nd St #3 (10/31/2026), #5 (10/31/2026); 171 Saratoga Avenue #5 (12/31/2026); 171-175 town garage road 171B (12/31/2026), 175B (11/30/2026); 1815 Highland Avenue #1 (12/31/2026).

## Full content (faithful transcription)

Sheet title: **GOLD TEAM PROPERTY INFORMATION:**

Column headers: `Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT`

Each "###" heading below is a property-address row from the sheet. Cells are transcribed as shown; text clipped by the source column width is kept clipped. Where the source cell is empty it is left empty. The original PDF has 10 landscape pages; page breaks are not marked because the table continues across them (e.g. the "322 Park Avenue" header sits at the bottom of page 8 and its units begin page 9).

### 1 - 4 Strong Place

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1A | 1 | Josephson M | at-will | 2 /1 Bath | $650.00 | G/E ; T | Hookups |
| 1B | 2 | VACANT |  | 2 Bed/1 Bath | $0.00 | G/E ; T | Hookups |
| 2A | 1 | Duwayne Johnson | 7/31/2027 | 2/1 Bath | $1,250.00 | G/E ; T | Hookups |
| 2B | 2 | Todd Zehnter | 11/30/2027 | 2/1 Bath | $847.00 | G/E ; T | Hookups |
| 3A | 1 | Karen Gaspie | at-will | 2 /1 Bath | $800.00 | G/E ; T | Hookups |
| 3B | 2 | Gail Kobelmsky | at-will | 2 /1 Bath | $750.00 | G/E ; T | Hookups |
| 4A | 1 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | Hookups |
| 4B | 2 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | Hookups |

### 1 Colonial Woods Lane

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| A | 1 | Nicole Amszynski | at-will | 2 /1 Bath | $1,300.00 | G/E ; T | Com. Bsmt |
| B | 1 | Chris Bendon, Colleen Huds | at-will | 2/1 Bath | $1,155.00 | G/E ; T | Com. Bsmt |
| C | 2 | Sean Ryan | at-will | 2 /1 Bath | $1,250.00 | G/E ; T | Com. Bsmt |
| D | 2 | Vanessa Grant | at-will | 2 /1 Bath | $1,250.00 | G/E ; T | Com. Bsmt |

### 2 Colonial Woods Lane

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| A | 1 | Amelia Tarantelli | at-will | 2 /1 Bath | $1,250.00 | G/E ; T | Com. Bsmt |
| B | 1 | Natalie Monescalchi | at-will | 2 /1 Bath | $1,155.00 | G/E ; T | Com. Bsmt |
| C | 2 | Jerry Feldman | at-will | 2 /1 Bath | $1,125.00 | G/E ; T | Com. Bsmt |
| D | 2 | Casey Helmer | at-will | 2 /1 Bath | $1,300.00 | G/E ; T | Com. Bsmt |

### 2 Prout Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | bsmt | Sandra Bowen | 2/28/2027 | 2 Bed/1 Bath | $1,250.00 | G/E ; T | Hookups |
| 2 | bsmt | Shonda Harrington | 1/31/2027 | 2 Bed/1 Bath | $1,350.00 | G/E ; T | Hookups |
| 3 | 1 | Thyais Gist | 2/28/2027 | 2 Bed/1 Bath | $1,375.00 | G/E ; T | Hookups |
| 4 | 1 | Donald Gaitor, Patrick Gaito | 10/31/2026 | 2 Bed/1 Bath | $1,280.00 | G/E ; T | Hookups |
| 5 | 2 | Tatianna Austin | at-will | 2 Bed/1 Bath | $1,300.00 | G/E ; T | Hookups |
| 6 | 2 | VACANT |  | 2 Bed/1 Bath | $0.00 | G/E ; T | Hookups |

### 3 Simmons Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 - rear | 1 | Jenna Upright | 8/31/2027 | 2 Bed/1 Bath | $1,250.00 | G/E ; T | n/a |
| 1- front | 1 | Ashley Chambers | 8/31/2027 | 1 Bed/1 Bath | $1,166.00 | G/E ; T | n/a |
| 2 - front | 2 | Katherine Barnes | 4/30/2027 | 2 Bed/1 Bath | $1,200.00 | G/E ; T | n/a |
| 2 - rear | 2 | Jenny Larrick | 11/30/2026 | 2 Bed/1 Bath | $1,200.00 | G/E ; T | n/a |

### 3 South Marshall Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 2/1 Bath | $0.00 | G/E ; T | n/a |
| 2 | 2 | VACANT |  | 2 /1 Bath | $0.00 | G/E ; T | n/a |

### 6 Orchard Lane

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| A | 1 | Raven-Satori Langley, Denn | 8/31/2027 | 2 Bed/1 Bath | $1,500.00 | G/E ; T | W/D in unit |
| B | 1 | Michael Krivak | 5/1/2027 | 2 Bed/1 Bath | $1,350.00 | G/E ; T | W/D in unit |

### 7 Stoney Creek Drive

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | HERMAN GILL | 5/31/2027 | 2 Bed/1 Bath | $2,000.00 | G/E ; T | W/D in unit |

### 8 South Main Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1B | 1 | Teresa Jimenez dejesus | 9/30/2027 | 2 Bed/1 Bath | $1,300.00 | G/E ; T | n/a |
| 1C | 1 | Rachel Longmire | 4/30/2027 | 1/1 Bath | $1,150.00 | G/E ; T | n/a |
| 2A | 2 | VACANT |  | 2/1 Bath | $0.00 | G/E ; T | n/a |
| 2B | 2 | Lance White | at-will | 2/1 Bath | $1,250.00 | G/E ; T | n/a |
| 2C | 2 | Samantha Fay | 7/31/2027 | 2/1 Bath | $1,300.00 | G/E ; T | n/a |
| 6 - COM | 1 | VACANT |  | n/a | $0.00 | G/E ; T | n/a |

### 9 Leach Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Stacey Dugon | 10/31/2027 | 2 Bed/1 Bath | $2,000.00 | E;T / G;L | W/D in unit |
| 2 | 2 | Lynette Tarrats | 7/31/2027 | 1 Bed/1 Bath | $1,100.00 | E;T / G;L | n/a |

### 9 Main Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| A1 | 1 | Alysha L Gilliland | 7/31/2027 | 1 Bed/1 Bath | $1,200.00 | G/E ; T | n/a |
| A2 | 2 | Troy Miller | 7/31/2027 | 1 Bed/1 Bath | $1,200.00 | G/E ; T | n/a |
| A3 | 2 | Amanda Starkey, Michael St | 7/31/2027 | 3 /1 Bath | $1,690.00 | G/E ; T | n/a |
| S1 | 1 | Mike Milliron | at-will | n/a | $1,000.00 | G/E ; T | n/a |

### 15-17 2nd Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 15-2 | 2 | Jonathan Stumpfel, Victoria | 3/31/2027 | 2 /1 Bath | $1,725.00 | G/E ; T | W/D in unit |
| 15-3F | 3 | Steve McCarthy | 4/30/2027 | - /1 Bath | $960.00 | G/E ; T | n/a |
| 15-3R | 3 | VACANT |  | 0 /1 Bath | $0.00 | G/E ; T | n/a |
| 15-Com. | 1 | Luis Medina | 9/26/2029 | commerical | $2,832.22 | G/E ; T | n/a |
| 17-1 | 1 | VACANT |  | 1/1 Bath | $0.00 | G/E ; T | W/D in unit |
| 17-2 | 2 | Michael Haber | 2/29/2028 | 1/1 Bath | $1,698.00 | G/E ; T | W/D in unit |
| 17-3 | 3 | Paul Joyce, Jessica Singleto | 5/31/2028 | 1/1 Bath | $1,925.00 | G/E ; T | W/D in unit |

### 19 Garner Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1L | 1 | David Erby, Danielle Lord | 6/30/2027 | 2 /1 Bath | $1,450.00 | G/E ; T | hookups |
| 1R | 1 | Keith Cole | 3/31/2027 | 1/1 Bath | $1,100.00 | G/E ; T | hookups |
| 2L | 2 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | hookups |
| 2R | 2 | VACANT |  | 2/1 Bath | $0.00 | G/E ; T | hookups |

### 21 Lincoln Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Linda Labelle | at-will | 2 Bed/1 Bath | $750.00 | G/E ; T | hookups |
| 2 | 2 | Holly LaBelle | at-will | 2 Bed/1 Bath | $1,350.00 | G/E ; T | hookups |

### 22 Lincoln Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Joanna Labelle | 11/30/2026 | 3 Bed/1 Bath | $1,050.00 | G/E ; T | hookups |
| 2 | 2 | Marlesia Lewis | at-will | 4 Bed/1 Bath | $1,350.00 | G/E ; T | hookups |

### 24 107th Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | n/a |
| 2 | 2 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | n/a |

### 27 7th Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Melissa Hauser | 10/31/2027 | 3/1 Bath | $2,100.00 | G/E ; T | W/D in unit |

### 35 Viall Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Ken Hall | at-will | 2/ 1 | $900.00 | G/E ; T | hookups |
| 2 | 2 | Jacqueline Franz | 10/31/2026 | 2/1 | $1,350.00 | G/E ; T | hookups |

### 36 Spring Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1F | 1 | VACANT |  | Studio/1 Bath | $0.00 | G/E ; T | comm. bsmt |
| 1R | 1 | Evan Meda | 4/30/2027 | 1/1 Bath | $1,050.00 | G/E ; T | comm. bsmt |
| 2F | 2 | VACANT |  | Studio/1 Bath | $0.00 | G/E ; T | comm. bsmt |
| 2R | 2 | Evan Bottomley | at-will | 1/1 Bath | $1,050.00 | G/E ; T | comm. bsmt |
| 3F | 3 | VACANT |  | 1 Bed/1 Bath | $0.00 | G/E ; T | comm. bsmt |
| 3R | 3 | Keshia Small | 6/30/2027 | 1/1 Bath | $1,200.00 | G/E ; T | comm. bsmt |

### 37 Mulberry Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 37A | 1 | Terry Aldrich, Laurie Aldrich | 3/31/2027 | 1/1 | $1,180.00 | G/E ; T | hookups |
| 37B | 2 | Chad Bouchard, Alissa Slitte | at-will | 1/1 | $1,100.00 | G/E ; T | hookups |
| 39A | 1 | Patrick James | 11/30/2026 | 2/1 | $1,374.00 | G/E ; T | hookups |
| 39B | 2 | John Cefferillo | at-will | 1/ 1 | $970.00 | G/E ; T | hookups |

### 46 Second Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Natasha Amacreon | 11/30/2026 | 3 Bed/1 Bath | $1,700.00 | G/E ; T | n/a |
| 2 | 2 | Qulaysha Nareese Blunt | at-will | 4 Bed/1 Bath | $1,750.00 | G/E ; T | n/a |

### 46 - 48 South Lake Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 2 | 1 | VACANT |  | 1/1 | $0.00 | G/E ; T | Com. Bsmt |
| 3 | 1 | VACANT |  | 2 Bed/1 Bath | $0.00 | G/E ; T | Com. Bsmt |
| 4 | 1 | Kristen Jones | at-will | 2/1 | $1,200.00 | G/E ; T | Com. Bsmt |
| 5 | 2 | VACANT |  | 1 Bed/1 Bath | $0.00 | G/E ; T | Com. Bsmt |
| 6 | 2 | Kimberlee Hart, Armon Days | 2/28/2027 | 2/1 | $1,250.00 | G/E ; T | Com. Bsmt |
| 7 | 2 | Vanessa Taylor | at-will | 2 Bed/ 1 | $1,100.00 | G/E ; T | Com. Bsmt |
| 8 | 1 | George Poole, Diane Thorel | 10/31/2027 | 2/1 | $1,330.00 | G/E ; T | Com. Bsmt |
| 9 | 1 | Jacob Matson | at-will | 2/1 | $1,250.00 | G/E ; T | Com. Bsmt |
| 10 | 1 | Lisa Skala | 10/31/2026 | 2/1 | $1,250.00 | G/E ; T | Com. Bsmt |
| 11 | 2 | VACANT |  | 2 Bed/1 Bath | $0.00 | G/E ; T | Com. Bsmt |
| 12 | 2 | Barbara Rodriguez | 11/30/2026 | 2/1 | $1,300.00 | G/E ; T | Com. Bsmt |
| 13 | 2 | Ayona Vasquez | at-will | 3/1 | $1,300.00 | G/E ; T | Com. Bsmt |
| 14 | 2 | Destiny Cagler | 4/30/2027 | 1/1 | $1,050.00 | G/E ; T | Com. Bsmt |
| 15 | 2 | Dasani Adams, Carmen Cor | 11/30/2026 | 1/1 | $1,155.00 | G/E ; T | Com. Bsmt |

### 52 Bassett Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Desiree Ferguson | 11/30/2026 | 1 /1 Bath | $1,275.00 | G/E ; T | n/a |
| 2 | 2 | VACANT |  | 2 Bed/1 Bath | $0.00 | G/E ; T | n/a |
| 3 | 3 | VACANT |  | 2 Bed/1 Bath | $0.00 | G/E ; T | n/a |

### 54 Alexander Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 1 Bed/1 Bath | $0.00 | G/E ; T |  |
| 2 | 2 | VACANT |  | -/- | $0.00 | G/E ; T | selling property |
| 3 | 3 | VACANT |  | 2 Bed/1 Bath | $0.00 | G/E ; T |  |

### 68 Jefferson Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Dominic Jones | at-will | 1 Bed/1 Bath | $900.00 | G/E ; T | n/a |
| 2 | 2 | Troy -- | at-will | 1 Bed/1 Bath | $900.00 | G/E ; T | n/a |
| Basement | bsmt | Joel Stroud Stroud, Jennifer | at-will | 1 Bed/1 Bath | $800.00 | G/E ; T | n/a |

### 73 Tallow Wood Drive

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Sergio Alfaro | 8/31/2027 | 3 Bed/1.5 Bath | $2,200.00 | G/E ; T | W/D in unit |

### 74 Cooks Court

_LMAT cell reads "Hookups or W/D in unit" (wrapped over two lines in the source)._

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Cassandra Gipe | 4/30/2027 | 2/1.5 Bath | $1,940.00 | G/E ; T | Hookups or W/D in unit |

### 77 Viall Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Tylar McBride, Hunter Wickh | 9/30/2027 | 2/1 | $1,025.00 | G/E ; T |  |
| 2 | 2 | Abigale Harding, Cameron B | 10/31/2027 | 2 Bed/ 1 | $1,300.00 | G/E ; T | Hookups |

### 89 Howard Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 1 Bed/1 Bath | $0.00 | G/E ; T | n/a |
| 2 | 2 | VACANT |  | 1 Bed/1 Bath | $0.00 | G/E ; T | n/a |

### 105 West Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Mercades Gibson | at-will | 2/1 Bath | $1,225.00 | G/E ; T | W/D in unit |
| 2 | 2 | Keron Carter | at-will | 3/1 Bath | $1,300.00 | G/E ; T | W/D in unit |

### 106 Elsmere Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | George Odom, Jessica Noye | at-will | 2/1 | $1,200.00 | G/E ; T | W/D in unit |
| 2 | 1 | VACANT |  | 2/1 | $0.00 | G/E ; T | W/D in unit |
| 3 | 1 | jubilee sittner | 10/31/2027 | 2/1 | $1,250.00 | G/E ; T | W/D in unit |
| 4 | 1 | Sidrah Stevens | at-will | 2/1 | $1,000.00 | G/E ; T | W/D in unit |

### 109 Washington Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Mark Mayer, Ashley Colley | 8/31/2027 | 3 Bed/1.5 Bath | $3,000.00 | G/E ; T | W/D in unit |
| 2 | 2 | Georgia Mills, Andrew Bockm | 7/31/2027 | 3/1.5 | $2,800.00 | G/E ; T | W/D in unit |
| 3 | 3 | John McCarthy | 10/31/2026 | 1/1 Bath | $2,000.00 | G/E ; T | W/D in unit |

### 114 Washington Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Itrice Dann | 2/28/2027 | 1 Bed/1 Bath | $1,050.00 | G/E ; T | N/A |
| 2 | 2 | Abigail Thompson, Maize Ea | 7/31/2027 | 1 Bed/1 Bath | $1,050.00 | G/E ; T | N/A |
| 3 | 3 | James Leshkevich | 4/30/2027 | 1/1 Bath | $995.00 | G/E ; T | N/A |

### 115 Round Lake Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Clarence Johnson | at-will | 5/1 | $1,415.00 | G/E ; T | hookups |
| 2E | 2 | April Fernet | 7/31/2027 | 3/1 | $1,425.00 | G/E ; T | hookups |
| 2W | 2 | Kimberly Dorn | 2/28/2027 | 3 /1 | $1,375.00 | G/E ; T | hookups |

### 138 North 2nd Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Lydia Tironi | at-will | 1/1 Bath | $1,050.00 | G/E ; T |  |
| 2 | 1 | James Cornell, Bevin Corne | 5/31/2027 | 3 /1 Bath | $1,425.00 | G/E ; T |  |
| 3 | 2 | Cora Gagnon | at-will | 2/1 Bath | $1,200.00 | G/E ; T | hookups |
| 4 | 2 | John Murphy, Joshua Boyce | 3/31/2027 | 3 /1 Bath | $1,225.00 | G/E ; T | hookups |
| 5 | 1 | Kiera Walker | 3/31/2027 | 1 /1 Bath | $1,378.00 | G/E ; T | W/D in unit |

### 165 Saratoga Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 Back | 1 | Tennille Callahan, Katherine | 4/30/2027 | 3/1 Bath | $1,500.00 | G/E ; T | hookups |
| 1 Front | 1 | Mike Roll | 5/31/2027 | 1/1 Bath | $1,025.00 | G/E ; T | hookups |
| 2 | 2 | VACANT |  | 3/1 Bath | $0.00 | G/E ; T | hookups |
| 3 | 2 | Nadine Miller, Kareem Diggs | at-will | 3 /1 Bath | $1,500.00 | G/E ; T | hookups |
| 4 | 3 | Thomas Snay, Luther Nilsen | 2/28/2027 | 3/1 Bath | $1,575.00 | G/E ; T | hookups |
| 5 | 3 | Michelle Chan | at-will | 3 /1 Bath | $1,470.00 | G/E ; T | hookups |
| FL 1 | 1 | Sabrina Adkison | 9/30/2027 | 1/1 Bath | $1,100.00 | G/E ; T | hookups |

### 166 2nd St

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 0/1 Bath | $0.00 | G/E ; L | Com. Bsmt |
| 2 | 1 | Willie / Sharon Silva | 6/30/2027 | 1/1 Bath | $1,208.00 | G/E ; L | Com. Bsmt |
| 3 | 2 | michael mcloughlin | 10/31/2026 | 1 Bed/1 Bath | $1,125.00 | G/E ; L | Com. Bsmt |
| 4 | 2 | Matt Singleton | 4/30/2027 | 1 /1 Bath | $1,250.00 | G/E ; L | Com. Bsmt |
| 5 | 3 | James Stevens | 10/31/2026 | 1 Bed/1 Bath | $1,225.00 | G/E ; L | Com. Bsmt |
| 6 | 3 | VACANT |  | 0 /1 Bath | $0.00 | G/E ; L | Com. Bsmt |

### 171 Saratoga Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 4 Bed/1 Bath | $0.00 | G/E ; T |  |
| 2 | 2 | Joshua Callahan | at-will | 2 Bed/1 Bath | $985.00 | G/E ; T |  |
| 2nd floor L | 2 | Keshia Lopez | 9/30/2027 | 2 Bed/2 Bath | $1,350.00 | G/E ; T | W/D in unit |
| 3 | 1 | James Doty | at-will | 2 Bed/1 Bath | $1,700.00 | G/E ; T | W/D in unit |
| 4 | 2 | Beverly Doty | 9/30/2027 | 2 Bed/2 Bath | $1,428.00 | G/E ; T | W/D in unit |
| 5 | 1 | Mr. Windshield | 12/31/2026 | n/a | $420.00 | G/E ; T | n/a |

### 171-175 town garage road

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 171A | 1 | Joseph Nicoletti | at-will | 2 /1 Bath | $1,300.00 | G/E ; T | hookups |
| 171B | 1 | Arianna Jarvis, Evelyn Feath | 12/31/2026 | 2 /1 Bath | $1,400.00 | G/E ; T | hookups |
| 173A | 1 | Alicia Dick, Dalton Walker | at-will | 2/1 Bath | $1,100.00 | G/E ; T | hookups |
| 173B | 1 | Richard Dick | at-will | 2/1 Bath | $1,125.00 | G/E ; T | hookups |
| 175A | 1 | Brandon Dick | at-will | 2 /1 Bath | $1,100.00 | G/E ; T | hookups |
| 175B | 1 | Adam Bordeaux | 11/30/2026 | 2 /1 Bath | $1,350.00 | G/E ; T | hookups |

### 173 Saratoga Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Aryal Ganowski | at-will | 2/1 | $1,250.00 | G/E ; T | W/D in unit |
| 2 | 2 | Charles Casterlin | at-will | 2/1 | $1,020.00 | G/E ; T | W/D in unit |

### 185 Saratoga Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Thomas Brandt Jones, Moni | at-will | 3/1 | $1,300.00 | G/E ; T | Hookups |
| 2 | 2 | Holly Hauprich | at-will | 3/1 | $1,260.00 | G/E ; T | Hookups |

### 187 Saratoga Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Brandon Munhall | 4/30/2027 | 3 Bed/1 Bath | $1,450.00 | G/E ; T | n/a |
| 2 | 2 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | n/a |

### 208 Elm Street -new

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | bsmt | VACANT |  | 1/1 Bath | $0.00 | G/E ; T | n/a |
| 2 | 1 | VACANT |  | 1 Bed/1 Bath | $0.00 | G/E ; T | n/a |
| 3 | 2 | Prachi Sadarangani | 7/31/2027 | 1 Bed/1 Bath | $1,400.00 | G/E ; T | W/D in unit |

### 252 Saratoga Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Kaytlyn Kelly, Frankie Cruz | 3/31/2027 | 3 /1 Bath | $1,125.00 | G/E ; T | Hookups |
| 2 | 2 | Jennifer Salerno | at-will | 3/1 Bath | $1,417.00 | G/E ; T |  |
| 3 | 3 | James Manning | 3/31/2027 | 2 /1 Bath | $1,025.00 | G/E ; T |  |

### 280 9th Street

_Row-group highlighted yellow in the source, with a merged note cell reading "selling" in the LMAT column._

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T |  |
| 2 | 2 | Quasia Davis | at-will | 4 Bed/1 Bath | $1,800.00 | G/E ; T | selling |
| 3 | 3 | VACANT |  | 4 Bed/1 Bath | $0.00 | G/E ; T |  |

### 281 Ontario Street

_Row-group highlighted yellow in the source, with a merged note cell reading "selling" in the LMAT column._

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | - /1 Bath | $0.00 | G/E ; T | selling |
| 2 | 2 | VACANT |  | - /1 Bath | $0.00 | G/E ; T | selling |

### 300 State Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | bsmt | Kenyetta Garcia | 5/31/2027 | Studio/1 Bath | $1,000.00 | E;T / G;L | Com. Bsmt |
| 1A (Effic.) | 1 | Tachauntae Arrington | 7/31/2028 | 0/1 Bath | $0.01 | E;T / G;L | Com. Bsmt |
| 2 | bsmt | Christine Blakely, Emily Blak | 5/31/2027 | Studio/1 Bath | $1,000.00 | E;T / G;L | Com. Bsmt |
| 3 | 1 | Hope Savercool | 3/31/2027 | Studio/1 Bath | $1,150.00 | E;T / G;L | Com. Bsmt |
| 4 | 1 | Tachauntae Arrington | 7/31/2028 | 1 Bed/1 Bath | $1,750.00 | E;T / G;L | Com. Bsmt |
| 5 | 2 | Ikeyara Leake | 9/30/2027 | 1 Bed/1 Bath | $1,400.00 | E;T / G;L | Com. Bsmt |
| 6 | 2 | Austin Scarborough | 5/31/2027 | 1 Bed/1 Bath | $1,370.00 | E;T / G;L | Com. Bsmt |
| 7 | 3 | Marcus Burns | 7/31/2027 | 1 Bed/1 Bath | $1,362.00 | E;T / G;L | Com. Bsmt |
| 8 | 3 | Zachary Archibald | 3/31/2027 | 1 Bed/1 Bath | $1,335.00 | E;T / G;L | Com. Bsmt |

### 322 Park Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Cheryl Sullivan, Keith Garml | at-will | 3 /1 Bath | $1,100.00 | G/E ; T | hookups |
| 2 | 2 | Shelly McNamara, Chris Mc | at-will | 1/1 Bath | $725.00 | G/E ; T | Hookups |
| 2C | 2 | Stacy Urbanski | at-will | 1/1 Bath | $800.00 | G/E ; T | hookups |
| R1 | 1 | Evan Jones, Daniel Wilks | at-will | 1/1 Bath | $900.00 | G/E ; T | Hookups |
| R2 | 2 | Erin Coleman | 4/30/2027 | 1/1 Bath | $1,100.00 | G/E ; T | Hookups |

### 368 Madison Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Saiful Basir | 5/31/2027 | 0/1 Bath | $1,417.50 | G/E ; T | W/D in unit |
| 2 | 2 | Craig Hyatt | 10/31/2027 | 2 /1 Bath | $1,550.00 | G/E ; T | W/D in unit |
| 3 | 3 | Vince Seeraj, Justine DiCio | at-will | 2/1 Bath | $1,455.00 | G/E ; T | W/D in unit |

### 427 1st Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Shquajzhra Romero | at-will | 3 Bed/1 Bath | $1,500.00 | G/E ; T | n/a |
| 2 | 2 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | n/a |

### 448 5th Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | n/a |
| 2 | 2 | Nikita Colon | 7/31/2027 | 3 Bed/1 Bath | $1,550.00 | G/E ; T | n/a |

### 502 Broadway

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1L | 1 | Rei Morrill | at-will | 1 /1 Bath | $950.00 | G/E ; T | W/D in unit |
| 1R | 1 | Daniel Honsinger | at-will | 3 /1 Bath | $1,000.00 | G/E ; T | W/D in unit |
| 2L | 2 | Larissa Kacensky, Sage Gau | 8/31/2027 | 2 /1 Bath | $1,250.00 | G/E ; T | W/D in unit |
| 2R | 2 | John Nead | 3/31/2027 | 4 /1 Bath | $1,900.00 | G/E ; T | W/D in unit |

### 506 6th Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Sarah DuJack | at-will | 2 /1 Bath | $1,200.00 | G/E ; T | n/a |
| 2 | 2 | Kaitlyn Painton | at-will | 2 /1 Bath | $1,100.00 | G/E ; T | n/a |

### 521 1st Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1F | 1 | VACANT |  | 1 Bed/1 Bath | $0.00 | G/E ; T | n/a |
| 1R | 1 | Samina Edmond | at-will | 1 Bed/1 Bath | $1,100.00 | G/E ; T | W/D in unit |
| 2 | 2 | Khiree Norwood | at-will | 2 Bed/1 Bath | $1,750.00 | G/E ; T |  |
| 3 | 3 | Amber Temple | at-will | 2 Bed/1 Bath | $1,700.00 | G/E ; T |  |

### 531 2nd Street

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 |  | Wayne Smith | at-will | 2 Bed/1 Bath | $0.00 | G/E ; T | n/a |
| 2 |  | Arnell Johnson | at-will | 3 Bed/1 Bath | $2,600.00 | G/E ; T | n/a |

### 622 1st Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Quanifah Grissett | 6/30/2027 | 4 Bed/1 Bath | $1,650.00 | G/E ; T | n/a |
| 2 | 2 | Petrnana Slater | 8/31/2027 | 3 Bed/1 Bath | $1,600.00 | G/E ; T | n/a |

### 1447 Broadway

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Asucena Barboza-Rojas | 5/31/2027 | 3 Bed/1 Bath | $1,500.00 | G/E ; T | n/a |
| 2 | 2 | Jamilisse Santos, Rorri Clark | 7/31/2027 | 2 Bed/1 Bath | $1,400.00 | G/E ; T | n/a |

### 1815 Highland Avenue

| Unit | Floor # | Tenants | Lease End | Bed/Bath | Rent | G/E & T/L | LMAT |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Jahkiem Robinson | 12/31/2026 | 3 Bed/1 Bath | $1,520.00 | G/E ; T | n/a |
| 2 | 2 | VACANT |  | 3 Bed/1 Bath | $0.00 | G/E ; T | n/a |
