# Rental Owner Statement (ROS): build spec, Phase 1 (no Stripe)

- Status: built; updated 2026-11-11 to match the code as built (see the Changelog at the end). Written 2026-11-11.
- Golden reference: `ROS.pdf` pages 3-7, transcribed in `docs/context/work-order-receipt-and-owner-statement-samples.md`.
- Authoritative decisions: `~/.claude/projects/-Users-umaraurangzeb-Desktop-simplr-518property/memory/ros-decisions.md`.
- Open client questions (we do not wait on them): `docs/questions/workorder-ros-questions.md` (cited below as Q1-Q17).
- Every guess is marked `ASSUMPTION Ax` and listed in section 12. Each one is a constant or a setting, so it can change without a redesign.

Rules that apply to every package:

- Money is an integer number of cents everywhere: database, Convex args, the calculation module, the UI and the PDF. Never use float arithmetic on money. Convert typed text to cents with `parseDollarsToCents`. Show cents with `formatAmount` or `formatCurrency`. Both live in `convex/rosFormat.ts`, the one shared module (section 4.1).
- Dates are business dates: `YYYY-MM-DD` strings in America/New_York (`ROS_TIME_ZONE`). Do not build a `Date` from a `YYYY-MM-DD` string. Do string maths on it with the helpers in `rosFormat.ts`.
- Every expected failure throws `ConvexError` with a message the user can act on. Field errors throw `new ConvexError({ message, field })`. The existing `errorMessage()` in `components/ui/toast.tsx` already reads `data.message`. Never `throw new Error` for a condition the user can fix.
- Use loose arg validators (`v.optional(v.string())`, `v.optional(v.number())`), then check each field in the handler and throw the exact message from this spec. For ids, take a string, call `ctx.db.normalizeId`, and throw the field message when that returns null. Convex's own validator errors are generic, so they must never be the first check a user can hit.
- Every write that changes money, a setting or a statement writes an audit row with `writeAudit` (`convex/audit.ts`) in the same mutation.
- Builders must not deploy, run migrations, push to a Convex deployment, commit or push git. Only WP6 may install a package, and only after the supply-chain check in section 7.6. VibeSec applies to all web code: server-side authz on every function, no secrets on the client, and no `dangerouslySetInnerHTML`.

---

## 1. What we are building (overview)

```
Work orders (office close: Bill $, account, description, property-level flag)
        |                                    Accountant enters by hand: rent, landscaping,
        v                                    dump fees, predicate notices, contributions...
   [eligible, unbilled WOs]                          |
        |                                            v
        +-------------------> draft statement <--- ledgerEntries (manual rows, unbilled)
                                 |  (owner, month, ticked properties)
                                 |  + auto management fee (computed)
                                 |  + suggested owner draw (computed)
                                 |  + adjustments (deposits, reserve, early payments, unpaid bills)
                                 v
                 rosCalc.computeStatement (pure) -> summary, income statement, detail
                                 |
                       Finalize (one mutation)
                                 |
   WO rows, fee and draw are written into ledgerEntries with statementId; manual rows get statementId;
   WOs get billedStatementId; an immutable JSON snapshot is stored; months up to this one are locked
                                 |
                       PDF (react-pdf, from the snapshot)
```

- The ledger (`ledgerEntries`) is the record of money. A statement is computed from ledger rows plus the draft's not-yet-written rows (work orders, fee, draw). Nothing on the summary or income-statement pages is typed in, except four per-property adjustment inputs (early payments, unpaid bills, property reserve, and the security deposits held per unit).
- Before finalize, work-order, fee and draw rows exist only as computed lines. At finalize they are written to the ledger, and each ledger row gets the statement's id. A row that has a `statementId` is "billed" and can never change.
- "Remove" a line = exclude it from this statement. The source work order or ledger row is untouched and comes back on the next draft (carry-forward).
- Rent comes ONLY from the **Payments page** (5.9, 6.8, as built 2026-11-12): the accountant marks each unit's rent received per rent month (always the full roster rent, no partial payments); each payment is a Rent Income ledger row dated the day it was received (cash basis, like Buildium), so it lands on that month's statement. The roster-rent prefill (5.4.1) was removed.
- The management fee % is not per owner: it is one org default (5.00% until changed) with an optional own % per property (3.3, 5.2).
- Owners are identified by name AND email together; the property page's owner name and email link or create the owner automatically only when that is certain (5.2).
- A final statement is immutable. It is stored as a snapshot, and its period is locked for its properties. Corrections go in as rows in a later month.

---

## 2. Access (authorization)

- Who: the **admin view** (team admin flag or job roles `executive` (Alex), `maintenance_lead` (Pat), `simplr_admin`) and the **accountant view**. `viewFor()` in `convex/authz.ts` decides the view, and Alex is `executive`, so he has the admin view. Asset managers, technicians and people with no role are refused.
- New file `dashboard/convex/financeAccess.ts` (WP1):

```ts
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requireOrg, viewFor, type OrgContext } from "./authz";
import { canUseFinanceView } from "./rosPolicy";

export const FINANCE_DENIED = "You don't have access to owner statements.";

export function canUseFinance(org: OrgContext): boolean {
  return canUseFinanceView(viewFor(org.isAdmin, org.jobRoles));
}

/** First line of every finance query and mutation. */
export async function requireFinance(ctx: QueryCtx | MutationCtx): Promise<OrgContext> {
  const org = await requireOrg(ctx);
  if (!canUseFinance(org)) throw new ConvexError(FINANCE_DENIED);
  return org;
}

/** Field-level user error: the UI marks `field` red and shows `message` under it and in a toast. */
export function fieldError(field: string, message: string): ConvexError<{ message: string; field: string }> {
  return new ConvexError({ message, field });
}
```

- `rosPolicy.canUseFinanceView(view)` is pure: it returns `view === "admin" || view === "accountant"`.
- Every exported `query` / `mutation` in `ledgerAccounts.ts`, `owners.ts`, `ledger.ts`, `ownerStatements.ts` and `workOrderBilling.ts` calls `requireFinance(ctx)` first. A test checks this (section 9.4).
- Every record read by id must be checked as `doc.orgId === org.orgId`. If the check fails, throw the same "not found" message as for a missing record (`"Statement not found."`, `"Owner not found."`, `"Transaction not found."`, `"Account not found."`), so a record's existence is never leaked.
- UI: the finance routes are wrapped in `<RequireView views={["admin", "accountant"]}>`. That only hides the pages; the server check above is the actual boundary.
- "Accountant" is an assignable role as built: the Team page role picker and the invite panel offer Admin, Asset manager, Technician and Accountant (`APP_ROLES` / `jobRolesFor` in `convex/jobRoles.ts`). An accountant is stored as membership role `"member"` plus `jobRoles: ["accountant"]`, and `viewFor()` returns the `accountant` view for it.
- Out of scope (B31): someone with both `asset_manager` and `accountant` job roles gets the asset-manager view and is refused. This is a known limitation (see section 13).

---

## 3. Schema (WP1 owns `dashboard/convex/schema.ts`; no other package edits it)

All changes are additive. New fields on existing tables are `v.optional(...)`, so every existing row stays valid. No migration is needed. Two optional, idempotent one-offs exist: `feeMigration:copyOwnerFeesToLinks` (the management fee moved from the owner to the property link, section 3.3) and `workOrderBilling:backfillRosPending` fills `workOrders.rosPending` on work orders closed before that field existed (section 3.9). Until it has run, the build reads those work orders through a fallback, so nothing is missed.

### 3.1 Shared validators (top of schema.ts, or a new dependency-free `convex/rosValidators.ts` imported by schema.ts and the function files)

```ts
export const rowTypeValidator = v.union(
  v.literal("income"), v.literal("owner_contribution"), v.literal("other_addition"),
  v.literal("expense"), v.literal("owner_draw"), v.literal("other_subtraction"),
);
export const ledgerSourceValidator = v.union(
  v.literal("manual"), v.literal("work_order"), v.literal("management_fee"),
  v.literal("owner_draw"), v.literal("opening_balance"), v.literal("stripe"), v.literal("roster_rent"), v.literal("rent_payment"),
);
export const accountSystemKeyValidator = v.union(
  v.literal("rent_income"), v.literal("management_fees"), v.literal("owner_draw"),
  v.literal("owner_contribution"), v.literal("repairs"),
);
export const statementStatusValidator = v.union(v.literal("draft"), v.literal("final"), v.literal("discarded"));
```

`opening_balance` and `stripe` are reserved: v1 never writes them (the opening balance is a setting, see 3.3). `roster_rent` is DEPRECATED (2026-11-12): it was a Rent Income row prefilled from the roster rent and written only at finalize (`sourceId` = `<statementId>:<unitId>`, 5.4.1); it is no longer written, and the literal stays so historical rows remain valid. `rent_payment` (as built 2026-11-12) is rent marked received on the Payments page (5.9). `stripe` is for the B25 rent feed: such a row has `source: "stripe"`, `sourceId` = the Stripe payment id, type `income`, account Rent Income and memo `by {tenant}`, and it needs no other change. `paymentMethodValidator` = `"cash" | "check" | "money_order" | "other"`.

### 3.2 `owners` (new)

```ts
owners: defineTable({
  orgId: v.string(),
  legalName: v.string(),            // "Nye Properties LLC": the rental owner entity; one statement per entity
  nameKey: v.string(),              // normalizeNameKey(legalName). NOT unique: two owners can share a name when their emails differ (identity rule below). Owners typed by hand (owners.create / update) still refuse a name another non-merged owner has.
  contactFirstName: v.optional(v.string()),
  contactLastName: v.optional(v.string()),
  emails: v.array(v.string()),      // trimmed, lowercased, validated; [] allowed
  managementFeeBps: v.optional(v.number()), // DEPRECATED (2026-11-11): never read or written. The fee is per property now (3.3). Kept optional so old rows stay valid; feeMigration copies it onto links.
  payeeName: v.optional(v.string()),// owner draw "Name"; undefined = derived (see 4.2 effectivePayee)
  active: v.boolean(),
  source: v.union(v.literal("manual"), v.literal("sheet_import")), // "sheet_import" = created by the owners import or by the roster import's automatic link (section 8)
  importKey: v.optional(v.string()),// = nameKey for imported rows ("#2", "#3" for further owners of that name); makes re-import idempotent
  mergedIntoOwnerId: v.optional(v.id("owners")), // set by owners.merge: this owner is inactive, has no links and is never matched again
  mergedAt: v.optional(v.number()),
  createdFromPropertyId: v.optional(v.id("properties")), // set when the owner was created from a property page's owner name + email (automatic link, "Create owner", or "Link all exact matches")
  createdBy: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_org_and_name_key", ["orgId", "nameKey"])
  .index("by_org_and_import_key", ["orgId", "importKey"]),

ownerIdentityDismissals: defineTable({   // "Not the same owner" decisions (owners.dismissIdentityFlag)
  orgId: v.string(),
  kind: v.union(v.literal("owner_pair"), v.literal("property_owner")),
  key: v.string(),                       // owner_pair: ownerPairKey(a, b); property_owner: propertyOwnerKey(property, owner, signature)
  ownerId: v.id("owners"),
  otherOwnerId: v.optional(v.id("owners")),
  propertyId: v.optional(v.id("properties")),
  createdBy: v.optional(v.id("users")),
  createdAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_org_and_key", ["orgId", "key"]),
```

**Owner identity (as built, user decision 2026-11-11): an owner is identified by NAME and EMAIL together.** The one rule is the pure module `convex/ownerIdentity.ts` (`compareIdentity`); the owners import, the automatic link, "Needs an owner" and the merge checks all call it (rule table and flows in 5.2). `nameKey` is therefore no longer unique. A `property_owner` dismissal key holds the property's owner name + emails at the time (`identitySignature`), so editing the property page brings the question back.

### 3.3 `ownerProperties` (new): owner-property link and per-link settings

```ts
ownerProperties: defineTable({
  orgId: v.string(),
  ownerId: v.id("owners"),
  propertyId: v.id("properties"),
  openingBalanceCents: v.optional(v.number()),  // signed integer; beginning cash of the FIRST statement; undefined = 0 + warning
  startMonth: v.optional(v.string()),           // "YYYY-MM": first statement month; set at first finalize if empty
  propertyReserveCents: v.optional(v.number()), // >= 0; default prefill for each statement; undefined = 0
  managementFeeBps: v.optional(v.number()),     // this property's OWN management fee (500 = 5.00%, integer 0..10000); undefined = the org default (financeSettings.rosDefaultFeeBps)
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner", ["ownerId"])
  .index("by_property", ["propertyId"])
  .index("by_org", ["orgId"]),

financeSettings: defineTable({             // org-wide statement settings; one row per org, created on the first change (feeSettings.ts)
  orgId: v.string(),
  rosDefaultFeeBps: v.optional(v.number()), // default management fee for every property without its own; undefined = 500 (5.00%)
  updatedBy: v.optional(v.id("users")),
  updatedAt: v.number(),
}).index("by_org", ["orgId"]),
```

**Management fee (as built, user decision 2026-11-11).** The fee is per property, not per owner. Effective fee = the link's own `managementFeeBps` when it is a valid value, else the org default (`rosPolicy.effectiveFee`, `orgDefaultFeeBps`; `DEFAULT_FEE_BPS = 500`). It sits on the link (not on the property), so a sold building's new owner starts from the default. `owners.managementFeeBps` is deprecated and unused. A fee change moves only drafts (open drafts are rebuilt on every read); final statements are frozen snapshots. The fee is therefore never "not set", so `FEE_NOT_SET` cannot fire as built (4.2). The one-off `feeMigration:copyOwnerFeesToLinks` (internal, `{ dryRun?: boolean (default true), orgId? }`) copies an owner's old fee onto each of its links that has no own fee, but only when the old fee differs from the org's default; it never overwrites a link's own fee (reported under `conflicts`), skips invalid values, is idempotent, and writes `owner_property_fee_changed` audit rows. Running it is the user's decision (`npx convex run feeMigration:copyOwnerFeesToLinks '{"dryRun": true}'` first).

- A property can go on a statement only when it has **exactly one** link row. With two or more links it is **co-owned**: it cannot be ticked and cannot take new ledger rows until the split is known (Q10, ASSUMPTION A10). With zero links it has no owner.
- `properties.ownerName` / `ownerEmails` (roster fields) are left alone. The owners importer reads them as its source (section 8): owners and links are created from them, and the roster fields themselves are never written.
- Per-owner link-setting lock (`rosPolicy.linkSettingProblem`, used by `owners.updateLinkSettings`, which only checks it when the value actually changes):
  - `openingBalanceCents` and `startMonth` are locked by the **same owner's** final statements for that property. After a property changes hands, the new owner can still set them although the property has the old owner's finals.
  - `startMonth` also cannot change while the property has an open draft (any owner), because the draft was built with the old value: `{property} has an open draft statement. Finalize or discard it before changing the first statement month.`
  - Locked messages: `The opening balance can't change after {property} has a final statement.` / `The first statement month can't change after {property} has a final statement.`

### 3.4 `ledgerAccounts` (new)

```ts
ledgerAccounts: defineTable({
  orgId: v.string(),
  name: v.string(),
  nameKey: v.string(),          // normalizeNameKey(name), unique per org
  kind: rowTypeValidator,       // immutable after create
  systemKey: v.optional(accountSystemKeyValidator),
  feeBase: v.boolean(),         // counts toward the management fee base; only kind "income" may be true
  active: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_org_and_name_key", ["orgId", "nameKey"])
  .index("by_org_and_system_key", ["orgId", "systemKey"]),
```

Seed list (`convex/ledgerAccountSeed.ts`, WP1). `ensureDefaultAccounts(ctx: MutationCtx, orgId: string): Promise<string[]>` is idempotent: it inserts each seed whose `nameKey` is missing, never changes rows that already exist, and returns the names it inserted (`[]` = nothing to do, so callers write the `accounts_seeded` audit only when something was inserted).

**Seeding only when a system account is missing (as built).** Calling `ensureDefaultAccounts` on every mutation would bring back a non-system default the accountant deleted or renamed (for example Pest Control). So every caller goes through `seedIfNeeded(ctx, orgId)`, which seeds only when `needsAccountSetup(accounts)` is true, meaning at least one system account (Rent Income, Management Fees, Repairs, Owner Draw, Owner Contribution) is missing. System accounts cannot be deleted or renamed, so after the first setup this stays false whatever the accountant does to the other defaults. Callers: `ledgerAccounts.ensureSeeded` (every `ledgerAccounts` mutation and `ownerStatements.createDraft`) and `workOrderBilling.seedAccounts` (closing a work order, `workOrderBilling.ensureAccounts`). `needsAccountSetup` is also returned by `ledgerAccounts.list` (`needsSetup`) and `workOrderBilling.accountsForClose` (`needsSetup`).

| name | kind | systemKey | feeBase |
|---|---|---|---|
| Rent Income | income | rent_income | true |
| Dump Fees | expense | - | false |
| Landscaping | expense | - | false |
| Management Fees | expense | management_fees | false |
| Pest Control | expense | - | false |
| Predicate Notice | expense | - | false |
| Repairs | expense | repairs | false |
| Owner Draw | owner_draw | owner_draw | false |
| Owner Contribution | owner_contribution | owner_contribution | false |

A system account (any `systemKey`) cannot be renamed, deleted or turned off. Repairs is protected because it is the default account when a work order is closed (ASSUMPTION A28).

### 3.5 `ledgerEntries` (new): the owner ledger

```ts
ledgerEntries: defineTable({
  orgId: v.string(),
  ownerId: v.id("owners"),
  propertyId: v.id("properties"),
  unitId: v.optional(v.id("units")),     // absent = "Property level"
  date: v.string(),                      // YYYY-MM-DD business date
  type: rowTypeValidator,                // always = account.kind at write time
  accountId: v.id("ledgerAccounts"),
  counterparty: v.string(),              // tenant / vendor / payee; Name column is built from it (4.3)
  memo: v.string(),
  amountCents: v.number(),               // integer > 0; direction comes from type
  source: ledgerSourceValidator,
  sourceId: v.optional(v.string()),      // WO id; "<statementId>:<propertyId>" for fee/draw; "<statementId>:<unitId>" for (historical) roster_rent; none for rent_payment; Stripe id later
  statementId: v.optional(v.id("ownerStatements")), // set = billed on that FINAL statement -> immutable
  voided: v.optional(v.boolean()),
  voidedAt: v.optional(v.number()),
  voidedBy: v.optional(v.id("users")),
  voidReason: v.optional(v.string()),
  postedDate: v.optional(v.string()),    // set at finalize on EVERY billed row: the date it shows on the statement (a carried-forward row posts on the period's first day). `date` keeps the original date. Unbilled rows have none.
  rentForMonth: v.optional(v.string()),  // rent_payment only: the month the rent is for ("YYYY-MM"); `date` = the day it was received
  paymentMethod: v.optional(paymentMethodValidator), // rent_payment only
  paymentNote: v.optional(v.string()),   // rent_payment only, <= 200 chars (e.g. a check number)
  createdBy: v.optional(v.id("users")),  // absent = system (finalize)
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_property_statement_date", ["propertyId", "statementId", "date"]) // unbilled = statementId undefined
  .index("by_statement", ["statementId"])
  .index("by_source", ["source", "sourceId"])
  .index("by_owner_and_date", ["ownerId", "date"])
  .index("by_org_and_date", ["orgId", "date"])
  .index("by_account", ["accountId"])
  .index("by_owner_and_posted", ["ownerId", "postedDate"])
  .index("by_org_and_posted", ["orgId", "postedDate"])
  .index("by_unit_and_rent_month", ["unitId", "rentForMonth"]) // one payment per unit per rent month (5.9)
  .index("by_org_and_rent_month", ["orgId", "rentForMonth"])   // the Payments page for a month
  .index("by_unit_and_date", ["unitId", "date"]),              // rent entered by hand, by date (5.9) and RENT_UNPAID
```

- `date` = the original business date; `postedDate` = the effective date on the statement. At finalize, every row written or stamped (work-order rows, fee, draw, and manual rows) gets `postedDate` = the line's effective date (`max(date, periodStart)`, ASSUMPTION A20). The ledger list (`ledger.list`, month filter) shows and filters by `postedDate ?? date` (`rosPolicy.ledgerRowInMonth`) and shows the original date when it differs. The `by_owner_and_posted` / `by_org_and_posted` indexes serve that month filter.

- `source: "roster_rent"` rows (historical, no longer written since 2026-11-12) were written **only at finalize**, one per included roster-rent line: type `income`, account Rent Income, a unit, `date` = the line's date (inside the period), `postedDate` = the same, `statementId` set. They are never editable in the ledger (the ledger's Edit / Void is for `manual` rows only).
- `source: "rent_payment"` rows (5.9) are written by the Payments page: unbilled until the statement covering their received date is finalized, when they are stamped like manual rows (`statementId`, `postedDate`). They are never editable in the ledger (Edit / Delete there are for `manual` rows only); they are changed or undone on the Payments page.
- Unbilled rows for a property up to the period end: `withIndex("by_property_statement_date", q => q.eq("propertyId", p).eq("statementId", undefined).lte("date", periodEnd))`, then keep only rows that are not voided and whose `ownerId` matches.
- Rows are never hard-deleted. Voiding is allowed only for unbilled `manual` rows, whatever their date: a row dated in a month that is already final was never on that statement (it carries forward), so voiding it changes no final statement.

### 3.6 `ownerStatements` (new)

```ts
ownerStatements: defineTable({
  orgId: v.string(),
  ownerId: v.id("owners"),
  month: v.string(),                         // "YYYY-MM"
  periodStart: v.string(),                   // "YYYY-MM-01"
  periodEnd: v.string(),                     // last day of month
  propertyIds: v.array(v.id("properties")),  // column order (sorted at create, 4.4)
  status: statementStatusValidator,
  excludedKeys: v.array(v.string()),         // "entry:<ledgerEntryId>" | "wo:<workOrderId>" ("rent:<unitId>" only on old drafts; ignored since 2026-11-12)
  includedKeys: v.optional(v.array(v.string())), // same key format: lines that are excluded BY DEFAULT (dated before the owner's first statement month, see 5.4) and that the accountant put back on
  adjustments: v.array(v.object({
    propertyId: v.id("properties"),
    earlyPaymentsCents: v.number(),          // >= 0, default 0
    unpaidBillsCents: v.number(),            // >= 0, default 0
    propertyReserveCents: v.optional(v.number()), // undefined = use ownerProperties.propertyReserveCents
  })),
  overrides: v.array(v.object({
    propertyId: v.id("properties"),
    feeAmountCents: v.optional(v.number()),  // undefined = computed
    feeMemo: v.optional(v.string()),         // undefined = standard memo
    feeExcluded: v.optional(v.boolean()),
    drawAmountCents: v.optional(v.number()), // undefined = suggested
    drawExcluded: v.optional(v.boolean()),
  })),
  rentOverrides: v.optional(v.array(v.object({  // DEPRECATED 2026-11-12, no longer read or written. Was: roster-rent prefill (5.4.1): the accountant's edits to a unit's prefilled rent line, key "rent:<unitId>". A field left out = the roster value. Removing a line uses excludedKeys.
    unitId: v.id("units"),
    amountCents: v.optional(v.number()),     // integer > 0
    date: v.optional(v.string()),            // YYYY-MM-DD inside the period
    counterparty: v.optional(v.string()),
    memo: v.optional(v.string()),
  }))),
  rentCheckedAt: v.optional(v.number()),     // DEPRECATED 2026-11-12, no longer read or written. Was: "I've checked the rent lines" (5.4.1); valid only while rentCheckedHash equals the current fingerprint of the rent lines
  rentCheckedBy: v.optional(v.id("users")),
  rentCheckedHash: v.optional(v.string()),
  statementDate: v.optional(v.string()),     // set at finalize (business date)
  endingCashCents: v.optional(v.number()),   // set at finalize ("All properties")
  availableCents: v.optional(v.number()),    // set at finalize ("All properties")
  finalizedAt: v.optional(v.number()),
  finalizedBy: v.optional(v.id("users")),
  discardedAt: v.optional(v.number()),
  discardedBy: v.optional(v.id("users")),
  emailedAt: v.optional(v.number()),         // DELIVERY HOOK (not written in v1)
  emailedTo: v.optional(v.array(v.string())),// DELIVERY HOOK
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_org_and_month", ["orgId", "month"])
  .index("by_owner_and_month", ["ownerId", "month"]),
```

### 3.7 `ownerStatementProperties` (new): one row per statement x property, for idempotency, locking and carry-forward

```ts
ownerStatementProperties: defineTable({
  orgId: v.string(),
  statementId: v.id("ownerStatements"),
  ownerId: v.id("owners"),
  propertyId: v.id("properties"),
  month: v.string(),
  status: statementStatusValidator,       // always equal to the parent's status (same mutation)
  endingCashCents: v.optional(v.number()),// this property's ending cash, set at finalize = next month's beginning
})
  .index("by_property_and_month", ["propertyId", "month"])
  .index("by_property_and_status", ["propertyId", "status", "month"])
  .index("by_statement", ["statementId"]),
```

### 3.8 `ownerStatementSnapshots` (new): the immutable final content

```ts
ownerStatementSnapshots: defineTable({
  orgId: v.string(),
  statementId: v.id("ownerStatements"),
  version: v.literal(1),
  json: v.string(),   // JSON.stringify(StatementSnapshot) (section 4.2); size counted in UTF-8 BYTES (`TextEncoder`), must be < 900,000 bytes (`SNAPSHOT_MAX_BYTES` in rosBuild.ts), else finalize refuses (a Convex document is at most 1 MiB)
  createdAt: v.number(),
}).index("by_statement", ["statementId"]),
```

### 3.9 Changes to existing tables

`units`: add one field.

```ts
securityDepositHeldCents: v.optional(v.number()), // integer >= 0; undefined = not recorded (0 + warning)
```

`workOrders`: add these fields (all optional) and two indexes. **`unitId` stays required. Do not change it.**

```ts
workCompletedDescription: v.optional(v.string()), // tech writes on submit; office edits; = ROS memo (<= 2000 chars)
billAmountCents: v.optional(v.number()),          // what the owner is charged; = ROS amount; integer > 0
costCents: v.optional(v.number()),                // internal only: never on the ROS, never to owners or technicians
rosAccountId: v.optional(v.id("ledgerAccounts")), // default Repairs, picked on close
billPropertyLevel: v.optional(v.boolean()),       // true = ROS row shows "Property level"; WO keeps its unit
noOwnerCharge: v.optional(v.boolean()),           // true = never billed to the owner (ASSUMPTION A2)
billedStatementId: v.optional(v.id("ownerStatements")), // set at finalize; WO can never be billed twice
billedLedgerEntryId: v.optional(v.id("ledgerEntries")),
billedAt: v.optional(v.number()),
rosPending: v.optional(v.boolean()),              // true = closed (reviewed_closed), chargeable and not billed yet: the ROS build reads only these
```

```ts
.index("by_property_and_status", ["propertyId", "status"])
.index("by_ros_account", ["rosAccountId"])
.index("by_property_and_rosPending", ["propertyId", "rosPending"])
```

`rosPending` (as built):
- Rule: `rosPendingOf(wo)` = `status === "reviewed_closed" && noOwnerCharge !== true && billedStatementId === undefined`.
- Written by `workOrders.reviewClose` and `workOrderBilling.updateBilling` (`billingPatch`: `rosPending = !noOwnerCharge`), and set to `false` at finalize when the work order is billed.
- `rosBuild.loadBuildData` reads work orders by `by_property_and_rosPending` with `rosPending = true` (billable, or missing its bill), then `status = "completed"` ones by `by_property_and_status` (the `WO_AWAITING_REVIEW` info warning). Reading every closed work order of a property is no longer needed.
- **Fallback and backfill.** Work orders closed before the field existed have it `undefined`. Until the backfill has run, the build also reads `rosPending = undefined` rows and keeps the `reviewed_closed` ones, so nothing is missed. The backfill is `internalMutation` `workOrderBilling:backfillRosPending` `{ cursor?, batchSize? }` (default 200, max 500 per page): it sets `rosPending = rosPendingOf(wo)` on every work order whose stored value differs, and returns `{ isDone, continueCursor, scanned, updated }`. It is idempotent. Run it from `dashboard/`: `npx convex run workOrderBilling:backfillRosPending '{}'`, then repeat with `continueCursor` as `cursor` until `isDone` is true. **Running it on a deployment is the user's decision** (builders do not run it).

`auditEntities.ts` (and the `AuditEntity` type in `audit.ts`): add `v.literal("owner")`, `v.literal("ledger_entry")` and `v.literal("ledger_account")`. Statements use the existing `"ros"`, units use `"unit"` and work orders use `"work_order"`.

---

## 4. Pure modules (WP1). No Convex imports, so Node's test runner loads them directly

All four files live in `dashboard/convex/`, so server code imports them as `./rosFormat` and client code as `@/convex/rosFormat` (the same pattern as `workOrderWindow.ts`). Use only erasable TypeScript: no `enum`, no `namespace`, no parameter properties. Node 26 strips the types. Import between the pure files with an extensionless relative path (`./rosFormat`); the test files register the same `.ts` resolve hook as `scripts/probes/work_order_status.test.mjs`.

### 4.1 `convex/rosFormat.ts`: money, dates and strings (the ONE shared formatter)

