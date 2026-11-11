# Unit Information — Silver Team ("AI Information" rent roll)

**Source file:** `Unit Information Silver Team.pdf` (23 pages, letter size, scanned/image-only, no text layer; transcribed visually)

## What this doc is

A scanned spreadsheet printout titled "AI Information" (repeated at the top of every page) that lists, property by property, every unit managed by the "Silver Team" portfolio: the unit identifier, the tenant name(s), lease end date (or "at-will"), bedroom/bathroom layout, monthly rent, floor, laundry type, and whether the gas and electric utilities are paid by the tenant or the owner. It is the unit/tenant reference data intended to be fed to the AI ("Sarah" voice agent) and to seed the 518 Property Pro dashboard (properties, units, tenants, leases). It contains no phone numbers, emails, asset-manager names or team assignments; the only team indicator is the filename ("Silver Team").

## Key facts & rules

- Columns on every page: Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid.
- Properties are identified by street address only (no city/state, no owner, no asset manager, no contacts in this doc). Address style looks like Capital Region NY (e.g. State Street, Union Street, Van Vranken Avenue, Remsen Street) but this is NOT stated in the doc.
- Total properties (address blocks): 55. Total unit rows: 275 (counted from the transcription below; includes garages, commercial units and vacant units).
- Vacant units (tenant column literally "VACANT"): 20.
- Lease End is either a date (M/D/YYYY) or the literal string `at-will` (month-to-month / no fixed term). Treat `at-will` as a valid non-date value; a blank lease end appears only on VACANT rows.
- Gas Paid / Electric Paid use single letters: `T` = tenant pays, `O` = owner pays (interpretation inferred; the doc has no legend). Some rows (garages) leave both blank; one row (25 North Ferry Street unit 7) has Electric Paid blank.
- Laundry values seen: `BLDG` (shared in building), `IN UNIT`, `NO`, `N/A` (commercial).
- Bed/Bath values seen: `Studio/1 Bath`, `1 Bed/1 Bath`, `1 Bed/1.5 Bath`, `2 Bed/1 Bath`, `2 Bed/1.5 Bath`, `2 Bed/2 Bath`, `3 Bed/1 Bath`, `3 Bed/2 Bath`, `3 Bed/2.5 Bath`, `4 Bed/1 Bath`, `COMMERCIAL`, `GARAGE`, and `'- / -'` (unspecified).
- Floor values seen: numbers 1-6, `BSMT`, and some clipped values (see notes). Garage rows have no floor.
- Unit identifiers are NOT always numeric: e.g. `1N`, `1S`, `A1`, `COM`, `COM B`, `COM1`, `S1`, `S2`, `2R`, `1L`, `4-1A`, `1- FFF`, `NEST`, `Office`, `Garage`, `Garage #2`, `1st Floor`, `3rd Floor`, `2nd  Front`, `Basement`, `A  Basement ( F...`. Unit IDs must be stored as strings, and the same unit ID (e.g. `1`, `COM1`, `S1`) repeats across properties, so a unit is only unique per property.
- Tenant column often holds several people for one unit, comma-separated (e.g. "Kristen Felker, Jim Hennes..."); commercial units list business names (e.g. "Tacos N Stuff", "The Legal Project"). Many multi-tenant names are cut off in the scan (marked with `…` below, i.e. the source cell was truncated by the column width).
- Some units have rent `$0.00` (all of 301 Green Street units 101-117, 508 State Street 2C, 204 Lafayette Street 1B "Legal Project Apartment"); `$0.00` is a real value in the source, not missing data. Vacant units have blank rent.
- Commercial units: rent can be large (e.g. 204 Lafayette Street S2 `$11708.00`, 512 State Street NEST `$7012.37`).
- Pages are a continuous list; some properties continue across page breaks with no repeated address header (noted inline as "continued from previous page").
- Data appears current as of roughly late Oct 2026 (lease ends run from 10/31/2026 through 2030); treat as a snapshot, not live data.
- Do not invent contact info, owners or asset-manager assignments from this doc; none are given.

---

# Full transcription

Legend used in the tables: Gas/Electric `T` and `O` exactly as printed. Blank cells are blank in the source. `…` at the end of a name = text truncated in the source scan. `[unclear]` = unreadable. Page markers show which PDF page the rows came from.

## PDF page 1

### 1 Washington Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Tom Martin | 1/31/2027 | 1 Bed/1 Bath | $1025.00 | 1 | BLDG | T | T |
| 2 | Kendell Maliszewski | 6/30/2027 | 1 Bed/1 Bath | $1273.00 | 2 | BLDG | T | T |
| 3 | Eric Tasker | 2/28/2027 | 1 Bed/1 Bath | $1200.00 | 2 | BLDG | T | T |
| 4 | VACANT | | 2 Bed/1 Bath | | 3 | BLDG | T | T |
| 5 | Mary Cermak | 5/31/2027 | 2 Bed/1 Bath | $1177.00 | 2 | BLDG | T | T |
| 6 | Patsy Ann Joinnides | 9/30/2028 | 2 Bed/2 Bath | $1878.00 | 1 | IN UNIT | T | T |

