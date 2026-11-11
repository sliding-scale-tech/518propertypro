# Client context docs (index)

Markdown copies of the client's source docs. These are the source of truth for 518 Property Pro decisions, alongside SIMPLR-518-BUILD-PLAN.md and PROGRESS.md at the repo root. If a request conflicts with a doc here, flag it before building.

| File | Source file | What it is |
|---|---|---|
| [prd-v2.md](prd-v2.md) | `Simplr_518PropertyPro_PRD_v2.docx` (repo root) | Internal working PRD v2.0: scope, roles, mandatory unit-to-asset-manager routing, maintenance workflow, leasing, Stripe/ROS, out-of-scope list. |
| [sarah-configuration.md](sarah-configuration.md) | `Simplr × 518 Property Pro — Sarah Configuration.docx` (repo root) | Call-handling spec for the Sarah AI voice agent: question flows per call type, approved scripts and policies, emergency wording, and items Pat must confirm. |
| [gold-property-ai-info.md](gold-property-ai-info.md) | `GOLD Property AI info.pdf` (repo root) | Rent roll for the GOLD team: every property, unit, tenant, lease end, bed/bath, rent, and two undefined codes (G/E & T/L, LMAT). |
| [unit-information-silver-team.md](unit-information-silver-team.md) | `Unit Information Silver Team.pdf` (repo root) | Scanned rent roll for the Silver team (55 properties, 275 unit rows, 20 vacant) with tenant-paid/owner-paid gas and electric flags. |
| [unit-make-up.md](unit-make-up.md) | `Unit Make Up.docx` and `Unit Make Up.pdf` (repo root) | "Delia" unit roster (32 addresses, 101 units) with lease status, utilities, "Who" (T/O) and W/D codes. Not a make-ready process despite the name. |
| [work-order-receipt-and-owner-statement-samples.md](work-order-receipt-and-owner-statement-samples.md) | `doc06361220261023121513.pdf` (repo root) | Real samples: a paper work order, a Home Depot receipt, and a monthly owner statement. These show the work-order and ROS formats the dashboard must produce. |
| [stripe-questions-2026-11-03.md](stripe-questions-2026-11-03.md) | Email from Ellie Conway (Stripe Strategic Partnerships), 2026-11-03 | Stripe's 7 questions to answer before any live access (account model, products, code ownership, permissions, payment lifecycle, card fees, Buildium migration), plus its note on payment finality and on never emailing credentials. Options to discuss: `docs/finance/stripe-options-factsheet.md`. |

## Open questions for the client

- PRD v2 asks for a technician checklist; it was removed 2026-10-16 per client decision (see PROGRESS.md). PRD not yet updated.
- Sarah Configuration covers lease renewal, portal login, payment FAQs and eviction/late-rent, which the PRD says are not in the pilot unless confirmed.
- Unit rosters (Gold, Silver, Unit Make Up / "Delia – Rentals") use undefined codes: G/E & T/L, LMAT, Who (T/O), Gas/Electric Paid (T/O), W/D (H/U, H/K, BLDG). Meanings are inferred, not confirmed.
- "Delia" appears both as Accounting (Sarah Configuration owner menu) and as the label on the Unit Make Up roster. Confirm Delia's role and which asset manager/team owns those units.
- None of the rosters assign units to an asset manager by name; the PRD requires every unit to have exactly one. Team (Gold/Silver/Delia) → asset manager mapping is needed.
- Properties marked "selling" in the Gold roster (280 9th St, 281 Ontario St, 54 Alexander St unit 2): exclude from leasing?
- The work-order/owner-statement samples look like the ROS example the PRD said finance work was blocked on; confirm with client and Areeb.
- Unit Make Up "Total Monthly" ($106,689) excludes page 1; all pages total $126,474.

## Client answers

- **2026-10-30 (Delia's email, cc Patrick): At-will vs Month-to-month.** "At-will and Month-to-Month agreements are the same." The unit rosters now use one lease type, "Month-to-month" (see `docs/rosters/unit-fields-spec.md`).
- **2026-10-30 (Delia's email, cc Patrick): Unit Make Up sections.** "Delia - Rentals" is a portfolio owned by the company's owners. "Delia Management Properties" is managed for other owners, the same management as Nina's (Gold) and Nikki's (Silver). Gold and Silver are managed as well.

## Decisions by the user

- **2026-10-30:** user moved the area question to the start of the leasing intake; doc order otherwise unchanged. (Sarah config v11: "Which city or area are you looking to rent in?", then communities to avoid, then the doc's order. This knowingly departs from the question order in `sarah-configuration.md` section 1; section 14 makes the order configurable.)

- **2026-11-03, owner call routing (Sarah Configuration §13), user decisions:**
  1. **Existing owners only.** Sarah offers or uses the menu only after the caller says they own a property 518 manages. Tenants, prospects and everyone else never get the menu or a transfer and follow the existing flows (maintenance included). A prospect who wants 518 to manage their property still goes to Alex through route_owner_prospect (not a transfer). A tenant who asks to be put through to staff gets a message taken the existing way.
  2. **Transfer the call.** When an owner picks someone (name, role or keypad key), Sarah confirms briefly ("I'll put you through to Nina now") and transfers the call. Built as an ElevenLabs blind transfer: if the person doesn't answer, the call goes to that phone's own voicemail and does not come back to Sarah.
  3. **Build now, keep it off.** The six numbers and hours are not known yet; the user tests with their own number in one slot. Pat and Alex still have to supply the numbers, hours, no-answer and after-hours behaviour, and approve it (PRD line 193). See BACKLOG.md B36.
  4. **Owners are verified by property + email before any transfer (2026-11-03).** Order: the owner picks who they want (name, role or key), then Sarah asks which property they own with 518 Property Pro (matched like a tenant's address: an exact match, or options the caller confirms, never a guess), then the email address on file, which she reads back in spoken form and lets them correct. The server checks it against every owner email of that property (exact, case-insensitive, no fuzzy matching). Match: availability check, then the transfer. No match: one retry; after 2 failures, or when the property has no owner emails, Sarah takes a message and does not transfer. She never says which part failed, never reveals or hints at a stored email, and never confirms whether a property has emails on file. Owner emails exist only for the Make Up properties today; Silver and Gold owner emails come later (user's decision).
  5. **Test numbers (2026-11-03).** For testing, all six menu people transfer to one spare test number (+1 754-279-5559, a phone that rings a person and does not forward to Sarah). Several people may share a number, with a warning on the editor; the real numbers replace it before production.

## Implementation status of client requirements

- **2026-10-30/31, Sarah Configuration §10 (Work-Order Status):** live work-order lookup is now supported (tool `check_work_order_status`, Sarah config v13). Sarah still asks name, address, unit, issue and first-reported date in the doc's order. User decision 2026-10-31: an exact address + unit match is enough for her to give the recorded status. Resident verification (caller ID, or a name matching a resident of the unit) is a soft signal: it only adds the scheduled visit day and time, never blocks, and is never mentioned to the caller. If the lookup fails, she routes the question without stating a status, as the doc requires. Policy and status wording are pending Pat's confirmation (see BACKLOG.md).

## Adding a new doc

Convert it to Markdown here with the same header block (title, source, What this doc is, Key facts & rules, full transcription) and add a row to the table above.
