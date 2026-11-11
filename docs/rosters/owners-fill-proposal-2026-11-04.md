# Owner name/email fill proposal (2026-11-04)

Status: PROPOSAL ONLY. Nothing has been written to the Google Sheet. The write step runs only after approval. (Update: approved and written on 2026-11-04 for Gold only; see "Owners filled 2026-11-04" at the end.)

- Sheet: `1BtIdb_vUprOjXxg1Xk4cBiqcDQL0tWXa8Qd_-63lApg`, tabs Gold (284976210), Silver (1139911461), Make Up (Delia) (2128282752). Target columns: W = "Owners Name", X = "Owners Email Address". The hidden "Read me" tab was not touched.
- Source: `Rental Owners - Sheet1.pdf` (owners list from Nina, 5 pages, Google Sheets export with a real text layer, not a scan).
- Privacy: emails are masked (first character + *** + @domain). People are shown as initials; company names in full. Full values, plus the exact cell for each write, are kept only in the session scratchpad (`owners/proposal.json`), not in the repo.

## 1. Headline

- **Gold**: owner cells are empty on all 205 units (rows 2-206). All 59 Gold properties have a PDF entry: 56 are exact address matches and 3 are FUZZY matches that need your OK. In total that is 205 rows x 2 cells = 410 cell writes, of which 186 rows are exact and 19 rows are fuzzy.
- **Silver**: every unit is already filled (275/275), so nothing is proposed. 10 properties (52 units) CONFLICT with the PDF and are listed for you to decide on.
- **Make Up (Delia)**: every unit is already filled (101/101), so nothing is proposed. No conflicts. One filled property (5 Museum Lane) has no PDF entry.
- Before anything is written, two decisions are needed: (1) which name form goes in "Owners Name" (section 3), and (2) whether the 3 Gold fuzzy matches are approved (section 4).

## 2. Counts per class

Classes: A = cells empty and an unambiguous PDF match, so a fill is proposed. B = already filled and matching the PDF. B-form = already filled, same entity and same email, but a different name form (no action). C = filled but different from the PDF (conflict, no action). D = partly filled. E = no PDF entry. F = PDF property that matches no sheet property.

| Tab | A (fill) | B (match) | B-form | C (conflict) | D (partial) | E (no PDF) |
|---|---|---|---|---|---|---|
| Gold | 59 (205 units) | 0 (0 units) | 0 (0 units) | 0 (0 units) | 0 (0 units) | 0 (0 units) |
| Silver | 0 (0 units) | 31 (130 units) | 15 (93 units) | 10 (52 units) | 0 (0 units) | 0 (0 units) |
| Make Up (Delia) | 0 (0 units) | 30 (96 units) | 1 (4 units) | 0 (0 units) | 0 (0 units) | 1 (1 units) |

F (PDF properties with no sheet match): 17 property lines (section 7).

## 3. Decision needed: name form for "Owners Name"

Each PDF owner block has a "Rental owner name" (often an LLC) and a person (First + Last). The two existing tabs nearly always use the **person form**:

| Tab / property | Existing sheet value | PDF rental owner name | PDF person |
|---|---|---|---|
| Silver / 1635 Van Vranken Avenue | P. T. | Tetravine LLC | P. T. |
| Silver / 204 Lafayette Street | J. B. | Hotel Foster LLC | J. B. |
| Silver / 86 Remsen Street | N. S. | Ironclad Equity Group LLC | N. S. |
| Silver / 9 Madison Place | G. A. | 9 Madison Place LLC | G. A. |
| Silver / 108 Jackson Avenue | A. N. | Nye Properties LLC | A. N. |
| Silver / 173 Western Avenue | K. S. | 173 Western Ave LLC | K. S. |
| Silver / 1084 Wendell Avenue | B. B. | Union Wendell NY LLC | B. B. |
| Silver / 301 Green Street | P. P. | Window Factory Lofts | P. P. & P. S. |
| Silver / 1527 3rd Street | J. S. | North Country Property Rentals LLC | M. J. S. |
| Silver / 433 3rd Street | R. T. | CFL Holdings, LLC | R. T. |
| Silver / 1 Washington Avenue | Redburn | Redburn Stockade, LP | E. Y. J. |
| Silver / 687 State Street | Margherita Boys | Margherita Boys | (blank) |
| Make Up (Delia) / 19 Spring St, Troy | R. H. | Spring Avenue LLC | R. H. |
| Make Up (Delia) / 22-24 Crockett Ave, Troy | R. F. & L. B. | L. B. / R. F. | L. B. & R. F. |
| Make Up (Delia) / 17 Harrison Ave | P. F. & A. B. | Property Pro Rentals, LLC | P. F. & A. B. |