### 4 Union Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Brennan Peters | 5/31/2027 | 1 Bed/1 Bath | $1280.00 | 1 | BLDG | O | T |
| 2 | Bernadette Jankauskas | 7/31/2027 | 1 Bed/1 Bath | $1418.00 | 1 | BLDG | O | T |
| 3 | Richard Mosher | 3/31/2027 | 1 Bed/1 Bath | $1257.00 | 1 | BLDG | O | T |
| 4 | Cindy Diaz | 2/28/2027 | 2 Bed/1 Bath | $1295.00 | 2 | BLDG | O | T |
| 5 | Brian Helba | at-will | 2 Bed/1 Bath | $1362.00 | 2 | BLDG | O | T |
| 6 | Ayesha Mayotte | 10/31/2026 | 1 Bed/1 Bath | $1260.00 | 2 | BLDG | O | T |
| 7 | Dakarai Grant | at-will | 1 Bed/1 Bath | $1017.00 | 3 | BLDG | O | T |
| 8 | Shelby LeMay, Michael Eh… | 6/30/2027 | 1 Bed/1 Bath | $1275.00 | 3 | BLDG | O | T |
| 9 | Tierza Roth | 10/31/2027 | 1 Bed/1 Bath | $1203.00 | 3 | BLDG | O | T |

(4 Union Street continues on page 2.)

## PDF page 2

### 4 Union Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 10 | Omari Olds, Alexis Jones | at-will | 1 Bed/1 Bath | $1050.00 | BSMT | BLDG | O | T |

### 9 Lexington Court

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 9 Lexington Cou… (unit cell truncated; whole house) | Ciara Guibault | at-will | 2 Bed/1.5 Bath | $2020.00 | 1 | IN UNIT | T | T |

### 9 Madison Place

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Kristen Felker, Jim Hennes… | at-will | 1 Bed/1 Bath | $2200.00 | 1 | BLDG | O | T |
| 2 | Madison Albright, Kyra No… | 4/30/2027 | 2 Bed/1 Bath | $1700.00 | 2 | BLDG | O | T |
| 3 | Gwendolyn Saul | 6/30/2027 | 2 Bed/2 Bath | $1118.00 | 3 | BLDG | O | T |
| Garden | Michelle Kresock | 6/30/2027 | 1 Bed/1 Bath | $1017.00 | BSMT | BLDG | O | T |

### 9 Union Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Darcy DeRocker | at-will | 1 Bed/1 Bath | $1095.00 | 1 | BLDG | T | T |
| 2 | Scott Nicolai, Ronelle McC… | 7/31/2028 | 1 Bed/1 Bath | $1325.00 | 1 | BLDG | T | T |
| 3 | Allison Suttenberg, Cass K… | 4/30/2027 | 2 Bed/1 Bath | $1231.00 | 1 | BLDG | T | T |
| 4 | Raymond Gonzalez | 7/31/2027 | 1 Bed/1 Bath | $1184.00 | 2 | BLDG | T | T |
| 5 | Noah Fry | 12/31/2026 | 1 Bed/1 Bath | $1125.00 | 2 | BLDG | T | T |

(9 Union Street continues on page 3.)

## PDF page 3

### 9 Union Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 6 | Aaron Neal | at-will | 2 Bed/1 Bath | $1295.00 | 3 | BLDG | T | T |

### 10 Madison Place

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Austin Hubler, Benjamin S… | 11/30/2026 | 1 Bed/1 Bath | $1800.00 | 1 | BLDG | O | T |
| 2 | Lily Nguyen-Lebo, Emma I… | 2/28/2027 | 2 Bed/1 Bath | $1926.00 | 2 | BLDG | O | T |
| 3 | Donna Hamilton | 8/31/2027 | 1 Bed/1 Bath | $1550.00 | 3 | BLDG | O | T |
| Garden | Makeba James | 10/31/2027 | 1 Bed/1 Bath | $1560.00 | BSMT | BLDG | O | T |

### 11 North Church Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Mollie Gilchrist | 10/31/2026 | 1 Bed/1 Bath | $1418.00 | 1 | BLDG | O | T |
| 2 | Erik Nelson | 11/30/2026 | 2 Bed/2 Bath | $2125.00 | 1 | IN UNIT | O | T |
| 3 | Susan Northrup | at-will | Studio/1 Bath | $956.00 | 2 | BLDG | O | T |
| 4 | Michael Basford | 2/28/2027 | 1 Bed/1 Bath | $1488.00 | 2 | BLDG | O | T |
| 5 | Peter Barvoets | 1/31/2027 | 1 Bed/1 Bath | $1389.00 | 2 | BLDG | O | T |
| 6 | VACANT | | 1 Bed/1 Bath | | 3 | BLDG | O | T |
| 7 | Ashley Kehoe | 6/30/2027 | 1 Bed/1 Bath | $1450.00 | 3 | BLDG | O | T |
| 8 | Justin Dempsey | 11/30/2026 | 1 Bed/1 Bath | $1100.00 | RRIAGE [clipped; likely "CARRIAGE"] | IN UNIT | T | T |

(11 North Church Street appears to continue on page 4; page 4 has no address header on its first rows.)

## PDF page 4

### 11 North Church Street (continued from previous page; no address header printed, inferred)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| A | Terrell Martin | 12/31/2026 | 1 Bed/1 Bath | $1295.00 | BSMT | BLDG | O | T |
| B | Leah Giacchetta | 12/31/2026 | 2 Bed/1 Bath | $1380.00 | BSMT | BLDG | O | T |
| Garage | Peter Atkinson, Shelley Lu… | at-will | GARAGE | $50.00 | | | | |

### 21 North College Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Christopher Pisano, Barba… | 7/31/2027 | 2 Bed/1 Bath | $1269.00 | 1 | BLDG | T | T |
| 2 | Brandon Williams | at-will | 2 Bed/1 Bath | $1255.00 | 2 | BLDG | T | T |