```ts
export const ROS_TIME_ZONE = "America/New_York";              // ASSUMPTION A24
export const COMPANY_NAME = "Property Pro Realty Group Inc.";
export const COMPANY_ADDRESS_LINES = ["60 Broad Street", "Waterford, NY 12188"] as const;
export const PROPERTY_LEVEL = "Property level";
export const MAX_AMOUNT_CENTS = 100_000_000;                  // $1,000,000.00: typo guard

// --- money ---
export function assertCents(n: number): void;                 // throws Error if !Number.isSafeInteger(n)
export function formatAmount(cents: number): string;          // 433387 -> "4,333.87"; 0 -> "0.00"; -240000 -> "(2,400.00)"
export function formatCurrency(cents: number): string;        // 433387 -> "$4,333.87"; 0 -> "$0.00"; -240000 -> "($2,400.00)"
export function parseDollarsToCents(raw: string | null | undefined): number | null;
//   trims; strips one leading "$" and every ","; must match /^\d+(\.\d{1,2})?$/; "12.5" -> 1250; "" / "-1" / "1.234" / "abc" -> null.
//   Computed with integer maths: whole*100 + Number(frac.padEnd(2,"0")). Never parseFloat.
export function parseSignedDollarsToCents(raw: string | null | undefined): number | null;
//   As above, but also accepts a leading "-" or wrapping "(...)" -> negative. Used only for the opening balance.
export function roundHalfUpDiv(numerator: number, denominator: number): number;
//   Integers only, numerator >= 0, denominator > 0: Math.floor((numerator * 2 + denominator) / (denominator * 2)).
//   Throws Error if (numerator*2 + denominator) is not a safe integer.
export function percentOf(baseCents: number, bps: number): number;  // roundHalfUpDiv(baseCents * bps, 10000)
export function formatBps(bps: number): string;               // 500 -> "5.00"; 1250 -> "12.50"; 0 -> "0.00"
export function parsePercentToBps(raw: string | null | undefined): number | null;
//   "5" | "5.0" | "5.00" | "5%" -> 500; 0..100 with <= 2 decimals; else null. Integer maths only.

// --- dates (strings only, no Date for YYYY-MM-DD) ---
export function isIsoDate(s: string): boolean;                // real calendar date, YYYY-MM-DD
export function isMonth(s: string): boolean;                  // YYYY-MM, 01..12
export function monthStart(month: string): string;            // "2026-09" -> "2026-09-01"
export function monthEnd(month: string): string;              // "2026-09" -> "2026-09-30"; leap years right
export function prevMonth(month: string): string;             // "2026-01" -> "2025-12"
export function nextMonth(month: string): string;
export function monthOf(date: string): string;                // "2026-09-30" -> "2026-09"
export function formatDate(date: string): string;             // "2026-09-01" -> "9/1/2026" (no zero padding)
export function formatMonth(month: string): string;           // "2026-09" -> "September 2026"
export function formatPeriod(start: string, end: string): string; // "9/1/2026 - 9/30/2026"
export function businessDate(ms: number): string;             // epoch ms -> YYYY-MM-DD in ROS_TIME_ZONE (Intl en-CA)
export function businessToday(nowMs: number): string;
export function generatedStamp(ms: number): string;           // "10/16/2026 09:26:36": MM/DD/YYYY HH:mm:ss, 24 h, zero-padded, ROS_TIME_ZONE (A23)

// --- strings ---
export function normalizeNameKey(s: string): string;          // trim, lowercase, collapse whitespace, strip trailing "."
export function naturalCompare(a: string, b: string): number; // a.localeCompare(b, "en", { numeric: true, sensitivity: "base" })
```

`formatAmount` algorithm, exactly (no `toLocaleString`, which depends on the locale):

```ts
const neg = cents < 0; const abs = Math.abs(cents);
const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const s = `${dollars}.${String(abs % 100).padStart(2, "0")}`;
return neg ? `(${s})` : s;            // formatCurrency: neg ? `($${s})` : `$${s}`
```

Rounding rule (ASSUMPTION A5): half up, to the cent, on non-negative values, applied **once** per management-fee row. Sample check: `percentOf(433387, 500)` = `roundHalfUpDiv(216693500, 10000)` = `floor((433387000 + 10000) / 20000)` = `floor(21669.85)` = **21669** = $216.69. Fee percentages are stored as integer basis points.

### 4.2 `convex/rosCalc.ts`: the statement engine (pure, deterministic)

```ts
import type { RowType } from "./rosPolicy";      // or declare locally; must equal rowTypeValidator literals

export type CalcAccount = { id: string; name: string; kind: RowType; feeBase: boolean; systemKey?: string };

export type CalcRow = {
  key: string;            // "entry:<id>" | "wo:<id>" (fee/draw rows are produced by the engine)
  propertyId: string;
  unitLabel: string | null;   // null = Property level
  date: string;               // stored date (WO: business date of completion, see 5.6)
  accountId: string;
  counterparty: string;
  memo: string;
  amountCents: number;        // integer > 0
  source: "manual" | "work_order" | "management_fee" | "owner_draw" | "opening_balance" | "stripe" | "roster_rent" | "rent_payment";
  seq: number;                // final tie-break: entry createdAt, or WO completedAt (ms)
};

export type CalcProperty = {
  id: string;
  name: string;                        // properties.name, e.g. "108 Jackson Avenue"
  beginningCashCents: number;          // signed
  securityDepositsCents: number;       // sum of units' securityDepositHeldCents (undefined -> 0)
  earlyPaymentsCents: number;
  propertyReserveCents: number;
  unpaidBillsCents: number;
  pendingEpayCents: number;            // 0 in Phase 1
  feeBps?: number | null;              // THIS property's management fee in bps (own fee ?? org default, resolved by rosBuild with rosPolicy.effectiveFee). Absent = fall back to owner.managementFeeBps (old inputs and tests only); null after that = no fee -> FEE_NOT_SET
  fee: { amountOverrideCents: number | null; memoOverride: string | null; excluded: boolean };
  draw: { amountOverrideCents: number | null; excluded: boolean };
};

export type CalcInput = {
  periodStart: string;  periodEnd: string;
  owner: { legalName: string; payeeName: string | null; managementFeeBps?: number | null }; // legalName is for the FEE_NOT_SET / PAYEE_MISSING messages; managementFeeBps is only the fallback for a property with no feeBps (rosBuild passes null)
  companyName: string;                 // COMPANY_NAME
  properties: CalcProperty[];          // column order
  accounts: CalcAccount[];             // must include systemKey management_fees and owner_draw
  rows: CalcRow[];                     // INCLUDED rows only (exclusions already removed), date <= periodEnd
};

export type Cols = { byProperty: number[]; total: number };   // byProperty[i] matches properties[i]

export type DetailLine = {
  key: string; propertyId: string; date: string /* effective */; storedDate: string; carriedForward: boolean;
  propertyName: string; unit: string /* label or "Property level" */; accountName: string;
  name: string; memo: string; amountCents: number; balanceCents: number;
  source: CalcRow["source"]; type: RowType;
};

export type StatementResult = {
  periodStart: string; periodEnd: string;
  columns: { propertyId: string; name: string }[];
  summary: {
    beginning: Cols; income: Cols; ownerContributions: Cols; otherAdditions: Cols;
    expenses: Cols; ownerDraws: Cols; otherSubtractions: Cols; ending: Cols;
    depositsAndEarlyPayments: Cols; propertyReserve: Cols; unpaidBills: Cols; pendingEpay: Cols; available: Cols;
  };
  incomeStatement: {
    income: { accounts: { accountId: string; name: string; values: Cols }[]; total: Cols };
    expense: { accounts: { accountId: string; name: string; values: Cols }[]; total: Cols };
    netIncome: Cols;
  };
  detail: {
    beginningCents: number; additions: DetailLine[]; totalAdditionsCents: number;
    subtractions: DetailLine[]; totalSubtractionsCents: number; endingCents: number;
  };
  generated: {
    propertyId: string;
    fee: { baseCents: number; bps: number | null; computedCents: number; amountCents: number; memo: string; overridden: boolean; excluded: boolean };
    draw: { suggestedCents: number; amountCents: number; overridden: boolean; excluded: boolean };
  }[];
  warnings: { code: string; propertyId?: string; workOrderId?: string; message: string; blocking: boolean }[];
  // workOrderId: set on WO warnings (one work order), so the UI can link to it
};

export type StatementSnapshot = {
  version: 1;
  header: { ownerLegalName: string; footerName: string; payeeName: string | null; statementDate: string; periodStart: string; periodEnd: string };
  result: StatementResult;
};

export function computeStatement(input: CalcInput): StatementResult;
export function effectivePayee(owner: { payeeName?: string | null; contactFirstName?: string | null; contactLastName?: string | null }): string | null;
//   payeeName?.trim() || `${first} ${last}`.trim() || null; but null if first or last contains "/" or " and " (A12)
export function footerName(owner: { contactFirstName?: string | null; contactLastName?: string | null; legalName: string }): string;
//   `${first} ${last}`.trim() || legalName (A12)
export function displayName(unitLabel: string | null, counterparty: string): string;
//   unitLabel ? `Unit ${unitLabel} - ${counterparty}` : counterparty
export function feeMemo(periodStart: string, periodEnd: string, bps: number, baseCents: number): string;
//   `Management Fee ${formatPeriod(start, end)} (${formatBps(bps)}% of ${formatCurrency(baseCents)})`
```

The fee % lives in the result: `generated[i].fee.bps` is the % that property's fee was calculated at. It is part of `previewHash` (`rosBuild.resultHash` hashes `generated`), so a fee change made while the Finalize dialog is open is caught, and it is stored in the final snapshot, so a final statement keeps the % it was finalized with whatever the fee is later. The Finalize dialog and the Adjustments card show it, with "(own fee)" / "(default)" from `PropertyAdjustmentView.feeSource` (`null` on a final).

`computeStatement`, step by step. It must throw `Error` (not ConvexError: these are programming errors the server already validated against) when a row has a non-integer or non-positive amount, an unknown account or property, a bad date, or `date > periodEnd`, or when an override is not a non-negative integer.

1. **Effective date.** `effDate = max(row.date, periodStart)` (string compare). `carriedForward = row.date < periodStart`. (ASSUMPTION A20)
2. **Management fee, per property `p`, in column order.**
   - `base_p` = sum of `amountCents` of the rows in `p` whose account has `feeBase === true` (and type `income`).
   - **Each property uses its own %** (as built): `bps_p = property.feeBps` (own fee ?? org default, 3.3), else the `owner.managementFeeBps` fallback, else `null`.
   - If any `bps_p` is `null`: that property gets no fee row, and one blocking warning `FEE_NOT_SET` (one for the statement, not one per property). Because rosBuild always supplies a `feeBps`, this cannot happen as built; it stays as a guard for inputs that give none.
   - Otherwise `computed_p = percentOf(base_p, bps_p)`. `amount_p = fee.excluded ? 0 : (fee.amountOverrideCents ?? computed_p)`.
   - If `amount_p > $1,000,000.00` (`MAX_AMOUNT_CENTS`; a typed override or a huge base): blocking `AMOUNT_TOO_LARGE` for that property, and the row is **capped** at `MAX_AMOUNT_CENTS` so the draft and its PDF preview still build. Finalize is blocked until it is fixed.
   - If `amount_p > 0`, add the generated row: key `fee:<p>`, date `periodEnd`, account = the account with `systemKey "management_fees"`, unit `null`, counterparty `companyName`, memo `fee.memoOverride ?? feeMemo(periodStart, periodEnd, bps_p, base_p)` (so the memo shows that property's %), source `management_fee`, seq `Number.MAX_SAFE_INTEGER - 1`.
3. **Owner draw, per property `p`.**
   - `cashBeforeDraw_p = beginning_p + Σadditions_p − Σexpense_p (including the fee row) − ΣotherSubtraction_p − ΣownerDraw_p (draw rows already in the ledger, e.g. a mid-month draw)`.
   - `suggested_p = max(0, cashBeforeDraw_p − propertyReserve_p − unpaidBills_p)`. Deposits and early payments are **not** subtracted: the sample pays out $657.32 even though $2,400.00 of deposits is held. (ASSUMPTION A7)
   - `amount_p = draw.excluded ? 0 : (draw.amountOverrideCents ?? suggested_p)`.
   - If `amount_p > $1,000,000.00`: blocking `AMOUNT_TOO_LARGE` (draw wording) and the row is capped, as for the fee.
   - If `amount_p > 0` and `owner.payeeName` is null: blocking warning `PAYEE_MISSING`, and the row is still produced with counterparty `""`.
   - If `amount_p > 0`, add the row: key `draw:<p>`, date `periodEnd`, account `systemKey "owner_draw"`, unit `null`, counterparty `payeeName ?? ""`, memo `"Owner Draw"`, source `owner_draw`, seq `Number.MAX_SAFE_INTEGER`.
   - If `suggested_p === 0`, there is no draw override and the draw is not excluded: info warning `NO_DRAW`.
4. **Summary, per property column** (the totals column = the sum of the property columns; every value is an integer):
   - `income` = Σ type `income`; `ownerContributions` = Σ `owner_contribution`; `otherAdditions` = Σ `other_addition`
   - `expenses` = Σ `expense` (includes the fee); `ownerDraws` = Σ `owner_draw` (includes the draw); `otherSubtractions` = Σ `other_subtraction`
   - `ending = beginning + income + ownerContributions + otherAdditions − expenses − ownerDraws − otherSubtractions`
   - `depositsAndEarlyPayments = securityDeposits + earlyPayments`; `propertyReserve`, `unpaidBills`, `pendingEpay` as given
   - `available = ending − depositsAndEarlyPayments − propertyReserve − unpaidBills − pendingEpay`
5. **Income statement.**
   - Income group = the accounts of kind `income`; Expense group = kind `expense`. Owner draw, contributions and other additions or subtractions are **not** on it.
   - An account is listed only if it has at least one included row in any column (the sample hides zero-activity accounts; ASSUMPTION A22). A listed account shows `0.00` in columns where it has no activity.
   - Order within a group: `naturalCompare(name)`, then account id.
   - `total` = the sum of the group. `netIncome = income.total − expense.total` per column.
6. **Detail.**
   - Additions = rows of type `income | owner_contribution | other_addition`. Subtractions = rows of type `expense | owner_draw | other_subtraction`.
   - Sort each list by, in this order:
     1. `effDate` ascending
     2. `rank` ascending: additions all 0; subtractions 0 = ordinary, 1 = `source === "management_fee"`, 2 = `type === "owner_draw"` (the fee is always just before the draw, and the draw is always last on its date)
     3. property column index ascending
     4. unit: `null` (Property level) first, then `naturalCompare(unitLabel)`
     5. `naturalCompare(accountName)`
     6. `seq` ascending
     7. `key` ascending (string)
   - Running balance: start at `beginningCents` = the total of `beginning`. Add each addition in order, then subtract each subtraction in order. `balanceCents` = the balance after the line.
   - `endingCents` = the final balance. **Invariant:** `endingCents === summary.ending.total` (throw if not).
   - `totalAdditionsCents` / `totalSubtractionsCents` = the list sums.
   - Line text: `unit = unitLabel ?? "Property level"`; `name = displayName(unitLabel, counterparty)`; `propertyName` from the column; `accountName` from the account.
7. **Warnings from the engine**:
   - `FEE_NOT_SET` (blocking; guard only, see step 2)
   - `PAYEE_MISSING` (blocking)
   - `AMOUNT_TOO_LARGE` (blocking, per property, fee or draw; the row is capped)
   - `NEGATIVE_ENDING` (info, per property)
   - `NO_DRAW` (info, per property)

   Exact messages are in 5.8.

Multiple properties: the detail is one list sorted by date across all properties, not grouped by property (ASSUMPTION A27).

### 4.3 `convex/rosView.ts`: the result turned into display strings (used by the on-screen preview, the PDF and the golden test)

```ts
export type ViewRow = { kind: "row" | "section" | "total" | "grand"; label: string; values: string[] };
// "section" = bold label, empty values; "total" = bold + $ values; "grand" = bold + $ values + double rule below (last row of a table).
export type StatementView = {
  header: { title: "Rental Owner Statement"; periodLabel: "Statement period"; period: string; dateLabel: "Statement date"; date: string;
            preparedBy: [string, string, string] };
  summary: { title: "Summary by property"; columns: string[]; rows: ViewRow[] };
  incomeStatement: { title: "Income statement"; columns: string[]; rows: ViewRow[] };
  detail: {
    title: "Detail transactions";
    columns: ["Date", "Property", "Unit", "Account", "Name", "Memo", "Amount", "Balance"];
    beginning: { label: string; balance: string };
    additionsTitle: "Additions to cash"; additions: DetailViewLine[]; additionsTotal: { label: "Total from additions to cash"; amount: string };
    subtractionsTitle: "Subtractions from cash"; subtractions: DetailViewLine[]; subtractionsTotal: { label: "Total from subtractions from cash"; amount: string };
    ending: { label: string; balance: string };
  };
};
export type DetailViewLine = { date: string; property: string; unit: string; account: string; name: string; memo: string; amount: string; balance: string };
export function buildView(result: StatementResult, header: { statementDate: string }): StatementView;
export function footerLeft(footerName: string, generatedMs: number): string;   // `${footerName} - Generated ${generatedStamp(ms)}`
export function pageLabel(n: number): string;                                  // `Page ${n}`
```

Strings, exactly. `columns` = the property names followed by `"All properties"`. `$` appears only on `total`/`grand` rows. Negatives are in parentheses.

Summary rows, in order (kind: label: values):

| # | kind | label | values |
|---|---|---|---|
| 1 | total | `Beginning cash balance` | formatCurrency(beginning) |
| 2 | section | `+ Additions to cash` | (empty strings) |
| 3 | row | `Income` | formatAmount |
| 4 | row | `Owner contributions` | formatAmount |
| 5 | row | `Other additions` | formatAmount |
| 6 | section | `– Subtractions from cash` (U+2013 en dash + space) | |
| 7 | row | `Expenses` | formatAmount |
| 8 | row | `Owner draws` | formatAmount |
| 9 | row | `Other subtractions` | formatAmount |
| 10 | total | `Ending cash balance` | formatCurrency |
| 11 | section | `– Adjustments` | |
| 12 | row | `Tenant security deposits and early payments` | formatAmount |
| 13 | row | `Property reserve` | formatAmount |
| 14 | row | `Unpaid bills` | formatAmount |
| 15 | row | `Pending ePay payments` | formatAmount |
| 16 | grand | `Available for payment` | formatCurrency |

Income statement rows: `section "Income"`; each income account (`row`, formatAmount); `total "Total income"` (formatCurrency); `section "Expense"`; each expense account; `total "Total expenses"`; `grand "Net income"` (formatCurrency). The PDF renders the word "Total" in bold and "income"/"expenses" in regular weight, as in the sample.

Detail strings:
- beginning label `Beginning cash balance as of ${formatDate(periodStart)}`, balance formatCurrency
- each line: date formatDate(effDate); amount and balance formatAmount
- totals formatCurrency
- ending label `Ending cash balance as of ${formatDate(periodEnd)}`, balance formatCurrency

`header.period = formatPeriod(periodStart, periodEnd)`, `header.date = formatDate(statementDate)`, `preparedBy = ["Prepared By: Property Pro Realty Group Inc.", "60 Broad Street", "Waterford, NY 12188"]`.

### 4.4 `convex/rosPolicy.ts`: rules as pure functions (Convex handlers call these, and the tests cover them)

```ts
export type RowType = "income" | "owner_contribution" | "other_addition" | "expense" | "owner_draw" | "other_subtraction";
export const ADDITION_TYPES: ReadonlySet<RowType>; export const SUBTRACTION_TYPES: ReadonlySet<RowType>;
export const MAX_STATEMENT_LINES = 2000;
export function canUseFinanceView(view: string): boolean;               // admin | accountant

/** Column order: naturalCompare(name), then id. */
export function sortProperties<T extends { id: string; name: string }>(ps: T[]): T[];

export type PropertyStatementState = {
  id: string; name: string;
  ownerLinkCount: number; linkedToThisOwner: boolean; coOwnerNames: string[];
  startMonth: string | null;            // ownerProperties.startMonth
  finalMonths: string[];                // months with a final statement for this property (any owner)
  openDrafts: { month: string; ownerName: string }[];
};
/** null = OK, else the exact user message (5.8 CREATE_*). `today` = business date. */
export function createDraftProblem(month: string, today: string, p: PropertyStatementState, ownerName: string): string | null;

/** Latest final month for the property, or null. Months <= it are locked. */
export function lockedThroughMonth(finalMonths: string[]): string | null;
/** Ledger date rule (5.8 ENTRY_*): future, locked month, before start month. null = OK. */
export function entryDateProblem(date: string, today: string, p: { name: string; lockedThrough: string | null; startMonth: string | null }): string | null;
/** The rule as add/edit apply it: on EDIT it runs only when the date actually changes (`currentDate` = the stored date; undefined on add). */
export function entryChangeDateProblem(date: string, currentDate: string | undefined, today: string, p: { name: string; lockedThrough: string | null; startMonth: string | null }): string | null;
/** Can this owner's link setting change? Only called when the value changes. null = OK. See 3.3. */
export function linkSettingProblem(field: "openingBalanceCents" | "startMonth", propertyName: string, ownerFinalCount: number, openDraftCount: number): string | null;
/** True when a WO is closed, chargeable and unbilled: `workOrders.rosPending` (3.9). */
export function rosPendingOf(wo: { status: string; noOwnerCharge?: boolean; billedStatementId?: string }): boolean;
/** Ledger list month filter: `postedDate ?? date` within [from, to]. */
export function ledgerRowInMonth(e: { date: string; postedDate?: string }, from: string, to: string): boolean;

export type WoForBilling = { id: string; number: number; propertyId: string; unitLabel: string; status: string;
  completedDate: string | null; billAmountCents?: number; noOwnerCharge?: boolean; billedStatementId?: string;
  workCompletedDescription?: string; rosAccountId?: string };
/** Splits WOs for one draft. floorDate = monthStart(startMonth ?? statement month). */
export function selectWorkOrders(wos: WoForBilling[], periodEnd: string, floorDate: string): {
  billable: WoForBilling[];     // reviewed_closed, !noOwnerCharge, !billedStatementId, floorDate <= completedDate <= periodEnd, has bill+account+description
  missingBill: WoForBilling[];  // same, but billAmountCents/rosAccountId/description missing  -> blocking WO_MISSING_BILL
  awaitingReview: WoForBilling[]; // status "completed", floorDate <= completedDate <= periodEnd -> info WO_AWAITING_REVIEW
  beforeFloor: WoForBilling[];  // like billable, but completedDate < floorDate -> NOT dropped: shown as a line excluded by default (with a note); the accountant can include it
  beforeFloorMissingBill: WoForBilling[]; // like missingBill, but completedDate < floorDate -> info WO_BEFORE_START_MISSING_BILL (not on the statement)
};
export function finalizeProblem(month: string, today: string): string | null; // period must have ended
export function validateEntryFields(input: EntryFieldsRaw): { ok: true; value: EntryFields } | { ok: false; field: string; message: string };
export function validateBillingFields(input: BillingFieldsRaw): { ok: true; value: BillingFields } | { ok: false; field: string; message: string };
export function validateOwnerFields(input: OwnerFieldsRaw): { ok: true; value: OwnerFields } | { ok: false; field: string; message: string };
//   as built: no management fee field (the fee is per property, see below). mode "create" | "update"; `nameTaken` is passed by the server.

// --- roster rent prefill (as built, 5.4.1; the prefill was REMOVED 2026-11-12, rosterRentToCents / rosterSaysVacant / rentCounterparty are still used by rentPaymentsPolicy.ts, 5.9) ---
export const ROSTER_RENT_MEMO = "Payment";  export const ROSTER_RENT_LABEL = "Roster rent";
/** Roster rent (DOLLARS, a JS number) to integer cents with no float drift, or null when it isn't a clean dollar amount:
 *  not finite, <= 0, more than 2 decimals, text form not plain digits (1e-3, 1e21, 950.875 refused), or over MAX_AMOUNT_CENTS. */
export function rosterRentToCents(rent: unknown): number | null;
export function rosterSaysVacant(u: { occupancy?: string | null; leaseType?: string | null }): boolean; // occupancy "vacant" | "vacant_not_ready", or leaseType "vacant"
export type RentSkipCode = "owner_direct" | "included_in_other_unit" | "already_recorded" | "roster_vacant" | "vacant" | "no_rent" | "invalid_rent";
/** The prefill decision for one unit; the skip rules run in the order given in 5.4.1. */
export function rentPrefillDecision(u: RentUnitInput): { ok: true; amountCents: number; counterparty: string } | { ok: false; code: RentSkipCode };
export function rentCounterparty(names: string[]): string;                  // unique, natural order, joined with " & " ("Ann Lee & Bob Ray")
export function validateRentLineFields(input: RentLineFieldsRaw): FieldResult<RentLineFields>; // first failing field in order amountCents, date, counterparty, memo
export function validateRentLineFieldsAll(input: RentLineFieldsRaw): Record<string, string>;
export const RENT_MSG, RENT_SKIP_TEXT;                                      // exact strings in 5.4.1 and 5.8

// --- management fee (as built, 3.3 and 5.2) ---
export const DEFAULT_FEE_BPS = 500;
export function readFeeInput(raw: string | number | null | undefined): { ok: true; bps: number | null } | { ok: false; message: string }; // blank = null
export function orgDefaultFeeBps(stored: number | null | undefined): number;   // a stored valid value, else 500
export function effectiveFee(linkBps, defaultBps): { bps: number; own: boolean }; // own fee ?? default
export function feeRangeLabel(bpsList: number[]): string | null;               // "5.00%" / "5.00–6.00%" / null
export function defaultFeeConfirmText(oldBps, newBps, counts: FeeCounts): string; export function resetOverridesLabel(m, newBps): string;
export const DEFAULT_FEE_DRAFT_NOTE: string;
export function setDefaultFeeProblem(input): { field: "bps" | "expectedCounts"; message: string } | null;
```

Owner identity lives in its own pure module `convex/ownerIdentity.ts` (no Convex imports): `compareIdentity`, `decidePropertyLink`, `planLinkAll`, `mergeProblem`, the doubt-reason texts and the merge messages (5.2). `convex/feeSettingsLib.ts` holds the fee-settings logic as plain functions on `ctx.db` (`applyDefaultFee`, `loadFeeCounts`, `readDefaultFeeBps`) so the tests can run it on a fake database; `feeSettings.ts` registers the Convex functions.

The client forms call the same `validate*Fields` functions, so client and server messages are identical by construction. Each returns the **first** failing field in form order. The client also runs every field separately, to mark all bad fields at once: export `validateEntryFieldsAll(...) → Record<field, message>`, and do the same for billing and owner.

---

## 5. Convex functions

### 5.1 `convex/ledgerAccounts.ts` (WP2)

| Function | Args (loose; checked in handler) | Returns | Errors (exact) | Audit (entity `ledger_account`) |
|---|---|---|---|---|
| `list` query | `{ includeInactive?: boolean }` | `{ needsSetup: boolean; accounts: { _id, name, kind, kindLabel, systemKey?, feeBase, active, usedCount }[] }`, sorted by naturalCompare(name). `usedCount` = ledger rows + WOs using it (cap at 1000, display "1000+") | - | - |
| `ensureDefaults` mutation | `{}` | `null` | - | `accounts_seeded` (only if something was inserted; note = names) |
| `create` mutation | `{ name?: string; kind?: string }` | `{ accountId }` | field `name`: "Enter the account name." / "Keep the account name under 60 characters." / `An account named “${name}” already exists.`; field `kind`: "Select the account type." / "Owner Draw is the only owner-draw account. Pick another type." | `account_created` to=`{name,kind}` |
| `rename` mutation | `{ accountId?, name? }` | `null` | "Account not found."; `${old} is a system account and can't be renamed.`; the name errors above | `account_renamed` from/to name |
| `setActive` mutation | `{ accountId?, active?: boolean }` | `null` | `${name} is a system account and can't be turned off.` | `account_deactivated` / `account_activated` |
| `setFeeBase` mutation | `{ accountId?, feeBase?: boolean }` | `null` | "Only income accounts can count toward the management fee." | `account_fee_base_changed` from/to |
| `remove` mutation | `{ accountId? }` | `null` | `${name} is a system account and can't be deleted.`; `${name} is used by ${n} transactions or work orders. Turn it off instead of deleting it.` | `account_deleted` from=name |

Kind labels (UI and `kindLabel`):
- `income` → "Income"
- `expense` → "Expense"
- `owner_contribution` → "Owner contribution"
- `other_addition` → "Other addition"
- `other_subtraction` → "Other subtraction"
- `owner_draw` → "Owner draw"

Every mutation except `list` calls `ensureSeeded(ctx, org)` first, which seeds the defaults **only when a system account is missing** (`needsAccountSetup`; see 3.4), and writes `accounts_seeded` only when something was inserted. It does not bring back a non-system default that was deleted or renamed.

### 5.2 `convex/owners.ts` (WP2), `convex/feeSettings.ts`, `convex/ownerIdentity.ts`, `convex/ownerLinking.ts`

**Owners (as built).**

- `list` query `{ includeInactive?: boolean }` → `[{ _id, legalName, contactName, emails, feeRange: string|null /* "5.00%" or "5.00–6.00%" over the owner's properties (each: own fee ?? default); null = no properties */, payeeName: string|null /* effective */, active, propertyCount, coOwnedPropertyNames: string[], problems: string[] }]`. `problems` holds only "Owner draw payee not set" (when there is no effective payee); "Management fee not set" no longer exists (the fee always has a value). Sorted by naturalCompare(legalName). A merged owner is inactive, so it shows only with `includeInactive`.
- `get` query `{ ownerId }` → `{ _id, legalName, contactFirstName, contactLastName, contactName, emails, defaultFeeBps /* the org default */, payeeName /* stored, form input */, derivedPayeeName, effectivePayeeName, active, source, createdAt, updatedAt, links }` with `links: [{ linkId, propertyId, propertyName, coOwnerNames: string[], coOwnedMessage: string|null, openingBalanceCents: number|null, startMonth: string|null, propertyReserveCents: number, ownFeeBps: number|null /* the property's own fee; null = uses the default */, effectiveFeeBps: number /* own ?? default */, lockedThroughMonth: string|null /* any owner */, hasFinal: boolean /* THIS owner has a final for the property: it locks the opening balance and first statement month (3.3) */, openDraftMonth: string|null, units: [{ unitId, unitLabel, securityDepositHeldCents: number|null }] }]`. Units are sorted by naturalCompare(unitNumber). There is no owner-level management fee.
- `propertyOptions` query `{}` → every org property `[{ propertyId, name, ownerNames: string[] }]` for the "Link property" select.
- `create` mutation `{ legalName?, contactFirstName?, contactLastName?, emails?: string[] | string, payeeName? }` → `{ ownerId }`. No fee argument.
- `update` mutation `{ ownerId?, ...same }` → `null`. Only changed fields are patched. Refused for a merged owner (`ownerMergedMessage`: `{name} was merged into {other}.`, field `ownerId`).
- `setActive` mutation `{ ownerId?, active? }`. Turning an owner off is refused if it has an open draft: "Discard or finalize the open draft for this owner first." Refused for a merged owner.
- `linkProperty` mutation `{ ownerId?, propertyId?, confirmCoOwned?: boolean }` → `{ linkId, coOwned: boolean }`. Refused for a merged owner. The open-draft check runs before the co-owned confirmation, so the user is not asked to confirm a link that would then be refused.
- `unlinkProperty` mutation `{ linkId? }`.
- `updateLinkSettings` mutation `{ linkId?, openingBalanceCents?: number|null, startMonth?: string|null, propertyReserveCents?: number|null }` (the fee is not here; see `setPropertyFee`).
- `setPropertyFee` mutation `{ linkId?, bps?: number|null }` → `{ effectiveFeeBps, own: boolean }`. The property's own fee; `null` / blank = "Use default". Allowed at any time (finals are snapshots; an open draft recalculates and its Finalize dialog refuses a statement reviewed at the old fee, via `previewHash`). Field `managementFeeBps`; refuses a value equal to the current own fee ("That is already this property's fee.").
- `setUnitDeposit` mutation `{ unitId?, amountCents?: number|null }` (null = clear).

**Management fee settings (as built).** `convex/feeSettings.ts` (logic in `feeSettingsLib.ts`), admin view + accountant only:

- `feeSettings.get` query `{}` → `{ defaultBps, changedBefore: boolean /* false until someone changes it: the 5.00% is the built-in default */, totalProperties /* every property of the org */, ownFeeCount /* links with their own fee */, usingDefaultCount }`.
- `feeSettings.setDefaultFee` mutation `{ bps?: number|null, alsoResetOverrides?: boolean|null, expectedCounts?: { totalProperties, ownFeeCount, currentBps }|null }` → `{ defaultBps, reset }`. It sets `financeSettings.rosDefaultFeeBps`; with `alsoResetOverrides` it also clears every link's own fee (one `owner_property_fee_changed` audit row per link). **Counts guard:** the UI sends the counts and current default the confirmation showed; if `totalProperties`, `ownFeeCount` or `currentBps` differ from the database now, or `expectedCounts` is missing, nothing is written (`countsChanged`, field `expectedCounts`). Nothing is written on any refusal.
- Messages (`FEE_MSG`): "Enter the new management fee % for all properties (for example 5.00)." (field `bps`, missing) / "Enter the management fee as a percentage like 5.00." (unparseable, client) / "The management fee must be between 0.00% and 100.00%." (not an integer 0..10000) / `The default management fee is already {pct}%. Enter a different fee.` (same as now and nothing to reset) / "The properties changed while you were deciding. Check the numbers and confirm again." (`expectedCounts`).
- **The alert** (Owners page, "Change fee for all properties"; wording from `rosPolicy.defaultFeeConfirmText`, one source for the dialog and the tests): `Change the management fee from {old}% to {new}% for all {N} {property|properties}?` and, when M > 0, ` {M} {property has its|properties have their} own fee and won't change.` With M > 0 the dialog shows a checkbox `Also reset {that 1 property|those M properties} to {new}%` (`resetOverridesLabel`), and always the note "Open drafts will recalculate. Final statements are not affected." (`DEFAULT_FEE_DRAFT_NOTE`).
- Audit: entity `config`, entityId `ros_default_fee`, action `ros_default_fee_changed` (from/to `5.00%`, note = JSON of the counts and `alsoResetOverrides`), only when the default actually changed. Per link: entity `owner`, action `owner_property_fee_changed` (from `5.00% (own)`, to `6.00% (default)`, note = property name). `owners.setPropertyFee` writes the same action (from/to `x% (own|default)`, note = property name).

**Owner identity (as built, user decision 2026-11-11): name AND email.** One pure rule, `ownerIdentity.compareIdentity(a, b)`, over `{ nameKey, emails }` (names by `normalizeNameKey`; emails exact after trim + lowercase: no domain or fuzzy matching, so two joint owners on `@518propertypro.com` are only flagged when they share the exact same address). An empty name never matches by name.

| Case | Verdict (`same`, `flag`) |
|---|---|
| same name + at least one shared email | same owner, no flag (an exact match) |
| same name, both sides have emails, none shared | separate, `same_name_different_email` |
| different name, a shared email | separate, `same_email_different_name` ("possibly the same owner") |
| same name, one side (or both) has no email | same owner, flagged `name_only_match` |
| neither | different owners, no flag |

A flag never merges anything: a person decides (Merge owners, or "Not the same owner").

- **`decidePropertyLink({ property, owners, linkedOwnerIds, hasOpenDraft, dismissed })`** is the one decision for a property's owner link. Merged owners are ignored. Outcomes:
  - `linked`: it already has a link and the property page agrees (or names nobody), or the page's owner was marked "Not the same owner" for every linked owner;
  - `mismatch`: it has a link but the page names someone else. **Never moved automatically.**
  - `link { ownerId }`: no link, exactly one active owner matches exactly (no flag), and nothing else is in doubt;
  - `create { legalName, emails }`: no link, nobody matches or looks alike, and the page has a name and a valid email;
  - `needs { reason }`, a person decides. Reasons (`NeedsReason`): `no_owner_name`, `open_draft` (the property is on an open draft), `invalid_owner_data` (the page's owner details can't make an owner, e.g. a bad email), `inactive_owner`, `several_match` (two or more exact matches), `no_email` (name but no email, and no owner has that name), `flagged` (an owner looks similar), `dismissed_match` (a same-name owner was marked "Not the same owner" for it, so a new owner would look identical).
  - An existing link is **never moved or added to** (a second link would make the property co-owned).
- **Where it runs (the automatic link).** `ownerLinking.linkOwnerForProperty(ctx, propertyId, { source, actorUserId?, data?, via? })` reads what it needs, calls `decidePropertyLink` and carries out only `link` / `create` through `applyLinkDecision`. It is called after the property is saved by `properties.updateProfile` (source `"manual"`, only when the owner name or emails changed: `ownerIdentityChanged`) and by `rosterImport.upsertProperty` (source `"sheet_import"`, for a new property that names an owner, and for an updated one whose owner name or emails changed; the roster import loads the owners and dismissals once and shares them as `data`, so the next property of the same owner links to the owner created a moment ago). The reads and the decision are guarded: an error is logged and the link skipped, so **it never fails the property save**; every expected case is a returned outcome. `create` inserts the owner from the property page's name and emails (`active`, no contact names, no fee, `createdFromPropertyId`) and the link. Audit: `owner_created` (counts only, never the emails; note `auto-created from {property}: no owner had this name or email`) and `owner_property_linked` (note `auto-linked: name + email match` / `auto-linked: new owner from the property's owner name + email`, with ` ({via})` when run from a bulk action). Nothing is ever sent to anyone.
- **`owners.needsOwner`** query `{}` → `{ properties, ownerPairs, bulk }`, the data of the Owners page's "Needs an owner" card.
  - `properties`: one row per property that is not simply `linked`, in property-name order: `{ propertyId, propertyName, category, rosterName, rosterEmails /* full: finance users only */, kind: "link"|"create"|"mismatch"|"needs", reason, reasonText, message, candidates: [{ ownerId, legalName, emails, active, flag, flagText }], readyOwnerId, linkedOwners, doubtful: boolean, doubt: string|null, bulk: null | { kind: "link"|"create"|"link_new", withPropertyName } }`.
  - `ownerPairs`: pairs of active, non-merged owners that look alike and are not dismissed: `{ key, a, b, flag /* or "same_owner" */, flagText, sharedEmails }`.
  - `bulk`: `{ link, create, linkNew, total, doubtful, thisRun }` (`linkAllCounts`).
- **Doubtful (`planLinkAll`, pure).** What "Link all exact matches" does with each property, decided by the same rule plus checks across the list: "Ready to link" (`link`) is safe; "New owner" (`create`) is safe only when no other unlinked property on the list looks like it (same name with another email or no email; same email under another name), and properties with the same name and a shared email are **one** new owner (the first in display order creates it, the rest are `link_new`; if one of them is doubtful, all are); everything else is **Doubtful** with the plain-words reason (`doubtOf`: `DOUBT_REASON_TEXT` / `DOUBT_FLAG_TEXT`, e.g. "Same email, different name", "Missing email on the property page", "On an open draft statement", "The property page differs from the linked owner").
- **`owners.linkAllExact`** mutation `{}` → `{ linked, created, linkedToNew, skipped, remaining }`. Decides everything again from the database (never from the list the browser shows), skips anything doubtful, and re-checks each property just before writing (a property whose decision changed is skipped). At most `LINK_ALL_LIMIT` = 100 properties per call; `remaining` says how many are left for the next click. Idempotent. Every link and every new owner is audited (`via` = "Link all exact matches").
- **`owners.createForProperty`** mutation `{ propertyId?, legalName?, emails? }` → `{ ownerId }` ("Create owner" on the card; name and emails are prefilled from the property page and editable). Refused: property missing / not found; owner field errors (`validateOwnerFields`); the property already has a link (`{property} is already linked to {owners}. Unlink it there first.`); an open draft (`{property} has an open draft statement. Finalize or discard it first.`); a same-name owner exists and either side has no email (`An owner named “{name}” already exists. Link the property to that owner, or add an email that tells the two apart.`, field `legalName`) or shares an email (`“{name}” with that email is already an owner. Link the property to that owner instead.`, field `emails`). Creates `source: "manual"`, `createdFromPropertyId`, no fee, and the link (audit notes `from Needs an owner: {property}`).
- **`owners.dismissIdentityFlag`** mutation `{ kind: "owner_pair"|"property_owner", ownerId, otherOwnerId?, propertyId? }` → `null` ("Not the same owner"). `owner_pair`: the two owners are different people. `property_owner`: the owner the property page names is not this owner (also used by "Keep linked to {owner}" on a `mismatch` row), remembered with the page's name + emails, so editing them asks again. A property that is not linked is refused when the owner matches its page name and email exactly ("This owner matches the property's name and email exactly. Link it, or change the owner on the property page.", field `ownerId`). Idempotent. Messages: "Choose what you are marking as not the same owner." / "Select the owner." / "Select the other owner." / "Pick two different owners." / "Select the property." / "Property not found." Audit `owner_identity_dismissed` (entity `owner`, to = the other owner's or the property's name).
- **`owners.mergePreview`** query `{ keepOwnerId?, mergeOwnerId? }` → `{ problem: { field, message }|null, keep, merge, moves: string[], shared: string[], emailsAfter: string[] }` (never throws for user input) and **`owners.merge`** mutation (same args) → `{ propertiesMoved, alreadyLinked }`. Merging owner B ("merge") into owner A ("keep"): B's links move to A (a property linked to both keeps A's link and B's is deleted), emails are unioned (A's first), **A's payee stays**, B is turned off and marked `mergedIntoOwnerId` / `mergedAt`. `mergeProblem` refuses, in this order (field `keepOwnerId` or `mergeOwnerId`): "Select the owner to keep." / "Select the owner to merge into it." / "Pick two different owners to merge." / `{name} was already merged into another owner.` / `{name} is inactive. Turn it back on first, or keep the other owner.` (the kept owner) / `{name} already has a final statement, so it can't be merged. Final statements stay with the owner they were issued to.` (either) / `{name} has an open draft statement. Finalize or discard it first.` (either) / `{name} has {n} ledger transaction(s). Void it/them first (or merge the other way round).` (the merged owner's non-voided rows) / `The owner draw payees differ ({keep}: {x}, {merge}: {y}). Make them match on both owners first.` (only when the merged owner has a payee and it differs) / `Together these owners have {n} email addresses, and an owner can have at most 5. Remove some first.` / `Both owners are linked to {property} with different opening balance, first statement month, reserve or management fee. Make them match, or unlink it from one owner first.` (a property linked to both, when the merged side has any setting and the settings differ). The old owner-level fee check is no longer used (the fee is compared per link). Audit: `owner_property_linked` (note `merged from {name}`) and `owner_property_unlinked` (note `merged into {name}`) per link, `owner_merged` (on A) and `owner_merged_into` (on B), notes with counts only (never emails).