- Silver: of 56 properties, 40 use the person form ("First Last"; the PDF's short first name for B. B., not the full name). The exceptions are "Redburn" (15 properties, a short form of Redburn Stockade, LP) and "Margherita Boys" (687 State Street; the PDF gives no person for this one). 1635 Van Vranken Avenue holds the person form P. T., who is the person for Tetravine LLC in the PDF (same email).
- Make Up: all use the person form. Two-person owners are written as "First Last & First Last" (P. F. & A. B., R. F. & L. B.), and two emails are written as "a, b".
- For Gold, both forms are listed per property in section 5. **Option P (person form)** matches the existing convention. **Option R (rental owner name)** would put LLC names in Gold only. Choose one; the write step uses one form for every row.
- Two-person blocks in Gold, shown in person form following the Make Up "&" convention: T. P. & M. T. (block 50), C. A. & L. B. (block 29). The PDF's first-name cell for block 37 holds two first names joined by "and", with one shared last name, so the person form is literally "P. and S. G.". The first of those first names looks misspelled (one letter missing). It is kept as printed; please confirm the spelling with Nina.

## 4. FUZZY and AMBIGUOUS matches (need your OK; none are silently accepted)

Normalisation used for "exact": case, punctuation, spacing around "-", city suffix after a comma (Make Up), and St/Street, Ave/Avenue, Rd, Dr, Ln, Ct, Pl, N./North, S./South. Anything beyond that is listed here.

### FUZZY

| Tab | Sheet property | PDF property / link | PDF block | Effect | Reason |
|---|---|---|---|---|---|
| Gold | 39 Mulberry Street | (via LLC name 39 Mulberry St LLC) | #50 39 Mulberry St LLC | proposed fill (needs OK) | PDF has no "39 Mulberry Street" property line; the only link is the rental-owner name "39 Mulberry St LLC", whose listed property is 37 Mulberry Street. Gold has 37 and 39 Mulberry Street as separate properties (both Mechanicville). |
| Gold | 46 - 48 South Lake Avenue | 48 South Lake Avenue | #8 BCM Property Holdings, LLC | proposed fill (needs OK) | Sheet "46 - 48 South Lake Avenue" (Troy) vs PDF "48 South Lake Avenue": PDF gives only the 48 half of the range. |
| Gold | 208 Elm Street | 208 Elm Street -new | #39 N. B. | proposed fill (needs OK) | PDF property text has a trailing note "-new" after "208 Elm Street". |
| Silver | 479 1st Street | (via LLC name 477-479 First LLC) | #27 477-479 First LLC | already filled, class B | PDF has only "477 1st Street"; 479 linked only through the LLC name "477-479 First LLC". |
| Make Up (Delia) | 19 Spring St, Troy | 19 Spring Avenue | #23 Spring Avenue LLC | already filled, class B | Street type differs: sheet "St" vs PDF "Avenue" (owner "Spring Avenue LLC"). |
| Make Up (Delia) | 60 - 62 Broad St, Waterford | 60 Broad Street | #42 Property Pro Rentals, LLC | already filled, class B | Sheet range 60 - 62 vs PDF 60 only. |
| Make Up (Delia) | 81 Elsworth Ave, Mechanicville | 81 Ellsworth Avenue | #42 Property Pro Rentals, LLC | already filled, class B | Spelling: sheet "Elsworth" vs PDF "Ellsworth". |
| Make Up (Delia) | 119 South 2nd St, Mechanicville | 119 South 2nd Avenue | #42 Property Pro Rentals, LLC | already filled, class B | Street type differs: sheet "St" vs PDF "Avenue". |
| Make Up (Delia) | 133 North 3rd St, Mechanicville | 133 North 3rd Avenue | #42 Property Pro Rentals, LLC | already filled, class B | Street type differs: sheet "St" vs PDF "Avenue". |
| Make Up (Delia) | 218 North 4th St, Mechanicville | 218 North 4th Avenue | #42 Property Pro Rentals, LLC | already filled, class B | Street type differs: sheet "St" vs PDF "Avenue". |
| Make Up (Delia) | 536 3rd St, Watervliet | 536 3rd Avenue | #42 Property Pro Rentals, LLC | already filled, class B | Street type differs: sheet "St" vs PDF "Avenue". |
| Make Up (Delia) | 1502 7th St, Watervliet | 1502 7th Avenue | #42 Property Pro Rentals, LLC | already filled, class B | Street type differs: sheet "St" vs PDF "Avenue". |

### AMBIGUOUS (and ambiguity checks the brief asked about)

- **182 / 184 / 188 / 190 Remsen Street (Silver)**: the PDF lists these four properties in two owner blocks: block 5 (rental-owner sub-block R. B., person B. B., b***@gmail.com) and block 11 (E. M., E***@manulifeam.com). Silver already holds E. M. / e***@manulifeam.com, which matches block 11. No action, but the PDF itself is contradictory. Please confirm with Nina.
- **318 Quail Street and 361 Washington Avenue (Silver)**: each is listed twice inside the same K. S. block, under different LLCs ("318 Quail St" or "361 Washington LLC", and "477-479 First LLC"). The person and email are the same either way, so this matters only if the LLC form is chosen. It looks like a copy error in the PDF: "477-479 First LLC" probably owns 477 and 479 1st Street.
- **477 vs 479 1st Street (Silver)**: the PDF has only "477 1st Street". 479 is linked only through "477-479 First LLC" (see FUZZY). Both are already filled with K. S. and the same email (class B).
- **9 Main Street (Gold) vs 9 S. Main St (Make Up)**: resolved, not ambiguous. The PDF has both "9 Main Street" (block 13, GKM Holdings Hoosick Falls LLC) and a separate "9 South Main Street" (block 28, K. L.). The Gold property is in Hoosick Falls (City column), which matches the GKM LLC name. The Make Up property (Mechanicville) already holds K. L. Gold 9 Main Street is proposed for block 13 as an exact match.
- **Saratoga Avenue (Gold 165, 171, 173, 185, 187, 252, all Mechanicville)**: each house number appears exactly once in the PDF, all in block 50. The only other Saratoga Avenue in the PDF is 219 (block 42, in Make Up, already filled and matching). Not ambiguous.
- **37 Mulberry Street (Gold)**: exact match, but the PDF rental-owner name on that line is "39 Mulberry St LLC". The person and email are the same as for 39 Mulberry (block 50).

## 5. Proposed Gold fills (class A)

All Gold W/X cells are empty, confirmed on re-read. Each property's rows are contiguous. Option R = rental owner name, Option P = person form. The email is written the same way under either option (lowercased; two emails as "a, b").

| # | Property (Gold) | Rows (W/X) | Units | Match | PDF block | Option R (rental owner) | Option P (person) | Email (masked) |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 - 4 Strong Place | 2-9 | 8 | EXACT | #49 | EM Apartments LLC | P. T. M. | t***@hotmail.com |
| 2 | 1 Colonial Woods Lane | 10-13 | 4 | EXACT | #8 | GFY FYM LLC | C. L. | c***@gmail.com |
| 3 | 2 Colonial Woods Lane | 14-17 | 4 | EXACT | #8 | GFY FYM LLC | C. L. | c***@gmail.com |
| 4 | 2 Prout Avenue | 18-23 | 6 | EXACT | #8 | BCM Property Holdings, LLC | C. L. | c***@gmail.com |
| 5 | 3 Simmons Avenue | 24-27 | 4 | EXACT | #7 | O. F. | O. F. | c***@gmail.com |
| 6 | 3 South Marshall Street | 28-29 | 2 | EXACT | #15 | S. H. | S. H. | h***@gmail.com |
| 7 | 6 Orchard Lane | 30-31 | 2 | EXACT | #47 | S. A. | S. A. | s***@aol.com |
| 8 | 7 Stoney Creek Drive | 32 | 1 | EXACT | #19 | B. L. | B. L. | t***@gmail.com |
| 9 | 8 South Main Street | 33-38 | 6 | EXACT | #49 | IM Apartments LLC | P. T. M. | t***@hotmail.com |
| 10 | 9 Leach Avenue | 39-40 | 2 | EXACT | #18 | D. O. | D. O. | t***@gmail.com |
| 11 | 9 Main Street | 41-44 | 4 | EXACT | #13 | GKM Holdings Hoosick Falls LLC | G. M. | g***@gmail.com |
| 12 | 15-17 2nd Street | 45-51 | 7 | EXACT | #14 | Troy 15-17 2nd St. LLC | H. K. | h***@gmail.com |
| 13 | 19 Garner Street | 52-55 | 4 | EXACT | #49 | 555 Washington Ave LLC | P. T. M. | t***@hotmail.com |
| 14 | 21 Lincoln Avenue | 56-57 | 2 | EXACT | #48 | Troy 22 LM LLC | S. M. | s***@gmail.com |
| 15 | 22 Lincoln Avenue | 58-59 | 2 | EXACT | #48 | Troy 22 LM LLC | S. M. | s***@gmail.com |
| 16 | 24 107th Street | 60-61 | 2 | EXACT | #48 | FML Group, LLC | S. M. | s***@gmail.com |
| 17 | 27 7th Street | 62 | 1 | EXACT | #4 | W. S. | W. S. | b***@gmail.com |
| 18 | 35 Viall Avenue | 63-64 | 2 | EXACT | #50 | 185 Saratoga Avenue, LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 19 | 36 Spring Street | 65-70 | 6 | EXACT | #37 | Albrick LLC | P. and S. G. | m***@aol.com, s***@gmail.com |
| 20 | 37 Mulberry Street | 71-72 | 2 | EXACT | #50 | 39 Mulberry St LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 21 | 39 Mulberry Street | 73-74 | 2 | FUZZY | #50 | 39 Mulberry St LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 22 | 46 Second Avenue | 75-76 | 2 | EXACT | #48 | SCI Group 46 LLC | S. M. | s***@gmail.com |
| 23 | 46 - 48 South Lake Avenue | 77-90 | 14 | FUZZY | #8 | BCM Property Holdings, LLC | C. L. | c***@gmail.com |
| 24 | 52 Bassett Street | 91-93 | 3 | EXACT | #33 | L. W. | L. W. | l***@gmail.com |
| 25 | 54 Alexander Street | 94-96 | 3 | EXACT | #45 | Livingston Project LLC | R. F. | r***@gmail.com |
| 26 | 68 Jefferson Street | 97-99 | 3 | EXACT | #48 | FML Group, LLC | S. M. | s***@gmail.com |
| 27 | 73 Tallow Wood Drive | 100 | 1 | EXACT | #10 | S. D. | S. D. | d***@yahoo.com |
| 28 | 74 Cooks Court | 101 | 1 | EXACT | #34 | E. B. | E. B. | l***@hotmail.com |
| 29 | 77 Viall Avenue | 102-103 | 2 | EXACT | #50 | 171 Saratoga Avenue, LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 30 | 89 Howard Street | 104-105 | 2 | EXACT | #48 | SCI Group 46 LLC | S. M. | s***@gmail.com |
| 31 | 105 West Street | 106-107 | 2 | EXACT | #29 | C. A. and L. B. | C. A. & L. B. | l***@gmail.com |
| 32 | 106 Elsmere Avenue | 108-111 | 4 | EXACT | #8 | GFY FYM LLC | C. L. | c***@gmail.com |
| 33 | 109 Washington Street | 112-114 | 3 | EXACT | #13 | G. M. | G. M. | g***@gmail.com |
| 34 | 114 Washington Street | 115-117 | 3 | EXACT | #3 | Alcove Place LLC | A. C. | a***@gmail.com |
| 35 | 115 Round Lake Avenue | 118-120 | 3 | EXACT | #50 | 115 Round Lake Avenue, LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 36 | 138 North 2nd Avenue | 121-125 | 5 | EXACT | #50 | 138 North Second Ave LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 37 | 165 Saratoga Avenue | 126-132 | 7 | EXACT | #50 | 165 saratoga Ave LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 38 | 166 2nd St | 133-138 | 6 | EXACT | #3 | Alcove Place LLC | A. C. | a***@gmail.com |
| 39 | 171 Saratoga Avenue | 139-144 | 6 | EXACT | #50 | 171 Saratoga Avenue, LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 40 | 171-175 town garage road | 145-150 | 6 | EXACT | #8 | GFY Property Holdings LLC | C. L. | c***@gmail.com |
| 41 | 173 Saratoga Avenue | 151-152 | 2 | EXACT | #50 | 171 Saratoga Avenue, LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 42 | 185 Saratoga Avenue | 153-154 | 2 | EXACT | #50 | 185 Saratoga Avenue, LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 43 | 187 Saratoga Avenue | 155-156 | 2 | EXACT | #50 | 138 North Second Ave LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 44 | 208 Elm Street | 157-159 | 3 | FUZZY | #39 | N. B. | N. B. | n***@outlook.com |
| 45 | 252 Saratoga Avenue | 160-162 | 3 | EXACT | #50 | 115 Round Lake Avenue, LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 46 | 280 9th Street | 163-165 | 3 | EXACT | #48 | FML 663, LLC | S. M. | s***@gmail.com |
| 47 | 281 Ontario Street | 166-167 | 2 | EXACT | #6 | 281 Ontario St LLC | J. C. | c***@gmail.com |
| 48 | 300 State Street | 168-176 | 9 | EXACT | #37 | Allbrick Albany LLC. | P. and S. G. | m***@aol.com, s***@gmail.com |
| 49 | 322 Park Avenue | 177-181 | 5 | EXACT | #49 | 322 Park Ave LLC | P. T. M. | t***@hotmail.com |
| 50 | 368 Madison Avenue | 182-184 | 3 | EXACT | #30 | Clear Spring, LLC | J.-Y. L. | l***@gmail.com |
| 51 | 427 1st Street | 185-186 | 2 | EXACT | #48 | FML 427 LLC | S. M. | s***@gmail.com |
| 52 | 448 5th Avenue | 187-188 | 2 | EXACT | #40 | N. A. | N. A. | n***@yahoo.com |
| 53 | 502 Broadway | 189-192 | 4 | EXACT | #50 | 502 Broadway LLC | T. P. & M. T. | t***@gmail.com, m***@gmail.com |
| 54 | 506 6th Avenue | 193-194 | 2 | EXACT | #29 | C. A. and L. B. | C. A. & L. B. | l***@gmail.com |
| 55 | 521 1st Street | 195-198 | 4 | EXACT | #38 | H. M. | H. M. | m***@gmail.com |
| 56 | 531 2nd Street | 199-200 | 2 | EXACT | #48 | FML 427 LLC | S. M. | s***@gmail.com |
| 57 | 622 1st Avenue | 201-202 | 2 | EXACT | #48 | 861 Troy LLC | S. M. | s***@gmail.com |
| 58 | 1447 Broadway | 203-204 | 2 | EXACT | #21 | V. L. | V. L. | v***@gmail.com |
| 59 | 1815 Highland Avenue | 205-206 | 2 | EXACT | #48 | 861 Troy LLC | S. M. | s***@gmail.com |

## 6. Conflicts (class C): already filled but different from the PDF. No action proposed.

| Tab | Property | Units (rows) | Sheet name | Sheet email | PDF rental owner | PDF person | PDF email | What differs |
|---|---|---|---|---|---|---|---|---|
| Silver | 301 Green Street | 17 (139-155) | P. P. | p***@yahoo.com | Window Factory Lofts | P. P. & P. S. | p***@pvslaw.com | name + email |
| Silver | 433 3rd Street | 2 (172-173) | R. T. | s***@blockbuilderproperties.com | CFL Holdings, LLC | R. T. | s***@blockbuilderproperties.com | name |
| Silver | 1009 19th Street | 2 (220-221) | R. T. | s***@blockbuilderproperties.com | R. T. | R. T. | s***@blockbuilderproperties.com | name |
| Silver | 1084 Wendell Avenue | 5 (222-226) | B. B. | u***@gmail.com | Union Wendell NY LLC | B. B. | b***@gmail.com | email |
| Silver | 1114 Union Street | 5 (227-231) | B. B. | u***@gmail.com | Union Wendell NY LLC | B. B. | b***@gmail.com | email |
| Silver | 1226 Wendell Avenue | 5 (250-254) | B. B. | u***@gmail.com | Union Wendell NY LLC | B. B. | b***@gmail.com | email |
| Silver | 1238 Union Street | 5 (255-259) | B. B. | u***@gmail.com | Union Wendell NY LLC | B. B. | b***@gmail.com | email |
| Silver | 1356 Union Street | 5 (260-264) | B. B. | u***@gmail.com | Union Wendell NY LLC | B. B. | b***@gmail.com | email |
| Silver | 1527 3rd Street | 3 (268-270) | J. S. | n***@gmail.com | North Country Property Rentals LLC | M. J. S. | n***@gmail.com | name |
| Silver | 1581 Van Vranken Avenue | 3 (271-273) | B. B. | u***@gmail.com | 1583 Van Vraken | B. B. | b***@gmail.com | email |

Notes on the conflicts:
- **B. B. properties (1084 and 1226 Wendell Avenue; 1114, 1238 and 1356 Union Street; 1581 Van Vranken Avenue)**: the name matches, but the email differs. Silver has u***@gmail.com and the PDF has b***@gmail.com. The PDF rental-owner name for 1581 Van Vranken Avenue is printed as "1583 Van Vraken" (sic).
- **301 Green Street**: Silver has P. P. / p***@yahoo.com. The PDF has Window Factory Lofts, two people (P. P. and P. S.), and the email p***@pvslaw.com, which is a different address. The Silver name matches one of the two PDF people.
- **433 3rd Street and 1009 19th Street**: spelling of the first name. Silver has "Ra..." and the PDF has "Re..." (one letter differs). The email is identical.
- **1527 3rd Street**: the first name differs. Silver has J. S. and the PDF has M. J. S. (North Country Property Rentals LLC). The email is identical.

B-form (no conflict, shown for completeness): 15 Silver properties hold "Redburn" / e***@redburndev.com, and the PDF has Redburn Stockade, LP / E. Y. J. with the same email. Make Up 22-24 Crockett Ave holds the same two people and the same two emails as the PDF, in reverse order. Make Up emails for P. F. & A. B. start with a capital letter (P***/A***); this is case only, and the address is identical.

## 7. Partial (D), no PDF entry (E), and PDF properties with no sheet match (F)

- **D (partly filled)**: none on any tab.
- **E (sheet property with no PDF entry)**: Make Up "5 Museum Lane, Waterford" (1 unit, row 17), already filled with P. F. & A. B. The PDF lists only "7 Museum Lane" (block 42). Gold and Silver: none.
- **F (PDF property with no sheet property)**:
  - 7 John Street (block #13, GKM Holdings Hoosick Falls LLC)
  - 1A Congress Street (block #24, Capital City Realty, LLC)
  - 72 Fairview Avenue (block #26, Troy Sand & Gravel, Inc.)
  - 78 Fairview Avenue (block #26, Troy Sand & Gravel, Inc.)
  - 284 Watervliet Shaker Road (block #26, Troy Sand & Gravel, Inc.)
  - 8 Reichards Lake Road (block #26, Troy Sand & Gravel, Inc.)
  - 3590 New York 43 (block #26, Troy Sand & Gravel, Inc.)
  - 109 Bleeker Road (block #26, Troy Sand & Gravel, Inc.)
  - 169 Allen Road (block #26, Troy Sand & Gravel, Inc.)
  - 169 Tayer Road (block #26, Troy Sand & Gravel, Inc.)
  - 3568 U.S. 9 (block #26, Troy Sand & Gravel, Inc.)
  - 24 Grange Road (block #26, Troy Sand & Gravel, Inc.)
  - 7488 New York 66 (block #26, Troy Sand & Gravel, Inc.)
  - 621 Columbia Street Extension (block #26, Troy Sand & Gravel, Inc.)
  - 49 Broad Street (block #27, 49-51 Broad St LLC)
  - 417 7th Avenue (block #43, T. M.)
  - 195 Livingston Avenue (block #45, Livingston Project LLC)

## 8. Matches between the PDF and Make Up that were not exact (all already filled and matching; info only)

Listed in the FUZZY table: 19 Spring St (PDF 19 Spring Avenue), 60 - 62 Broad St (PDF 60 Broad Street), 81 Elsworth Ave (PDF 81 Ellsworth Avenue), and five where the sheet has "St" and the PDF has "Avenue" (119 South 2nd, 133 North 3rd, 218 North 4th, 536 3rd, 1502 7th). These are possible address typos in either source.

## 9. How the PDF was parsed and checked

- Result: **50 owner blocks** (one person/email each), containing **77 rental-owner-name sub-blocks** and **167 property lines**.
- Method: each page was rendered at 150 dpi, and the drawn horizontal grid lines were detected in each column separately (the name, first, last and email columns each have their own merged cells). Every property row was then assigned to the merged cell that contains it. The text came from `pdftotext -bbox-layout` word coordinates. Every page was also viewed by eye, and the dense areas (page 3 K. S. block, page 4/5 S. M. block) were viewed again at 300 dpi.
- Checks: the first/last/email column boundaries are identical on every page. Every rental-owner sub-block sits inside one person block. Every property line is assigned exactly once.
- Page breaks (no border at the page edge, so the block continues): block 12 Redburn Stockade, LP (p1-p2, 15 properties, starting at 1 Washington Avenue); block 26 Troy Sand & Gravel, Inc. (p2-p3, 12 properties); block 42 Property Pro Rentals, LLC (p3-p4, 26 properties, starting at 152 Main Street); block 48 S. M. (p4-p5), whose sub-block "SCI Group 46 LLC" itself spans the break (89 Howard Street on p4 + 46 Second Avenue on p5). Google Sheets repeats the clipped text of these cells outside the table area; those copies were ignored.

### Things in the PDF that are odd or uncertain (text is a real text layer, so characters are exact; content may be wrong)

- Block 5: the rental-owner name "1583 Van Vraken" (an address, misspelled) sits against property 1581 Van Vranken Avenue, and a person name (R. B.; the first-name column holds a short form) sits against the four Remsen properties, which are also listed under E. M.
- Block 36 (687 State Street, "Margherita Boys"): no first or last name.
- Block 37: the first first-name looks misspelled (one letter missing). The rental owners are spelled "Albrick LLC" (36 Spring Street) and "Allbrick Albany LLC." (300 State Street, with a trailing period). Both are kept as printed.
- Block 50: "165 saratoga Ave LLC" has a lower-case "s" as printed. "39 Mulberry St LLC" is attached to 37 Mulberry Street.
- Block 18: the last name and the email local part spell the surname differently (one letter differs). Block 35: one surname is spelled differently in the name and in the email (two letters swapped). Both are kept as printed.
- Block 12: the last-name cell holds two words (E. Y. J.). Block 39: the property is printed "208 Elm Street -new". Block 26: "169 Tayer Road" (probably Thayer) and "109 Bleeker Road" are as printed (not in any tab).
- Emails printed with capitals (E***@manulifeam.com, N***@outlook.com, S***@aol.com) are lowercased in the proposal.

## 10. For the write step

- The exact cells are in `proposal.json` → `proposed_writes` (205 entries: tab "Gold", row, `W<row>` / `X<row>`, both name options, the email, and `requires_extra_approval: true` for the 19 fuzzy rows).
- Re-read W/X just before writing, and write only cells that are still empty. Write only to Gold. Do not change Silver or Make Up.

## Owners filled 2026-11-04

Applied with the user's approval: the Gold owner cells on the live Sheet, then a re-import of Gold only to the Convex **dev** deployment `brilliant-badger-615`. Silver, Make Up and the hidden "Read me" tab were not written (Nikki's Silver values are kept exactly as they are; the Silver conflicts in section 6 go to Nikki as questions, see `questions-for-nikki-2026-11-04.md`). No ElevenLabs call. People are initials and emails are masked here, as above.

### User decisions applied

- **Name form:** Option P (the person form), the same form Nikki used on Silver. Two people are written as "First Last & First Last". Emails are lowercased, and two emails are written as "a, b".
- **G1:** the 3 FUZZY Gold matches are approved: 39 Mulberry Street (block 50), 46 - 48 South Lake Avenue (block 8), 208 Elm Street (block 39).
- **G2:** block 37 (36 Spring Street, 300 State Street) uses the names as printed in the PDF, in the two-person form "P. G. & S. G.". The PDF's spelling of the first first name (one letter missing) is kept, not corrected. This replaces the literal "P. and S. G." form shown in section 5 (15 rows: 65-70 and 168-176).

### Checks before the write (done again from scratch, not taken from the proposal)

- Every Gold property was re-matched to its PDF block from `owners.json`, using a separate address normaliser. 56 properties matched exactly one block, and the 3 approved FUZZY properties have no exact PDF line. The person name and email were re-derived from each block and compared with `proposal.json` for all 205 rows (cell W/X, Row ID, property, unit, block and match flag). The only differences were the 15 G2 rows, as decided.
- Each property's rows are contiguous and get one owner value. Every email is syntactically valid and lowercased. Every name contains only letters, spaces, hyphens and "&", with no leading, trailing or double spaces. Every name word and every email occurs verbatim in the PDF text layer.
- Result: 25 distinct owners across 59 properties. Two-person names: T. P. & M. T. (13 properties), P. G. & S. G. (2), C. A. & L. B. (2). Two-email cells: the T. P. & M. T. and P. G. & S. G. properties (15 properties).
- A snapshot of Gold A1:AV300 (values, formatted values, backgrounds and number formats) was taken before the write, and W/X were re-read just before it. All 410 target cells (W2:X206) were still empty, so **no cell was skipped**.

### How it was written

- One `batchUpdate`, guarded by the snapshot's revision id: 118 `repeatCell` requests, one per property per column, each with explicit row bounds and the field mask `userEnteredValue` only, so no formatting was changed. It applied on the first try.
- After-read and diff against the snapshot: exactly **410 value cells** changed (205 Owners Name + 205 Owners Email Address), each equal to the plan. No other value changed, and no background or number format changed.
- Files, in the session scratchpad only (they hold full values): `owners/fill/plan.json`, `owners/fill/request_repeat.json`, `owners/fill/snapshot_before_owners_2026-11-04_grid.json`, `owners/fill/after_owners_2026-11-04_grid.json`; the checker is `owners/fill/scripts/verify_proposal.py`.

### Mirror

`518-unit-rosters-normalized.xlsx` was replaced with a fresh xlsx export of the whole live Sheet (Drive export, all tabs). The previous mirror (17:33, after the Silver import) is backed up at `scratchpad/owners/fill/mirror_backup_before_owners_import_2026-11-04.xlsx`. Against the backup: **Gold 410 cells** (Owners Name 205, Owners Email Address 205), Silver 0, Make Up 0, Read me 0. The exported Gold owner values equal the plan on all 205 rows.

### Dry run, import, verify (Gold only, dev)

Command: the same as the Gold import earlier today (`--category gold --skip-flagged --expect-skipped G-020,G-063,G-084,G-113,G-134,G-136`, same org and admin stand-in).

- **Batched dry run** (4 batches): 0 errors, 199 rows, 59 properties, 6 held rows skipped as expected. Properties 0 created, **59 updated**. Units 199, residents 194 and source rows 199 were all unchanged. 31 rule-available (the same set as the first Gold import).
- **Apply** (4 batches): the same counts. A dry run afterwards reported everything unchanged.
- **Verify:** lossless check of 199 sheet rows against 199 DB rows, 8,756 cells, **0 differences**. Owner name on 59/59 Gold properties; owner emails 1 on 44 properties and 2 on 15; `ownerEmail` equals the first of `ownerEmails` on all 59. Occupancy, unit types and residents are unchanged.
- **Database diff (before/after dump of dev):** only the 59 Gold properties changed, and only `ownerName`, `ownerEmail`, `ownerEmails` and `updatedAt`. Every value equals the plan. The 575 units on dev are identical before and after. No Silver or Make Up record changed.
- **Owners on dev, per tab:** Gold 59/59, Silver 56/56, Make Up 32/32 properties with an owner name and owner email(s).
- **Org totals on dev:** 147 properties, 575 units, 49 available (unchanged).