### 23 North College Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| A1 | Jennifer Higgins | 12/31/2026 | 2 Bed/1 Bath | $1495.00 | 1 | BLDG | O | T |
| A2 | Kyla Boultenhouse | 5/31/2027 | 2 Bed/1 Bath | $1450.00 | 2 | BLDG | O | T |
| COM | Ryan Marr | 5/31/2027 | COMMERCIAL | $708.00 | ARAGE [clipped; likely "GARAGE"] | N/A | T | T |
| COM B | Electric City Athletics | 4/30/2027 | COMMERCIAL | $2060.00 | ARAGE [clipped; likely "GARAGE"] | N/A | T | T |

### 25 North Ferry Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Paul Kearney | 7/31/2027 | 1 Bed/1 Bath | $1145.00 | 1 | BLDG | T | T |
| 2 | Nathan Stack | 10/31/2026 | 1 Bed/1 Bath | $1070.00 | 2 | BLDG | T | T |

(25 North Ferry Street continues on page 5.)

## PDF page 5

### 25 North Ferry Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 3 | Terrell McLaughlin | 4/30/2027 | 1 Bed/1 Bath | $1025.00 | 2 | BLDG | T | T |
| 4 | Amie Chabot, Jason Taylo… | at-will | 1 Bed/1 Bath | $1075.00 | 3 | BLDG | T | T |
| 5 | Destiny Bompers | 7/31/2027 | 1 Bed/1 Bath | $1145.00 | 3 | BLDG | T | T |
| 6 | Irving Greenwood | 8/31/2027 | 2 Bed/1 Bath | $1200.00 | 1 | BLDG | T | T |
| 7 | Daniel Walter Young, Moh… | 8/31/2027 | 2 Bed/1 Bath | $2022.00 | 1 | IN UNIT | T | (blank) |

### 32 North Ferry Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Kimberly Polner | 7/31/2027 | 1 Bed/1 Bath | $1100.00 | 1 | BLDG | T | T |
| 2 | Amalia Lanza | 12/31/2026 | 1 Bed/1 Bath | $1050.00 | 1 | BLDG | T | T |
| 3 | Jill Iversen | at-will | 1 Bed/1 Bath | $945.00 | 1 | BLDG | T | T |
| 4 | Bobby French | 8/31/2027 | 1 Bed/1 Bath | $1145.00 | 1 | BLDG | T | T |
| 5 | Courtney Aken | 5/31/2027 | 1 Bed/1 Bath | $1315.00 | 2 | BLDG | T | T |
| 6 | Tina Coughlin | 10/31/2027 | 1 Bed/1 Bath | $1250.00 | 2 | BLDG | T | T |
| 7 | Scott Ference | 8/31/2027 | 1 Bed/1 Bath | $1133.00 | 2 | BLDG | T | T |
| 8 | Kacie Williams, Jordan Blu… | 5/31/2027 | 1 Bed/1 Bath | $1231.00 | 3 | BLDG | T | T |
| 9 | Patrick Micheli | 12/31/2026 | 1 Bed/1 Bath | $1150.00 | 3 | BLDG | T | T |

## PDF page 6

### 33 North Ferry Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Julie Pamkowski | 8/31/2027 | 1 Bed/1 Bath | $1204.00 | 1 | BLDG | O | T |
| 2 | Lizette Arroyo | 5/31/2027 | 1 Bed/1 Bath | $1140.00 | 1 | BLDG | O | T |
| 3 | Stephanie Colgrove, Carlo… | 7/31/2027 | 2 Bed/1 Bath | $1445.00 | 2 | BLDG | O | T |
| 4 | Ronald Deloriea | 8/31/2027 | 1 Bed/1 Bath | $1278.00 | 2 | BLDG | O | T |
| 5 | Alexandra Kuzma | 1/31/2027 | 1 Bed/1 Bath | $1495.00 | 3 | BLDG | O | T |

### 43 Washington Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1N | JoAnne Langhauser | at-will | 2 Bed/1 Bath | $2045.00 | 1 | IN UNIT | T | T |
| 1S | Robert Yeates, Melanie Ye… | 10/31/2027 | 3 Bed/2.5 Bath | $2925.00 | 1 | IN UNIT | T | T |
| 2N | Jeffrey Becker | 12/31/2026 | 2 Bed/1 Bath | $1550.00 | 2 | IN UNIT | T | T |
| 2S | Tanya Thorne | 8/31/2027 | 3 Bed/2 Bath | $2140.00 | 2 | IN UNIT | T | T |
| 3N | Christine Skubon | 4/30/2027 | 2 Bed/1 Bath | $1595.00 | 3 | IN UNIT | T | T |
| 3S | Bailey Peters, Emily Adam… | 2/28/2027 | 3 Bed/2 Bath | $2050.00 | 3 | IN UNIT | T | T |

### 58 Washington Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | John Meltz, Julia Omelko… | 9/30/2027 | 2 Bed/1 Bath | $1750.00 | 1 | BLDG | O | T |

(58 Washington Avenue continues on page 7.)

## PDF page 7

### 58 Washington Avenue (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2 | Danielle Schimpf, Holden … | 9/30/2027 | 1 Bed/1 Bath | $1530.00 | 1 | BLDG | O | T |
| 3 | Zachary Arras, Hannah Le… | 11/30/2026 | 2 Bed/2 Bath | $1800.00 | 2 | BLDG | O | T |
| 4 | Kathryn Kiernan | 8/31/2027 | 2 Bed/1 Bath | $1350.00 | 3 | BLDG | O | T |
| 5 | Addiis Jackson | 6/30/2027 | 2 Bed/2 Bath | $1873.00 | 2 | IN UNIT | T | T |