Validation messages (shared with the client via `validateOwnerFields`; the fee messages are `FEE_MSG` above):

| field | message |
|---|---|
| legalName | "Enter the owner's legal name (the LLC or person the statement is for)." / "Keep the legal name under 160 characters." / `An owner named “${name}” already exists.` (`owners.create` / `update` only; a name another non-merged owner has) |
| contactFirstName / contactLastName | "Keep the name under 80 characters." |
| emails | `“${raw}” isn't a valid email address.` (regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`; at most 5 emails; "Add at most 5 email addresses.") |
| managementFeeBps (`owners.setPropertyFee`) | "Enter the management fee as a percentage like 5.00." (unparseable on the client) / "The management fee must be between 0.00% and 100.00%." (not an integer in 0..10000) / "That is already this property's fee." |
| payeeName | "Keep the payee name under 120 characters." |
| propertyId (link) | "Select the property to link." / `${property} is already linked to this owner.` / `${property} already belongs to ${otherOwner}. Linking it here makes it co-owned and pauses its statements. Confirm to continue.` (when `confirmCoOwned` is not true) / `${property} has an open draft statement. Finalize or discard it first.` |
| unlink | `${property} has an open draft statement for this owner. Finalize or discard it first.` / `${property} has ${n} transactions for this owner that aren't on a final statement yet. Put them on a statement or void them first.` |
| openingBalanceCents | "Enter the opening balance like 1,250.00 (use a minus sign if it's negative)." (client) / `The opening balance can't change after ${property} has a final statement.` (only when the value changes, and only this owner's finals lock it: `linkSettingProblem`, 3.3) |
| startMonth | "Pick the first statement month." (invalid) / `The first statement month can't change after ${property} has a final statement.` (this owner's finals) / `${property} has an open draft statement. Finalize or discard it before changing the first statement month.` (any open draft on the property, `START_MONTH_DRAFT_OPEN`) |
| propertyReserveCents | "Enter the property reserve like 500.00." / "The property reserve can't be negative." |
| deposit (unitId) | "Unit not found." / "Enter the deposit like 800.00." / "The deposit can't be negative." / "The deposit can't be more than $1,000,000.00." |

Audit:
- entity `owner`: `owner_created` (to = JSON of fields; the automatic and bulk paths store email **counts**, never addresses), `owner_imported` (the owners import), `owner_updated` (from/to = JSON of changed fields only), `owner_activated` / `owner_deactivated`, `owner_property_linked` (to = property name, note "co-owned" if so, or the auto-link / merge note), `owner_property_unlinked`, `owner_property_settings_changed` (from/to JSON), `owner_property_fee_changed`, `owner_merged`, `owner_merged_into`, `owner_identity_dismissed`
- entity `config`: `ros_default_fee_changed`
- entity `unit`: `security_deposit_set` (from/to cents as strings)

### 5.3 `convex/ledger.ts` (WP2): manual transactions

- `formOptions` query `{ propertyId? }` → `{ properties: [{ propertyId, name, ownerLegalName, blockedReason: string|null }], units: [{ unitId, label, tenants: string[] /* active residents' fullName */ }], accounts: active accounts }`. `blockedReason` is the co-owned or no-owner message (5.8).
- `list` query `{ ownerId?, propertyId?, month?, includeVoided?: boolean, cursor: string|null }` → a paginated list (50 per page), newest date first: `{ _id, date, postedDate: string|null, propertyName, unit, accountName, type, name /* displayName */, memo, amountCents, source, sourceLabel, statementId, statementLabel /* "September 2026 statement" */, voided, editable }`. `date` is the original date; `postedDate` is set only on a billed row whose statement date differs (carried forward). The `month` filter uses the posted month: an unbilled row filters by its own `date`, a billed row by `postedDate`, and rows dated before the month but posted in it (`by_owner_and_posted` / `by_org_and_posted`) are added to the last page (`rosPolicy.ledgerRowInMonth`).
- `add` mutation `{ propertyId?, unitId?: string|null, date?, accountId?, counterparty?, memo?, amountCents?: number }` → `{ entryId }`.
- `update` mutation `{ entryId?, unitId?, date?, accountId?, counterparty?, memo?, amountCents? }` → `null`. The property cannot be changed: "To move a transaction to another property, delete it and add it again."
- `voidEntry` mutation `{ entryId?, reason? }` → `null`.
- `history` query `{ entryId }` → audit rows for entity `ledger_entry`, newest first (max 100).

Rules, in check order, for `add` / `update`:
1. `validateEntryFields`. Exact messages:

   | field | message |
   |---|---|
   | propertyId | "Select the property this transaction belongs to." |
   | unitId | `That unit isn't part of ${property}.` (`""` / null / undefined all mean Property level) |
   | date | "Enter the transaction date." / "Enter a real date." / "The date can't be in the future." |
   | accountId | "Select the account for this transaction." / `The account “${name}” is turned off. Pick another account.` |
   | counterparty | "Enter the name that prints on the statement (tenant, vendor or payee)." / "Keep the name under 120 characters." |
   | memo | "Enter a memo (it prints on the statement)." / "Keep the memo under 300 characters." |
   | amountCents | "Enter the amount." / "Enter the amount like 1,250.00." / "The amount must be more than $0.00." / "The amount can't be more than $1,000,000.00." |

2. Property ownership:
   - no link → `Link ${property} to its owner before recording transactions.`
   - co-owned → the `CO_OWNED` message (5.8)
   - The row's `ownerId` = the single linked owner.
3. `entryChangeDateProblem` (period lock and start month; `entryDateProblem` = future, locked month, before start month), messages in 5.8.
   - On `add` it always runs.
   - On `update` it runs **only when the date changes**. An unbilled row dated in a locked month (it is carried forward onto the next draft) keeps its date and can have its other fields corrected; moving it into or within a locked month is still refused.
4. `update` / `voidEntry` checks:
   - Billed row: "This transaction is on a final statement and can't be changed. Add a correction in a later month instead."
   - `source !== "manual"`: "Only transactions entered by hand can be changed here."
   - Voided row: "This transaction was deleted."
   - `voidEntry` has no date rule: **any unbilled manual row can be voided**, whatever its date (one in a final month was never on that statement).
5. `voidEntry` reason: "Enter why you're deleting this transaction." (max 300). The UI calls voiding **Delete** (dialog "Delete this transaction?").

Audit (entity `ledger_entry`, entityId = entry id):
- `entry_created`: to = JSON `{date, property, unit, account, counterparty, memo, amountCents}`
- `entry_updated`: from/to = JSON of the changed fields only
- `entry_voided`: note = reason

`type` is always set from the account's `kind`.

**Rent Income is not entered here (2026-11-12).** `validateEntryFields` refuses an account with `systemKey "rent_income"` on add and on edit (field `accountId`): "Record rent on the Payments page." Other income accounts are allowed. Rent Income rows entered by hand before this stay valid, go on statements as before, show on the Payments page as Paid ("Entered in the ledger", 5.9) and can still be deleted (voided) here; the Ledger and statement pages offer no Edit on them. The old rent-confirmation hook (`clearRentCheckForProperty`) was removed. **A row whose CURRENT account is Rent Income can't be edited at all** (2026-11-12, `rosPolicy.entryEditProblem`, checked in `ledger.update` right after `loadForChange`, field `accountId`): "Rent can't be moved to another account. Delete it and record it on the Payments page." (`ENTRY_MSG.rentRowLocked`); Delete (`voidEntry`) stays allowed. `ledger.list` takes an optional `pageSize` (25, 50 default, 100; anything else = 50). The ledger list labels a `roster_rent` row's source "Roster rent" and a `rent_payment` row's "Payments page" (with a link to the Payments page for its rent month); `ledger.list` rows carry `onRentAccount` and `rentForMonth`.

### 5.4 `convex/ownerStatements.ts` (WP2)

| Function | Args | Returns |
|---|---|---|
| `list` query | `{ month }` | `{ month, owners: [{ ownerId, legalName, eligiblePropertyCount, statements: [{ statementId, status, propertyNames: string[], endingCashCents?: number, availableCents?: number, updatedAt }] }] }`: every active owner with at least one link, plus inactive owners that have statements that month. Discarded statements are left out. |
| `generateOptions` query | `{ ownerId, month }` | `{ owner: { legalName }, properties: [{ propertyId, name, selectable: boolean, reason: string|null, defaultTicked: boolean }] }`: every linked property, sorted (4.4). `defaultTicked = selectable`. `reason` = `createDraftProblem(...)` |
| `createDraft` mutation | `{ ownerId?, month?, propertyIds?: string[] }` | `{ statementId }` |
| `get` query | `{ statementId }` | see below |
| `excludeLine` / `includeLine` mutation | `{ statementId?, key? }` | `null` (a repeated call that finds the line already in the requested state is a no-op). The key is `entry:`, `wo:` or `rent:` + id. |
| `setRentLine` mutation | `{ statementId?, unitId?, amountCents?, date?, counterparty?, memo?, reset?: boolean }` | DEPRECATED 2026-11-12: always refuses with "Rent is recorded on the Payments page." (kept for older clients) |
| `confirmRent` mutation | `{ statementId?, checked?: boolean, expectedRentHash?: string }` | DEPRECATED 2026-11-12: always refuses with "Rent is recorded on the Payments page." |
| `setAdjustments` mutation | `{ statementId?, propertyId?, earlyPaymentsCents?, unpaidBillsCents?, propertyReserveCents? }` | `null` |
| `setGenerated` mutation | `{ statementId?, propertyId?, kind?: "fee"|"draw", amountCents?: number|null, memo?: string|null, excluded?: boolean }` | `null` (amountCents null = back to computed; memo null = standard memo) |
| `finalize` mutation | `{ statementId?, expectedEndingCents?: number, expectedAvailableCents?: number, expectedHash?: string }` | `{ statementId }` (`expectedHash` = the `previewHash` the user reviewed, optional; see step 4) |
| `discard` mutation | `{ statementId?, reason?: string }` | `null` |
| `history` query | `{ statementId }` | audit rows for entity `ros` + this id, newest first (max 200) |
| `pdfData` query | `{ statementId }` | `{ draft: boolean, snapshot: StatementSnapshot }`: final = the stored snapshot; draft = built live with `statementDate = businessToday(now)` |
| `recordDownload` mutation | `{ statementId?, draft?: boolean }` | `null` (audit only) |

`get` returns:

```ts
{
  statement: { _id, status, month, monthLabel, periodStart, periodEnd, statementDate: string|null, createdAt, finalizedAt?, finalizedByName? },
  owner: { _id, legalName, payeeName: string|null },   // no owner-level fee any more (the fee is per property, in `properties`)
  view: StatementView,                     // live for draft, from snapshot for final
  result: StatementResult,
  lines: LineView[],                       // included lines (draft: live; final: from snapshot, all editable=false)
  excludedLines: LineView[],               // draft only
  properties: [{ propertyId, name, securityDepositsCents, earlyPaymentsCents, unpaidBillsCents,
                 propertyReserveCents, propertyReserveDefaultCents,
                 feeSource: "own" | "default" | null,   // where fee.bps comes from; null on a final (the % is the one frozen in its snapshot)
                 fee: ..., draw: ... /* from result.generated; fee.bps = this property's % */ }],
  rent: { lineCount, hash: string|null, checked: boolean, checkedAt: number|null, checkedByName: string|null,
          skipped: { propertyId, propertyName, unitId, unit, code, reason }[] },   // DEPRECATED 2026-11-12, kept for older clients: a draft always returns lineCount 0, hash null, checked false, skipped []; a final keeps lineCount of its historical roster-rent lines and its stored confirmation
  warnings: { blocking: { code, message, workOrderId?, rentMonth? }[], info: { code, message, workOrderId?, rentMonth? }[] },  // rentMonth on RENT_UNPAID (link to the Payments page)  // workOrderId on single-WO warnings (WO_MISSING_BILL, WO_AWAITING_REVIEW, WO_BEFORE_START*), so the UI links to the work order
  canFinalize: boolean,                    // draft && blocking.length === 0 && the period has ended (finalizeProblem === null)
  previewHash: string,                     // resultHash(result): fingerprint of everything the statement shows (columns, summary, income statement, detail, generated fee/draw), not the warnings. The Finalize dialog freezes it (see 6.3).
}
type LineView = {
  key: string; kind: "entry" | "wo" | "fee" | "draw" | "rent";   // "rent" = a historical roster-rent line (finals before 2026-11-12 only), key "rent:<unitId>"
  side: "addition" | "subtraction";
  date: string; storedDate: string; carriedForward: boolean;
  propertyId: string; propertyName: string; unit: string; accountId: string; accountName: string;
  name: string; counterparty: string; memo: string; amountCents: number;
  sourceLabel: string;   // "Manual" | "Payments page" (rent_payment) | "WO-2051" | "Roster rent" (historical) | "Management fee (auto)" | "Owner draw (suggested)" | "Owner draw (edited)" | "Management fee (edited)"
  entryId?: string; workOrderId?: string; unitId?: string | null; billPropertyLevel?: boolean;
  rentForMonth?: string;   // rent payments (source rent_payment): the month the rent is for (the "Edit on Payments page" link)
  onRentAccount?: boolean; // an entry line on the Rent Income account: no Edit on the statement (rent is changed on the Payments page)
  // (rentDefault / rentEdited were removed with the roster-rent prefill, 2026-11-12)
  editable: boolean;     // draft && (entry unbilled manual | wo | rent | fee | draw)
  defaultExcluded?: boolean; // true = dated before the owner's first statement month: left off by default (in excludedLines) until the accountant includes it
  note?: string;             // why it is excluded by default (MSG.BEFORE_START_NOTE / ENTRY_BEFORE_START_NOTE, see 5.8)
}
```

**Building a draft (`convex/rosBuild.ts`, WP2, a server helper, not registered).** `buildStatement(ctx, statement, { statementDate })` returns `{ input: CalcInput, result, lines, excludedLines, warnings }`:

1. Load the owner, the statement's properties (in stored order), each property's links (to detect co-owned or changed owner), and the accounts (via `ensureDefaultAccounts` is not possible in a query, so if the system accounts are missing, return the blocking warning `ACCOUNTS_MISSING`).
2. Per property `p`:
   - **beginning:** (the order below is the order checked)
     - If the final row for `(p, prevMonth(month))` belongs to **another owner** (the property changed hands), that owner's ending cash is theirs and is **not** carried:
       - `link.openingBalanceCents` is set → use it.
       - Not set and the previous owner ended with a non-zero balance → blocking `PREV_OWNER_BALANCE`.
       - Not set and the previous owner ended at $0.00 → beginning 0, info `OPENING_BALANCE_NOT_SET`.
     - Else, if a final row exists for `(p, prevMonth(month))` (same owner), use its `endingCashCents`.
     - Otherwise, if `p` has no final statement at all, use `link.openingBalanceCents ?? 0`, plus the info warning `OPENING_BALANCE_NOT_SET` when it is undefined.
     - Otherwise: blocking `PRIOR_NOT_FINAL`.
   - **deposits:** Σ `units.securityDepositHeldCents ?? 0` over the property's units. If the property **has units** and every one is undefined: info `DEPOSITS_NOT_SET`. A property with no units at all gets no warning.
   - **first statement month floor:** `floorDate = monthStart(link.startMonth ?? statement month)`. If `link.startMonth` is set and is **after** the statement's month: blocking `START_MONTH_AFTER` ("Discard this draft, then check the first statement month."). Rows dated before the floor are not dropped, they are **excluded by default** (see "Manual rows" and "Work orders" below).
   - **reserve:** `adjustment.propertyReserveCents ?? link.propertyReserveCents ?? 0`. Early payments and unpaid bills come from `adjustments` (default 0). Pending ePay is 0.
   - **Fee:** `effectiveFee(link.managementFeeBps, org default)`: the link's own % if it has one, else `financeSettings.rosDefaultFeeBps` (500 when absent). It goes into the engine as `feeBps` for that property (4.2); `feeSource` = "own" / "default".
   - **Rent:** no longer prefilled (5.4.1 removed). Rent payments from the Payments page are ledger rows (source `rent_payment`) and come in with the manual rows below; their LineView carries `rentForMonth`, `editable: false` and `onRentAccount: true`. **RENT_UNPAID (info):** for the rent months `unpaidCheckMonths(month, link.startMonth)` (the statement month and up to two before it, never before the first statement month), every unit whose rent can be marked (`rentMarkability`) with neither a rent payment for that month nor a Rent Income row dated in it is counted; one info warning per rent month (oldest first), with `rentMonth` so the UI links to the Payments page (5.9). The loader reads those rows per unit (`by_unit_and_rent_month`, `by_unit_and_date`) into `rentRecords`.
   - **Manual rows:** unbilled, not voided, `ownerId` = this owner, `date <= periodEnd`. Key `entry:<id>`. `unitLabel` = the unit's `unitNumber` or null. `seq` = createdAt. A row with `date < floorDate` is **excluded by default** with the note `ENTRY_BEFORE_START_NOTE` (5.8); it appears under "Left off this statement" and goes on the statement only when the accountant includes it.
   - **Work orders:** loaded by `by_property_and_rosPending` (`rosPending = true`; plus the not-yet-backfilled fallback, 3.9) and `by_property_and_status` for `completed`, mapped to `WoForBilling` with `completedDate = businessDate(completedAt ?? closedAt ?? createdAt)`, then `selectWorkOrders(wos, periodEnd, floorDate)` with the `floorDate` above (ASSUMPTION A9). Each billable WO becomes a row. `beforeFloor` WOs (completed before the first statement month, they may already have been billed in Buildium) also become rows, **excluded by default** with the note `BEFORE_START_NOTE`; `WO_BEFORE_START` (info) is raised for those still left off, and `WO_BEFORE_START_MISSING_BILL` (info) for ones before the floor that have no bill amount, account or description (they are not on the statement and do not block it). Warnings for a single work order carry its `workOrderId`. Row fields:
     - key `wo:<id>`, date `completedDate`
     - `unitLabel = billPropertyLevel ? null : unit.unitNumber`
     - account `rosAccountId`, counterparty `COMPANY_NAME`
     - memo `workCompletedDescription` (verbatim, trimmed), amount `billAmountCents`
     - source `work_order`, seq `completedAt`
3. Remove the keys in `excludedKeys` (including `rent:<unitId>` for a removed roster-rent line). A normal line is off when its key is in `excludedKeys`; a **default-excluded** line (before the first statement month) is off unless its key is in `includedKeys`. `excludeLine` / `includeLine` keep the two lists consistent: toggling a default-excluded line writes `includedKeys`, toggling a normal line writes `excludedKeys`, and the key is removed from the other list either way (`rosBuild.toggledKeys`). Excluded lines are returned separately (with `defaultExcluded` and `note` where they apply) and still marked editable.
4. Owner: `payeeName = effectivePayee(owner)`. There is no owner-level fee: the engine input has `managementFeeBps: null` and each property carries its own `feeBps` (step 2).
5. If more than `MAX_STATEMENT_LINES` lines: blocking `TOO_MANY_LINES`.
6. Call `computeStatement`. Merge the engine warnings with the DB warnings (5.8).

**createDraft (idempotent).** In order:
1. `requireFinance`.
2. Validate:
   - field `ownerId`: "Select the owner this statement is for." / "Owner not found."
   - field `month`: "Select the statement month." / "You can't create a statement for a month that hasn't started."
   - field `propertyIds`: "Tick at least one property for this statement." / "Property not found."
3. For each property, build `PropertyStatementState` and call `createDraftProblem`. On the first problem, throw `fieldError("propertyIds", message)`.
4. `ensureSeeded` (seeds the default accounts only when a system account is missing, 3.4).
5. Insert the statement: `status "draft"`, propertyIds sorted with `sortProperties`, `excludedKeys []`, one `adjustments` entry per property `{earlyPaymentsCents: 0, unpaidBillsCents: 0}`, `overrides []`.
6. Insert one `ownerStatementProperties` row per property with `status "draft"`.
7. Audit `ros` / `draft_created`, to = JSON `{owner, month, properties: names}`.

Convex mutations are serializable, so two concurrent creates for the same property-month cannot both pass step 3.

`createDraftProblem` rules, in order (messages in 5.8):
1. Not linked to this owner → `CREATE_NOT_OWNER`.
2. Co-owned → `CO_OWNED`.
3. A draft or final already exists for `(p, month)` → `CREATE_EXISTS`.
4. An open draft exists in another month → `CREATE_OPEN_DRAFT`.
5. If finals exist:
   - `month <= lockedThrough` → `CREATE_ALREADY_FINAL`
   - `month !== nextMonth(lockedThrough)` → `CREATE_GAP`
6. No finals and `startMonth` is set and `month !== startMonth` → `CREATE_START_MONTH`.

(ASSUMPTION A25: months are finalized in order for each property.)

**Draft edits.** For every draft mutation:
- Load the statement: "Statement not found."
- It must be a draft: "This statement is final and can't be changed." / "This statement was discarded."

`excludeLine` / `includeLine`:
- The key must match `^(entry|wo):` and be a line of this draft: "That line isn't on this statement."
- To skip the fee or the draw, use `setGenerated(excluded: true)`.
- Audit `line_excluded` / `line_included`, note = `${sourceLabel} ${formatDate(date)} ${accountName} ${formatAmount(amount)}`.

`setAdjustments`:
- Money must be integers >= 0: "Early payments can't be negative." / "Unpaid bills can't be negative." / "The property reserve can't be negative." Use the same `fieldError` keys as the form.
- Audit `adjustments_changed` from/to JSON.

`setGenerated`:
- `amountCents` must be an integer >= 0 or null: "Enter the amount like 657.32."
- memo max 300: "Keep the memo under 300 characters."
- Audit `generated_changed` (note `fee` or `draw`, from/to JSON).

**finalize (single transaction).** In order:
1. `requireFinance`. Load the statement; it must be a draft ("This statement is already final." / "This statement was discarded.").
2. `finalizeProblem(month, businessToday(now))` → for example `You can finalize September 2026 from 10/1/2026.`
3. `buildStatement(ctx, st, { statementDate: businessToday(now) })`. If there are blocking warnings: `Can't finalize yet: ${first.message}` (+ ` (and ${n-1} more)` when n > 1). (`RENT_NOT_CHECKED` no longer exists; RENT_UNPAID is info only and never blocks.)
4. Staleness guard: if `expectedEndingCents !== result.summary.ending.total || expectedAvailableCents !== result.summary.available.total`, or `expectedHash` is given and differs from `resultHash(result)` → "The statement changed while you were reviewing it. Check the new totals and finalize again." (The UI sends the figures and hash it **froze when the Finalize dialog opened**, never the live ones; see 6.3 and `components/finance/finalize-guard.ts`.)
5. For each WO line:
   - Re-read the WO. If `billedStatementId` is set, or a `ledgerEntries` row exists `by_source ("work_order", woId)` → `WO-${n} was already billed on another statement. Refresh and check this statement.`
   - Insert a ledger row:
     - `source "work_order"`, `sourceId = woId`, `type "expense"`
     - date = the line's **effective** date, `postedDate` = the same effective date, `unitId = billPropertyLevel ? undefined : wo.unitId`
     - account, counterparty `COMPANY_NAME`, memo, amount
     - `statementId`, `ownerId`
   - Patch the WO: `billedStatementId`, `billedLedgerEntryId`, `billedAt`, `rosPending: false`.
   - Audit `work_order` / `billed`, to = statement id, note = `${monthLabel} statement for ${legalName}`.
6. For each fee and draw line, insert a ledger row:
   - `source "management_fee" | "owner_draw"`, `sourceId = ${statementId}:${propertyId}` (check `by_source` first; if one exists, throw "This statement was already finalized.")
   - type `expense` / `owner_draw`, date `periodEnd`, `postedDate = periodEnd`, no unit
6b. (Removed 2026-11-12.) Roster-rent rows are no longer written. Rent payments are stamped in step 7 like manual rows (`statementId`, `postedDate`), so each is billed exactly once.
7. For each manual line: re-read it. It must still be unbilled and not voided, else "A transaction on this statement changed while you were reviewing it. Refresh and try again." Patch `statementId` and `postedDate` = the line's effective date (`date` stays the original; the snapshot also holds the effective date).
8. Build `StatementSnapshot` from the same result (`header.statementDate = today`, `footerName(owner)`, `payeeName`) and insert `ownerStatementSnapshots` (the snapshot is built and its size checked **before anything is written**; if the JSON is ≥ 900,000 **UTF-8 bytes** (`new TextEncoder().encode(json).length`, not string length): "This statement is too large to save. Split it into fewer properties.").
9. Patch the statement:
   - `status "final"`, `statementDate`, `endingCashCents`, `availableCents` (the totals), `finalizedAt`, `finalizedBy`
   - each `ownerStatementProperties`: `status "final"`, `endingCashCents = result.summary.ending.byProperty[i]`
   - each link with no `startMonth`: set `startMonth = month`
10. Audit `ros` / `finalized`, to = JSON `{ endingCents, availableCents, lines: n }`.

**discard.**
- Draft only.
- Set status `discarded` on the statement and on its `ownerStatementProperties` rows. This frees the property-month. Nothing in the ledger or on any WO changes.
- Audit `discarded`, note = reason.
- Final statements cannot be discarded: "A final statement can't be discarded. Put corrections on next month's statement."

#### 5.4.1 Roster rent prefill (REMOVED 2026-11-12, replaced by the Payments page, 5.9)

> **Removed.** Drafts no longer get roster-rent lines; `RENT_NOT_CHECKED`, `RENT_INVALID` and `RENT_ACCOUNT_MISSING` are no longer raised; `setRentLine` / `confirmRent` refuse with "Rent is recorded on the Payments page."; finalize writes no `roster_rent` row; the Rent dialog, the "Not prefilled from the roster" card and the Confirm rent checkbox are gone. `rosterRentToCents` and `rosterSaysVacant` are still used (by `rentPaymentsPolicy.rentMarkability`). Historical `roster_rent` rows and the deprecated statement fields stay valid. The text below is kept as the record of what was built.

Until card payments are live, every draft is prefilled with the rent the roster says each occupied unit pays. The accountant checks it against what was actually received, fixes it, and confirms it once. Code: `rosPolicy.ts` (the pure rules), `rosBuild.ts` (the lines and the fingerprint), `ownerStatements.ts` (`setRentLine`, `confirmRent`).

**The line.** For each unit of a statement property (natural order), when the Rent Income account exists:

| field | value |
|---|---|
| key | `rent:<unitId>` (`rosBuild.rentKey`) |
| type / account | `income` / the account with `systemKey "rent_income"` |
| unit | the unit (never Property level) |
| date | `periodStart` (the 1st); editable inside the period |
| Name | the unit's active tenants (`residents.active`, `fullName`), unique, natural order, joined with `" & "` (`rentCounterparty`: "Ann Lee & Bob Ray") |
| memo | `"Payment"` (`ROSTER_RENT_MEMO`) |
| amount | `rosterRentToCents(units.rent)`; `units.rent` is **dollars** (a JS number), the result is integer cents |
| source / label | `roster_rent` / "Roster rent" (edited lines show "Roster rent (edited)") |

`rosterRentToCents` returns `null` unless the roster rent is a finite number > 0 whose decimal text is plain digits with at most 2 decimals (so `1e-3`, `1e21` and `950.875` are refused), that rounds to a safe integer of cents <= `MAX_AMOUNT_CENTS` and gives back exactly the same number. No float drift.

**Skip rules** (`rentPrefillDecision`, checked in this order; the first that applies wins). A skipped unit gets no line and is listed in `get().rent.skipped` as `Unit {X}: {reason}` (the "Not prefilled from the roster" card), so nothing is left off silently:

| code | reason shown | when |
|---|---|---|
| `owner_direct` | owner collects rent directly | `units.rentPaidTo === "owner_direct"` |
| `included_in_other_unit` | rent is included in another unit | `rentPaidTo === "included_in_other_unit"` |
| `already_recorded` | rent is already recorded for {Month YYYY} | a non-voided Rent Income ledger row for that unit is dated inside the period (any owner; the unbilled rows of the draft plus this owner's billed rows, so a recorded payment is never doubled) |
| `roster_vacant` | unit is marked vacant on the roster | `occupancy` is `vacant` or `vacant_not_ready`, or `leaseType` is `vacant` (`rosterSaysVacant`), **even when an active resident is still on file** |
| `vacant` | no active tenant | no active resident |
| `no_rent` | no rent on the roster | `units.rent` undefined / null |
| `invalid_rent` | the roster rent isn't a valid dollar amount | `rosterRentToCents` is null; also raises the info warning `RENT_INVALID` |

**Edit (`ownerStatements.setRentLine`)** `{ statementId, unitId, amountCents?, date?, counterparty?, memo?, reset? }`, draft only. A field left `undefined` keeps its current value; `reset: true` goes back to the roster values. The result is validated by `validateRentLineFields` (the client dialog runs the same function, so messages are identical) and **only what differs from the roster is stored** in `ownerStatements.rentOverrides` (an override equal to the roster value is dropped; nothing differing = the override is removed). `rosBuild.applyRentOverride` ignores an override field that is not valid (amount not 1..MAX cents, date outside the period, blank text), so a bad stored value can never reach a statement. Audit `rent_line_changed` / `rent_line_reset` (from/to JSON, note `Unit {X} ({property})`). The unit must have a rent line on this statement: "That rent line isn't on this statement." (field `unitId`).

Field messages (`RENT_MSG`; fields in this order):

| field | message |
|---|---|
| amountCents | "Enter the rent amount." / "Enter the amount like 1,250.00." / "The amount must be more than $0.00. If the tenant didn't pay, remove the line instead." / "The amount can't be more than $1,000,000.00." |
| date | "Enter the payment date." / "Enter a real date." / `The payment date must be in {Month YYYY}.` / "The date can't be in the future." |
| counterparty | "Enter the tenant name that prints on the statement." / "Keep the name under 120 characters." |
| memo | "Enter a memo (it prints on the statement)." / "Keep the memo under 300 characters." |

**Remove ("didn't pay") and add.** Remove = `excludeLine("rent:<unitId>")` (key in `excludedKeys`). The line moves to "Left off this statement" with the note "Removed: the tenant didn't pay this month. Put it back if the payment came in." and a **Put back** button (`includeLine`). A removed line is **not carried forward**: next month's draft prefills its own rent. A payment the roster did not predict is added with "Add transaction" (a manual Rent Income row).

**Confirm (`ownerStatements.confirmRent`)** `{ statementId, checked, expectedRentHash }`, draft only.
- `rent.hash` is a fingerprint of **every rent line, on or off**: the roster-rent lines and the unbilled Rent Income ledger rows, each as `[key, on, propertyId, unitLabel, date, accountId, amountCents, counterparty, memo]`, sorted by key. It is `null` when the statement has no roster-rent line.
- While `rent.hash !== null` and the stored `rentCheckedHash` is not equal to it, the blocking warning `RENT_NOT_CHECKED` keeps Finalize disabled (`rent.checked` = false).
- Ticking needs the hash the accountant was looking at. `checked` must be a boolean ("Tick the box to confirm the rent lines."); no roster-rent line: "This statement has no roster rent lines to confirm."; a different hash now: "The rent lines changed while you were reviewing them. Check them again, then confirm." On success it stores `rentCheckedAt`, `rentCheckedBy`, `rentCheckedHash` and audits `rent_checked` (note `{n} roster rent line(s) ($total), {m} removed`). `checked: false` clears it (audit `rent_unchecked`).
- **Any change voids the confirmation.** `setRentLine`, removing or putting back a rent line or a Rent Income row, and adding, editing or voiding a Rent Income ledger row (5.3) clear it (audit `rent_check_cleared`, note says why), and because the fingerprint is recomputed on every read, a change made anywhere else (for example a roster edit to `units.rent`) also un-confirms it.
- A final statement keeps `rentCheckedAt` / `rentCheckedBy`; `get()` shows them (`checked`, `checkedAt`, `checkedByName`).

**Finalize** writes one Rent Income ledger row per included roster-rent line (step 6b above, `source "roster_rent"`, `sourceId = {statementId}:{unitId}`); removed lines write nothing. The rows are billed (`statementId`), so they can't change, and they count toward the management-fee base like any Rent Income row (`feeBase`).

**UI (6.3):** row actions **Edit** (the Rent dialog, `components/finance/rent-dialog.tsx`) and **Remove (didn't pay)**; the "Not prefilled from the roster (n)" card; the side panel's **Confirm rent** checkbox (`RentConfirm`: "I've checked the rent lines against what was actually received").

### 5.5 Locking and idempotency, summarised

| Guarantee | Enforced by |
|---|---|
| One active (draft or final) statement per property per month | `createDraftProblem` CREATE_EXISTS via `by_property_and_month` |
| At most one open draft per property | CREATE_OPEN_DRAFT, so an unbilled row or WO can only be in one draft |
| A WO is billed at most once | `billedStatementId` + the `by_source` check at finalize + `selectWorkOrders` skips billed WOs |
| Fee/draw written once per statement-property | `sourceId = statementId:propertyId` + the `by_source` check |
| A rent payment is recorded once per unit per rent month | `rentPaymentsLib.planMark`: a non-voided `rent_payment` for (unit, rentForMonth) via `by_unit_and_rent_month`, or a Rent Income row entered by hand dated in that month, refuses (inside the mutation, so concurrent marks can't both pass) |
| A rent payment is billed once and frozen when final | it is an unbilled ledger row stamped at finalize (step 7); `paymentLock` refuses update / undo once billed or once its received month is final for the property |
| Fee changes can't slip past a review | `previewHash` covers each property's fee % (4.2); a default-fee change is guarded by `expectedCounts` (5.2) |
| Final is immutable | every draft mutation checks `status === "draft"`; `get` serves the snapshot |
| Locked period | `entryDateProblem` (months <= `lockedThroughMonth` refuse add/edit), billed rows refuse edit/void, `workOrderBilling.updateBilling` refuses billed WOs |
| Months in order | CREATE_GAP / CREATE_START_MONTH / PRIOR_NOT_FINAL |
| Opening balance and first statement month lock per owner | `linkSettingProblem` (this owner's finals; any open draft for the first statement month), 3.3 |
| The user finalizes what they reviewed | the finalize staleness guard: amounts plus `expectedHash`, frozen when the dialog opens (6.3) |
| No surprise totals | the finalize staleness guard |
| Finalize only after the month ends | `finalizeProblem` |

### 5.6 Work-order billing (WP3)

**Date of a WO row** = `businessDate(completedAt ?? closedAt ?? createdAt)` (completion = the tech's submit time). On the statement, the shown date is `max(that, periodStart)` (carried forward when it was billed late, ASSUMPTION A20).

`convex/workOrderBilling.ts` (new, WP3):
- `accountsForClose` query `{}`:
  - `requireFinance`
  - returns `{ accounts: [{ _id, name }] /* active expense accounts, naturalCompare */, defaultAccountId: Id|null /* systemKey repairs */, needsSetup: boolean /* needsAccountSetup: the form then calls ensureAccounts once */ }`
- `ensureAccounts` mutation `{}` → `null`: `requireFinance`, then `seedAccounts` (seeds only when a system account is missing, audit `accounts_seeded` only when something was inserted).
- `updateBilling` mutation `{ workOrderId?, workCompletedDescription?, billAmountCents?: number|null, costCents?: number|null, rosAccountId?, billPropertyLevel?: boolean, noOwnerCharge?: boolean }`:
  1. `requireFinance` (admin view or accountant)
  2. WO in org: "Work order not found."
  3. `status === "reviewed_closed"`: `Only closed work orders can be billed. Close WO-${n} first.`
  4. Not billed: `WO-${n} was billed on the ${monthLabel} statement for ${legalName} and can't be changed. Add a correction on a later statement instead.`
  5. `validateBillingFields` (below)
  6. Patch only the changed fields, plus `rosPending = !noOwnerCharge`
  7. Audit `work_order` / `billing_updated`, from/to = JSON of the changed fields (`costCents` included: the audit is internal)

`validateBillingFields` messages (the client close form and the server use the same function):

| field | rule | message |
|---|---|---|
| workCompletedDescription | required, ≤ 2000 | "Describe the work completed (it prints on the owner statement)." / "Keep the description under 2,000 characters." |
| billAmountCents | required unless `noOwnerCharge` | "Enter the bill amount (what the owner is charged), or tick “No charge to owner”." |
| billAmountCents | integer | "Enter the bill amount like 395.00." |
| billAmountCents | > 0 | "The bill amount must be more than $0.00. Tick “No charge to owner” instead." |
| billAmountCents | ≤ MAX | "The bill amount can't be more than $1,000,000.00." |
| costCents | optional; integer ≥ 0 ≤ MAX | "Enter the cost like 245.00, or leave it blank." |
| rosAccountId | required unless `noOwnerCharge`; active expense account | "Select the account for this work order (usually Repairs)." / `The account “${name}” is turned off. Pick another account.` / "Pick an expense account for a work order." |

`workOrders.ts` changes (WP3):
- `reviewClose` args gain `workCompletedDescription?`, `billAmountCents?`, `costCents?`, `rosAccountId?`, `billPropertyLevel?`, `noOwnerCharge?`. After the existing access and transition checks:
  1. `seedAccounts(ctx, org)` (seeds only when a system account is missing, 3.4)
  2. `validateBillingFields`, throwing `fieldError`
  3. patch the fields with `status/closedAt` and `rosPending = !noOwnerCharge` (`billingPatch`)
  4. the existing `closed` audit
  5. an extra audit `billing_set`, to = JSON `{billAmountCents, costCents, account, billPropertyLevel, noOwnerCharge}`

  Pat (admin view) is the only one who can close, as today.
- `submitCompleted` gains `workCompletedDescription?: string`. In the handler, if it is blank after trimming, add `"a description of the work completed"` to the existing `missing` list. The existing message format `Can't submit yet. Missing: …` is kept. Max 2000 chars: "Keep the description under 2,000 characters." Store the trimmed text on the WO. (ASSUMPTION A30)
- `addExpense`: when `kind === "material"` and `reimbursable === undefined` → "Choose SWEEP or REIMB for this material." (existing rows are unaffected). (ASSUMPTION A3)
- **Technicians must never receive** `billAmountCents`, `costCents`, `rosAccountId`, `billedStatementId`, `billedLedgerEntryId`, `billedAt` or `noOwnerCharge`. Add `function forTechnician(wo)` in `workOrders.ts`, which returns the WO without those keys. Apply it wherever the caller's view is `technician`: `workOrders.get`, `workOrders.list` and `maintenance.ts` (the technician branch near line 2309, which returns WOs). Asset managers and accountants may see bill and cost (staff). Cost is never in any finance query or the PDF.
- `expensesTabFor` adds `reimbursable: boolean | null` to each expense, so the office UI can show SWEEP/REIMB.
- `board.ts` `detail` (work-order branch): return `billing: { workCompletedDescription, billAmountCents, costCents, rosAccountId, rosAccountName, billPropertyLevel, noOwnerCharge, billedStatementId, billedLabel /* "Billed on September 2026 statement" */ } | null`, so the drawer can prefill and show the close form.

### 5.7 Delivery hook

v1 only downloads the PDF. Later, email works like this:
- A Node action `ownerStatements.emailStatement` ("use node") renders the same `StatementPdf` document with `renderToBuffer` from `@react-pdf/renderer`.
- It sends with the existing Resend integration (`convex/resendApi.ts`) to `owner.emails`.
- It sets `emailedAt` / `emailedTo` and audits `emailed`.

Do not build any of this now. Leave a `// DELIVERY HOOK (Q8)` comment in `ownerStatements.ts` and in `components/finance/pdf/statement-pdf.tsx`.

### 5.8 Warning and problem messages (exact strings)

`{X}` = interpolated. Dates use `formatDate`, months use `formatMonth`, money uses `formatCurrency`.

| Code | Blocking | Message |
|---|---|---|
| CO_OWNED | yes | `{property} is listed under {n} owners ({names joined ", "}). Statements for it are paused until the ownership split is set.` |
| CREATE_NOT_OWNER | yes | `{property} doesn't belong to {legalName}.` |
| CREATE_EXISTS | yes | `{property} already has a {draft|final} statement for {Month YYYY} ({ownerLegalName}). Open it instead.` |
| CREATE_OPEN_DRAFT | yes | `{property} already has an open draft for {Month YYYY}. Finalize or discard it first.` |
| CREATE_ALREADY_FINAL | yes | `{Month YYYY} is already final for {property}.` |
| CREATE_GAP | yes | `{property} has no final statement for {Month YYYY of nextMonth(lockedThrough)}. Generate and finalize that month first.` |
| CREATE_START_MONTH | yes | `Statements for {property} start in {Month YYYY}. Create that month first.` |
| PRIOR_NOT_FINAL | yes | `{property} has no final statement for {prev Month YYYY}. Finalize that month first.` |
| OWNER_CHANGED | yes | `{property} is no longer linked to {legalName}. Discard this draft and generate it again.` |
| WO_MISSING_BILL | yes | `WO-{n} ({property}{, Unit X}) is closed but has no bill amount, account or description. Add them on the work order, or mark it “No charge to owner”, before finalizing.` |
| FEE_NOT_SET | yes | `Set the management fee % for {legalName} before finalizing.` (a guard only: every property has a fee since 2026-11-11 (own ?? org default), so it cannot fire as built, 3.3) |
| PAYEE_MISSING | yes | `Set the owner draw payee for {legalName} before finalizing.` |
| ACCOUNTS_MISSING | yes | `The account list isn't set up yet. Open Accounts once to create it.` |
| TOO_MANY_LINES | yes | `This statement has more than 2,000 transactions. Split it into fewer properties.` |
| PERIOD_OPEN (finalizeProblem; shown as info on the draft) | finalize only | `You can finalize {Month YYYY} from {M/D/YYYY of the 1st of next month}.` |
| WO_AWAITING_REVIEW | no | `WO-{n} ({property}) was completed on {date} but hasn't been closed by the office yet. It will go on a later statement once closed.` |
| OPENING_BALANCE_NOT_SET | no | `The opening cash balance for {property} isn't set, so it starts at $0.00.` (no final statement yet; or the previous owner's final ended at $0.00, so there is nothing to settle) |
| DEPOSITS_NOT_SET | no | `No security deposits are recorded for any unit at {property}.` (only when the property has units) |
| NEGATIVE_ENDING | no | `The ending cash balance for {property} is negative ({amount}).` |
| NO_DRAW | no | `No owner draw is suggested for {property}: cash after expenses is {amount}.` |
| RENT_PAYMENT_BEFORE_START | no | `A rent payment received before this owner's first statement month ({Month YYYY}) is left off this statement: Unit {X}, {M/D/YYYY} ({property}). Put it back from “Left off this statement” only if it wasn't billed in Buildium.` / plural `{n} rent payments received … are left off this statement: Unit {X}, {date}; Unit {Y}, {date} ({property}). Put them back … only if they weren't billed in Buildium.` (one per property, `propertyId` set, payments still left off by default sorted by date then unit; the first statement month is `link.startMonth`, else the statement month; links to the statement's "Left off this statement" card, which opens; added 2026-11-12) |
| RENT_UNPAID | no | `{n} units have no rent marked received for {Month YYYY}.` / `1 unit has no rent marked received for {Month YYYY}.` (one per rent month, `rentMonth` set; links to the Payments page for that month and owner, status Unpaid; 5.4, 5.9) |
| ~~RENT_NOT_CHECKED~~, ~~RENT_INVALID~~, ~~RENT_ACCOUNT_MISSING~~ | | Removed 2026-11-12 with the roster-rent prefill (5.4.1). |
| ENTRY_LOCKED | - | `{Month YYYY} is final for {property}. Date this transaction in {Month YYYY of nextMonth(lockedThrough)} or later.` |
| ENTRY_BEFORE_START | - | `Statements for {property} start in {Month YYYY}. Use a date on or after {M/D/YYYY}.` |
| ENTRY_FUTURE | - | `The date can't be in the future.` |
| PREV_OWNER_BALANCE | yes | `Previous owner {prevOwner} ended with {amount} for {property}. Settle it on their statement or set this owner's opening balance.` (the property changed hands, the previous owner's final ended non-zero, and this owner has no opening balance set) |
| WO_BEFORE_START | no | one: `WO-{n} ({property}) was completed before this owner's first statement month ({Month YYYY}) and is left off this statement. Put it back from “Left off this statement” only if it wasn't billed in Buildium.` Several: `WO-{a}, WO-{b} ({property}) were completed before ... and are left off this statement. Put them back from “Left off this statement” only if they weren't billed in Buildium.` |
| WO_BEFORE_START_MISSING_BILL | no | one: `WO-{n} ({property}) was completed before this owner's first statement month ({Month YYYY}) and has no bill amount, account or description, so it isn't on this statement.` Several: `... were completed before ... and have no bill amount, account or description, so they aren't on this statement.` |
| START_MONTH_AFTER | yes | `Statements for {property} start in {Month YYYY of startMonth}, after {Month YYYY of the statement}. Discard this draft, then check the first statement month.` |
| START_MONTH_DRAFT_OPEN | - | `{property} has an open draft statement. Finalize or discard it before changing the first statement month.` (refusal from `owners.updateLinkSettings`, field `startMonth`) |
| AMOUNT_TOO_LARGE | yes | `Management fee for {property} is over $1,000,000.00. Check the transactions.` / `Owner draw for {property} is over $1,000,000.00. Check the transactions.` (the row is capped at $1,000,000.00 so the draft still builds) |
| BEFORE_START_NOTE | - | Note on a work-order line excluded by default: `Completed before this owner's first statement month — include it only if it wasn't billed in Buildium` |
| ENTRY_BEFORE_START_NOTE | - | Note on a manual line excluded by default: `Dated before this owner's first statement month — include it only if it wasn't billed in Buildium` |

Warnings about a single work order (`WO_MISSING_BILL`, `WO_AWAITING_REVIEW`, and `WO_BEFORE_START` / `WO_BEFORE_START_MISSING_BILL` when they name one work order) carry `workOrderId`, so the warnings card can link to it. `WO_AWAITING_REVIEW` applies only to work orders completed on or after the first-statement-month floor; one before it is covered by the `WO_BEFORE_START*` rows.

---

### 5.9 Rent payments: the Payments page (`convex/rentPayments.ts`, as built 2026-11-12)

Rent reaches a statement ONLY as a payment marked on the Payments page (user decisions 2026-11-12, `ros-decisions.md` "Rent via a Payments page"). Files: `rentPaymentsPolicy.ts` (pure rules and every message, shared with the client), `rentPaymentsLib.ts` (the logic, no runtime Convex server imports, tested on a fake database), `rentPayments.ts` (the registered functions: `requireFinance` first, then the lib; the audit trail and the seeded Rent Income account come in as `deps`).

**Decisions.**
1. **Cash basis like Buildium:** a payment is dated the day it was RECEIVED and lands on that month's statement, whatever month the rent is for. September rent received 10/2 is on the October statement.
2. **No partial payments:** one payment per unit per rent month, always the unit's full rent FOR THAT RENT MONTH (`unitRentPolicy.rentForMonth`: its rent history, else the roster rent `rosterRentToCents(units.rent)`; never an amount from the client). Statuses are Paid / Unpaid (plus Not markable). See "Rent history" below (2026-11-13).
3. **Greyed-out units** (not markable), with the reason: owner collects rent directly (`rentPaidTo "owner_direct"`), rent included in another unit, vacant on the roster, no active tenant, no rent on the roster, roster rent not a valid dollar amount, and (with rent history) "No rent set for this month" (`no_rent_month`) (`rentMarkability`, rules in that order).
4. **Editable until final:** a payment can be edited or undone until it is billed on a final statement or its received date is in a month that is final for the property (`paymentLock`, the locked-month rule).
5. **Rent is edited only here.** The statement shows payment lines read-only with "Edit on Payments page".

**The row** (`ledgerEntries`): `source "rent_payment"`, the Rent Income system account (`systemKey "rent_income"`, seeded on first use), `type` = the account kind (`income`), the unit, the property's single owner, `counterparty` = the unit's active tenant(s) when marked (`rentCounterparty`, "Ann Lee & Bob Ray"), `memo "Payment"`, `amountCents` = roster rent, `date` = received date, `rentForMonth`, `paymentMethod`, `paymentNote` (optional). No `sourceId`. Audit entity `ledger_entry`: `rent_marked_received` (to = JSON of month, received date, property, unit, name, method, note, amount), `rent_payment_updated` (from / to of the changed fields), `rent_payment_undone` (note = unit · month · reason).

**Functions** (all `requireFinance` first, org-scoped; every user error is a `ConvexError` `{ message, field }`):

| Function | Args | Returns |
|---|---|---|
| `list` query | `{ month, category?, ownerId?, propertyId?, status? }` (all nullable strings) | `{ month, monthLabel, today, earliestReceivedDate, latestRentMonth, rows: Row[], summary: { paid, unpaid, notMarkable, total, receivedCents, unpaidCents }, filters: { owners: [{ ownerId, name }], properties: [{ propertyId, name, category, teamLabel }] }, truncated, maxUnits, monthClosed }` (`monthClosed` = the "more than 24 months ago" message, or null) |
| `markReceived` mutation | `{ unitId, month, receivedDate, method, note? }` | `{ entryId, amountCents }` |
| `markManyReceived` mutation | `{ month, unitIds: string[], receivedDate, method }` | `{ count, totalCents }` |
| `updatePayment` mutation | `{ entryId, receivedDate?, method?, note? }` (undefined keeps; note null / "" clears) | `null` |
| `undoPayment` mutation | `{ entryId, reason }` | `null` (= void with the reason) |

`Row` = `{ unitId, propertyId, propertyName, propertyAddress /* address.formatted or null; the page search matches it */, unit, category, teamLabel, ownerId, ownerName, ownerProblem /* no owner / co-owned message, or null */, tenants, rentCents /* null when not markable */, status: "paid" | "unpaid" | "not_markable", reason /* greyed-out reason */, payment: null | { entryId, kind: "payment" | "ledger", amountCents, receivedDate, method, methodLabel, note, counterparty, locked, lockedReason, statementId }, canMark }`. One row per unit, sorted by team (Gold, Silver, Make Up, none), property (natural), unit (natural). **Units read (LOW-3, 2026-11-12):** with no team / owner / property filter, the org's units in one go (`by_org`, at most 3,000 = `maxUnits`; `truncated` above that); with a filter, only the matching properties' units (`by_property`, properties in team / property order, the same cap), so the cap applies AFTER the filter and filtering really does show every unit of that team / owner / property. The filter choices are built from every org property and every owner with a property of their own (not from the rows). The summary counts the team / owner / property filters but not the status filter (the page now asks with `status: null` and does the status filter, the search and the totals itself, 6.8). A co-owned property belongs to no single owner (it is not in an owner filter). A unit whose rent month is before its owner's first statement month (`link.startMonth`) is Not markable with the reason `Statements start in {Month YYYY}` (unless already paid). A month more than 24 months ago can be listed (links from old statements open it) but `canMark` is false on every row and `monthClosed` says why.

**Status of a unit for a rent month** (`rentRecordsFor`, `paymentStatus`): Paid when a non-voided `rent_payment` has `rentForMonth` = the month (`payment.kind "payment"`), or when a non-voided Rent Income row entered any other way (by hand in the ledger before this page, a historical roster_rent row, Stripe later) is DATED in the month (`payment.kind "ledger"`: shown as Paid "Entered in the ledger", locked with "Entered in the ledger. Change it on the Ledger page.", amounts summed). Paid wins over Not markable. Otherwise Unpaid when markable, else Not markable.

**Marking rules** (`markReceived`, and per unit in `markManyReceived`), in order:
1. Fields (`validatePaymentFields`, same on the client): month, received date, method, note.
   The rent month must not be more than 24 months before the current month (`markRentMonthProblem`, `MAX_RENT_MONTHS_BACK = 24`, `earliestRentMonth`; LOW-1).
2. The unit (org-scoped), its property's owner (exactly one link), markable; the rent month not before the owner's first statement month (`rentMonthStartProblem`, field `month`; LOW-1).
3. Not already recorded: no non-voided `rent_payment` for (unit, month) (`by_unit_and_rent_month`), no Rent Income row entered by hand dated in the month (`by_unit_and_date`), and (**MEDIUM-1, 2026-11-12**) no other non-voided Rent Income row of the unit (entered by hand, or a rent payment for ANY rent month) dated in the same calendar month as the new payment's RECEIVED date (`by_unit_and_date`; both would land on the same statement, and a hand-entered row is matched to the month it is dated in, so it may be the same money). Checked inside the mutation (serializable, so two concurrent marks can't both pass). Consequence: two months' rent received in the same calendar month can't be recorded as two payments; date one in the month it actually arrived, or check with the user.
4. The property's date locks (`receivedDateLockProblem`): not in a month final for the property, not before the owner's first statement month.
`markManyReceived` is ALL OR NOTHING: at most 100 distinct units (duplicates are dropped); if any unit fails, nothing is written and the error carries `field "unitIds"` and `problems: [{ unitId, message }]` (the message lists the first three).

`updatePayment` / `undoPayment` refuse a row that isn't a rent payment, is voided, or is locked; a date change re-runs the owner check (a different owner now: `ownerChanged`, LOW-4), the date locks and, when the received MONTH changes, the MEDIUM-1 same-month check (the row itself excluded). The amount and the rent month never change (undo and mark again). The latest final month of a property (`lockedThrough`) is read as ONE row: `by_property_and_status` (["propertyId", "status", "month"]) with status final, `.order("desc").first()` (LOW-5).

**Messages** (exact; `RENT_PAY_MSG`; field in brackets):

| When | Message |
|---|---|
| month missing [month] | "Select the rent month." |
| month not a real month [month] | "Select a real month (like October 2026)." |
| month after next month [month] | `You can't mark rent for {Month YYYY} yet.` |
| month more than 24 months ago [month] | `You can't mark rent for {Month YYYY} — it's more than 24 months ago.` |
| month before the owner's first statement month [month] | `Statements for {property} start in {Month YYYY}.` |
| unit missing [unitId] | "Select the unit to mark rent for." |
| unit not found / other org [unitId] | "Unit not found." |
| date missing [receivedDate] | "Enter the date the rent was received." |
| date not real [receivedDate] | "Enter a real date." |
| date in the future [receivedDate] | "The received date can't be in the future." |
| date before the window [receivedDate] | `For {Month YYYY} rent, the received date must be on or after {M/D/YYYY}.` (the 1st of the month two months before the rent month) |
| date in a final month [receivedDate] | `{Month YYYY} is final for {property}. Use a received date in {next Month YYYY} or later.` |
| date before the first statement month [receivedDate] | `Statements for {property} start in {Month YYYY}. Use a received date on or after {M/D/YYYY}.` |
| method missing / unknown (null, "", anything else) [method] | "Select how the rent was paid." |
| note too long [note] | "Keep the note under 200 characters." |
| no owner link [unitId] | `{property} has no owner yet. Link it on the Owners page first.` |
| co-owned [unitId] | the `CO_OWNED` message (5.8) |
| not markable [unitId] | `Rent can't be marked for Unit {X} at {property}: {owner collects rent directly / rent is included in another unit / unit is marked vacant on the roster / no active tenant / no rent on the roster / the roster rent isn't a valid dollar amount}.` |
| already marked [unitId] | `Unit {X} at {property} already has rent marked received for {Month YYYY}.` |
| entered by hand already [unitId] | `Unit {X} at {property} already has rent recorded in the ledger for {Month YYYY}. Check it on the Ledger page.` |
| other rent dated in the received month [unitId; receivedDate on a date edit] | `Unit {X} at {property} already has rent dated in {Month YYYY of the received date} (entered in the ledger).` / `(marked received for {Month YYYY of its rent month})` + ` Check it before adding another payment.` |
| date edit after the owner changed [receivedDate] | `{property} now belongs to a different owner, so this payment's date can't be changed. Undo it and mark it again.` |
| bulk: none [unitIds] | "Select at least one unit to mark received." |
| bulk: over 100 [unitIds] | "Select at most 100 units at a time." |
| bulk: any unit fails [unitIds] | `Nothing was saved: {n} of the selected unit(s) can't be marked received. {first three messages}` + ` (and {n-3} more)` |
| payment not found [entryId] | "Payment not found." |
| not a rent payment [entryId] | "That transaction isn't a rent payment from the Payments page." |
| already undone [entryId] | "This payment was already undone." |
| billed on a final [entryId] | "This payment is on a final statement and can't be changed. Put a correction on a later statement." |
| dated in a final month [entryId] | `{Month YYYY} is final for {property}, so this payment can't be changed.` |
| undo reason missing / long [reason] | "Enter why you're undoing this payment." / "Keep the reason under 300 characters." |
| list filters [category / status / ownerId / propertyId] | "Select a team." / "Select a status." / "Owner not found." / "Property not found." |
| Rent Income account missing (should never happen: it is seeded) | "The Rent Income account is missing. Open Accounts once to create it." |
| old clients: `setRentLine` / `confirmRent` | "Rent is recorded on the Payments page." |
| statement: leave off a payment [key] | "Rent is recorded on the Payments page. To take this payment off the statement, undo it there." |
| ledger: add / edit on Rent Income [accountId] | "Record rent on the Payments page." |
| ledger: edit a row that is on Rent Income [accountId] | "Rent can't be moved to another account. Delete it and record it on the Payments page." |

Lock reasons shown on the page: "On the {Month YYYY} final statement." / `{Month YYYY} is final for {property}.` / "Entered in the ledger. Change it on the Ledger page." Greyed-out reason before the first statement month: `Statements start in {Month YYYY}`.

**Which statement a payment lands on** (`statementMonthFor(receivedDate)` = `monthOf(receivedDate)`, the cash-basis rule the builder uses): `landsOnText` "Goes on the {Month YYYY} statement (the month it was received)." under Received on in the Mark / Mark selected / Edit dialogs; `landsOnShort` "→ {Mon YYYY} statement" on paid rows.

**Rent history (2026-11-13).** A unit's rent changes with an effective month; payments use the rent FOR the month they are for.

- **Table `unitRentChanges`** `{ orgId, unitId, effectiveMonth "YYYY-MM", rentCents (integer, > 0, <= $1,000,000.00), previousRentCents? (the rent in force for effectiveMonth before the change; absent = none), note?, createdBy, createdAt }`, indexes `by_unit_and_month` ["unitId", "effectiveMonth"], `by_org`. One row per unit per effective month. Written only by `unitRentLib.changeRent`; deleted with the unit (`units.remove`, `purgeOrgUnits`).
- **`rentForMonth(unit, changes, month)`** (`unitRentPolicy.ts`, pure) -> cents | null: the latest change with `effectiveMonth <= month`; before the first change, that change's `previousRentCents` (the roster rent when the history started); no changes, `rosterRentToCents(units.rent)`. `rentInEffect` also returns `fromMonth` (null = roster) for display.
- **`units.rent` stays the CURRENT rent** for Sarah, leasing and docs: it is set to the change with the newest effective month (so an upcoming rent shows there as soon as it is set; no cron). Money never reads it once a unit has history. `units.update` refuses a rent edit (`Rent is changed with Change rent, so its history is kept.` [rent]); a roster re-import (`upsertRosterUnit`) leaves `rent` alone on a unit with history. `units.create` validates the rent (`Enter the rent as a dollar amount over $0, like 1250 or 1250.50.` [rent]) and the floor / baths (`unitFieldsPolicy.ts`).
- **Who reads it:** `rentPayments.list` (each row's `rentCents` and the summary's expected total are that month's rent), `markReceived` / `markManyReceived` (the amount), the draft's `RENT_UNPAID` info warning (per month: a unit counts only for months it has rent set; the loader passes `rentChanges`), `units.rentSummary` (property page: rent this month, `fromMonth`, upcoming change; same access and AM scope as `units.list`).
- **Paid months are never changed:** a payment stores its own amount. A change that covers months already paid at another amount (from its effective month up to the next change) leaves those payments alone and returns an info line per month.

| Function (`convex/unitRent.ts`, `requireFinance` first: admin view + accountant; AM / technician / none refused with "You don't have access to owner statements.") | Args (nullable strings) | Returns |
|---|---|---|
| `changeRent` mutation | `{ unitId, rent /* typed dollars, parseDollarsToCents */, effectiveMonth, note? }` | `{ rentCents, effectiveMonth, previousRentCents, replaced, paidMonths: [{ month, amountCents }], info: string[] }` |
| `history` query | `{ unitId }` | `{ unitId, unitNumber, propertyName, current: { cents, fromMonth }, upcoming: { month, cents } \| null, hasHistory, lines: [{ changeId, effectiveMonth, fromCents, toCents, note, byName, at }] (newest first), changes, rosterRent, earliestMonth, latestMonth, currentMonth }` |

`changeRent` rules, in order: unit (org-scoped); fields (`validateRentChange`, the same on the client); the amount must differ from the rent already in force for that month; then write. A second change for the same effective month REPLACES the first (its `previousRentCents` is kept). Audit entity `unit`, action `rent_changed`: `from` = JSON `{ rentCents }` (in force before), `to` = JSON `{ rentCents, effectiveMonth }`, `note` = `Unit {X} at {property} · from {Month YYYY}` + ` · replaced the earlier change for {Month YYYY} ($X)` when it replaced one + ` · {note}`.

Messages (exact; `RENT_CHANGE_MSG`; field in brackets):

| When | Message |
|---|---|
| unit missing [unitId] | "Select the unit to change rent for." |
| unit not found / other org [unitId] | "Unit not found." |
| rent missing [rent] | "Enter the new rent." |
| rent not a dollar amount (negative, 3 decimals, text) [rent] | "Enter the rent as a dollar amount, like 1250 or 1250.50." |
| rent $0 [rent] | "The rent must be more than $0.00." |
| rent over $1,000,000.00 [rent] | "The rent can't be more than $1,000,000.00." |
| month missing [effectiveMonth] | "Select the month the new rent starts." |
| month not real [effectiveMonth] | "Select a real month (like October 2026)." |
| more than 24 months back [effectiveMonth] | `The new rent can't start in {Month YYYY} — that's more than 24 months ago.` |
| more than 12 months ahead [effectiveMonth] | `The new rent can't start in {Month YYYY} — that's more than 12 months ahead.` |
| note over 200 [note] | "Keep the note under 200 characters." |
| same as the rent in force [rent] | `The rent from {Month YYYY} is already {$X}.` |
| info (not an error): a covered month already paid at another amount | `{Month YYYY} is already marked paid at {$X}; that payment isn't changed.` |
| marking a month with no rent set (history) [unitId] | `Rent can't be marked for Unit {X} at {property}: no rent is set for this month.` |

UI: "Change rent…" in every Payments row's ⋯ menu (paid, unpaid, locked and not-markable rows; the new rent starts in the page's rent month by default); on the property page in each unit's ⋯ menu and the unit drawer (with the rent history list: effective month, from → to, who, when, note), and from the Edit unit form's read-only rent line.

**On statements.** A payment is an unbilled ledger row: the draft for its received month (or a later one, carried forward) picks it up like a manual row, it counts toward the fee base (Rent Income), finalize stamps it (`statementId`, `postedDate`), and it is then immutable. It can't be left off a statement (only a payment left off by default, dated before the first statement month, can be put back; while it is left off, the info warning RENT_PAYMENT_BEFORE_START lists it, 5.8). The info warning RENT_UNPAID (5.4) lists units still unpaid.

## 6. UI (WP5 statements and finance; WP3 work orders)

Visual language: keep the designer's mock (`ros19.png`, Figma file `wISc3YonhsLV3mc6MiuVMe`). That means the Simplr sidebar, white `Card`s, the right-hand "Review & delivery" side card, a status `Pill`, and primary/secondary `Btn`s. Use only the existing kit in `components/ui` (`PageHeader, Card, CardHead, Btn, Seg, Select, Input, Textarea, Field, DatePicker, Modal, ConfirmDialog, DataTable, Pill, Toggle, KeyValue`). Do not add a UI library.

**Form rules (global CLAUDE.md), every form:**
- Validate every required field on submit with the shared `validate*FieldsAll` from `rosPolicy.ts`.
- If anything fails, toast the first message (`toast.error`), then mark **every** failing field: `aria-invalid`, the class `border-danger-ink` on the control (existing forms set `aria-invalid` but nothing styles it, so add the class explicitly), and a message under the control as `<p className="mt-1 text-xs text-danger-ink">`. Focus the first failing field.
- On a server failure, use the shared helper `dashboard/lib/form-errors.ts` (WP1): `serverError(e) → { field?: string; message: string }`. It reads `ConvexError.data.field` and `.message`; otherwise it returns `{ message: errorMessage(e) }`. Toast the message and mark `field` if present. Never show `error.message` of a non-ConvexError.
- Selects show labels (names), never ids. The "nothing chosen" value is `""`. Treat `""`, `null` and `undefined` all as unset (`value || null`).
- Money inputs are text inputs with `inputMode="decimal"` and a `$` prefix, parsed with `parseDollarsToCents`. Display money with `formatCurrency` / `formatAmount`. Never use `toLocaleString` for money.

### 6.1 Routes and navigation (WP5)

| Route | Page |
|---|---|
| `/owner-statements` | Statements by month (default) |
| `/owner-statements/[id]` | Draft editor / final view |
| `/payments` | Payments (rent marked received, 6.8): Finance → Payments, its own page (no Owner Reports sub-nav) |
| `/owner-statements/payments` | Old URL: redirects to `/payments`, keeping the query string |
| `/owner-statements/ledger` | Ledger (manual transactions) |
| `/owner-statements/owners` | Owners list |
| `/owner-statements/owners/[id]` | Owner edit (`new` for create) |
| `/owner-statements/accounts` | Accounts |

- Every page is wrapped in `<RequireView views={["admin", "accountant"]}>`. The Owner Reports pages have a `Seg` sub-nav: Statements · Ledger · Owners · Accounts (Payments moved out to its own page, 2026-11-12).
- `components/app-sidebar.tsx`:
  - Finance group → "Owner Reports" becomes `{ href: "/owner-statements", label: "Owner Reports", icon: FileText, views: ["admin", "accountant"] }`. Remove its `query` key.
  - "Payments" → `{ href: "/payments", label: "Payments", icon: Banknote, views: ["admin", "accountant"], alsoActive: ["/owner-statements/payments"] }` (2026-11-12; replaced the admin-only "Payment" placeholder). A nested route lights only the most specific link (hrefs and `alsoActive` paths), so "Payments" is active on `/payments` and "Owner Reports" on `/owner-statements/**` only.
- `app/finance/page.tsx`: redirects: `?view=statements` → `/owner-statements`, otherwise → `/payments` (`PAYMENTS_PATH`).
- **Shared list controls** (2026-11-12, `components/ui`): `Pagination` (+ the pure `pagination-model.ts`: `PAGE_SIZES` 25 / 50 / 100, default 50, `paginate`, `pageItems`, `rangeLabel` "Showing 51–100 of 483", `readPage`, `readPageSize`, `cursorRange`), `useUrlPaging` (`?page=` / `?size=`), `SearchBox` + `useUrlSearch` (`?q=`, debounced 250 ms, a new search goes back to page 1), `SortHeader` + `table-sort.ts` (`?sort=` / `?dir=`, `aria-sort` on the header cell). `DataTable` gained `rowClickable` / `rowClassName` and ignores clicks and keys that start on a button, link, checkbox or label inside the row. Used by Payments, Statements, Owners (and the Needs an owner card, paged when over 25) and the Ledger (cursor mode: "Showing 51–100", Previous / Page n / Next). A single statement's lines are never paged.

### 6.2 Statements list `/owner-statements`

- Header "Owner statements", subtitle "Monthly Rental Owner Statements, built from the ledger and closed work orders."
- Month `Select`:
  - labels "September 2026", values `YYYY-MM`
  - options: the current month and the 23 months before it, newest first
  - default: the previous month
  - stored in `?month=`
- **Finding tools (2026-11-12):** a search box (`?q=`; owner name, owner email, the name or address of any of the owner's properties; `ownerStatements.list` returns `emails` and `properties: [{ name, address, category }]` per owner), a Team filter next to Month (`?team=`; the owner has a property in that team), status chips with counts after search and team (All / Not started / Draft / Final, `?status=`; discarded statements aren't listed), sortable headers Owner (default) · Status · Ending cash · Available for payment · Updated (`?sort=&dir=`; amounts only on finals, others last), and pages (`Pagination`, `?page=&size=`). A row with a statement opens it when clicked (its Open / Generate buttons keep their own action). No match: `No statements match "{q}".` + Clear search; with filters only: "No statements match these filters." Helpers: `components/finance/list-finders.ts` (`statementsView`, `sortStatements`). "Has warnings" isn't offered: warnings aren't stored on a statement (each draft would have to be built).
- `DataTable` from `ownerStatements.list`, one row per owner (or per statement when an owner has more than one):

  | Column | Content |
  |---|---|
  | Owner | legal name |
  | Properties | names, truncated, with "+n" |
  | Status | `Pill`: "Not started" (neutral), "Draft" (amber), "Final" (green) |
  | Ending cash | final only |
  | Available for payment | final only (formatCurrency, so negatives show in brackets) |
  | Updated | |
  | Action | "Generate" (not started) / "Open" |
- Primary button "Generate statement" opens the Generate dialog. A row's "Generate" opens it with the owner prefilled.
- States: loading spinner; empty "No owners yet. Add owners or import them first." with a link to Owners.

**Generate dialog** (`Modal`, title "Generate statement"):
- Owner `Select`:
  - required: "Select the owner this statement is for."
  - labels `legalName` (contact name in muted text); active owners only
- Month `Select`:
  - required: "Select the statement month."
  - same options as the page
- Properties: a checkbox list from `generateOptions(ownerId, month)`.
  - Every selectable property is **ticked by default**.
  - A non-selectable one is shown disabled with its `reason` in muted red underneath.
  - "Select all / Clear" links.
  - Required: "Tick at least one property for this statement."
- Buttons "Cancel" / "Generate draft". On success, navigate to `/owner-statements/{statementId}`.

### 6.3 Statement page `/owner-statements/[id]`

**Layout (rebuilt 2026-11-13 as a five-step page).** One column: no two columns and no "Review & delivery" side card. Header: breadcrumb "Owner reports / {legalName} / {Month YYYY}", title "{legalName}: {Month YYYY}", the status `Pill`, the period, and one pill per property. Under it the step bar, the step's content, and the totals bar. Code: `components/finance/statement-page.tsx` (page, step state), `statement-chrome.tsx` (step bar, totals bar, header), `statement-steps.ts` (pure: step ids, `?step=` reading, warning-to-step mapping, step status dots, `totalsOf`, `groupWarnings`), `statement-check.tsx`, `statement-lines.tsx`, `statement-payout.tsx`, `statement-review.tsx`, `finalize-dialogs.tsx` (Finalize / Discard), `statement-preview.tsx`.

**Steps:** Check · Money in · Money out · Fees & payout · Review & finalize.
- The step is in the URL (`?step=check|in|out|payout|review`). A draft opens on Check; a final or discarded statement opens on Review. A bad `?step=` falls back to that default.
- Navigation is free: every step can be opened at any time (a click on the step bar, or **Back** / **Next** under the content). Each step has a status dot: ✓ done, `!` needs attention (blocking items), • worth a look (info items). Mobile shows "Step N of 5" with a dropdown to jump.
- A final statement is view-only on every step (no add, edit, skip or put-back controls).

**Totals bar (every step).** Income, Expenses (includes the management fee), Fee, Owner draw, Ending cash, Available (available for payment). All are the server's figures (`result`), never summed in the browser (`totalsOf(result)`). Desktop: a slim bar fixed to the bottom of the screen. Mobile: a compact card above the content with "All totals" / "Fewer totals". It also holds **Preview** (opens the Preview drawer) and the PDF button ("Preview PDF" for a draft, "Download PDF" for a final statement).

**Step 1: Check.** The server's warnings (5.4) grouped per property, blocking first, in cards with a short banner at the top of the step. `NO_DRAW` and `PERIOD_OPEN` are not per-property fixes: they sit under "Notes". The warning-code-to-step mapping lives in `statement-steps.ts` (`warningStep`: `RENT_UNPAID` / `RENT_PAYMENT_BEFORE_START` → Money in; the `WO_*` codes → Money out; `AMOUNT_TOO_LARGE`, `PAYEE_MISSING`, `FEE_NOT_SET`, `NO_DRAW`, `NEGATIVE_ENDING`, `DEPOSITS_NOT_SET` → Fees & payout; `PERIOD_OPEN` → Review; anything else is a Check item), and decides each step's status dot. Every other step shows its own warnings as a banner at the top. Quick fixes, one click and no navigation:
- Opening balance not set: **"It's $0.00"** (writes 0 through `owners.updateLinkSettings`; it first re-reads the link and, when an opening balance has been set meanwhile, does not write and shows the info toast "Opening balance for {property} is already set to {$X}.") or **"Set amount…"** (a dialog).
- Deposits not set: **"None held"** (records $0.00 only for units with nothing recorded, so a deposit entered meanwhile is kept; per-unit writes, not atomic: accepted) or **"Enter deposits…"** (the in-place deposits dialog).
- Other warnings link to where they are fixed (a work order, the owner page, the Payments page).

**Steps 2 and 3: Money in / Money out.** The statement's additions (step 2) or expenses (step 3), grouped by property, each group a `LinesTable` with its subtotal ("Money in: {property}"); with several properties a grand total row follows ("Total money in" is the server's `view.detail.additionsTotal`; "Total money out (before fee and draw)" is the sum of the lines shown, because the server's subtractions total also contains the fee and draw). The management fee and owner draw are on Fees & payout, not here.
- Columns: Date (a carried-forward line shows the original `storedDate` with a muted "posts {M/D/YYYY}" hint), Unit, Account, Name, Memo, Amount (right), Source (badge `sourceLabel`; a carried-forward line also gets "From {Month YYYY} — not on a final statement yet", or "From {Month YYYY}" on a final statement). Property is the group heading.
- Each row has one **main action** button and a **⋯ menu** (`components/ui/row-menu.tsx`, with hover hints as `title`: "Leave off this month" shows `LEAVE_OFF.tooltip`; Delete on a legacy hand-entered Rent Income line shows `PAYMENTS_LINK.legacyRentTooltip`). A **click on the row** runs the main action. By kind:
  - `entry`: main Edit (TransactionForm → `ledger.update`); ⋯ Leave off this month (`excludeLine`), Delete… (an editable manual row; dialog "Delete this transaction?" with a required reason → `ledger.voidEntry`; toast "Transaction deleted.").
  - `wo`: main Edit billing (BillingForm → `workOrderBilling.updateBilling`); ⋯ Leave off this month, Open work order.
  - Rent payment (an `entry` line with `rentForMonth`, source "Payments page"): read-only. The Source cell links "Edit on Payments page" (draft) / "View on Payments page" (final) to `/payments?month={rentForMonth}&owner={ownerId}`. No Edit, Delete or Leave off (the server refuses it: "Rent is recorded on the Payments page. To take this payment off the statement, undo it there."); only a payment left off by default (dated before the first statement month) can be put back. A hand-entered Rent Income line keeps Leave off and Delete but has no Edit.
- Buttons at the top: **"Add income"** (step 2) / **"Add expense"** (step 3) open TransactionForm limited to that side (`addition` / `subtraction`); each property group also has **"Add income here"** / **"Add expense here"** (property preselected). Step 2 also has "Record rent on Payments page" (`/payments?month=&owner=`). TransactionForm: property limited to the statement's properties; the date defaults to `min(today, periodEnd)` and must be inside the period (client check "Pick a date in {Month YYYY}."; the server applies the normal lock rules).
- **Left off** is split per step: the lines left off this statement that belong to money in are listed at the bottom of step 2, those that belong to money out at the bottom of step 3, each with **Put back** (`includeLine`) and the line's `note` (5.8; lines dated before the owner's first statement month are listed here by default). The note reads "Lines left off stay unbilled and come back on next month's draft." The fee and the draw, when skipped, are listed on Fees & payout with their own Put back.

**Step 4: Fees & payout.** One card per property:
- Heading with "Available for payment {amount}" (server).
- **Management fee** row: "{x.xx}% (this property's fee / default fee) of {base} fee-base income" with the amount and **Edit** / **Skip** (draft). Edit / Skip are hidden when the fee percentage is not set (`fee.bps` null: there is nothing to edit); a skipped fee shows "Skipped this month" with **Put back**. A **"Change %"** link goes to the property on the owner page.
- **Hold back** (these do not change the cash balance): "Tenant security deposits held: {amount}" with an in-place **"Edit deposits…"** dialog (owner deposits per unit, `owners.setUnitDeposit`); the property reserve, unpaid bills and early payments inputs; **Save adjustments** (`setAdjustments`).
- **Owner draw** row: the suggested draw with **Edit amount** / **Skip this month** / **Put back** and "Reset to suggested". Editing a draw shows "Suggested: $X".
- "Pending ePay payments: $0.00 (card payments are not live yet)".
The fee and draw are the only `fee` / `draw` generated lines (`setGenerated`, `setGeneratedExcluded`).

**Step 5: Review & finalize.**
- Summary: status (Draft / Final / Discarded), owner, period, statement date (draft: "Set when finalized"), finalized by (and when), ending cash and available for payment per property.
- **Gate:** while `!canFinalize` Finalize is off with the server's reason: "Fix N items on the Check step first." (N = blocking count; `finalizeBlocker` in `finalize-dialogs.tsx`), or the `PERIOD_OPEN` message while the month is still open.
- Buttons (draft): **Finalize** (primary), **Discard draft** (ConfirmDialog "Discard this draft? Nothing in the ledger or on any work order changes."), **Preview PDF**. Final: **Download PDF**; the note reads "Emailing statements to owners comes later."
- **"What gets locked"** card: what Finalize freezes (the month for these properties; the figures; the ledger rows it writes) and that corrections go on next month's statement.
- **History** (collapsed): `ownerStatements.history` as a `Timeline` (it moved here from the old Transactions tab).
- Finalize ConfirmDialog:
  - Title: "Finalize {Month YYYY} for {legalName}?"
  - Body: one row per property "{property}: ending cash {x}, owner draw {y}, management fee {z} ({pct}%), available for payment {w}" (the % is that property's fee, `fee.bps`), then the line "Finalizing locks {Month YYYY} for these properties. Corrections go on next month's statement."
  - A checkbox "I've checked the owner draw amounts" must be ticked; until it is, confirming shows "Tick the box to confirm the owner draw amounts."
  - **The dialog freezes what the user reviewed** (`components/finance/finalize-guard.ts`, pure): `captureReviewed(data)` records `previewHash`, `expectedEndingCents` and `expectedAvailableCents` **when the dialog opens**. It calls `finalize({ statementId, expectedEndingCents, expectedAvailableCents, expectedHash: previewHash })` with those captured values, never the live ones. While the dialog is open the live `get().previewHash` is compared with the captured one (`reviewChanged`); if it differs (another tab, a work-order edit, a ledger change), the dialog shows "The statement changed since you opened this. Review it again." (`STATEMENT_CHANGED`) with "Close this and open Finalize again.", and the Finalize button is disabled. The server guard (5.4 step 4) is the second line of defence.

**Preview = a drawer** opened from the totals bar on any step (there is no Transactions / Preview tab switch any more). `StatementPreview` takes an optional `sections` prop (which of Summary by property, Income statement, Detail transactions to render; default all) and renders `view` as HTML tables in the PDF's order with the same strings (bold `total` / `grand`, right-aligned numbers, horizontal scroll on narrow screens), above them the PDF header block (title, period, statement date, Prepared By).

### 6.4 Ledger `/owner-statements/ledger`

- Filters: Owner, Property (labels), Month (any or a month).
- A paginated `DataTable` from `ledger.list` with columns Date, Property, Unit, Account, Name, Memo, Amount (subtractions shown with a leading "−" in this table only; the statement itself shows positive amounts), Source, Statement ("Unbilled" or "September 2026 statement").
- "Add transaction" button. Row actions: Edit / Void when `editable`; clicking an editable row (not on Rent Income) opens Edit. Paging uses the shared `Pagination` in cursor mode with Rows per page (25 / 50 / 100, `ledger.list` `pageSize`). No text search or column sorting yet: the ledger is cursor-paged on the server (`by_org_and_date` desc), so a search would need a server search index (not added).

**TransactionForm** (WP5 `components/finance/transaction-form.tsx`, used by the ledger and the draft editor). Fields in order:
1. Property* (`Select`; a blocked property is disabled with its reason)
2. Unit (`Select`, first option "Property level" with value `""`)
3. Date* (`DatePicker`)
4. Account* (`Select` of active accounts, "{name} · {kindLabel}")
5. Name on statement* (counterparty)
6. Memo*
7. Amount*

Defaults when the account or unit changes, only while the field is untouched:
- **counterparty:**
  - income + unit → the first active tenant of the unit (a datalist offers all of them)
  - expense / other subtraction → "Property Pro Realty Group Inc."
  - owner draw / owner contribution → the owner's effective payee
- **memo:**
  - income → "Payment"
  - owner draw → "Owner Draw"
  - otherwise empty

A live preview line shows the Name exactly as it will print: `displayName(unitLabel, counterparty)`. Validation uses `validateEntryFieldsAll`, with the same messages as the server.

### 6.5 Owners `/owner-statements/owners` and `/owner-statements/owners/[id]`

- **Header (list page):** title "Owners"; subtitle "Rental owners, their owner draw payee and linked properties." plus the default-fee line from `feeSettings.get`, `Default management fee: 5.00% · 2 properties have their own fee.` (the second part only when `ownFeeCount > 0`). Buttons: **Change fee for all properties** (below) and "Add owner".
- **Change fee for all properties** (`components/finance/default-fee-dialog.tsx`, `DefaultFeeButton`). A two-step `Modal`:
  1. "Change fee for all properties": the text "The default fee is {x}%. Properties with their own fee keep it unless you reset them.", the field "New management fee % *" (hint "For example 5.00 (0.00 to 100.00)."; `readFeeInput`; blank = "Enter the new management fee % for all properties (for example 5.00).") and "Continue". The client refuses a fee equal to the current default only when no property has its own fee.
  2. The alert "Change the fee for all properties?" (role alert) with the confirmation text and, when some properties have their own fee, the checkbox "Also reset those M properties to {new}%", then "Cancel" / "Confirm". The counts and current default shown here are sent as `expectedCounts`. If the server answers `expectedCounts` ("The properties changed while you were deciding. Check the numbers and confirm again.") the dialog toasts it and refreshes its numbers, so the person decides again on what is really there. Exact wording of the alert, the checkbox and the draft note: 5.2 "Management fee settings".
  - Success toast: `The default management fee is now {x}%.` or `The management fee is now {x}% for all properties ({n} reset).`
- **Needs an owner card** (`components/finance/needs-owner.tsx`, `NeedsOwnerCard`, above the table; data from `owners.needsOwner`, 5.2). Title "Needs an owner" with a count badge (properties + owner pairs), hint "Owners are matched by name and email. A property is linked automatically only on an exact match; anything uncertain waits here for you.", and two header buttons: **Link all exact matches (N)** (primary; shown only when `bulk.total > 0`) and **Merge owners**. Empty state: "Every property has an owner, and no two owners look alike." Nothing here is automatic: every change is a click.
  - **Properties (n)**, one row per property: name, category pill, a status pill (**Ready to link** = exactly one exact owner; **New owner** = nobody matches, the page has a name and an email; **Owner differs** = linked, but the page names someone else; **Needs review**), and a **Doubtful** pill (tooltip "Left out of “Link all exact matches”. Check it and use the buttons below.") with `Doubtful: {reason}.` when `planLinkAll` marks it (5.2). It shows "Property page: {name} · {emails}" (full emails: finance users only), the reason text (`NEEDS_REASON_TEXT`, plus a server message such as the bad email), the owners it is linked to, and the candidate owners (name, emails, a flag pill: "Same name and email" / "Same name, different email" / "Same email, different name: possibly the same owner" / "Same name, but no email to confirm it", an "Inactive" pill). Buttons: **Link to this owner** (per active candidate), **Not the same owner** (per flagged candidate; on a `mismatch` row it is **Keep linked to {owner}**), **Link to an existing owner…** (a select dialog → `owners.linkProperty`) and **Create owner…** (name and emails prefilled and editable → `owners.createForProperty`); neither of those two is offered for a property on an open draft. A `mismatch` row also says "Links are never moved automatically. To move it, unlink it on the owner's page first; or keep the link if the statements are right."
  - **Owners that may be the same (n)**, one row per pair: both names (links to their pages), the flag pill, both owners' emails and property counts, **Merge…** and **Not the same owner**.
  - **Link all exact matches** dialog: "Only properties whose owner name and email match exactly, with nothing in doubt. Existing links are never moved. Nothing is sent to anyone." with the counts (properties linked to an existing owner; new owners created from the property page; more properties linked to one of those new owners; doubtful properties left for you) and "Link {n} properties". More than 100: "This run does the first {n} of {total}. Click the button again for the rest." (`LINK_ALL_LIMIT`).
  - **Merge owners** dialog (`MergeOwnersDialog`; also opened by **Merge…** with both owners filled): "Keep this owner *", a swap button, "Merge this owner into it *", then the live `owners.mergePreview` (the refusal message in red, or what will happen: properties that move, properties already linked to both, the emails after the merge, the kept payee, and that the merged owner is turned off) and the button "Merge {B} into {A}". It tells the user the second owner's properties move to the first, emails are combined, and owners that already have a statement can't be merged. Selects show owner labels "Name · email · n properties", never ids.
- **Finding tools (2026-11-12):** search box (`?q=`: legal name, contact, email, linked property names; `owners.list` returns `propertyNames`), "Only owners with problems" toggle next to "Show inactive owners", sortable Legal name (default) · Contact · Properties · Problems (`?sort=&dir=`), pages (`?page=&size=`; the page wraps the list in Suspense). No match: `No owners match "{q}".` + Clear search. Helpers: `list-finders.ts` (`ownersView`).
- **List table:** a `DataTable` of legal name, contact, emails (masked in the table as `a***@domain`, full on the edit page), **Fee %** (`feeRange`: "5.00%" or "5.00–6.00%" over the owner's properties, each at its own fee or the default; "No properties" when it has none), properties count, problems (pills: "Owner draw payee not set", "{n} co-owned"). A "Show inactive owners" toggle (a merged owner is inactive).
- **Edit form:**
  - Fields: Legal name*, Contact first name, Contact last name, Emails (one text input, comma-separated, each validated), Owner draw payee (placeholder = the derived payee, hint "Prints as the Name on the owner draw line. Leave blank to use the contact name."), Active toggle. **There is no management fee field**: the fee is per property (below).
  - Save → `owners.create` / `owners.update`. Messages are in 5.2.
- **Properties section** (edit page only):
  - The linked properties, each as a card with:
    - a co-owned warning (CO_OWNED text) if co-owned
    - **Management fee** (`LinkFee`): "Fee: {x.xx}% (own)" or "(default)" (`effectiveFeeBps`, `ownFeeBps`), the field "Own fee %" (placeholder = the default; hint "Leave blank to use the default ({x}%). Final statements don't change."), **Use default** (shown when the property has its own fee; sends `bps: null`) and **Save fee** (`owners.setPropertyFee`). An unchanged value shows "That is already this property's fee." Toasts: `{property} now uses its own fee of {x}%.` / `{property} now uses the default fee of {x}%.`
    - "Opening cash balance" (signed money; disabled with the reason when `hasFinal`)
    - "First statement month" (month Select; disabled when `hasFinal`)
    - "Property reserve"
    - a units table "Security deposit held" (money input per unit; "Save deposits" → `setUnitDeposit` per changed unit)
    - "Unlink"
  - "Link property": a `Select` of `propertyOptions` (label "{name}", plus "· owned by {owners}" when linked elsewhere). If `linkProperty` throws the co-owned message, show a ConfirmDialog with that text and retry with `confirmCoOwned: true`.

### 6.6 Accounts `/owner-statements/accounts`

- On mount, if `list.needsSetup`, call `ensureDefaults` once.
- `DataTable`: Name, Type (`kindLabel`), "Counts toward management fee" (`Toggle`, enabled for income accounts only), Status (Active/Off), a lock icon with "System account" for `systemKey` rows, Actions: Rename, Turn off/on, Delete (ConfirmDialog; server messages in 5.1).
- "Add account" form:
  - Name* ("Enter the account name.")
  - Type* (`Select` with labels Income, Expense, Owner contribution, Other addition, Other subtraction; "Select the account type.")

### 6.7 Work orders (WP3)

**Office close form**: new shared component `components/work-orders/close-bill-form.tsx`, used by `components/board/wo-drawer.tsx` (the "Confirm as Completed" action in the `completed` status branch now opens this form as a step, like `NoteStep`) and by `app/work-orders/[id]/page.tsx` (replacing the one-click `reviewClose`). Fields:

1. "Description of work completed"* (Textarea, prefilled from `workCompletedDescription`, or else the technician's latest note; hint "Prints as the memo on the owner statement.")
2. "No charge to owner" (`Toggle`; when on, the Bill amount and Account are hidden and not required)
3. "Bill amount"* (money; hint "What the owner is charged. Prints on the owner statement.")
4. "Cost" (money, optional; hint "Internal only. Never shown to owners.")
5. "Account"* (`Select` from `workOrderBilling.accountsForClose`, preselected `defaultAccountId` = Repairs)
6. "Bill at property level" (`Toggle`; hint "The statement shows “Property level” instead of the unit. The work order keeps its unit.")
7. "Note" (optional, existing).

Submit "Close work order" → `reviewClose({...})`. Validation uses `validateBillingFieldsAll`, with the messages in 5.6. On success, toast "`WO-{n}` closed."

After close, the drawer and the detail page show a read-only **Billing** block: description, bill, cost (staff only), account, property level, "Billed on {Month YYYY} statement" or "Not billed yet". It has an "Edit billing" button (→ `workOrderBilling.updateBilling`) while the WO is not billed.

**Technician app** (`components/tech/job-detail.tsx`):
- Before Submit, add the textarea "Description of work completed"* (max 2000; client check "Describe the work you completed."). Send it as `workCompletedDescription` to `submitCompleted`. The submit gate (`need`) also requires it.
- Material add form: add a required two-option `Seg` "SWEEP (company card)" → `reimbursable: false` / "REIMB (I paid, reimburse me)" → `reimbursable: true`, with no default. Client check: "Choose SWEEP or REIMB for this material."
- Material lines show a small "SWEEP" or "REIMB" tag. Old rows with `reimbursable` undefined show no tag.
- Do not show bill or cost to technicians anywhere.

**Office expense list** (`components/work-orders/format.tsx`, and the drawer's expense rows in `wo-drawer.tsx`): show the SWEEP/REIMB tag next to each material line.

Not in this build (B18 leftovers): the invoice # format `3-110`, keys/code, the paid stamp, and auto-calculating Bill from hours and materials (Q1-Q3).

---

### 6.8 Payments `/payments` (as built 2026-11-12)

`components/finance/payments-view.tsx` + `payment-dialogs.tsx` + `payments-search.ts` (pure), route `app/payments/page.tsx` (FinanceGate + Suspense; error boundary = the owner-statements one). Finance → Payments in the sidebar; it has NO Owner Reports sub-nav. The old `/owner-statements/payments` redirects to `/payments` keeping the query string (`app/owner-statements/payments/page.tsx`), and so does `/finance`. Everything lives in the URL (`?month=&team=&owner=&property=&status=&q=&page=&size=`), so the statement's RENT_UNPAID link and "Edit on Payments page" open it filtered.

- **Header** "Payments": "Mark rent received for each unit and month. A payment goes on the owner statement for the month it was received (cash basis), always for the full roster rent."
- **Search** (top of the card, `SearchBox`, placeholder "Search property, address, unit, tenant or owner"): any part of the property name or address, the unit, a tenant's name (roster, or the name the payment was marked under) or the owner's name; case-insensitive, trimmed, runs of spaces as one (`payments-search.normalizeSearch` / `rowMatchesSearch`). Live as you type (250 ms debounce), stored as `?q=`, cleared with × / Escape. AND-ed with every filter. Done in the browser over the list result (every unit of the month for the team / owner / property filters, ≤ 3,000).
- **Filters:** Rent month (next month, the current month and the 24 before it, the oldest that can be marked; a valid `?month=` older than that, e.g. from an old statement, is added to the list and opens view-only: `monthClosed` notice "You can't mark rent for {Month} — it's more than 24 months ago. This month is shown for reference only."; default the current month), Team (All teams / Gold / Silver / Make Up), Owner, Property (narrowed by team). Selects show names, never ids. Any filter, search or page-size change goes back to page 1.
- **Summary** (KPI tiles): Paid (n, "$x received"), Unpaid (n, "$x expected"), Not markable (n), "Received for {Month}" ($ total). Status chips: All / Unpaid / Paid / Not markable, with counts. Tiles and chips count every row matching the filters + search (all pages), not the status filter; computed in integer cents (`summarizePayments`).
- **Table** (one row per unit, paged): select box (unpaid, markable units only), Property (+ team), Unit, Tenant, Owner ("No owner"), Rent, Status (Paid / Unpaid / Not markable + the reason; Paid rows entered by hand say "Entered in the ledger"), Received (date, "→ {Mon YYYY} statement", method · note), actions. Not-markable rows are greyed out and have no action. Clicking a markable row anywhere outside its buttons / links ticks its box (pointer cursor, hover background, Space / Enter on the focused row, focus ring; a ticked row is tinted).
- **Pages:** `Pagination` under the table: "Showing 51–100 of 483", Previous / page numbers / Next, Rows per page 25 / 50 / 100 (default 50); `?page=` / `?size=`.
- **Selection:** per page. "Select all" (header box, "Select every unpaid unit on this page") ticks only the markable rows of the page shown (`selectableOnPage`); the selection clears when the page, a filter, the search or the month changes; "Mark selected received" and its confirmation list exactly the ticked rows of that page (a page holds at most 100 = the bulk cap).
- **Actions:** Unpaid → **Mark received** (or, when the property has no owner / is co-owned, the message and an "Owners page" link). Paid → **Edit** / **Undo**, or a **Locked** badge with the reason (and "Open statement" when billed). Entered in the ledger → the reason and a "Ledger" link.
- **Mark received dialog:** the unit, tenant and amount (read-only: "Always the full roster rent (no partial payments). To change it, fix the rent on the unit first."), **Received on \*** (default today; hint "From {earliest} to today. It goes on the statement for the month it was received, whatever month the rent is for."; under it, live: "Goes on the {Month YYYY} statement (the month it was received)."), **Paid by \*** (select with the labels Cash / Check / Money order / Other, placeholder "Select how it was paid"; `aria-invalid` + red border + message when in error), **Note** (optional, "for example the check number"). Toast: `{Month} rent marked received for Unit {X}.`
- **Mark selected received:** a confirmation dialog listing the count, the total and every unit with its amount, plus Received on \* (with the same "Goes on the … statement" line) and Paid by \*; "Mark {n} received". On failure nothing is saved and the dialog lists every failing unit ("Nothing was saved. Fix or unselect these units:"). Toast: `{Month} rent marked received for {n} units ($total).`
- **Edit payment:** received date (with the "Goes on the … statement" line), paid by, note (amount read-only). **Undo this payment?:** reason \* ("It comes off the draft statement and the unit shows as unpaid. It stays in the ledger history with your reason.").
- Form rules as everywhere (6): client validation with the shared messages, red border + message under the field + toast; server errors with a field mark that field; others are toasted.
- **Truncated** (more than 3,000 units read): no filter: "Only the first 3,000 units are shown, and the totals count only those. Pick a team, owner or property above to see every unit of it." / team or owner: "… Pick a property above to see every unit of it." / property: "Only the first 3,000 units of this property are shown, and the totals count only those."
- Loading: spinner. Empty: `No units match "{q}".` + **Clear search** / "No units match these filters." / "No units yet. Units come from the property rosters." Errors: the owner-statements error boundary.

## 7. PDF (WP6)

### 7.1 Approach

- `@react-pdf/renderer@4.9.0` (exact pin, in `dashboard/package.json` as `"@react-pdf/renderer": "4.9.0"`), built-in Helvetica / Helvetica-Bold (no font files), rendered **in the browser** with `pdf(<StatementPdf .../>).toBlob()`, then downloaded.
- Why this approach:
  - The output is deterministic: given the same snapshot and fonts, the layout is identical every time.
  - Headers and footers repeat on every page (`fixed`).
  - Rows never split (`wrap={false}`).
  - Page numbers come from `render`.
  - The same component can render server-side later for email (`renderToBuffer` in a Node action, 5.7).
- Print CSS was rejected because browser print engines differ, and headers, page numbers and repeated table heads are not reliable with it.
- The library is loaded with a dynamic `import()` on click, so it never enters the main bundle.

### 7.2 Files (WP6)

- `dashboard/components/finance/pdf/statement-pdf.tsx`: `export function StatementPdf({ snapshot, generatedMs, draft, logoSrc = LOGO_SRC }: { snapshot: StatementSnapshot; generatedMs: number; draft: boolean; logoSrc?: string })`. (`logoSrc` is an absolute URL when rendering in the browser; the download button passes `new URL(LOGO_SRC, window.location.origin).href`.) All strings come from `buildView(snapshot.result, snapshot.header)`, plus `footerLeft` and `pageLabel` from `rosView.ts`. No formatting logic in this file.
- `dashboard/components/finance/pdf/layout.ts`: every size, position and colour constant (7.4).
- `dashboard/components/finance/pdf/download-button.tsx`: `export function DownloadStatementPdfButton({ statementId, draft, label }: { statementId: Id<"ownerStatements">; draft: boolean; label: string })`.
  - **Fetch on click (as built), not a live `useQuery`.** A draft is rebuilt from the ledger on every read, so a subscription would recompute it on every ledger change while the page is open, and a query error would break the page instead of showing a toast. On click it runs `convex.query(api.ownerStatements.pdfData, { statementId })` (via `useConvex()`) together with the dynamic imports of `@react-pdf/renderer` and `./statement-pdf`, builds the blob with `pdf(<StatementPdf .../>).toBlob()`, and triggers a download.
  - File name: `ROS-{slug(legalName)}-{YYYY-MM}{-DRAFT}.pdf`, where slug = lowercase, non-alphanumerics → "-", leading and trailing "-" trimmed (empty → "statement"), `YYYY-MM` = the first 7 characters of `periodStart`, and `-DRAFT` is added when the server says the statement is a draft (the server's `pdfData.draft`, not the `draft` prop, decides the watermark and the name).
  - It then calls `recordDownload` (audit only). If that fails, the PDF has already downloaded: it shows "The PDF downloaded, but the download couldn't be recorded."
  - Errors: a `ConvexError` from the server is shown with its own message (`serverError`); anything else shows `toast.error("Couldn't build the PDF. Try again.")`.
  - It shows a spinner ("Building PDF...") and is disabled while building.
- `dashboard/public/brand/pprg-logo.png`: the placeholder logo (7.5; 10,949 bytes as built). The path is a constant `LOGO_SRC = "/brand/pprg-logo.png"` in `layout.ts`, so a high-res file (Q17) can be swapped in by replacing the file.

### 7.3 Page structure

Page size `LETTER`, `orientation="landscape"` (792 × 612 pt). The document has **three `<Page wrap>` elements**, each starting a new physical page, in this order:

1. **Summary by property.** It may flow onto the next page.
2. **Income statement.**
3. **Detail transactions.** It may span many pages.

On every physical page (`fixed`):
- **Top right:**
  - "Rental Owner Statement"
  - the logo under it
  - two right-aligned rows: "Statement period" + **"9/1/2026 - 9/30/2026"**, and "Statement date" + **"10/16/2026"** (values bold)
- **Top left:** "Prepared By: Property Pro Realty Group Inc." / "60 Broad Street" / "Waterford, NY 12188".
- **Footer:** left `{footerName} - Generated {MM/DD/YYYY HH:mm:ss}` (`footerLeft(snapshot.header.footerName, generatedMs)`); right `Page {n}` (`render={({ pageNumber }) => pageLabel(pageNumber)}`, numbered continuously across the three `<Page>`s).
- **Draft only:** a diagonal light-grey watermark "DRAFT - NOT FINAL" across each page (`fixed`, absolute; `WATERMARK` in `layout.ts`: 64 pt, colour `#9A9A9A`, opacity 0.15, rotated -30 degrees).

Page 1 only: a blank recipient block (the mailing window Buildium leaves) between the Prepared-By block and the Summary title (ASSUMPTION A34).

Table column headers repeat on every page a table continues onto: render the header row with `fixed` inside that `<Page>`, and render the section title through `render={({ subPageNumber }) => subPageNumber === 1 ? title : null}`, keeping its height on later pages. Each table row is `wrap={false}`. In the Detail, each line is one row and Memo/Name wrap inside the row. "Total from…" rows and the Ending row are `wrap={false}` and use `minPresenceAhead={30}` with the row before them, so a total never sits alone at the top of a page.

Column chunking: a table holds at most **5 value columns**. If the properties plus "All properties" exceed 5, split the columns into consecutive chunks of 5 (the last chunk ends with "All properties"). Render each chunk as its own full table (labels repeated), stacked in order on the same `<Page>`.

### 7.4 Layout constants (`layout.ts`)

These values are measured from the sample at 90 dpi × 0.8 = pt and then tuned by eye against renders of the golden fixture. The table shows the values **as built** (`layout.ts` is the source of truth; where it differs from the first draft of this table, the built value is listed).

| Item | Value |
|---|---|
| Margins | left 40, right 50, bottom 60 (footer zone); content top 183 (`MARGIN.top`, so a section title sits at y 183 on pages 2+); page 1 Summary title at y 305 (`RECIPIENT.height = 305 - 183`); content width 702 |
| Title "Rental Owner Statement" | Helvetica 18 pt, right edge x 742, text box top y 54 (baseline about y 70) |
| Logo | right edge x 742, top y 80, width 125, height 50 (`objectFit: contain`) |
| Statement period/date rows | 8.5 pt; labels right-aligned ending at x 652; values Helvetica-Bold right-aligned at x 742; rows at y 134 and y 148 |
| Prepared By block | x 62, y 96, Helvetica 10 pt, leading 11 |
| Section titles | Helvetica-Bold 9 pt ("Summary by property", "Income statement", "Detail transactions") |
| Table text | Helvetica 8 pt; row height 15 pt (min); header row band fill `#E6E6E6`, text 8 pt (property names regular, "All properties" bold) |
| `total` rows | Helvetica-Bold; 0.5 pt `#999999` dotted line under the row |
| `grand` rows | Helvetica-Bold; double rule under the row (two 0.75 pt lines, 1.5 pt apart) |
| Summary table | x 40; label column 171; value columns 88 each, right-aligned |
| Income statement table | x 40; label column 92 (account rows indented 12); value columns 87 each |
| Detail columns (**measured**, sum 702 = content width) | Date 61, Property 86, Unit 58, Account 74, Name 175, Memo 120 (wraps), Amount 58 (right), Balance 70 (right). The "Total from ..." amounts sit right-aligned in the Memo column. The first draft of this table listed 712 pt, which does not fit the 702 pt content box |
| Footer | left x 40, y 566, 8 pt; "Page N" right-aligned at x 742, y 569, 8 pt |
| Draft watermark | text "DRAFT - NOT FINAL", 64 pt, `#9A9A9A`, opacity 0.15, rotate -30 deg, `fixed` on every page |
| Value columns per table | at most 5 (`TABLE.maxValueColumns`); more are split into consecutive chunks of 5 and rendered as stacked tables (gap 14 pt), the last chunk ending with "All properties" (7.3) |
| Fonts | built-in `Helvetica` / `Helvetica-Bold` only (no font files, so output is fully repeatable; ASSUMPTION A26). The en dash (U+2013) is in WinAnsi, so it renders |

Table rows: minimum height 15 pt (8 pt text, line height 1.3, vertical padding 2.3 pt), header band 16 pt, one-line rows are exactly 15 pt and a wrapped Memo/Name grows the row.

Check for the golden fixture: with these numbers, page 1 holds the Summary down to "Unpaid bills", and "Pending ePay payments" / "Available for payment" go to page 2 under a repeated column header, exactly as in the sample. WP6's done-check is visual.

### 7.5 Placeholder logo (WP6)

As built: `dashboard/public/brand/pprg-logo.png` is a placeholder cropped from the scan (ASSUMPTION A17), until a high-res file arrives (Q17); replace the file to swap it. How it was made: crop it from the scan. The scan pages are 1-bit, 300 dpi and rotated.

```
cd /Users/umaraurangzeb/Desktop/simplr-518property
S=<WP6 scratchpad dir>
pdftoppm -r 300 -f 3 -l 3 -png ROS.pdf "$S/ros300"      # -> ros300-3.png (2550 x 3300, rotated)
sips -r 90 "$S/ros300-3.png" --out "$S/ros300-rot.png"   # readable landscape 3300 x 2550
# logo sits top-right: approx x 2560..3105, y 330..555 at 300 dpi. Crop, view, adjust, then:
sips -c 225 545 --cropOffset 330 2560 "$S/ros300-rot.png" --out dashboard/public/brand/pprg-logo.png
```

View the result, then trim the white margins (adjust the offsets until only the house mark plus "PROPERTY PRO / Realty Group, inc." remain). The file must be ≤ 200 KB. Note in the report that it is a placeholder until Alex sends a high-res file (Q17).

### 7.6 Package install, with a supply-chain check first (WP6 only)

1. Run `npm view @react-pdf/renderer@4.9.0 maintainers time dist.tarball scripts dependencies --json` and `npm view @react-pdf/renderer` (weekly downloads via `npm view` or the npm site). Pass criteria:
   - published ≥ 14 days ago (4.9.0: 2026-08-27 ✓)
   - known maintainer (`diegomura`)
   - at least 100k weekly downloads
   - **no `preinstall` / `install` / `postinstall` scripts** in it or in any new transitive dependency. Check each new dependency with `npm view <dep>@<ver> scripts`.
   - peer `react` covers 19 ✓
2. If any check fails, stop and report. Do not install anything else as a substitute.
3. Install from `dashboard/`: `pnpm add @react-pdf/renderer@4.9.0 --save-exact`. pnpm blocks dependency build scripts by default; do not approve any with `pnpm approve-builds`.
4. Report the new packages added to `pnpm-lock.yaml`.

---

## 8. Owners import (WP4)

**Source of truth (as built, user decision 2026-11-11): the unit rosters already stored on each property.** `Rental Owners - Sheet1.pdf` is **NOT a source of truth** and is not used. The first design (a hand transcription of that PDF, address matching, `matchOverrides`, `rental-owners.json`) was dropped: every property on the Gold, Silver and Make Up rosters already names its own owner, so there is nothing to match.

**Owners are identified by NAME and EMAIL together** (`convex/ownerIdentity.ts`, 5.2), by the same rule everywhere: here, in the automatic link that runs when a property is saved (the roster import and the Property page both call it, 5.2), on the "Needs an owner" list and in the merge checks. This importer is the batch version, and it is **as strict as the automatic link**: it never adopts or links on a name-only match, and it never links next to a look-alike owner. The old rule "one owner per distinct name" is gone.

### 8.1 Source and grouping (pure, `dashboard/convex/ownersImportLib.ts`)

- Input: each property's `ownerName`, `ownerEmails` (or `[ownerEmail]` when only that is set; an address that isn't valid is ignored and reported under `ignoredEmails`, as the automatic link does), `ownership` (`company_owned | managed`) and `category` (`gold | silver | make_up`; none = a property with no category, for example one made by hand). These were written by the roster import (`convex/rosterImport.ts`); the importer never writes them. The importer also reads the existing owners, links, open drafts and the "Not the same owner" decisions.
- **Grouping (`groupRosterOwners`).** Properties with the same normalized owner name are grouped by email:
  - properties that share at least one email are **one owner** (emails unioned: lowercased, trimmed, de-duplicated, in property order; capped by the owner rules at 5; the first property's spelling of the name wins as `legalName`);
  - the same name with **different emails stays separate owners** (flag `same_name_different_email`); a shared email under a different name stays separate (flag `same_email_different_name`). Further owners of one name get `importKey` `{nameKey}#2`, `#3`, ...;
  - a property with **no email** joins the one owner of that name (flag `name_only_match`); with two or more owners of that name it is **not linked** (flag `name_only_ambiguous`);
  - properties joined only through a chain of shared emails (A and B share one address, B and C another) stay one owner, flagged `joined_via_shared_email_chain`.
- **Against the owners already in the app** (each roster owner is compared with the identity rule): exactly one active owner with the same name AND a shared email is **adopted** (an owner typed in by hand is not duplicated); a match by name only is never adopted (flag `name_only_match`, left for "Needs an owner"); two or more matches (`several_owners_match`) or an inactive match (`inactive_owner_match`) import nothing for it; a look-alike owner (same name and different email, or the same email under another name) is kept separate and flagged, and the property is left for "Needs an owner" unless it was marked "Not the same owner" for that owner (`dismissed_owner`). Merged owners are never matched. Nothing is ever merged on a flag.
- **Links are add-only, and never added to a property that already has an owner link (to anyone):** a property moved to another owner by hand stays where it was put and is reported under `linkedElsewhere`. A property on an open draft gets no new link (`skippedOpenDraft`).
- **An owner is created only when at least one of its properties gets a link**; otherwise it is reported under `notCreated`.
- **Never invented:** contact first and last name (the roster has none), `managementFeeBps` (the owner has no fee any more: a new link has no own fee, so its property uses the org default, 3.3) and `payeeName` (derived, ASSUMPTION A12). A name that looks like two owners (`/`, ` & ` or ` and `) is flagged in the report and is **never split**.
- A property with no `ownerName` gets no link and is reported ("link by hand").
- An owner the owner rules refuse (for example too many emails) is **not created or linked** and is reported under "refusals". `apply` then refuses the whole run (see 8.2).

### 8.2 Importer (`dashboard/convex/ownersImport.ts`, internal only)

- `importOwners` is an `internalMutation` `{ orgId: string, dryRun: boolean }`. The script sends only the org and the mode; the data is read from the database. The org is an argument because the CLI has no signed-in user; every audit row is written by "System". Unknown org: "That team does not exist."
- **Idempotent**, using the `rosterImport` pattern:
  - **Adopt by identity:** an existing owner is found by the name + email rule (5.2), not by key alone. An adopted owner is filled in, not duplicated.
  - **Fill empty only:** a re-run sets `importKey` only when empty in the database, and never overwrites a value someone edited. Fields that differ from the roster (`legalName`, `emails`) are reported under "differences" and left as they are.
  - **Links are add-only:** a missing link is created; links and owners are never removed, and no link is added to a property that already has one.
  - **Properties with an open draft are skipped:** no new link is added to a property that is on an open (`draft`) statement; it is reported and picked up by a later run.
  - `managementFeeBps`, `payeeName` and contact names are never written.
- Audit: `owner_imported` per created owner (note "Unit roster import", emails as a count) and `owner_property_linked` per link (note "Unit roster import: name + email match"). The automatic link written by the roster import itself uses `owner_created` / `owner_property_linked` with `auto-created` / `auto-linked` notes (5.2).
- **Dry run = apply + second pass + rollback.** The same code runs, then a second pass runs in the same transaction and must find nothing left to do (the idempotency proof), then the mutation throws `ConvexError({ kind: "dry_run", dryRun: true, report, secondPass })`, which rolls the whole transaction back. The CLI reads the data out of that error. The report is cut by `compactReport` to about 12 KB (Convex cuts error data at about 16 KB): the longest list is shortened first and `truncated` says how many items each list lost; counts are never cut.
- **Apply** returns the report. If any owner is refused (`invalid`), `apply` throws `Fix these roster owners first (nothing was written): {owner}: {message}; ...` and writes nothing.
- **Report** (`ImportReport`; emails are **masked** everywhere, `a***@domain`, and never printed in full):
  - `owners` `{ created, updated, unchanged }` and `links` `{ created, existing }`
  - per-category counts (`byCategory`: properties, with an owner, with no owner, company-owned, links to create, links existing)
  - `ownersToCreate`, `notCreated`
  - **identity flags** (`flags`, never merged automatically): `same_name_different_email`, `same_email_different_name`, `name_only_match`, `name_only_ambiguous`, `several_owners_match`, `inactive_owner_match`, `joined_via_shared_email_chain`, `dismissed_owner`. This replaces the old "conflicting emails" list (`emailConflicts`).
  - **no-owner properties** (`noOwner`)
  - **needs an owner** (`needsOwner`: properties not linked because the match is in doubt; left for the Owners page's "Needs an owner" list)
  - **linked elsewhere** (`linkedElsewhere`: the roster names an owner but the property is already linked to someone else; no link added)
  - **multi-category owners** (`crossCategory`)
  - **two-owner-looking names** (`twoOwnerNames`, with the reason)
  - **company-owned** (`companyOwned`: still linked, flagged for review; A16)
  - **co-owned** (`coOwned`: properties that already have two or more owner links)
  - **skipped, open draft** (`skippedOpenDraft`)
  - **differences** (`differsFromRoster`)
  - **ignored emails** (`ignoredEmails`: an owner address on a property that isn't valid)
  - **refusals** (`invalid`)
- `dashboard/scripts/owners/import_owners.mjs` (Node, no packages):
  - Usage: `node scripts/owners/import_owners.mjs dry-run|apply --org <orgId> --deployment <dev-name>` (from `dashboard/`).
  - It calls `npx convex run --deployment <name> ownersImport:importOwners '{"orgId":..., "dryRun":...}'`.
  - **It refuses prod:** `--prod` is rejected, and `--deployment` must equal the `dev:<name>` in `dashboard/.env.local`'s `CONVEX_DEPLOYMENT`; otherwise it exits with a message.
  - It prints the report in the sections above. Convex errors are cut down to the error line only, so no call arguments or full emails are echoed.
  - **The builder runs only `dry-run`, and only if the orchestrator says so. `apply` is the user's decision.**
- There is no `rental-owners.json`, no `--default-fee-bps` and no `matchOverrides` in the built version.

---

## 9. Tests

Test style (as today): Node's own runner, no packages. From `dashboard/`, run `node --test scripts/probes/ros_*.test.mjs scripts/probes/owners_import.test.mjs`. Each file registers the `.ts` resolve hook (copy the `registerHooks` block from `scripts/probes/work_order_status.test.mjs`) and imports the pure modules directly.

**Why no Convex integration tests:** `convex-test` (latest that is ≥ 14 days old: 0.0.66) requires `convex ^1.43.0`, and the app is on `1.42.3`. Upgrading Convex is out of scope. So every rule lives in a pure function in `rosPolicy.ts` / `rosCalc.ts`, the handlers call those functions, and the tests cover them. That is why sections 4.4 and 5 put every decision in a pure function.

### 9.1 Golden test `scripts/probes/ros_golden.test.mjs` (WP1)

Fixture (build `CalcInput` by hand, then call `computeStatement`, then `buildView`):

- Owner "Nye Properties LLC", contact Adam Nye, payee "Adam Nye" (derived), management fee 500 bps (5.00%; in the as-built engine this is each property's `feeBps`, the org default).
- Property `p1` "108 Jackson Avenue", beginning 0, deposits 240000 (units 1st Floor 80000, 2nd Floor 80000, 3rd Floor 80000; ASSUMPTION A15: any split that sums to $2,400.00), early payments 0, reserve 0, unpaid 0, pending ePay 0, no overrides.
- Period `2026-09-01` .. `2026-09-30`. Statement date `2026-10-16`.
- Accounts: the seed list (3.4).
- Rows (counterparty `"Property Pro Realty Group Inc."` unless stated):

| key | date | unit | account | counterparty | memo | cents | source |
|---|---|---|---|---|---|---|---|
| entry:r1 | 2026-09-01 | 1st Floor | Rent Income | David Roberts | Payment | 88300 | manual |
| entry:r2 | 2026-09-22 | 2nd Floor | Rent Income | Sharavia Rivera | by Sharavia Rivera | 95087 | manual |
| entry:r3 | 2026-09-24 | 3rd Floor | Rent Income | Adrianna Mimbs | by Adrianna Mimbs | 250000 | manual |
| entry:e1 | 2026-09-03 | null | Landscaping | | 9/3 - Lawn mowing and weed whacking | 10000 | manual |
| entry:e2 | 2026-09-11 | 2nd Floor | Predicate Notice | | Bills | 13433 | manual |
| entry:e3 | 2026-09-11 | 3rd Floor | Predicate Notice | | Bills | 13433 | manual |
| wo:w1 | 2026-09-12 | 2nd Floor | Repairs | | Unit 2 - Close up ceiling from previous leak repair, took down rest of damaged section, add new sheet rock, tape, mud, sanded, added 2 coats of prime, painted ceiling and walls | 190700 | work_order |
| wo:w2 | 2026-09-14 | null (billPropertyLevel) | Pest Control | | Treatment of multiple bees' nest around the property | 28900 | work_order |
| entry:e4 | 2026-09-16 | null | Dump Fees | | Dump Fees, driver, truck, fuel | 52020 | manual |
| entry:e5 | 2026-09-23 | null | Landscaping | | 9/23/26 - Lawn mowing and weed whacking | 11000 | manual |
| wo:w3 | 2026-09-30 | 3rd Floor | Repairs | | Unit 3 - Ceiling tiles damaged from water, sprayed to keep from molding in areas that needed it, replaced ceiling tiles as needed | 26500 | work_order |

(Rows r2/r3 were ePay in Buildium. Phase 1 stores the memo text as given; ASSUMPTION A31.) Give the `seq` values in table order. **Shuffle `rows` before calling the engine** to prove the sort.

Assert, with `deepStrictEqual` on strings:

- Header: period `"9/1/2026 - 9/30/2026"`, date `"10/16/2026"`, preparedBy as in 4.3. `footerLeft("Adam Nye", Date.UTC(2026, 9, 16, 13, 26, 36))` === `"Adam Nye - Generated 10/16/2026 09:26:36"`. `pageLabel(1)` === `"Page 1"`.
- Summary columns `["108 Jackson Avenue", "All properties"]`. Rows (label → both values):
  - `Beginning cash balance` → `$0.00`
  - `+ Additions to cash` (blank)
  - `Income` → `4,333.87`
  - `Owner contributions` → `0.00`
  - `Other additions` → `0.00`
  - `– Subtractions from cash` (blank)
  - `Expenses` → `3,676.55`
  - `Owner draws` → `657.32`
  - `Other subtractions` → `0.00`
  - `Ending cash balance` → `$0.00`
  - `– Adjustments` (blank)
  - `Tenant security deposits and early payments` → `2,400.00`
  - `Property reserve` → `0.00`
  - `Unpaid bills` → `0.00`
  - `Pending ePay payments` → `0.00`
  - `Available for payment` → `($2,400.00)`
- Income statement rows:
  - `Income`
  - `Rent Income` 4,333.87
  - `Total income` $4,333.87
  - `Expense`
  - `Dump Fees` 520.20
  - `Landscaping` 210.00
  - `Management Fees` 216.69
  - `Pest Control` 289.00
  - `Predicate Notice` 268.66
  - `Repairs` 2,172.00
  - `Total expenses` $3,676.55
  - `Net income` $657.32

  Assert that no "Owner Draw" or "Owner Contribution" row is present.
- Detail: beginning `Beginning cash balance as of 9/1/2026` / `$0.00`. Additions (date, property, unit, account, name, memo, amount, balance):
  1. `9/1/2026 | 108 Jackson Avenue | 1st Floor | Rent Income | Unit 1st Floor - David Roberts | Payment | 883.00 | 883.00`
  2. `9/22/2026 | … | 2nd Floor | Rent Income | Unit 2nd Floor - Sharavia Rivera | by Sharavia Rivera | 950.87 | 1,833.87`
  3. `9/24/2026 | … | 3rd Floor | Rent Income | Unit 3rd Floor - Adrianna Mimbs | by Adrianna Mimbs | 2,500.00 | 4,333.87`

  `Total from additions to cash` `$4,333.87`. Subtractions:
  1. `9/3/2026 | Property level | Landscaping | Property Pro Realty Group Inc. | 9/3 - Lawn mowing and weed whacking | 100.00 | 4,233.87`
  2. `9/11/2026 | 2nd Floor | Predicate Notice | Unit 2nd Floor - Property Pro Realty Group Inc. | Bills | 134.33 | 4,099.54`
  3. `9/11/2026 | 3rd Floor | Predicate Notice | Unit 3rd Floor - Property Pro Realty Group Inc. | Bills | 134.33 | 3,965.21`
  4. `9/12/2026 | 2nd Floor | Repairs | Unit 2nd Floor - Property Pro Realty Group Inc. | Unit 2 - Close up ceiling… | 1,907.00 | 2,058.21`
  5. `9/14/2026 | Property level | Pest Control | Property Pro Realty Group Inc. | Treatment of multiple bees' nest around the property | 289.00 | 1,769.21`
  6. `9/16/2026 | Property level | Dump Fees | Property Pro Realty Group Inc. | Dump Fees, driver, truck, fuel | 520.20 | 1,249.01`
  7. `9/23/2026 | Property level | Landscaping | Property Pro Realty Group Inc. | 9/23/26 - Lawn mowing and weed whacking | 110.00 | 1,139.01`
  8. `9/30/2026 | 3rd Floor | Repairs | Unit 3rd Floor - Property Pro Realty Group Inc. | Unit 3 - Ceiling tiles… | 265.00 | 874.01`
  9. `9/30/2026 | Property level | Management Fees | Property Pro Realty Group Inc. | Management Fee 9/1/2026 - 9/30/2026 (5.00% of $4,333.87) | 216.69 | 657.32`
  10. `9/30/2026 | Property level | Owner Draw | Adam Nye | Owner Draw | 657.32 | 0.00`

  `Total from subtractions from cash` `$4,333.87`. `Ending cash balance as of 9/30/2026` `$0.00`.
- `generated[0]`: fee `{ baseCents: 433387, bps: 500, computedCents: 21669, amountCents: 21669 }`, draw `{ suggestedCents: 65732, amountCents: 65732 }`. No blocking warnings.

### 9.2 Unit tests (WP1): `ros_format.test.mjs`, `ros_calc.test.mjs`, `ros_policy.test.mjs`

**Format:**
- `formatAmount`: 0, 5, 99, 100, 123456789, −1, −240000 → `"0.00","0.05","0.99","1.00","1,234,567.89","(0.01)","(2,400.00)"`.
- `formatCurrency`: the same values with `$` inside the brackets.
- `parseDollarsToCents`:
  - "12.5"→1250
  - "$1,250.00"→125000
  - "0.1"→10
  - "1.234"→null, "-1"→null, ""→null, "abc"→null
  - "0.07"→7: integer maths, so no float drift (e.g. "1.15" → 115, "4.35" → 435, "0.29" → 29)
- `parseSignedDollarsToCents`: "(12.00)"→−1200, "-0.50"→−50.
- `roundHalfUpDiv`: (5,10)→1, (4,10)→0, (15,10)→2, (25,10)→3 (half up, not banker's).
- `percentOf`: (433387,500)→21669; (100,250)→3 (2.5 → 3); (1,500)→0; (0,500)→0; (10000,1)→1.
- `formatBps`: 500→"5.00", 1250→"12.50", 1→"0.01".
- `parsePercentToBps`: "5"→500, "5.5%"→550, "100"→10000, "100.01"→null, "5.123"→null.
- Dates:
  - `monthEnd("2028-02")`→"2028-02-29"; `monthEnd("2026-02")`→"2026-02-28"
  - `prevMonth("2026-01")`→"2025-12"
  - `formatDate("2026-09-01")`→"9/1/2026"
  - `formatMonth("2026-09")`→"September 2026"
  - `businessDate(Date.UTC(2026,9,1,3,30))`→"2026-09-30" (Eastern time is still the 30th)
  - `generatedStamp` on a January (EST) date also uses New York time

**Calc:**
- **Ordering:** same-date tie-breaks:
  - a manual draw row (mid-month, type owner_draw) on the period's last day sorts after the fee
  - two properties' rows on the same date follow column order
  - Property level before units
  - "Unit 2" before "Unit 10" (natural)
  - additions are never interleaved with subtractions
- **Multi-property:** 3 properties (names "12 B St", "108 Jackson Avenue", "9 A St"), so the column order is `["9 A St", "12 B St", "108 Jackson Avenue", "All properties"]`. Each summary row total = the sum of its columns. Income-statement accounts with activity in only one property show `0.00` in the others. The fee and the suggested draw are computed per property. The detail is one list sorted by date across properties.
- **Carry-forward beginning:** beginning 12345 with no rows gives ending 12345, available = 12345 − deposits, and the `Beginning cash balance as of …` balance = "$123.45". A negative beginning −5000 shows "($50.00)".
- **Carried-forward rows:** a row dated 2026-08-28 in a September statement shows date "9/1/2026" with `carriedForward: true`, sorts first, and still counts in the fee base when it is Rent Income.
- **Draw suggestion:**
  - with reserve 50000 and unpaid bills 10000, suggested = max(0, cash − 60000)
  - when cash before the draw is negative, suggested = 0, no draw row, the `NO_DRAW` info warning, `NEGATIVE_ENDING`, and available in brackets
  - an override of 30000 is used; `excluded` gives no draw row
- **Fee:**
  - `managementFeeBps null` gives a `FEE_NOT_SET` blocking warning and no fee row
  - an override replaces the amount and keeps the standard memo unless a memo override is given
  - `excluded` gives no row
  - only `feeBase` accounts count (add an income account "Laundry Income" with feeBase false and check it is not in the base)
- **Zero-activity accounts** are hidden. When there are no income rows, the Income section header and "Total income $0.00" still show.
- **Invariant:** a hand-made inconsistent input (amount 0, a float amount 10.5, a date after periodEnd, an unknown account) throws.

**Policy:**
- `createDraftProblem`: one case per rule in 4.4 / 5.8, with exact messages:
  - Remsen co-owned with names
  - existing draft or final
  - an open draft in another month
  - already final
  - a gap (last final July, asking for September)
  - start month
  - the future month
- `entryDateProblem`: locked through 2026-09 → a 2026-09-15 date is refused with ENTRY_LOCKED; 2026-10-01 is OK; before the start month is refused; a future date is refused.
- `selectWorkOrders`:
  - a billed WO is excluded
  - `noOwnerCharge` is excluded
  - a missing bill amount goes to `missingBill`
  - `completed` goes to `awaitingReview`
  - completed before `floorDate` is ignored
  - completed after `periodEnd` is excluded
- `finalizeProblem("2026-09", "2026-09-30")` → message; `("2026-09","2026-10-01")` → null.
- `validateBillingFields` / `validateEntryFields` / `validateOwnerFields`: every message in 5.2/5.3/5.6, with `""`, `null` and `undefined` all treated as missing.
- **Double-billing simulation (idempotency):** run `selectWorkOrders` → "finalize" (mark `billedStatementId`) → `selectWorkOrders` for the next month. The WO is no longer billable. A WO excluded in September (not billed) is billable in October, with an effective date of 10/1.

### 9.3 Owners import tests `scripts/probes/owners_import.test.mjs` (WP4)

The importer reads the unit rosters on the properties (section 8), so there is no address matching and no transcription to test. The tests feed `groupRosterOwners` / `planImport` (pure) with fixture properties:

- Grouping (identity rule, name + email, 5.2 and 8.1): properties with the same normalized name that share an email are one owner across Gold, Silver and Make Up (the first spelling wins); the same name with different emails is two owners (flagged); a no-email property joins the one owner of that name (flagged `name_only_match`), but is not linked when two roster owners have the name; a chain of shared emails stays one owner (flagged); emails are the lowercased, de-duplicated union in property order. Joint owners on one company domain are flagged only on an exact shared address.
- `twoOwnerReason` flags `/`, ` & ` and ` and `, and never a plain name.
- Plan from an empty database: owners and links are created, and nothing is invented (no contact names, no fee, no payee, no opening balance).
- Report sections: no-owner properties, identity flags, needs-an-owner, linked-elsewhere, multi-category owners, company-owned, two-owner-looking names, ignored emails, per-category counts.
- The report never holds a full email address (masking).
- An owner the owner rules refuse is reported under refusals, not created or linked.
- Idempotency: a second run creates nothing (the dry-run second-pass contract).
- An owner typed in by hand is adopted only on name + email: blanks are filled, nothing is overwritten, differences are reported; a name-only match or a look-alike waits for a person on the "Needs an owner" list. Several matches, an inactive match and a merged owner import nothing for it. "Not the same owner" decisions are respected.
- A property that already has an owner link is never given another (`linkedElsewhere`); an existing co-owned property is reported; links are never removed.
- A property on an open statement draft gets no new link and is listed as skipped.
- CLI: refuses `--prod`, unknown modes, and a deployment that is not the dev one in `.env.local`; the dry-run data is read from stderr and the printed report has no full email.

### 9.4 Authorization tests (WP2) `scripts/probes/ros_authz.test.mjs`

- `canUseFinanceView`: `admin` ✓, `accountant` ✓, `asset_manager` ✗, `technician` ✗, `none` ✗.
- **Source scan:** read `convex/ledgerAccounts.ts`, `owners.ts`, `ledger.ts`, `ownerStatements.ts` and `workOrderBilling.ts`.
  - For each `export const <name> = (query|mutation|action)(`, take the text up to the next top-level `export`. Assert it contains `requireFinance(ctx` before any `ctx.db`.
  - Assert that no `internalQuery`/`internalMutation` in these files is exported without a comment saying why.
  - Assert that `FINANCE_DENIED === "You don't have access to owner statements."`.
- **Technician strip:** assert that `workOrders.ts` defines `forTechnician`, and that the strip list contains all seven billing keys (a source scan of the key list).

### 9.5 Locking and idempotency

These are covered by the policy tests in 9.2. In addition, the WP2 builder adds a **manual test script** to its report: the exact clicks on the dev deployment to check that a second "Generate" for the same owner, month and property is refused, that a finalized month refuses a new transaction dated in it, and that a closed WO appears on exactly one statement. It runs only if the orchestrator approves a dev run.

### 9.6 Tests added with the later features (as built)

All pure or source-scan tests with `node --test`, no packages; the pattern in section 9 (`scripts/probes/ros_*.test.mjs`) picks them up.

- `ros_owner_identity.test.mjs`: the identity rule table (5 cases, normalization, empty name, joint owners on one company domain, order-independent pair keys); `decidePropertyLink` (link, create, every "needs" reason, a merged owner never matched, an existing link never moved, "Not the same owner" decisions); `mergeProblem` refusals; `planLinkAll` / `linkAllCounts` (Ready to link, New owner, every doubtful case, one new owner per name + shared email, cap per call); source scans (every writer of a property's owner name or emails calls `linkOwnerForProperty`; the linker never contacts anyone or moves a link; update / setActive / linkProperty refuse a merged owner; `linkAllExact` is finance-only, decides on the server and re-checks each property).
- `ros_fee.test.mjs`: `readFeeInput`, `effectiveFee`, `feeRangeLabel`, the alert wording, `setDefaultFeeProblem`; per-property fee in the engine (each property at its own %, memos, totals) and `FEE_NOT_SET` no longer blocking; `rosBuild` (own fee ?? default, `feeSource`), `previewHash` changing when a fee changes, the snapshot storing the % used; `setDefaultFee` on a fake database (counts, with and without reset, the counts guard writing nothing).
- `ros_rent.test.mjs` (rewritten 2026-11-12 for the Payments page): `rosterRentToCents`; `rentMarkability` (amount = roster rent cents, greyed-out reasons and order); `validatePaymentFields` (every message, date window, future, method null/empty/unknown, note length); `receivedDateLockProblem`; `rentRecordsFor` / `paymentStatus` (rent month vs received date, voided, legacy rows); `paymentLock`; `unpaidCheckMonths`; manual Rent Income refused; on a fake database: `markOne` (the written row, client amount ignored), uniqueness per unit / month (and again after undo), every not-markable / no-owner / co-owned / unknown-unit message, date window + future + locked month + before the first statement month, legacy hand-entered rent shown as Paid and never doubled, `markMany` all or nothing with every failure listed (dedupe, bounds), `updateOne` / `undoOne` (locks, messages, audit), `listPayments` (statuses, reasons, summary, sort, filters, lock reason); on the builder: no prefill, RENT_UNPAID, the golden 108 Jackson statement byte-for-byte the same, cash basis (September rent received 10/2 is on October's statement), fee base, billed once at finalize, final-statement lines; and source scans of the server wiring.

---

## 10. Work packages

All paths are relative to the repo root. **One owner per file.** A package may *import* another package's file but never edit it.

| WP | Model (suggested) | Owns (create or edit) | Depends on |
|---|---|---|---|
| **WP1 Foundation**: schema, pure engine, shared helpers, golden test | opus | `dashboard/convex/schema.ts`; `dashboard/convex/auditEntities.ts`; `dashboard/convex/audit.ts` (only the `AuditEntity` type union); new: `dashboard/convex/rosValidators.ts`, `rosFormat.ts`, `rosCalc.ts`, `rosView.ts`, `rosPolicy.ts`, `financeAccess.ts`, `ledgerAccountSeed.ts`; `dashboard/lib/form-errors.ts`; tests `dashboard/scripts/probes/ros_format.test.mjs`, `ros_calc.test.mjs`, `ros_golden.test.mjs`, `ros_policy.test.mjs` | - |
| **WP2 Finance backend** | opus | new: `dashboard/convex/ledgerAccounts.ts`, `owners.ts`, `ledger.ts`, `ownerStatements.ts`, `rosBuild.ts`; test `dashboard/scripts/probes/ros_authz.test.mjs` | WP1 |
| **WP3 Work orders** | opus | `dashboard/convex/workOrders.ts`, `dashboard/convex/board.ts`, `dashboard/convex/maintenance.ts` (technician strip only), new `dashboard/convex/workOrderBilling.ts`; `dashboard/components/board/wo-drawer.tsx`; `dashboard/app/work-orders/[id]/page.tsx`; new `dashboard/components/work-orders/close-bill-form.tsx`; `dashboard/components/work-orders/format.tsx`; `dashboard/components/tech/job-detail.tsx` | WP1 |
| **WP4 Owners import** | opus | new: `dashboard/convex/ownersImport.ts`, `dashboard/convex/ownersImportLib.ts`, `dashboard/scripts/owners/import_owners.mjs`, test `dashboard/scripts/probes/owners_import.test.mjs` (no JSON transcription: owners come from the unit rosters, section 8) | WP1 |
| **WP6 PDF** | sonnet | new: `dashboard/components/finance/pdf/statement-pdf.tsx`, `layout.ts`, `download-button.tsx`; `dashboard/public/brand/pprg-logo.png`; `dashboard/package.json`, `dashboard/pnpm-lock.yaml` (the one install) | WP1, WP2 (`ownerStatements.pdfData`, `recordDownload`) |
| **WP5 Statement UI** | opus | new: `dashboard/app/owner-statements/**` (page.tsx, `[id]/page.tsx`, `ledger/page.tsx`, `owners/page.tsx`, `owners/[id]/page.tsx`, `accounts/page.tsx`), `dashboard/components/finance/**` except `components/finance/pdf/**` (e.g. `transaction-form.tsx`, `billing-form.tsx`, `generate-dialog.tsx`, `statement-preview.tsx`, `lines-table.tsx`, `warnings-card.tsx`, `side-panel.tsx`, `money-input.tsx`, `finance-nav.tsx`); edits `dashboard/components/app-sidebar.tsx`, `dashboard/app/finance/page.tsx` | WP1, WP2, WP3 (`workOrderBilling.updateBilling`), WP6 (`DownloadStatementPdfButton`) |

**Order:**
1. **WP1** alone.
2. Then **WP2 ∥ WP3 ∥ WP4** in parallel (their files don't overlap).
3. Then **WP6** (needs WP2's queries).
4. Then **WP5** (it may start in parallel with WP6, coding against the `DownloadStatementPdfButton` signature in 7.2, but its last step waits for WP6 to land).

`schema.ts` belongs only to WP1: if a later package finds it needs a schema change, it reports back and does not edit the file.

**Done when:**

- **WP1:**
  - All 4 test files pass with `node --test`.
  - The golden test matches every string in 9.1.
  - `pnpm exec tsc --noEmit` passes in `dashboard/`.
  - The schema adds only optional fields to existing tables.
  - `npx convex codegen` has been run **only if it doesn't push**. Otherwise, report that codegen and the deploy wait for the orchestrator.
  - Report: the exported signatures, as built.
- **WP2:**
  - Every function in 5.1-5.4 exists with the exact messages and audit actions.
  - `rosBuild.buildStatement` produces the 9.1 numbers when run on equivalent DB rows: show this with a short reasoning trace or an extra pure test that feeds `rosBuild`'s mapping helpers.
  - The authz scan test passes. tsc passes.
  - Report: the manual dev test script (9.5).
- **WP3:**
  - Closing a WO requires the billing fields (or "No charge to owner"), and both close UIs (drawer and detail page) collect them, with field errors marked.
  - The tech submit requires the description.
  - SWEEP/REIMB is required on new material lines and shown in the tech and office lists.
  - Technicians never receive bill or cost (`forTechnician` is applied in `workOrders.get`, `workOrders.list` and the technician branch of `maintenance.ts`).
  - `workOrderBilling.updateBilling` refuses billed WOs.
  - Existing work-order flows (assign, start, sendBack, requestInfo) are unchanged. tsc passes.
- **WP4:**
  - The import tests pass.
  - The dry-run report is produced (only if the orchestrator approves a dev dry run; never `apply`).
  - Report: the per-category counts, no-owner, conflicting-email, multi-category, two-owner-looking, company-owned, co-owned, skipped-open-draft, difference and refusal lists (emails masked).
- **WP6:**
  - The supply-chain check is recorded in the report.
  - The PDF for the golden fixture (temporarily render the fixture through `StatementPdf` in a scratch page, or a node script with `renderToFile` in the scratchpad, not committed) matches the sample's sections, strings, page order and the Summary break after "Unpaid bills". Attach PNG renders of each page in the report.
  - The draft watermark shows. Header and footer show on every page. The detail column header repeats.
  - tsc passes.
- **WP5:**
  - Every screen in section 6 works with loading, empty and error states.
  - Every form validates each required field on the client with the shared messages, marks fields red with a message under them, and toasts.
  - Server errors go through `serverError()`.
  - Accountant and admin can reach the pages; other views are redirected.
  - The sidebar link works.
  - The draft → finalize → download flow works against the WP2 functions.
  - tsc and `pnpm lint` pass.

---

## 11. Phase-2 hooks (do not build)

- **Stripe (B25):**
  - The webhook inserts `ledgerEntries { source: "stripe", sourceId: <payment id>, type: "income", account: Rent Income, counterparty: tenant, memo: "by {tenant}" }`. `by_source` makes this idempotent.
  - "Pending ePay payments" becomes the sum of paid-but-unsettled Stripe payments per property. That is a new `pendingEpayCents` source in `rosBuild`; the calculation module is unchanged.
  - The Payments page (5.9) is the stand-in until this feed is live: Stripe will write the same kind of row (Rent Income, unit, dated when paid, `rentForMonth`) and the page will show it as "Paid online".
  - Open decision: what to do when a Stripe row's date falls in a locked month. The default proposal: date it the 1st of the first open month and keep the original date in the memo.
- **Email delivery:** 5.7.
- **Ownership split for co-owned properties:** a `sharePct` on `ownerProperties` and a split step in `rosBuild` (Q10).
- **B31 multi-role:** have `canUseFinance` check `jobRoles.includes("accountant")` as well as the view, once the user decides.

---

## 12. ASSUMPTIONS (each is a constant or setting, so it is easy to change)

| # | Assumption | Where it lives | Client question |
|---|---|---|---|
| A1 | The office enters the Bill amount by hand when closing a work order. Cost is optional and internal. No formula yet. | `reviewClose`, close form | Q1, Q2, Q3 |
| A2 | New "No charge to owner" option on close, so a closed WO can stay off the ROS on purpose (warranty, tenant-caused). | `workOrders.noOwnerCharge` | Q1 |
| A3 | SWEEP = paid on the company card (`reimbursable: false`); REIMB = the tech paid and is reimbursed (`true`). The choice is required on new material lines. | tech form, `addExpense` | Q4 |
| A4 | **Replaced (user decision 2026-11-11).** The management fee % is per **property**, not per owner: one org default (5.00% until someone changes it, stored as `financeSettings.rosDefaultFeeBps`; absent = 500) and an optional own % per property on the owner-property link (`ownerProperties.managementFeeBps`; integer basis points 0..10000; blank = use the default). It is never "not set", so it no longer blocks finalizing and the import leaves it alone. "Change fee for all properties" changes the default, with an optional reset of every own fee. Only accounts flagged "counts toward management fee" (seed: Rent Income) form the fee base. `owners.managementFeeBps` is deprecated and unused (`feeMigration:copyOwnerFeesToLinks` copies an old non-default owner fee onto its links). | `financeSettings.rosDefaultFeeBps`, `ownerProperties.managementFeeBps`, `ledgerAccounts.feeBase` | Q5 |
| A5 | Fee rounding is half up to the cent, once per property row, on that property's own %. | `rosFormat.roundHalfUpDiv`, `rosCalc` step 2 | Q5 |
| A6 | Landscaping, dump fees and predicate notices are entered by hand as ledger rows, unless they come in as work orders. | ledger | Q6 |
| A7 | Suggested owner draw = max(0, cash after expenses − property reserve − unpaid bills). Deposits and early payments are not subtracted (matches the sample). There is one draw per property, dated the last day, and the accountant can edit or skip it. | `rosCalc` step 3 | Q7, Q13 |
| A8 | v1 delivery = PDF download only. Email comes later (hook in 5.7). | | Q8 |
| A9 | The opening cash balance is set per owner-property; unset = $0.00 with a warning. Statements start at the first finalized month. Work orders and manual rows dated before the owner's first statement month are **left off by default** (they may already have been billed in Buildium) and shown under "Left off this statement" with a note; the accountant can include them (`includedKeys`, 5.4). | `ownerProperties.openingBalanceCents/startMonth`, `selectWorkOrders` floorDate | Q9 |
| A10 | Co-owned properties (2+ owner links) are blocked from statements and new ledger rows until a split exists. | `CO_OWNED` | Q10 |
| A11 | One statement per owner **entity** (LLC), not per person. | `owners` | Q11 |
| A12 | The owner draw Name = the payee name, defaulting to "contact first + last" (the sample shows "Adam Nye"). It is unset when the contact cell holds two people. The PDF footer name = contact first + last, falling back to the legal name. | `rosCalc.effectivePayee`, `footerName` | Q12 |
| A13 | Property reserve is a per owner-property setting, default $0.00, editable per statement. | `ownerProperties.propertyReserveCents`, `adjustments` | Q13 |
| A14 | The Name on expense rows is "Property Pro Realty Group Inc."; it is editable on manual rows for outside vendors. Work-order rows always use the company name. | TransactionForm default, `rosBuild` | Q14 |
| A15 | Security deposits are the current amount held per unit, typed in by the accountant and snapshotted at finalize; there is no deposit history. The golden test splits $2,400.00 as $800 per unit. | `units.securityDepositHeldCents` | Q15 |
| A16 | Company-owned properties (Property Pro Rentals, LLC) are imported as an owner like any other (linked, and flagged in the import report); generating their statements is optional. | import | Q16 |
| A17 | The logo is a placeholder cropped from the scan until a high-res file arrives. | `public/brand/pprg-logo.png` | Q17 |
| A18 | "Unpaid bills" is a manual per-statement, per-property amount, default 0. There is no bills-payable workflow, and every ledger expense is treated as paid from owner cash, so a typed figure is the only honest source. | `adjustments.unpaidBillsCents` | - |
| A19 | "Early payments" is a manual per-statement, per-property amount, default 0, added to deposits on one line (as in Buildium). | `adjustments.earlyPaymentsCents` | - |
| A20 | A row dated before the period (an excluded line or a WO closed late) appears on the next statement dated the period's first day, tagged "carried forward". It is stored in the ledger with that effective date. | `rosCalc` step 1, finalize | - |
| A21 | Same-date order: ordinary rows, then the management fee, then the owner draw; then column order, Property level before units, natural unit order, account name, entry time. | `rosCalc` step 6 | - |
| A22 | Income-statement accounts are in alphabetical (natural) order, and accounts with no activity are hidden. | `rosCalc` step 5 | - |
| A23 | The footer timestamp is `MM/DD/YYYY HH:mm:ss`, zero-padded, 24-hour, in New York time, taken from the moment the PDF is built. | `generatedStamp` | - |
| A24 | Business time zone is fixed to America/New_York (`organizations.timeZone` is optional and may be unset). | `ROS_TIME_ZONE` | - |
| A25 | Each property's months must be finalized in order. A month can be finalized only after it ends. Drafts can be made any time from the 1st of the month. | `createDraftProblem`, `finalizeProblem` | - |
| A26 | The PDF uses built-in Helvetica instead of Buildium's fonts, for repeatable output with no font files. | `layout.ts` | - |
| A27 | A multi-property statement's detail is one list sorted by date, not grouped by property. | `rosCalc` step 6 | - |
| A28 | Repairs is a protected system account (it can't be deleted, renamed or turned off) because it is the default on close. | seed | - |
| A29 | Drafts can be downloaded as a PDF marked "DRAFT - NOT FINAL" for review. | WP6 | - |
| A30 | The technician must write "Description of work completed" to submit. The office can edit it on close and until the WO is billed. | `submitCompleted` | - |
| A31 | Rent memo defaults to "Payment" for office-entered rent and for the roster-rent prefill (A39), and stays free text. The golden test types "by {tenant}" for the two ePay rows. | TransactionForm default, `ROSTER_RENT_MEMO` | - |
| A32 | **Replaced.** Owners come from the unit rosters already stored on each property (`properties.ownerName` / `ownerEmails`), not from `Rental Owners - Sheet1.pdf` (not a source of truth; user decision 2026-11-11). No owner-email file is created or committed, so the old transcription-JSON privacy question no longer exists. The import report masks emails. An owner is identified by **name AND email** (user decision 2026-11-11): the import, the automatic link on every property save and the "Needs an owner" list use one rule, and a look-alike is flagged, never merged (5.2, section 8). | `ownersImport.ts`, `ownerIdentity.ts`, `ownerLinking.ts` | - |
| A33 | Statement date = the business date of finalizing. | finalize | - |
| A34 | Page 1 keeps a blank recipient block like Buildium's mailing window. No owner address is printed in v1. | WP6 | - |
| A35 | The owner draw needs a payee; a missing payee blocks finalizing when the draw is > 0. | `PAYEE_MISSING` | Q12 |
| A36 | The opening balance can be negative. | `parseSignedDollarsToCents` | Q9 |
| A37 | Unit-level rent rows need the tenant name; it is prefilled from active residents and editable. | TransactionForm | - |
| A38 | The work-completed description is copied verbatim into the memo. No "Unit N -" prefix is added; the sample's prefix was typed by the office. | `rosBuild` | - |
| A39 | (SUPERSEDED 2026-11-12 by the Payments page, 5.9.) Until Stripe, every draft is prefilled with one Rent Income line per occupied unit from the roster rent (`units.rent`, dollars): dated the 1st, Name = the active tenants joined with " & ", memo "Payment". A unit is skipped (and listed) when the owner collects rent directly, the rent is included in another unit, rent is already recorded for the month, the roster says vacant (even with a resident on file), it has no active tenant, no rent, or an invalid rent. A removed line ("didn't pay") is not carried to the next month. The accountant must confirm the rent lines against what was actually received before finalizing. | `rosPolicy.rentPrefillDecision`, `rosBuild`, `ownerStatements.confirmRent` | - |

---

## 13. Things in the codebase that conflict with or constrain the decisions

1. **No Convex integration test harness.** There is no vitest or convex-test. `convex-test` needs `convex ^1.43.0`, and the app has `1.42.3`. The tests are therefore pure-function tests with `node --test`, plus source scans (section 9). A Convex upgrade is a separate decision.
2. **The accountant role could not be assigned in the team UI (RESOLVED as built).** `AppRole` / `jobRolesFor` (`convex/jobRoles.ts`) originally knew only admin, asset_manager and technician. Accountant is now a fourth app role: the Team page and the invite panel offer it, stored as membership role `"member"` plus `jobRoles: ["accountant"]` (section 2).
3. **B31:** `viewFor` gives the asset-manager view to anyone holding `asset_manager` + `accountant` (Delia). They will be refused by `requireFinance`. This is out of scope as decided.
4. **The existing finance UI is admin-only.** `app/finance/page.tsx` uses `RequireView views={["admin"]}` and the sidebar's Finance links are admin-only. WP5 changes "Owner Reports" to admin + accountant on `/owner-statements`.
5. **`audit.forEntity` is admin-only.** The accountant needs statement history, so WP2 adds finance-scoped `ownerStatements.history` and `ledger.history`.
6. **`workOrders.unitId` is required**, and authz and routing depend on it. Property-level billing is therefore a flag (`billPropertyLevel`), as decided.
7. **There are two close UIs:** `components/board/wo-drawer.tsx` ("Confirm as Completed") and `app/work-orders/[id]/page.tsx`. Both call `reviewClose({ workOrderId })` today. Once the server requires billing fields, both must change in the same package (WP3), or closing breaks.
8. **`board.detail` excludes accountants** (`boardViewOf` returns admin | asset_manager). Accountants therefore edit WO billing from the statement draft (via `workOrderBilling.updateBilling`), not from the work-order board.
9. **Technician reads return whole WO docs** (`workOrders.get`, `workOrders.list`, the technician branch in `maintenance.ts`). The new bill and cost fields would leak to technicians without the `forTechnician` strip (WP3).
10. **`completedAt` is epoch ms and `organizations.timeZone` is optional.** The ROS uses a fixed America/New_York business date.
11. **`aria-invalid` is set by existing forms but nothing styles it,** so there is no red border today. `Field` has no `error` prop. WP5 and WP3 add the explicit `border-danger-ink` class and the message under the field; `controls.tsx` is not changed.
12. **`Rental Owners - Sheet1.pdf` is not used (decision 2026-11-11).** Its merged cells make the text layout misleading, and the owners now come from the unit rosters on each property (section 8). Data problems in the rosters show up in the dry-run report instead: the same owner name with different emails, owners across more than one category, names that look like two owners, properties with no owner, and properties that end up with two owner links (co-owned).
13. **A privacy precedent (no longer in conflict):** `docs/rosters/owners-fill-proposal-2026-11-04.md` kept full owner emails out of the repo. Because the import now reads the emails from the database (the roster fields) and never writes an owner file into the repo, and its report masks emails, nothing needs to be committed (A32).
14. **The work-order "Cost" in the WO drawer** today is only `materialsTotal`/`otherExpensesTotal`, with a "labor formula unconfirmed" note (`expensesTabFor.laborNote`). The new `costCents` is a separate, manually entered figure. Keep the existing note.
15. **The sample's rent memos "by {tenant}"** come from Buildium ePay. In Phase 1 they are typed text. The `stripe` source is reserved for B25.

---

## Changelog

- **2026-11-11, initial spec.** Phase 1 design: schema, pure engine, Convex functions, UI, PDF, owners import from a transcription of `Rental Owners - Sheet1.pdf`, tests, work packages and assumptions A1-A38.
- **2026-11-11, as-built update.** This document now matches the code:
  - **Owners from the unit rosters (section 8, A32, 9.3, section 13).** The PDF transcription, address matching and `rental-owners.json` were dropped. Owners and links are built from `properties.ownerName` / `ownerEmails`, grouped by normalized name across Gold, Silver and Make Up, with an idempotent adopt / fill-empty / add-only importer, a masked-email report, and a dry run that rolls back. The CLI refuses prod. `Rental Owners - Sheet1.pdf` is not a source of truth.
  - **Review fixes 1-11 (as built):**
    - `workOrders.rosPending` + `by_property_and_rosPending` + `workOrderBilling:backfillRosPending`, so the build reads only pending work orders (3.9);
    - `ledgerEntries.postedDate` + `by_owner_and_posted` / `by_org_and_posted`, set at finalize on every billed row (3.5);
    - `ownerStatements.includedKeys` and default-excluded lines (with notes) for work orders and manual rows dated before the owner's first statement month, with `WO_BEFORE_START` and `WO_BEFORE_START_MISSING_BILL` (info) and `START_MONTH_AFTER` (blocking) (4.4, 5.4, 5.8);
    - `PREV_OWNER_BALANCE` (blocking) and the info `OPENING_BALANCE_NOT_SET` for a property that changed hands (5.4);
    - per-owner link-setting lock, `linkSettingProblem`, and the refusal to change the start month while a draft is open (3.3, 5.2);
    - `AMOUNT_TOO_LARGE` (blocking, row capped) for the fee and the draw (4.2);
    - `DEPOSITS_NOT_SET` only when the property has units (5.4);
    - `workOrderId` on single-work-order warnings (5.4, 5.8);
    - the ledger date rule runs on edit only when the date changes, and any unbilled manual row can be voided (3.5, 5.3);
    - default accounts are seeded only when a system account is missing (`needsAccountSetup` / `seedIfNeeded`) (3.4, 5.1, 5.6);
    - the Finalize dialog freezes `previewHash` and the expected totals when it opens (`finalize-guard.ts`), and the snapshot size is counted in UTF-8 bytes (5.4, 6.3, 3.8).
  - **PDF as built (section 7).** `@react-pdf/renderer` 4.9.0 with built-in Helvetica, placeholder logo `public/brand/pprg-logo.png`, measured detail column widths (sum 702), the "DRAFT - NOT FINAL" watermark, fetch-on-click `pdfData`, the file name pattern `ROS-{slug}-{YYYY-MM}{-DRAFT}.pdf`, and tables with more than 5 value columns split into stacked tables.
  - **Accountant role (sections 2 and 13).** "Accountant" is an assignable role on the Team page and in the invite panel (membership role `"member"` plus `jobRoles: ["accountant"]`). B31 (asset manager + accountant) is still out of scope.
- **2026-11-11, features added after the as-built update (this document now matches the code):**
  - **Owner identity: name + email (3.2, 3.3, 5.2, 6.5, 8, 9.3, 9.6, A32).** One pure rule (`ownerIdentity.compareIdentity`: same name + a shared email = same owner; same name with different emails, or a shared email under a different name, = separate and flagged; same name with no email = same owner, flagged `name_only_match`). `decidePropertyLink` / `planLinkAll` decide links; `ownerLinking.linkOwnerForProperty` + `applyLinkDecision` run automatically after `properties.updateProfile` and in `rosterImport.upsertProperty` (links on an exact match, creates an owner only when nobody matches or looks alike, never moves an existing link, never fails the property save). New `owners` functions `needsOwner`, `mergePreview`, `merge`, `dismissIdentityFlag`, `createForProperty`, `linkAllExact`. Schema: `owners.mergedIntoOwnerId` / `mergedAt` / `createdFromPropertyId`, table `ownerIdentityDismissals`, `owners.nameKey` no longer unique. UI: the "Needs an owner" card (Ready to link / New owner / Owner differs / Needs review, the Doubtful pill, "Link all exact matches (N)", "Not the same owner", the Merge owners dialog). The owners import (section 8) now groups and adopts by name + email instead of by name alone, and its report gains identity flags, `needsOwner`, `linkedElsewhere`, `notCreated` and `ignoredEmails` in place of the old conflicting-emails list.
  - **Roster rent prefill (3.1, 3.5, 3.6, 4.4, 5.4, new 5.4.1, 5.5, 5.8, 6.3, A31, A39).** Every draft gets one Rent Income line per occupied unit from `units.rent` (key `rent:<unitId>`, ledger source `roster_rent`, written at finalize with `sourceId = statementId:unitId`). Skip rules include vacant-on-roster even with a resident on file; each skip is listed. `rosterRentToCents`, `validateRentLineFields`, `rosBuild.applyRentOverride`, `finalizePlan` `rentRows`; `ownerStatements.setRentLine` / `confirmRent`, `rentOverrides`, `rentCheckedAt` / `By` / `Hash`; new warnings `RENT_NOT_CHECKED` (blocking), `RENT_INVALID` and `RENT_ACCOUNT_MISSING` (info). UI: the Rent dialog, "Remove (didn't pay)" / "Put back", the "Not prefilled from the roster" card, and the "Confirm rent" checkbox in the side panel.
  - **Management fee per property with an org default (3.2, 3.3, 4.2, 5.2, 5.4, 6.3, 6.5, A4, A5).** `financeSettings.rosDefaultFeeBps` (absent = 5.00%), `ownerProperties.managementFeeBps` (own fee), `owners.managementFeeBps` deprecated and unused. `feeSettings.get` / `setDefaultFee` (the "Change fee for all properties" alert, optional reset of own fees, the `expectedCounts` guard), `owners.setPropertyFee`. The engine takes `feeBps` per property (and prints it in the memo); `previewHash` covers it; the snapshot stores it. `FEE_NOT_SET` is now only a guard. `feeMigration:copyOwnerFeesToLinks` (internal, dry run by default) copies an old non-default owner fee onto its links; running it is the user's decision. UI: the "Change fee for all properties" dialog and the per-property fee field on the owner page; the owner form no longer has a fee field.
  - **Accountant role (2, 13).** Re-checked against `convex/jobRoles.ts` and the Team page: unchanged and correct as already documented (membership role `"member"` plus `jobRoles: ["accountant"]`; Admin, Asset manager, Technician and Accountant are offered).
- **2026-11-12, rent via a Payments page (replaces the roster-rent prefill).** User decisions in `ros-decisions.md` ("Rent via a Payments page"): cash basis, no partial payments, owner-direct / included / vacant units greyed out, editable until final, rent edited only on the Payments page.
  - New ledger source `rent_payment` and optional `ledgerEntries.rentForMonth` / `paymentMethod` / `paymentNote`, indexes `by_unit_and_rent_month`, `by_org_and_rent_month`, `by_unit_and_date` (3.1, 3.5).
  - New `convex/rentPayments.ts` (+ `rentPaymentsLib.ts`, `rentPaymentsPolicy.ts`): `list`, `markReceived`, `markManyReceived` (all or nothing, max 100), `updatePayment`, `undoPayment` (5.9). Payments page `/owner-statements/payments`, "Payments" tab (Statements · Payments · Ledger · Owners · Accounts), sidebar "Payments" for admin + accountant, `/finance` redirects there (6.1, 6.8).
  - The roster-rent prefill is removed (5.4.1): no `rent:` lines, no `RENT_NOT_CHECKED` / `RENT_INVALID` / `RENT_ACCOUNT_MISSING`, no roster_rent rows at finalize, `setRentLine` / `confirmRent` refuse ("Rent is recorded on the Payments page."), the Rent dialog, the "Not prefilled" card and Confirm rent are gone. `rentOverrides` / `rentChecked*` and the `roster_rent` source stay as deprecated optional values. New info warning `RENT_UNPAID` with a link to the Payments page (5.4, 5.8).
  - Statement: payment lines read-only ("Payments page", "Edit on Payments page"), never left off (5.4, 6.3). Ledger: Rent Income can't be added or edited by hand ("Record rent on the Payments page."); hand-entered Rent Income rows stay valid, show as Paid ("Entered in the ledger") on the Payments page and can still be deleted (5.3).
  - Tests: `ros_rent.test.mjs` rewritten for the new behaviour (9.6); `ros_warning_links`, `ros_build` (snapshot round trip) and `ros_authz` (rentPayments.ts gated, the lib org-checked) updated; the golden test is unchanged.
- **2026-11-12, Payments follow-up (layout, search, pagination, review fixes).** This document matches the code:
  - **Layout (6.1, 6.8):** Payments is its own page `/payments` (Finance → Payments, sidebar icon Banknote, active on `/payments` only; Owner Reports active on `/owner-statements/**` only). The Owner Reports sub-nav is Statements · Ledger · Owners · Accounts. `/owner-statements/payments` and `/finance` redirect to `/payments` (query string kept). Every link updated (`paymentsHref` / `PAYMENTS_PATH`, `line-labels.paymentsPageHref`, `warning-links` RENT_UNPAID, statement page "Record rent on Payments page").
  - **Search and pages (6.1, 6.2, 6.4, 6.5, 6.8):** shared `Pagination`, `useUrlPaging`, `SearchBox` / `useUrlSearch`, `SortHeader` / `table-sort.ts`; `DataTable` `rowClickable` / `rowClassName` and control-aware row clicks. Payments: search + client-side status filter and totals, per-page selection, row click toggles. Statements list: search, Team filter, status chips, sortable headers, whole-row open, pages (`ownerStatements.list` returns `emails` and `properties`). Owners: search, "Only owners with problems", sortable headers, pages (`owners.list` returns `propertyNames`); Needs an owner card paged when over 25. Ledger: shared pager in cursor mode with `pageSize`, row click opens Edit.
  - **MEDIUM-1 (5.9):** marking (and a received-date edit into another month) refuses when the unit already has a non-voided Rent Income row dated in the received month: `Unit {X} at {property} already has rent dated in {Month} (entered in the ledger / marked received for {rentMonth}). Check it before adding another payment.`
  - **MEDIUM-2 (5.8, 5.9):** new info warning RENT_PAYMENT_BEFORE_START for rent payments left off by default before the first statement month, linking to the "Left off this statement" card (anchor `left-off`, opened on reveal).
  - **LOW-1:** rent months before the owner's first statement month (`Statements for {property} start in {Month}.`) or more than 24 months ago (`You can't mark rent for {Month} — it's more than 24 months ago.`) are refused on the server; the list greys out pre-start months and shows old months view-only. **LOW-2:** `ledger.update` refuses any edit of a row on Rent Income ("Rent can't be moved to another account. Delete it and record it on the Payments page."). **LOW-3:** filtered lists read only the matching properties' units; accurate truncation notes. **LOW-4:** `ownerChanged` message on a date edit. **LOW-5:** `lockedThrough` reads one row. **LOW-6:** older `?month=` values open. **LOW-7:** `MethodSelect` (and the shared `Select`) set `aria-invalid`.
  - **Which statement:** "Goes on the {Month} statement (the month it was received)." in the dialogs and "→ {Mon YYYY} statement" on paid rows (`statementMonthFor`, `landsOnText`, `landsOnShort`).
  - Tests: `ros_rent.test.mjs` (MEDIUM-1, MEDIUM-2, LOW-1/2/3/4/5, lands-on; the uniqueness test now expects the same-month refusal), `ros_warning_links.test.mjs` (new code, new hrefs), new `ros_lists.test.mjs` (search, totals, per-page select all, pagination maths, sorting, statements / owners finders).
- **2026-11-13, rent history (rent changes with an effective month) and the property page redesign.**
  - **Rent history (5.9 "Rent history").** New table `unitRentChanges` (+ `by_unit_and_month`, `by_org`); pure `unitRentPolicy.ts` (`rentForMonth`, `rentInEffect`, `validateRentChange`, messages), `unitRentLib.ts` (`changeRent`, `rentHistory`), registered in `unitRent.ts` (`changeRent`, `history`; `requireFinance` first: admin view + accountant). Payments (`list`, `markReceived`, `markManyReceived`) and the draft's `RENT_UNPAID` use the rent FOR the month: a late October payment marked after a November increase is October's rent. Paid months are never changed (info message). `units.rent` = the latest change (Sarah and other readers unchanged). `units.update` refuses rent; `units.create` / `update` validate floor, baths and rent (`unitFieldsPolicy.ts`); a roster re-import skips `rent` on units with history; removing a unit removes its history. New not-markable code `no_rent_month` ("No rent set for this month"). New `units.rentSummary` (rent this month per unit) and `properties.linkedOwners` (the owner links, admin view + accountant).
  - **Property page.** Header (name, address, team, linked owner → owner page, unit / occupancy counts, Edit property) and tabs Units · Details · Asset manager (`?tab=`). Units: table Unit · Tenant · Rent / month · Status · Asset manager · ⋯ (Edit unit, Change rent…, View history, Remove unit…), whole-row click opens the unit drawer (details, rent now and upcoming, rent history, asset manager history; Edit unit and Change rent inline). Details: read-only Profile / Owner / Leasing rules cards with focused Edit dialogs (same `updateProfile` call and validation). Payments page rows all get a ⋯ menu with Change rent…; the shared `RowMenu` moved to `components/ui/row-menu.tsx`.
  - Tests: new `ros_rent_history.test.mjs` (rentForMonth, cents round trip, validation messages, changeRent on a fake database, late payment after an increase, past changes and paid months, same-month replace, no-rent months, unit form parsing, access); `ros_rent.test.mjs` (RENT_UNPAID with history); `ros_authz.test.mjs` scans `unitRent.ts`.

- **2026-11-13, statement page rebuilt as five steps (C) and review fixes.**
  - **Statement page (6.3).** Single column with a header (period, property pills); steps Check · Money in · Money out · Fees & payout · Review & finalize (`?step=`, free navigation, Back / Next, status dots); a totals bar on every step (server figures; fixed bottom on desktop, compact card on mobile) with Preview (a drawer; `StatementPreview` gets an optional `sections`) and the PDF; Check groups warnings per property with one-click "It's $0.00" / "Set amount…" and "None held" / "Enter deposits…"; Money in / out grouped by property with subtotals, a main action plus a ⋯ menu, row click edits, "Add income" / "Add expense" (and "… here"); Left off split per step; fee and draw on Fees & payout; History and "What gets locked" on Review. New files `statement-steps.ts`, `statement-check.tsx`, `statement-lines.tsx`, `statement-payout.tsx`, `statement-review.tsx`, `statement-chrome.tsx`, `finalize-dialogs.tsx` (replaces `side-panel.tsx`), `components/ui/row-menu.tsx`; `warnings-card.tsx` removed.
  - **Tests:** new `ros_statement_steps.test.mjs` (step reading, warning-to-step mapping, status dots, totals, grouping, quick actions); `ros_authz` and `ros_rent` updated; `ros_rent_history.test.mjs` extended.
  - **Review fixes.** (1) "It's $0.00" re-reads the opening balance and does not overwrite one set meanwhile (info toast "Opening balance for {property} is already set to {$X}."). (2) Fees & payout hides the fee Edit / Skip buttons when the fee percentage is not set. (3) `unitRent.changeRent` refuses replacing a unit's first change with its `previousRentCents` ("The rent from {Month YYYY} would be the same as before ({$X}). Nothing to change."; test added). (4) The roster re-import counts units whose roster rent was kept because they have rent history: summary fields `rentKeptForHistory` (count) and `rentKeptUnits` (up to 20 labels), printed by `import_roster.py`. (5) The Change rent panel's "Rent now" says "Before the first rent change" like the unit drawer. (6) "Total money in" is the server's `view.detail.additionsTotal`. (7) "Leave off this month" and the legacy-rent Delete keep their hover hints in the ⋯ menu (`RowMenuItem.title`). (8) Edit unit validates floor / baths only when changed (client `validateUnitForm(…, unchanged)` and `units.update`), and the property form validates only the fields shown in that dialog. Accepted as is: "None held" writes per unit (not atomic) and comma parsing.