### 86 Remsen Street

(In the source, the unit number is right-aligned in the Unit column for this block and the lease end is right-aligned.)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Tacos N Stuff | 9/14/2027 | COMMERCIAL | $2,050.00 | 1 | NO | T | T |
| 2 | Austin Kipp | 8/31/2027 | 3 Bed/1 Bath | $1,950.00 | 2 | IN UNIT | T | T |
| 3 | Amanda Chura, Breianna … | 8/31/2027 | 2 Bed/2 Bath | $2,400.00 | 3 | IN UNIT | T | T |

### 90 Hill Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Vendetta Williams, Robert… | at-will | 2 Bed/1 Bath | $1300.00 | 1 | NO | O | T |
| 2 | Patrick Mochrie | at-will | 2 Bed/1 Bath | $1050.00 | 2 | NO | O | T |

### 108 Jackson Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1st Floor | David Roberts | at-will | 2 Bed/1 Bath | $883.00 | 1 | NO | T | T |
| 2nd Floor | Sharavia Rivera | at-will | 2 Bed/1 Bath | $975.00 | 2 | NO | T | T |

(108 Jackson Avenue continues on page 8.)

## PDF page 8

### 108 Jackson Avenue (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 3rd Floor | Adrianna Mimbs | 5/31/2027 | 3 Bed/1 Bath | $1250.00 | 3 | NO | T | T |

### 113 Front Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Joe Bondi | 1/31/2027 | 1 Bed/1 Bath | $1260.00 | 1 | BLDG | T | T |
| 2 | Ortelio Gibson | 2/28/2027 | 1 Bed/1 Bath | $1100.00 | 1 | BLDG | T | T |
| 3 | Don Keyser | 9/30/2027 | Studio/1 Bath | $945.00 | 1 | BLDG | T | T |
| 4 | Debbie Davis | 8/31/2027 | 2 Bed/1 Bath | $1378.00 | 2 | BLDG | T | T |
| 5 | Victoria Gatta | 10/31/2027 | 2 Bed/1 Bath | $1563.00 | 2 | BLDG | T | T |
| 6 | Colleen Macaulay | at-will | 2 Bed/1 Bath | $1470.00 | 3 | BLDG | T | T |

### 132 Johnston Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Justin Buck, Felycha Buck | 7/31/2027 | 4 Bed/1 Bath | $1500.00 | 1 | IN UNIT | T | T |
| 2nd  Front | Amanda Gagnon | at-will | 2 Bed/1 Bath | $600.00 | 2 | IN UNIT | T | T |
| 2nd  rear | Derrick Smart | at-will | 1 Bed/1 Bath | $950.00 | 2 | NO | T | T |

### 173 Western Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | VACANT | | Studio/1 Bath | | 1 | NO | O | O |

(173 Western Avenue continues on page 9.)

## PDF page 9

### 173 Western Avenue (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2 | Nicholas DeFalco | at-will | Studio/1 Bath | $660.00 | 2 | NO | O | O |
| 3 | John Carroll, Raquel Best… | at-will | 2 Bed/1 Bath | $1000.00 | 1 | NO | O | O |
| 4 | Ted Ewing | at-will | 1 Bed/1 Bath | $1000.00 | 2 | NO | O | T |
| 5 | Martin Brown | at-will | Studio/1 Bath | $500.00 | 2 | NO | O | T |
| 6 | John Curley | at-will | Studio/1 Bath | $700.00 | 2 | NO | O | T |
| 7 | Mark Beatty | at-will | Studio/1 Bath | $1000.00 | 2 | NO | O | O |
| 8 | Joseph Grande | at-will | Studio/1 Bath | $800.00 | 3 | NO | O | O |
| 9 | Liane Milton | at-will | Studio/1 Bath | $900.00 | 3 | NO | O | T |
| 10 | Roger Loux | at-will | 2 Bed/1 Bath | $500.00 | 3 | NO | O | T |
| 11 | Chase Lawson | at-will | 1 Bed/1 Bath | $700.00 | 3 | NO | O | O |
| 12 | William Tarantino | at-will | Studio/1 Bath | $590.00 | 3 | NO | O | O |

### 182 Remsen Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2 | Ashlee O'Connor, Dennis … | 12/31/2027 | 2 Bed/1 Bath | $1200.00 | 2 | IN UNIT | T | T |
| COM1 | The Daisy 182 LLC | 10/31/2028 | 2 Bed/1 Bath | $1800.00 | 1 | NO | T | T |

### 184 Remsen Street

(Header at bottom of page 9; rows are on page 10.)

## PDF page 10

### 184 Remsen Street (rows)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2 | VACANT | | 1 Bed/1 Bath | | 2 | BLDG | T | T |
| COM1 | Arte Industrial Tattoo Studi… | 10/31/2027 | 1 Bed/1 Bath | $1200.00 | 1 | NO | T | T |

### 188 Remsen Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2 | Jason Geiger | 8/31/2027 | 2 Bed/1 Bath | $1488.00 | 2 | IN UNIT | T | T |
| 2R | Rose Tefoe, Allen Lemons… | 12/31/2026 | 2 Bed/1 Bath | $1260.00 | 2 | BLDG | T | T |
| 3 | Andy Dykeman-Daams, Ja… | 4/30/2027 | 2 Bed/1 Bath | $1391.00 | 3 | BLDG | T | T |
| COM1 | Mr Halal | 6/9/2030 | 2 Bed/1 Bath | $2600.00 | 1 | NO | T | T |

### 190 Remsen Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2 | Cara Sorensen | 9/30/2027 | 1 Bed/1 Bath | $1415.00 | 2 | IN UNIT | T | T |
| COM1 | Nocturnal Cookies | at-will | '- / -' | $1350.00 | 1 | NO | T | T |

### 204 Lafayette Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1A | Muhammed Yousaf | at-will | 1 Bed/1 Bath | $1200.00 | BSMT | IN UNIT | T | T |
| 1B | Legal Project Apartment | at-will | Studio/1 Bath | $0.00 | 2 | IN UNIT | T | T |
| 2A | Murad Raja | at-will | 2 Bed/1 Bath | $2150.00 | 2 | IN UNIT | T | T |

(204 Lafayette Street continues on page 11.)

## PDF page 11

### 204 Lafayette Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2B | Omkar Manchekar | 6/30/2027 | 1 Bed/1 Bath | $1124.00 | 2 | IN UNIT | T | T |
| 2C | Nyasia Haylette, Jasmine … | 7/31/2027 | 2 Bed/1 Bath | $2125.00 | 2 | IN UNIT | T | T |
| 3A | Robert Carreau | at-will | 2 Bed/1 Bath | $2210.00 | 3 | IN UNIT | T | T |
| 3B | Nicholas Pacyna | at-will | 1 Bed/1 Bath | $1395.00 | 3 | IN UNIT | T | T |
| 3C | VACANT | | 1 Bed/1 Bath | | 3 | IN UNIT | T | T |
| S1 | The Creative Collective Jo… | 12/31/2026 | '- / -' | $3440.00 | 1 | NO | T | T |
| S2 | The Legal Project LLC, To… | 8/31/2027 | '- / -' | $11708.00 | 1 | NO | T | T |

### 208 Union Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Christina Sharp, Kaylee S… | 4/30/2027 | 2 Bed/1 Bath | $1950.00 | 1 | BLDG | T | T |
| 3 | Tony Williams | 7/31/2027 | 2 Bed/1 Bath | $1315.00 | 2 | BLDG | T | T |
| 4 | John Perry | at-will | 1 Bed/1 Bath | $1141.00 | 2 | BLDG | T | T |
| 5 | Sarah Collins | 1/31/2027 | 1 Bed/1 Bath | $1050.00 | 3 | BLDG | T | T |
| 6 | Heather Williams | 3/31/2027 | 1 Bed/1 Bath | $1145.00 | 3 | BLDG | T | T |

(Note: 208 Union Street has no unit 2 in the source.)

### 250 Green Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Liam Cannon | at-will | 2 Bed/1 Bath | $1236.00 | 1 | IN UNIT | T | T |

(250 Green Street continues on page 12.)

## PDF page 12

### 250 Green Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 2 | Abigail Hileman, Alexande… | 1/31/2027 | 2 Bed/1 Bath | $1375.00 | 2 | IN UNIT | T | T |
| Garage | Roseann Kearney | at-will | GARAGE | $55.00 | | | | |

### 301 Green Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 101 | Daniel Hart | 5/31/2027 | 1 Bed/1 Bath | $0.00 | 1 | IN UNIT | T | T |
| 102 | Travis Fairlee | 10/31/2027 | 1 Bed/1 Bath | $0.00 | 1 | IN UNIT | T | T |
| 103 | Paul Maloney-Diamond | 9/30/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 104 | Michael Dombrowski | 4/30/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 105 | Nate Affinito | at-will | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 106 | Diana Hurlbert, Brandon T… | 3/31/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 107 | Genevieve Bushek, Andre… | 11/30/2026 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 108 | Brian Costello | 9/30/2027 | 1 Bed/1 Bath | $0.00 | 1 | IN UNIT | T | T |
| 109 | Joseph Braun | 1/31/2027 | 1 Bed/1 Bath | $0.00 | 1 | IN UNIT | T | T |
| 110 | Lucas LaBarre | 7/31/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 111 | Etienne Abelin, Katarzyna… | 8/31/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 112 | Cassandra Newman, Dere… | 6/30/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 113 | Kathleen Mahar, Ryan Hol… | 3/31/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |

(301 Green Street continues on page 13.)

## PDF page 13

### 301 Green Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 114 | Thach Thao Duong, Andre… | 8/10/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 115 | Marcel D'Aprile | 11/30/2026 | 1 Bed/1 Bath | $0.00 | 1 | IN UNIT | T | T |
| 116 | Brandon Bipat, Michael Mi… | 10/31/2027 | 2 Bed/2 Bath | $0.00 | 1 | IN UNIT | T | T |
| 117 | Abby Colvin | 10/31/2027 | 1 Bed/1 Bath | $0.00 | 1 | IN UNIT | T | T |

### 308 East Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| A  Basement ( F… (unit cell truncated) | Jason McLean | 7/31/2027 | 1 Bed/1 Bath | $1081.00 | 1 | NO | T | T |
| B Rear Left | Taylor Straight, Jakob Curt… | 3/31/2027 | 1 Bed/1.5 Bath | $1050.00 | 2 | IN UNIT | T | T |
| C Rear Right | Brandon Riddle | 2/28/2027 | 1 Bed/1 Bath | $1050.00 | 2 | IN UNIT | T | T |

### 318 Quail Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Jesus Polanco | 12/31/2026 | 1 Bed/1 Bath | $825.00 | 1 | NO | O | T |
| 2 | Anastasia Mainer | 10/31/2026 | 2 Bed/1 Bath | $1200.00 | 1 | NO | O | T |
| 3 | Johanna Sierra | 3/31/2027 | 1 Bed/1 Bath | $1100.00 | 2 | NO | O | T |
| 4 | Remdeemer Dixon | 9/30/2027 | 2 Bed/1 Bath | $1417.00 | 2 | NO | O | T |

### 361 Washington Avenue

(Header at bottom of page 13; rows are on page 14.)

## PDF page 14

### 361 Washington Avenue (rows)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Matthew Simon | 1/31/2027 | Studio/1 Bath | $1217.00 | 1 | NO | T | T |
| 2 | Kammi Long | 7/31/2027 | 1 Bed/1 Bath | $1100.00 | 1 | NO | T | T |
| 3 | Alberto Mosqueda | 2/28/2027 | Studio/1 Bath | $1217.00 | 1 | NO | T | T |
| 4 | Diamante Thompson | 7/31/2027 | Studio/1 Bath | $1000.00 | 2 | NO | T | T |
| 5 | Robert Kramer | 2/28/2027 | Studio/1 Bath | $1000.00 | 2 | NO | T | T |
| 6 | Lindsay Horn | 6/30/2027 | 1 Bed/1 Bath | $1000.00 | 2 | NO | T | T |
| 7 | Amani Kwame | 2/28/2027 | Studio/1 Bath | $1000.00 | 2 | NO | T | T |
| 8 | VACANT | | 2 Bed/1 Bath | | 3 | NO | T | T |
| 9 | Jesse Hogan | at-will | 1 Bed/1 Bath | $1131.00 | 3 | NO | T | T |

### 433 3rd Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Robert Barber, Makaylah B… | at-will | 2 Bed/1 Bath | $1250.00 | 1 | NO | T | T |
| 2 | VACANT | | 2 Bed/1 Bath | | 2 | NO | T | T |

### 457 4th Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Valerie Machnick, Gaetan… | 10/31/2026 | 3 Bed/1 Bath | $1100.00 | 1 | NO | T | T |
| 2 | Nigeriah Jenkins | at-will | 2 Bed/1 Bath | $997.50 | 2 | NO | T | T |

## PDF page 15

### 477 1st Street (includes 477-x and 479-x units)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 477-1 | VACANT | | 1 Bed/1 Bath | | 1 | NO | O | T |
| 477-2 | Danielle Casey | at-will | 2 Bed/1 Bath | $860.00 | 2 | NO | O | T |
| 479-1 | LaVynece Watson | 12/31/2026 | 1 Bed/1 Bath | $1100.00 | 1 | NO | O | T |
| 479-2 | Kayla Linster | 11/30/2027 | 2 Bed/1 Bath | $1350.00 | 2 | NO | O | T |

### 508 State Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1A | Ankith Prakash Chikkur | at-will | 1 Bed/1 Bath | $1325.00 | 1 | IN UNIT | T | T |
| 2A | Shalena Murray | at-will | 2 Bed/2 Bath | $1605.00 | 2 | IN UNIT | T | T |
| 2C | Kaytrin Ziemann, Devin Zi… | at-will | Studio/1 Bath | $0.00 | 2 | IN UNIT | T | T |
| 3A | Dylan Buckley | 10/31/2027 | 1 Bed/1 Bath | $1633.00 | 3 | IN UNIT | T | T |
| 3B | Avery Coston, Marquez D… | at-will | 2 Bed/2 Bath | $1750.00 | 3 | IN UNIT | T | T |
| 3C | Lauren France | at-will | 2 Bed/1 Bath | $1780.00 | 3 | IN UNIT | T | T |
| 4A | Victoria Palmer | 1/8/2027 | 1 Bed/1 Bath | $1546.00 | 4 | IN UNIT | T | T |
| 4B | Sam Conti | 3/31/2027 | 1 Bed/1 Bath | $1395.00 | 4 | IN UNIT | T | T |
| 4C | Zachary Zebrowski | 1/6/2027 | 1 Bed/1 Bath | $1415.00 | 4 | IN UNIT | T | T |

(508 State Street continues on page 16.)

## PDF page 16

### 508 State Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 5A | Xavier Dixon | 4/30/2027 | 1 Bed/1 Bath | $1696.00 | 5 | IN UNIT | T | T |
| 5B | Kimberly Swanteck | 4/30/2027 | 1 Bed/1 Bath | $1338.00 | 5 | IN UNIT | T | T |
| 5C | Gary Moore | 6/30/2027 | 1 Bed/1 Bath | $1466.00 | 5 | IN UNIT | T | T |
| 6P | Mary Sykes | 5/31/2027 | 2 Bed/2 Bath | $3033.00 | 6 | IN UNIT | T | T |
| S1 | Nicolette Domkowski | 12/31/2026 | COMMERCIAL | $3470.00 | 1 | NO | T | T |
| S2 | The Legal Project | 1/31/2027 | COMMERCIAL | $1525.00 | 1 | NO | T | T |

### 510 State Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Lorraine Made LLC | 1/31/2027 | COMMERCIAL | $750.00 | 1 | NO | T | T |

### 512 State Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| NEST | Devin Ziemann, Kaytrin Zi… | at-will | COMMERCIAL | $7012.37 | 1 | NO | T | T |

### 514 State Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| Office | Gary Delisle | at-will | COMMERCIAL | $1500.00 | 2 | NO | T | T |
| S1 | Nicolle Broughton | at-will | COMMERCIAL | $1325.00 | 1 | NO | T | T |

## PDF page 17

### 538-540 2nd Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 538-1 | VACANT | | 1 Bed/1 Bath | | 1 | NO | T | T |
| 538-2 | VACANT | | 2 Bed/1 Bath | | 2 | NO | T | T |
| 540-1 | Ray Novak | at-will | 1 Bed/1 Bath | $1075.00 | 1 | NO | T | T |
| 540-2 | Devera Pittman | at-will | 2 Bed/1 Bath | $1100.00 | 2 | NO | T | T |

### 551 5th Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | VACANT | | 2 Bed/1 Bath | | 1 | NO | T | T |
| 2 | VACANT | | 2 Bed/1 Bath | | 2 | NO | T | T |

### 687 State Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| A1 | Paris Steele | at-will | 3 Bed/1 Bath | $550.00 | 1 | NO | O | O |
| A2 | Datchele Charlene Johnso… | at-will | 3 Bed/1 Bath | $550.00 | 1 | NO | O | O |
| A3 | Charfadine Haoua | at-will | 3 Bed/1 Bath | $550.00 | 1 | NO | O | O |
| B1 | VACANT | | 4 Bed/1 Bath | | 2 | NO | O | O |
| B2 | Nicholas Davison | at-will | 4 Bed/1 Bath | $550.00 | 2 | NO | O | O |
| B3 | VACANT | | 4 Bed/1 Bath | | 2 | NO | O | O |

(687 State Street continues on page 18.)

## PDF page 18

### 687 State Street (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| B4 | VACANT | | 4 Bed/1 Bath | | 2 | NO | O | O |

### 718 East Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1- FFF | Kyle Hall, Hunter Harville-… | 11/30/2026 | 1 Bed/1 Bath | $1012.00 | 1 | NO | O | T |
| 2-FFR | Douglas Rust | at-will | 1 Bed/1 Bath | $845.00 | 2 | NO | O | T |
| 3-SFF | John Moore, Sherri St. Lou… | at-will | 1 Bed/1 Bath | $776.00 | 2 | NO | O | T |
| 4-SFR | Shannon Horan | 4/30/2027 | 1 Bed/1 Bath | $1036.00 | 2 | NO | O | T |
| 5- BF | VACANT | | 1 Bed/1 Bath | | 1 | NO | O | T |
| 6- BR | VACANT | | 1 Bed/1 Bath | | 1 | NO | O | T |

### 858 Union Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Clair Imbody, James Imbod… | at-will | 3 Bed/1 Bath | $1375.50 | 1 | BLDG | T | T |
| 2 | Hajir Ali, Mohammed Ham… | at-will | 3 Bed/1 Bath | $1500.00 | 2 | BLDG | T | T |

### 1009 19th Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Raymond Hebert | 12/31/2026 | 3 Bed/1 Bath | $1050.00 | 1 | NO | T | T |
| 2 | Bobbi Hyler | 1/31/2027 | 3 Bed/1 Bath | $1500.00 | 2 | NO | T | T |

## PDF page 19

### 1084 Wendell Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Kendall Ransom | 4/30/2028 | 2 Bed/1 Bath | $1750.00 | 1 | IN UNIT | T | T |
| 1R | Andrea Van Wyk | 1/31/2027 | 2 Bed/1 Bath | $1400.00 | 1 | BLDG | T | T |
| 2L | Karla Baldwin | 8/31/2027 | 2 Bed/1 Bath | $1495.00 | 2 | BLDG | T | T |
| 2R | Chadwick Lacy, Leanne E… | at-will | 2 Bed/1 Bath | $1400.00 | 2 | BLDG | T | T |
| 3 | Yareli Rodriguez, Julio Ro… | at-will | 2 Bed/2 Bath | $2000.00 | 3 | BLDG | T | T |

### 1114 Union Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1L | Sydney Velazquez, Shyies… | 8/31/2027 | 1 Bed/1 Bath | $1395.00 | 1 | NO | T | T |
| 1R | Jordan Keller | 10/31/2026 | 1 Bed/1 Bath | $1375.00 | 1 | NO | T | T |
| 2L | Jacob Monser | at-will | 1 Bed/1 Bath | $1250.00 | 2 | NO | T | T |
| 2R | Emily Rene Snell | 7/31/2027 | 1 Bed/1 Bath | $1450.00 | 2 | NO | T | T |
| 3 | Maddie Erickson, Ethan G… | 3/31/2027 | 3 Bed/1 Bath | $1950.00 | 3 | IN UNIT | T | T |

### 1146 Madison Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 4-1A | Michael Mills | at-will | Studio/1 Bath | $1011.00 | 1 | NO | O | O |

(1146 Madison Avenue continues on page 20.)

## PDF page 20

### 1146 Madison Avenue (continued)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 4-1B | Jeffery Eaton | 3/31/2027 | Studio/1 Bath | $856.00 | 1 | NO | O | O |
| 4-1C | Betsy Harwell | 12/31/2026 | Studio/1 Bath | $1000.00 | 1 | NO | O | O |
| 4-1D | Kevin Ranck | at-will | Studio/1 Bath | $800.00 | 1 | NO | O | O |
| 4-2A | Donna Allen | 6/30/2027 | Studio/1 Bath | $1000.00 | 2 | NO | O | O |
| 4-2B | Brystol Gibbs | at-will | Studio/1 Bath | $900.00 | 2 | NO | O | O |
| 4-2C | James Hasham | at-will | Studio/1 Bath | $1150.00 | 2 | NO | O | O |
| 4-2D | LaSonya Miller | 7/31/2027 | Studio/1 Bath | $1000.00 | 2 | NO | O | O |
| 4-3A | VACANT | | Studio/1 Bath | | 3 | NO | O | O |
| 4-3B | VACANT | | Studio/1 Bath | | 3 | NO | O | O |

### 1211 Dean Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Miranda Hogan, Richard C… | at-will | 1 Bed/1 Bath | $1230.00 | 1 | BLDG | T | T |
| 2 | Francis Helion | 10/31/2026 | 1 Bed/1 Bath | $1260.00 | 1 | BLDG | T | T |
| 3 | Shelby Ferry | 10/31/2027 | 1 Bed/1 Bath | $1050.00 | 2 | BLDG | T | T |
| 4 | Elijah Clay | 1/31/2027 | 1 Bed/1 Bath | $1000.00 | 2 | BLDG | T | T |
| 5 | Karen Vanpatten | 6/30/2027 | Studio/1 Bath | $830.00 | 2 | BLDG | T | T |
| 6 | Michael O'Neil | 4/30/2027 | Studio/1 Bath | $900.00 | 2 | BLDG | T | T |

(1211 Dean Street continues on page 21.)

## PDF page 21

### 1211 Dean Street (continued from previous page; no address header printed, inferred)

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| Garage #2 | Robert Jaegly | at-will | GARAGE | $61.67 | | | | |
| Garage #3 | Patricia Mesec | at-will | GARAGE | $60.00 | | | | |

### 1226 Wendell Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1L | Nina Santana, Emily Santa… | 12/31/2026 | 2 Bed/1 Bath | $1295.00 | 1 | BLDG | T | T |
| 1R | Kelly Simpson | at-will | 1 Bed/1 Bath | $1300.00 | 1 | BLDG | T | T |
| 2L | Elizabeth VanSchaik | 4/30/2027 | 2 Bed/1 Bath | $1400.00 | 2 | BLDG | T | T |
| 2R | Katherine Parker | at-will | 2 Bed/1 Bath | $1400.00 | 2 | BLDG | T | T |
| 3rd floor | Sarah Barter | 3/31/2027 | 3 Bed/1 Bath | $2000.00 | 3 | BLDG | T | T |

### 1238 Union Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1L | Debora Maloney | at-will | 1 Bed/1 Bath | $900.00 | 1 | BLDG | T | T |
| 1R | Darold Myers, Janet Rose… | at-will | 3 Bed/2 Bath | $1350.00 | 1 | BLDG | T | T |
| 2L | Mariel Silpe | at-will | 2 Bed/1 Bath | $1300.00 | 2 | BLDG | T | T |
| 2R | Crystal Brijmohan | at-will | 2 Bed/1 Bath | $1500.00 | 2 | BLDG | T | T |
| 3 | Emily Boggs | at-will | 2 Bed/1 Bath | $1300.00 | 3 | BLDG | T | T |

## PDF page 22

### 1356 Union Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | William Dixon | at-will | 1 Bed/1 Bath | $1250.00 | 1 | NO | T | T |
| 2 | Molly Bracken | at-will | 2 Bed/1 Bath | $1250.00 | 2 | NO | T | T |
| 3 | Marina Viscusi | at-will | 1 Bed/1 Bath | $1050.00 | 3 | NO | T | T |
| 5 | Michael Kimmer | at-will | 3 Bed/1 Bath | $1350.00 | 3 | NO | T | T |
| Basement | Erica Pratcher, Lakeisha J… | at-will | 1 Bed/1 Bath | $1200.00 | BSMT | NO | T | T |

(1356 Union Street has no unit 4 in the source.)

### 1406 5th Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Tina Clarke | at-will | 2 Bed/1 Bath | $1250.00 | 1 | NO | O | T |
| 2 | Silvestre Acevedo | at-will | 2 Bed/1 Bath | $1200.00 | 2 | NO | O | T |
| 3 | James Davidson | at-will | 3 Bed/1 Bath | $1200.00 | 3 | NO | O | T |

### 1527 3rd Street

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Ian Bonnell | at-will | 1 Bed/1 Bath | $1250.00 | 1 | BLDG | T | T |
| 2 | Christopher Francisco | at-will | 1 Bed/1 Bath | $1250.00 | 2 | BLDG | T | T |
| 3 | Alice Betzhold | at-will | 1 Bed/1 Bath | $1250.00 | 3 | BLDG | T | T |

## PDF page 23

### 1581 Van Vranken Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | Anna Silverio | at-will | 2 Bed/1 Bath | $850.00 | 1 | IN UNIT | T | T |
| F | John Cahill | 7/31/2027 | 1 Bed/1 Bath | $1200.00 | 2 | NO | T | T |
| R | Mark Silvero | at-will | 1 Bed/1 Bath | $750.00 | 2 | NO | T | T |

### 1635 Van Vranken Avenue

| Unit | Tenants | Lease End | Bed/Bath | Rent | Floor | Laundry | Gas Paid | Electric Paid |
|---|---|---|---|---|---|---|---|---|
| 1 | VACANT | | 1 Bed/1 Bath | | 2 | NO | T | T |
| 2 | Aracellis Urgelles | at-will | 4 Bed/1 Bath | $1000.00 | 2 | NO | T | T |
| COM | Jorge Colon | at-will | '- / -' | $1100.00 | 1 | NO | T | T |

End of document (page 23 is the last page; the lower half of the page is blank).
