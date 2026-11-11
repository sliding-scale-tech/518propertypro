# Stripe options fact sheet (518 Property Pro)

**Purpose:** neutral material for brainstorming the finance decisions behind Stripe's 7 questions (`docs/context/stripe-questions-2026-11-03.md`). It lists options, facts, costs and open questions. **It makes no recommendations.** Decisions belong to the user, Alex, Pat and Delia, with legal and compliance review where noted.

**Checked against Stripe's live docs on 2026-11-04.** Stripe changes its docs and prices, so re-check before quoting anything to a client.

**Labels used below**
- **[Stripe]**: stated on a Stripe page listed under Sources.
- **[Client]**: from our client docs (`docs/context/`), the build plan or the backlog.
- **[Code]**: what the repo contains today.
- **[Unverified]**: not confirmed from a primary source. Treat it as a question, not a fact.
- **[Legal/compliance]**: needs a lawyer, an accountant or Stripe's compliance team. Nothing here is legal advice.

---

## 0. Starting point

### What exists in the code today [Code]
- `/finance` (`dashboard/app/finance/page.tsx`) is a "Coming soon" card for Payments and Owner statements. It is wrapped in `RequireView views={["admin"]}`, so the accountant view cannot open it today. The build plan's access table gives accountants access to Payments.
- `convex/schema.ts` has no payment, ledger or Stripe tables. The only payment hook is `publicLinks.purpose`, which already allows `"payment"`. That table stores only a SHA-256 of each token and enforces expiry and a use cap.
- `properties.ownership`: `company_owned` ("Delia – Rentals") or `managed` (Gold, Silver, "Delia Management Properties"). Client answer, 2026-10-30.
- `properties.ownerName`, `ownerEmail`, `ownerEmails`: display and owner verification only. There are no owner payee or bank details.
- `units.rentPaidTo`: `company` | `owner_direct` | `included_in_other_unit`.
- `units.rent`: dollars a month, as a float. It is absent when the roster gives no figure. BACKLOG says 87 units have no rent stated. The build plan says money should be stored as integer cents.
- `residents`: name, phones, email (optional), unit, active. Delia's roster has no tenant names.
- Roles: the job role `accountant` exists. `viewFor()` (`convex/authz.ts`) gives one view per person, by priority. Delia holds both `asset_manager` and `accountant`, so she lands in the asset-manager view (BACKLOG B31, not decided).
- Stack: Next.js + Convex + Clerk, with multi-tenant orgs. Secrets live in Convex environment variables. The repo does not say where the Next.js app is hosted [Unverified].

### What the client docs require or rule out [Client]
- PRD §9: Stripe is **net-new work**. The exact flow must be agreed first.
- PRD §9 [VERIFY] list: account ownership and eligibility, merchant or connected-account model, payment methods, funds flow, payout timing, fees, refunds, failed payments, disputes, rent-ledger source of truth, reconciliation.
- PRD §9: don't assume Stripe replaces Buildium's rent ledger, balances, recurring schedules, late fees, partial payments, payment plans, owner accounting or reconciliation.
- PRD §9 minimum pilot: an eligible tenant, the amount due and its source of truth, payment confirmation, failed-payment handling, transaction history, and how staff confirm settlement.
- PRD §9: test mode first. **Alex, Pat and the accountant approve before production.** Don't represent Simplr as able to replace Buildium until the full flow is validated.
- PRD §9: a payment link in the ROS was discussed. Whether the ROS is the main entry point is unconfirmed.
- PRD §11: payment records need access controls. Payment and integration errors must be logged.
- PRD §17 (out of scope): full accounting replacement, live Buildium API, automatic migration, and payment-plan negotiation flows.
- Sarah Configuration §5 (Pat to confirm the wording): rent is due on the 1st; five-day grace period; computer-generated late notice on the 6th; **$50 late fee** if rent isn't paid in full before the 6th. Current payment methods: check, certified check or cash at the office; **debit or credit card by phone to the office**; debit or credit card online. Pat's policy requires some payment before a payment plan is entered into (§8).
- Figma conflicts (`docs/design/figma-audit.md`):
  - **C-7:** a payment request offers bank transfer details and a Stripe link, verified by hand against a deposit slip. Not in the PRD.
  - **C-8:** a custom card form on our own page, which would bring PCI scope. Ruled out in favour of Stripe-hosted fields.
  - **C-9:** an ROS with a 10% management fee, against the client sample's 5%. This is the management fee, not a card fee.
- Backlog: B24 (ROS), B25 (Stripe), B26 (Buildium CSV import, needs a sample export) are all after Nov 1 unless agreed in writing.

### Stripe's published US standard prices, at a glance [Stripe]
| Item | Price |
|---|---|
| Domestic card | 2.9% + 30¢ |
| Manually entered card (e.g. keyed by staff) | +0.5% |
| International card | +1.5% (+1% if currency conversion) |
| ACH Direct Debit, standard (T+4) | 0.8%, capped at $5.00 |
| ACH Direct Debit, faster settlement (T+2) | 1.2% (no cap listed) |
| ACH failed payment | $4.00 |
| ACH dispute | $15.00 |
| Instant Bank Payments (via Link) | 2.6% + 30¢ |
| Financial Connections instant verification | $1.50 per successful verification (microdeposits free) |
| Card dispute received / countered | $15.00 / $15.00 (countered fee refunded if you win) |
| Billing (subscriptions) | 0.7% of Billing volume, or from $620/month on a 1-year contract |
| Connect, "Stripe handles pricing" | No platform fees |
| Connect, "you handle pricing" | $2 per monthly active account + 0.25% + 25¢ per payout |

Worked examples using real roster rents (standard pricing, before any negotiated rate):

| Rent | Card | Card keyed by staff | ACH standard | ACH faster | Instant Bank Payments |
|---|---|---|---|---|---|
| $550 (687 State St room) | $16.25 | $19.00 | $4.40 | $6.60 | $14.60 |
| $883 (108 Jackson 1st Fl, ROS sample) | $25.91 | $30.32 | $5.00 (cap) | $10.60 | $23.26 |
| $1,200 | $35.10 | $41.10 | $5.00 (cap) | $14.40 | $31.50 |

The ACH standard fee hits its $5 cap at $625 of rent. Stripe's refund page says processing fees on the original transaction aren't returned when you refund.

---

## Q1. Account model: a Property Pro-owned Stripe account, or a connection through a Simplr platform?

### Background facts [Stripe]
- Stripe calls Standard, Express and Custom "legacy connected account types". New platforms should use **Accounts v2** (or Accounts v1 with **controller properties**). The settings that matter are:
  - who collects fees: `fees_collector` (v1: `controller.fees.payer`)
  - who carries negative balances: `losses_collector` (v1: `controller.losses.payments`)
  - who collects KYC requirements (v1: `controller.requirement_collection`)
  - Dashboard access, `full` / `express` / `none` (v1: `controller.stripe_dashboard.type`)
- Responsibilities are set when the merchant configuration is added and "can't update their values later". On the legacy types: "After you create a connected account, you can't change its type."
- OAuth for Connect still exists, but it **requires Accounts v1**. Since 2021, platforms using OAuth `read_write` "won't be able to connect to accounts that are controlled by another platform". The OAuth `access_token` is deprecated in favour of the platform key plus the `Stripe-Account` header.
- Charge types:
  - **Direct charges**: the connected account is the merchant and pays fees, refunds and chargebacks.
  - **Destination charges / separate charges and transfers**: the platform is debited for refunds and disputes and collects fees from its accounts.
  - The ACH mandate and the customer's bank statement show the merchant of record. That is the connected account for direct charges, and the platform for destination charges unless `on_behalf_of` is used.
- Stripe's **restricted businesses** list includes "Payment facilitation and aggregation", described as "receiving settlement proceeds for goods or services that you did not provide". This matters if Simplr's own account were to receive Property Pro's rent.

### Options

| | A. Property Pro's own standalone account | B. Simplr Connect platform, Property Pro on full Dashboard, direct charges | C. Simplr Connect platform, Simplr-controlled account (Express-like or no Dashboard), destination charges | D. Simplr's own account collects rent for Property Pro |
|---|---|---|---|---|
| **Plain words** | Property Pro opens and owns a normal Stripe account. Simplr's code calls it with a key Property Pro issues to Simplr. | Simplr runs a Stripe platform. Property Pro's account is connected to it, keeps its own full Dashboard and is the merchant on every payment. Simplr acts on its behalf. | Simplr runs a platform and the platform is the payment owner. Property Pro gets a light or no Dashboard. | No Connect. Money lands in Simplr's Stripe balance and Simplr passes it on. |
| **Who owns the money and customer relationship** | Property Pro | Property Pro | Platform (Simplr) carries refunds, disputes, negative balances | Simplr |
| **Liability for disputes and negative balances** | Property Pro | Property Pro (with `losses_collector = stripe`, Stripe covers the connected account's negative balances) | Simplr (the platform) | Simplr |
| **Simplr's build effort** | Lowest: one account, one key, one webhook | Medium: onboarding link, `Stripe-Account` header, Connect webhooks | Higher: platform risk management, payouts, support | Low code, but see the restricted list |
| **Fits more Simplr clients later?** | Each new client repeats the setup: own account, own key, own webhook | Yes, this is the multi-tenant shape | Yes | No |
| **Stripe cost on top of processing** | None | "Stripe handles pricing": no platform fees | If the platform sets pricing: $2/active account + 0.25% + 25¢ per payout | n/a |
| **Simplr can earn from payments?** | No (only via its $600/month fee) | Yes, through application fees, if agreed | Yes | n/a |
| **Client docs** | Build plan P21 lists this as "simplest" (an internal note, not a client decision) | PRD §9 [VERIFY]: "merchant or connected-account model if relevant" | Same | Not mentioned. Matches "Payment facilitation and aggregation" on Stripe's restricted list [Stripe]; likely ruled out [Legal/compliance] |

Points to weigh:
- **Changing later.** Moving from A to B means connecting an existing Stripe account to a new platform. With OAuth (Accounts v1) that is the classic path for an existing account. Whether Accounts v2 can attach an already-existing standalone account, and what happens to its customers, saved payment methods and mandates when it does, is **[Unverified]**. Ask Stripe in the technical review.
- **Who controls keys.** Under A, Property Pro (as account owner) creates the restricted key and can revoke it at any time. Under B, Simplr's platform key can act on the account through the `Stripe-Account` header. Property Pro keeps its own Dashboard and can disconnect a Standard-style account (OAuth deauthorize).
- **Merchant of record.** A and B show Property Pro as the merchant on cards, ACH mandates and bank statements. C and D could show Simplr unless `on_behalf_of` is used.
- **Multi-tenancy.** Simplr is built with multi-tenant orgs. Under A, keys would be per org (one Property Pro key set), stored so that no other org can use them.

### Questions to answer before choosing
1. Does Property Pro already have a Stripe account, or a merchant account with Buildium's processor? Who at Property Pro would be the Stripe **account owner** (legal entity, likely Property Pro Realty Group Inc.)?
2. Does Property Pro want to keep full control and visibility in its own Stripe Dashboard?
3. Does Simplr want to earn payment revenue (application fees), or only the $600/month subscription?
4. Will other Simplr clients need payments within the next year? Would Simplr accept platform liability for them?
5. **For Stripe:** if we start with A, can the account later be connected to a Simplr platform (Accounts v2) without re-collecting payment methods and mandates?
6. **For Stripe:** for managed properties, does Property Pro collecting rent that belongs to outside owners raise any eligibility question on its account (see the funds-flow section)?

---

## Q2. Which Stripe products, APIs or hosted components, for card and ACH?

### Payment UI options [Stripe]

| Option | Plain words | Effort | Fit for rent | Notes |
|---|---|---|---|---|
| **Payment Links** | A Stripe-hosted link made in the Dashboard or by API | 1/5, no code | Generic "pay rent" link | "Anyone with the link"; reusable. Supports "customers can choose what to pay". Stripe's comparison table marks **partial payments and payment plans as not supported** (Invoicing supports them). Reconciliation is by URL parameters. ACH is supported. |
| **Checkout Sessions, Stripe-hosted page** | Our page creates a session for one tenant and amount, then redirects to Stripe | Low | One-off rent payment per tenant per month | Stripe recommends the Checkout Sessions API "for most integrations". Sessions **expire automatically after 24 hours**, so a link sent by SMS would need our own `/pay/[token]` page that creates a fresh session when the tenant clicks. Displays the ACH mandate and records acceptance. |
| **Checkout Sessions, embedded form** | Same, but Stripe's form sits inside our page | Low–medium | Same, with our branding around it | Same mandate handling |
| **Payment Element (Elements)** | Stripe's iframe fields inside our own page design | Medium | A custom-looking pay page (Figma P01–P08) | Works with Checkout Sessions or PaymentIntents. Stripe shows the ACH mandate. With PaymentIntents "you calculate the final amount and manage the entire checkout lifecycle in your own code". |
| **Invoicing (hosted invoice page)** | A Stripe invoice emailed or linked to a specific customer | Low | Monthly rent "bill" per tenant | Per customer. Supports partial payments and payment plans. Can auto-charge a saved method. Invoicing pricing was not checked **[Unverified]**. |
| Our own card or bank fields | Raw card entry on our page | n/a | **Ruled out** | Figma C-8. Direct API card handling is SAQ D. |

### Payment method options [Stripe]
- **Cards** (credit, debit, prepaid): immediate authorization result; disputable later.
- **ACH Direct Debit (`us_bank_account`)**:
  - Bank verified by **Financial Connections** (instant, $1.50 per successful verification) or microdeposits (free, 1–2 business days, 10 days to verify).
  - Needs a mandate. Checkout and the Payment Element show it and record it.
  - Up to 4 business days to confirm (T+4); T+2 with faster settlement if eligible.
  - Minimum $0.50.
- **Instant Bank Payments**: only through Link. "Bank-initiated returns guaranteed by Stripe"; 2.6% + 30¢.
- **Wallets / Link**: available in Checkout and Elements. Not examined in detail.
- **Card by phone to the office** (Sarah config §5): if staff key the card into the Stripe Dashboard, that is manual entry (+0.5%) and **SAQ C-VT** scope. Whether to keep phone payments is a question for Pat.

### Server-side APIs any option would touch [Stripe]
Checkout Sessions or PaymentIntents, Customers (or Accounts v2 customer configuration), PaymentMethods / SetupIntents (only if saving methods for autopay), Refunds, Disputes (read), Balance Transactions and Payouts (reconciliation), Events/webhooks, and the Reporting API (optional).

### Questions
1. Card only, ACH only, or both? Is Instant Bank Payments wanted?
2. Should tenants be able to save a method (needed for any autopay later)?
3. One link per tenant per month (amount fixed by staff), or one reusable link where the tenant types the amount?
4. Is the ROS the entry point for a payment link (PRD §9 open item), or SMS/email from staff, or a tenant portal?
5. Keep "card by phone to the office"? (It brings SAQ C-VT and the manual-entry fee.)

---

## PCI scope by integration type

| Integration | SAQ (per Stripe's PCI guide) | Notes |
|---|---|---|
| Checkout (hosted page), Payment Links | SAQ A | Card inputs are served from Stripe's domain |
| Elements / Payment Element (iframe on our page) | SAQ A | Stripe lists it with Checkout as meeting SAQ A eligibility |
| Elements with legacy Stripe.js v2 | SAQ A-EP | Not relevant if current Stripe.js is used |
| Direct API with raw card numbers | SAQ D | Ruled out (C-8) |
| Mobile SDKs | SAQ A | n/a |
| Dashboard manual entry (staff keying a card from a phone call) | SAQ C-VT | Applies if phone payments stay |

- **PCI DSS v4.0** added payment-page script requirements (6.4.3 and 11.6.1) and changed SAQ A eligibility wording. Stripe's PCI guide page does **not** address these. Whether an embedded form (Payment Element or embedded Checkout) on our own page brings extra script-management duties under v4.0 is **[Unverified]**. Confirm with Stripe or a QSA. A full redirect to the Stripe-hosted page keeps our page out of the card-entry flow.
- Stripe: card brand, last four and expiry returned by the API are not PCI data and may be stored.
- Security basics [Stripe]: TLS 1.2+; verify webhook signatures; optionally allowlist Stripe's IPs; minimise third-party JavaScript on payment pages; Content Security Policy entries are listed for Checkout and Stripe.js.

---

## Q3. Who will own, host and maintain the code after launch?

### Options

| | A. Simplr owns and hosts the code and maintains it under the subscription | B. Simplr hosts and maintains; Property Pro gets contractual rights (escrow or licence) | C. Property Pro (or a contractor) takes over code and hosting |
|---|---|---|---|
| Plain words | Same as the rest of the 518 dashboard today | As A, plus a written guarantee if Simplr stops | Handover |
| Fits the current setup | Yes (Next.js + Convex + Clerk, Simplr-run) | Yes | Needs a separate deployment and skills |
| Cost | Inside $600/month? Not stated in the PRD [Client] | Legal drafting | Property Pro's own engineering cost |
| Stripe access needed by Simplr | A restricted key (Q4) and Dashboard seats | Same | None after handover |

### Facts about secrets and operations
- **Where secrets would live:**
  - Convex environment variables, separate for dev and prod deployments [Code pattern].
  - Stripe: "Store sensitive keys in a secrets vault… If you can't use a secrets vault, use environment variables"; "Don't share keys over email, chat, or other unencrypted channels" [Stripe]. Ellie's email says the same.
  - Webhook signing secrets (`whsec_`) are separate from API keys and differ for each endpoint and for test and live [Stripe].
- **Revealing keys:** a live restricted key you create yourself can't be revealed again after the first view. Sandbox keys can always be viewed [Stripe].
- **Rotation:**
  - Rotating a key in the Dashboard keeps the old and new keys working for up to 7 days; keys can also be set to rotate on a schedule.
  - Webhook secrets can be rolled with up to 24 hours of overlap.
  - Stripe suggests rotating when someone with access leaves.
  - A key unused for payouts or transfers for 180 days can lose those abilities until access is restored. [Stripe]
- **Access policies:** a key can be limited to IP ranges, or by ASN, country and threat category. Stripe recommends a policy on every live key. Convex's outbound IPs may not be fixed, so an ASN/country policy may be the practical choice **[Unverified]**.
- **Monitoring:** each key has request logs in Workbench. Stripe retries failed webhook deliveries for up to 3 days in live mode; manual resend works for up to 15 days in the Dashboard and 30 in the CLI [Stripe].
- **Incident response building blocks:**
  - Expire or rotate the key (Stripe can block a request from outside the policy and notify you).
  - Roll the webhook secret.
  - Review request logs and the Dashboard security history.
  - Notify Stripe and Property Pro. [Stripe]
  - Who is on call, who tells Property Pro, and the response time are not defined anywhere [Client].

### Questions
1. Is payments maintenance inside the $600/month, or priced separately? (The PRD says new work beyond the PRD needs a separate scope decision.)
2. Who at Simplr may hold production Stripe access? Who is the backup?
3. Does Property Pro want an exit clause or escrow for the payments code?
4. Who is the incident contact on each side, and what response time is expected?
5. Where is the Next.js front end hosted, and under whose account? (Not documented in the repo.)

---

## Q4. Exact Dashboard roles and API permissions

### API key options [Stripe]
- **Restricted API key (RAK, `rk_test_` / `rk_live_`):** each resource is set to None, Read or Write, and "Write permissions imply read permissions". Permissions can be edited later. A RAK can also carry a permission for acting on connected accounts. Stripe recommends RAKs over secret keys and "one restricted key per service or use case" (for example, a separate key for a reporting job).
- **Secret key (`sk_`):** unrestricted. Stripe: "we don't recommend using secret keys for new use cases".
- **Connect (Q1 option B or C):** Simplr's platform key with the `Stripe-Account` header. OAuth `read_write` is the only platform scope (`read_only` is for extensions).
- **Agent-tagged RAKs:** a key can be tagged as used by an autonomous agent, which applies approval rules to payouts, refunds and config changes. Only relevant if an AI agent ever touches Stripe.

### Candidate RAK scopes by feature (to be confirmed in sandbox request logs)
Exact resource labels in the Dashboard key editor weren't captured from the docs **[Unverified]**. Stripe's method: start broad in a sandbox, run every test, then trim using the request log (GET = read, POST/DELETE = write).

| Feature | Resource | Level |
|---|---|---|
| Create a payment for a tenant | Checkout Sessions (or Payment Intents) | Write |
| Attach the payment to a tenant | Customers | Write |
| Read the payment result | Payment Intents, Charges | Read |
| Save methods for autopay (later only) | Setup Intents, Payment Methods | Write / Read |
| Refunds from inside the app (only if refunds are done in-app) | Refunds | Write |
| Disputes shown in the app | Disputes | Read (Write only if evidence is submitted from the app) |
| Reconciliation view | Balance transactions, Payouts | Read |
| Reports | Reporting / Report runs | Read or Write |
| Webhook handling | Events | Read |
| Webhook endpoint setup | none (set up by hand in the Dashboard) | None |
| Everything else (Billing, Connect, Issuing, Terminal…) | — | None, unless an option above needs it |

### Dashboard roles relevant here [Stripe]
| Role | Can | Can't |
|---|---|---|
| Account owner / Super Administrator | Everything, including sandboxes and owner transfer | — |
| Administrator | Almost everything: API keys, team, refunds, payouts, bank details | Delete the default bank account; change the owner |
| Developer | Create and view API keys, events and logs, refunds, disputes, payouts to bank | Invite team; edit payout schedule; add or edit bank accounts |
| Sandbox Admin / Sandbox User | Full / own sandboxes only | Anything in live mode |
| Analyst | Refunds, disputes, payouts, financial reports, exports | API keys, team, bank details |
| Refund Analyst | View and refund payments | View balance or payouts; resolve disputes |
| Dispute Analyst | View and resolve disputes | Refunds, balance, payouts |
| View Only | View payments, disputes, balance, payouts; download financial reports | Any change |
| Accountant | View payments, balance, payouts; Revenue Recognition and financial reports | Refunds, disputes, any change |
| IAM Administrator | Invite and remove users | Anything financial |

Stripe notes: "If you assign a user multiple roles, they're assigned all the permissions of each individual role." Several roles can invite users, so a compromised account can add more.

### Possible role patterns to discuss (not chosen)
- Test phase: Simplr developers as **Sandbox Admin/User** only, or **Developer**. Property Pro staff as View Only.
- Live phase: who is Owner/Administrator at Property Pro (Alex? Pat?). Delia as **Analyst**, **Accountant** or **View Only + Refund Analyst + Dispute Analyst**. Simplr with no live Dashboard role, or **Developer**, or **View Only** for support.

### Questions
1. Who at Property Pro owns the account and holds Administrator?
2. Should refunds be possible only in the Stripe Dashboard, only in our app, or both? (This decides whether the RAK needs Refunds: Write.)
3. Does Simplr need any live Dashboard access, or only the API key plus sandbox access?
4. Which role does Delia get? Is anyone besides Delia allowed to refund or answer disputes?

---

## Q5. Lifecycle: recurring rent, async ACH, failed payments, refunds, disputes and reconciliation

### 5.1 How rent gets requested each month: options

| | A. Monthly one-off request (link → Checkout) | B. Saved method + monthly charge started by our system (autopay, PaymentIntents) | C. Stripe Billing subscription | D. Stripe Invoicing (one-off invoice per tenant per month) |
|---|---|---|---|---|
| Plain words | Staff (or the system) send each tenant a link for this month's amount; the tenant pays | Tenant saves a card or bank once; we charge it on a set date | Stripe bills a fixed price each month and charges automatically | Stripe sends a bill; the tenant pays on a hosted page or it auto-charges |
| Tenant action each month | Yes | No | No | Yes (or auto-charge) |
| Variable amounts (late fee, utilities, credits) | Easy: set each month | Easy: we compute the amount | Fixed price plus extra invoice items | Easy |
| Partial payments | Only if we allow a custom amount (Payment Links: "customers choose what to pay") | We decide | Not natural | Supported per Stripe's comparison table |
| Extra Stripe cost | None | None | 0.7% of Billing volume (or from $620/month) | Not checked [Unverified] |
| Mandate and notice duties | One-time ACH mandate per payment | Recurring mandate. "You must disclose… how these amounts are calculated or a range"; give **at least 7 calendar days' notice** if timing changes (Nacha text on Stripe's ACH page) | Same | Same if auto-charge |
| Build effort | Lowest | Medium (scheduler, retries, notices) | Medium (subscription sync with the ledger) | Low–medium |
| Retries | Tenant pays again | Our logic | Smart Retries; ACH at most 2 automatic retries within 40 days, no failure fee on Stripe-initiated retries | Invoice retries |
| Risk of conflict with Buildium | Low | Higher: autopay must match the true balance | Higher: a second "schedule" next to Buildium's | Medium |

Relevant [Client] constraint: PRD §9 says not to assume Stripe replaces Buildium's recurring rent schedules, balances or late fees.

### 5.2 Source of truth for the amount due during the pilot: options

| Option | What it means | Facts |
|---|---|---|
| Buildium export (CSV) | Staff export balances; we import them or Delia keys them in | B26 needs a sample export. No live API (PRD §17). |
| Manual entry by Delia or staff per request | Staff type the amount on each request | Matches Figma F-2 (create payment request). Every request is human-checked. |
| `units.rent` from the rosters | Default to the roster rent | 87 units have no rent; rent is a float in dollars [Code]. Ignores late fees, credits and balances. |
| Tenant types the amount | A reusable link where the tenant chooses | Over- and under-payments land on staff to sort out |

Questions: who is accountable for the amount being right? Is Buildium still the ledger during the pilot, and do Stripe payments get entered back into Buildium by hand? (PRD §9 suggests yes until validated.)

### 5.3 Late fees ($50 after the 5th) and partial payments: options
- **Late fee:**
  - stays in Buildium only (staff add it there and the next request includes it); or
  - staff add it to the request by hand; or
  - the system adds it automatically from the 6th.
- **Partial payment:**
  - not allowed (pay the full requested amount); or
  - allowed with staff approval; or
  - allowed freely (custom amount).
- Facts: Sarah config §5 says the fee applies if rent "is not paid in full before the 6th". §8 says some payment is required before a payment plan. Payment plans are out of scope (PRD §17). ACH refunds can only be full refunds [Stripe], which matters if an overpayment needs a partial refund.

### 5.4 Stripe objects and events (facts)
- **PaymentIntent statuses:** `requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`, `requires_capture`, `canceled`, `succeeded`. A PaymentIntent in `processing` can be cancelled only for US bank accounts [Stripe].
- **Checkout events:** `checkout.session.completed` (for ACH the session completes before the money is confirmed), `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` [Stripe].
- **Payment events:** `payment_intent.processing`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.succeeded`, `charge.failed`, `charge.updated` (carries the ACH `expected_debit_date`) [Stripe]. The event list was read from the ACH and webhook pages; the exact set our handler needs is to be confirmed in sandbox.
- **Refund events:** `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded` [Stripe].
- **Dispute events:** `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_reinstated` (and `funds_withdrawn`). Inquiry statuses start with `warning_`, e.g. `warning_needs_response` [Stripe].
- **ACH method blocked:** `payment_method.automatically_updated`, with `us_bank_account.status_details.blocked` [Stripe].
- **Webhook rules** [Stripe]:
  - Verify the `Stripe-Signature` header against the **raw** body; the default tolerance is 5 minutes.
  - Return 2xx fast and process asynchronously.
  - Events can arrive **more than once and out of order**. Store processed event IDs, and don't use `created` for ordering.
  - Live retries run for up to 3 days.
  - Separate test and live signing secrets.
  - Up to 16 event destinations.

### 5.5 Possible internal statuses and how events could map (a sketch for discussion, not a chosen design)

| Possible status | Entered when (Stripe signal) | Notes |
|---|---|---|
| Requested / Pending | Our request created; link sent; no Stripe payment yet | Link expiry is ours (Checkout Session expires in 24 h) |
| Processing | `payment_intent.processing` / ACH `checkout.session.completed` with payment unpaid | ACH: up to 4 business days |
| Paid | `payment_intent.succeeded` / `checkout.session.async_payment_succeeded` | For ACH, still returnable or disputable afterwards (Ellie's point) |
| Failed | `payment_intent.payment_failed` / `async_payment_failed` / card decline | ACH failure fee $4 |
| Returned | ACH failure after `succeeded`: Stripe creates a **dispute** with reason `insufficient_funds`, `incorrect_account_details` or `bank_cannot_process` | So a "return" arrives as a dispute event |
| Refunded (full / partial) | `charge.refunded`, `refund.updated` → succeeded; `refund.failed` | ACH: full refunds only |
| Disputed → Won / Lost | `charge.dispute.created` → `closed` (`won` / `lost`) | ACH disputes are final and can't be contested; cards can be countered |

Idempotency: Stripe supports idempotency keys on create requests. Using the event ID as a dedupe key is Stripe's advice for webhooks; the build plan (P21) already says "idempotent on the Stripe event id" [Client]. Details of the idempotency-key header were not re-checked here **[Unverified]**.

### 5.6 Refunds (facts)
- **Cards:** full or partial; can't exceed the charge. Stripe's fees aren't returned. The customer sees the credit in about 5–10 business days. A refund soon after the charge may be a reversal instead. Refunds draw on the available balance [Stripe].
- **ACH:** **full refunds only**, within 180 days, asynchronous and up to 3 business days, can't be cancelled, and appear as a separate credit (not labelled "refund"). **Double-credit risk:** if the tenant also disputes with their bank, they can get two credits. Stripe suggests telling the customer before refunding [Stripe].
- Who may refund (in-app or Dashboard), and whether it is audited in our app, is open. The Dashboard has Refund Analyst and Analyst roles; our app has an audit log pattern [Client: PRD §11].

### 5.7 Disputes (facts)
- **Cards:**
  - Cardholders usually have 120 days to dispute.
  - The response deadline is usually 7–21 days; the bank decides in 60–75 days; the whole process takes 2–3 months.
  - The disputed amount plus a $15 fee is debited from the balance straight away, and you can't refund outside the dispute while it is open.
  - Amex and Discover inquiries come first and must be answered.
  - Countering costs $15, refunded if you win. [Stripe]
- **ACH:**
  - Consumers usually have 60 calendar days (2 business days for business accounts), and these disputes are **final**.
  - "Late returns" outside that window are rare.
  - Proof-of-authorization inquiries are answered automatically by Stripe when Stripe-hosted mandates are used.
  - A dispute cancels the mandate, and a second dispute blocks the bank account.
  - Fee $15. [Stripe]

### 5.8 Reconciliation (facts)
- **Payout reconciliation report:** groups every charge, refund, dispute and fee into the automatic payout that settled it. Itemized CSV (or PDF up to 5,000 rows). **Requires automatic payouts.** Can include `payment_metadata[key]` columns, so a unit, resident or request ID put into metadata appears in the export. Report data can lag behind the payout arriving [Stripe].
- **Balance report:** for manual payouts or treating the Stripe balance like a bank account [Stripe].
- **API:** Balance Transactions and Payouts, and the Reporting API, which sends `reporting.report_type.updated` when data is ready [Stripe].
- **ACH payment reference** (bank-generated) appears on the charge once it succeeds; ACH refunds have a refund reference [Stripe].
- [Client] Figma FP02 shows manual "verify payment" against a deposit slip (C-7). That workflow is for offline methods (check, cash, bank transfer), not Stripe payments.
- Questions: does Delia reconcile per payout (bank deposit) or per payment? Daily or monthly? Do Stripe payments get keyed into Buildium, and by whom?

---

## ACH timing and returns (summary)

| Step | Timing / rule [Stripe] |
|---|---|
| Bank verification | Instant via Financial Connections, or microdeposits (1–2 business days to arrive, 10 days to verify, 10 attempts max) |
| Mandate | Shown and stored by Checkout or the Payment Element; Stripe emails the confirmation if a billing email is given |
| Confirmation | Up to 4 business days (standard, cutoff 21:00 ET), or 2 days with faster settlement (cutoff 14:00 ET, eligible US accounts) |
| Funds | Standard settlement T+4, then paid out on the payout schedule |
| Target debit date | Can be set 3–15 days ahead (best effort; not with microdeposits) |
| Failure before success | Insufficient funds, invalid account, debits blocked. PaymentIntent goes back to `requires_payment_method`. $4 fee. |
| Failure after `succeeded` | Rare. Arrives as a dispute (`insufficient_funds`, `incorrect_account_details`, `bank_cannot_process`). Failure fee. |
| Consumer dispute window | 60 calendar days (business accounts: 2 business days); final |
| Refund | Full only, within 180 days, takes 3 business days |
| Retry (Billing/Invoicing only) | Max 2 automatic retries within 40 days |
| Blocked accounts | Stripe may block an account after certain returns (Nacha); `payment_method.automatically_updated` |
| Test settlement | Instant in sandbox (unlike live) |

Nacha return codes (R01 insufficient funds, R02 account closed, R10 unauthorized, etc.) are not listed on the Stripe pages read. Stripe exposes failure reasons and dispute reasons instead. The R-code mapping is **[Unverified]**.

---

## Q6. Card fees: pass-through, and how credit, debit and ACH are treated

### Options

| | A. Absorb all fees | B. Surcharge credit cards only | C. Flat "convenience" or service fee | D. Steer to ACH (ACH only, or cards with a disclosed cost) | E. Pass the ACH fee through |
|---|---|---|---|---|---|
| Plain words | Property Pro pays every fee | Add a % to credit-card payments only | A fixed fee per online payment | Make ACH the default or only method | Charge tenants the ACH cost (≤ $5) |
| Cost to Property Pro on $1,200 rent | Card $35.10; ACH $5.00 | ~$0 on credit; debit is still absorbed | Depends | ~$5.00 | $0 |
| Rules known [Stripe] | None | Credit only; **debit and prepaid excluded**. Cap is the lower of the cost of acceptance or the network cap (Visa 3%, Mastercard 4% per Stripe's page). Visa wants 30 days' notice before surcharging begins. Disclosure at point of entry and on the receipt. **New York is on Stripe's list of 10 states with surcharge restrictions (caps or bans).** | Not covered by the Stripe page read [Unverified] | No fee rule | Not covered by the Stripe page read [Unverified] |
| Legal/compliance | — | **Required** (NY rules, lease terms, card network rules) | **Required** | Check if rent may legally be ACH-only and whether the lease allows it | **Required** |
| Effort | None | Needs card-funding detection (`card.funding` = credit/debit/prepaid) before the final amount, plus a disclosure UI | Fee line on the request | Config | Fee line |

Facts:
- Stripe's surcharge page is general information, "not legal or tax advice". Two Stripe pages disagree a little on details (for example, Visa's registration wording), so re-check before relying on either [Stripe].
- The card funding type is available on the card object and in the reconciliation report (`card_funding`) [Stripe].
- A debit card run "as credit" is still debit and can't be surcharged (from a third-party source; **[Unverified]** as a primary rule).
- Today tenants can already pay by card online and by phone (Sarah config §5). Whether a fee is charged today, through Buildium's ePay, is unknown [Client].

Questions (for Alex and Pat, then legal and compliance):
1. Are tenants charged any card fee today in Buildium? Does the lease mention one?
2. Is the aim zero cost to Property Pro, or the best tenant experience?
3. Is it acceptable for debit cards to cost Property Pro the full card fee?
4. Is a NY compliance review available before any surcharge or fee is switched on?

---

## Q7. Migrating existing Buildium customers or saved payment methods

### Options

| | A. No migration: tenants enter their details fresh | B. Import saved methods from Buildium's processor into Stripe | C. Phased: new or opted-in tenants on Stripe, Buildium autopay left running for the rest |
|---|---|---|---|
| Plain words | Each tenant adds a card or bank on first payment | Stripe's data migrations team imports cards and ACH details sent by the old processor (PGP + SFTP) | Two systems for a while |
| Effort | None on the data side | Request to the old processor plus a Stripe intake form; Stripe imports within about 10 business days of valid data; "processors can take anywhere from a few days to several months" | Ops overhead |
| Risk | Tenant friction; lower uptake | Migrated cards may see more declines at first (new merchant ID; Stripe suggests ramping up). Double-charging if the old autopay keeps running. | Double charges; confusion over which system holds the balance |
| What Stripe can import | — | Cards, ACH Direct Debit, billing addresses. **Not** CVCs, subscriptions or invoices (Billing migration toolkit is separate) | — |
| Client docs | Matches PRD §17 (no automatic migration) and the pilot scope | Would need separate approval (PRD §17) | Needs a rule for which system each tenant uses |

Facts and unknowns:
- Whether existing ACH **mandates** stay valid after import, or whether tenants must re-authorise, isn't stated on the import page **[Unverified]**. Ask Stripe.
- Which processor Buildium uses for 518's tenants, and whether it will release card data, is **[Unverified]**. The ROS sample shows a "Pending ePay payments" line, which suggests Buildium ePay is in use [Client inference].
- Stripe's import needs the requester logged in to the destination Stripe account, so the account model (Q1) comes first.

Questions:
1. How many 518 tenants use Buildium autopay or saved methods today?
2. Is the pilot limited to tenants who pay a certain way?
3. When Stripe goes live for a tenant, who turns off their Buildium autopay, and when?

---

## Funds flow: company-owned vs managed properties

### Facts [Client]
- **Company-owned** ("Delia – Rentals", `ownership = company_owned`): rent belongs to Property Pro's owners. Stripe payouts to Property Pro's operating bank account match who owns the money.
- **Managed** (Gold, Silver, "Delia Management Properties", `ownership = managed`): rent belongs to outside owners. The ROS sample (108 Jackson Ave, Sept 2026) shows:
  - rent income
  - minus expenses
  - minus a **5.00% management fee** on rent collected ($216.69 on $4,333.87)
  - an **owner draw** that sweeps the balance to $0 ($657.32 to the owner)
  - **tenant security deposits held** as an adjustment ($2,400), giving "Available for payment" of ($2,400).
- `units.rentPaidTo = owner_direct` exists, so some tenants pay owners directly. Those units would presumably not use a Property Pro payment link [Inference].
- Open client question (BACKLOG): the owner-statement payee (Adam Nye) differs from the work order's ownership entity. Who the payee is per property isn't settled.

### Where Stripe money could land: options
1. **All rent into one Property Pro Stripe balance, paid out to one operating bank account.** Owner draws are then paid outside Stripe (as today via Buildium or the bank), net of the 5% fee and expenses on the ROS.
2. **Stripe payouts to a separate bank account** (for example a trust or escrow account the company already uses for owner funds). Whether one Stripe account can split payouts by property to different bank accounts isn't confirmed **[Unverified]**. A second Stripe account (Stripe supports multiple accounts and organizations) is another possible way.
3. **Owners as Connect recipients** (the platform pays owners directly). Heavy: owner onboarding and KYC. Not in the PRD.

What Stripe would do in any of these: take the tenant's payment, report it, and pay out to a bank account. What stays in Buildium or manual for the pilot (per PRD §9 and §10): the ledger and balances, late fees, owner accounting, the management fee calculation, owner draws, and security deposit accounting.

### Questions for Property Pro's accountant and legal [Legal/compliance]
- Does holding rent collected for outside owners require a trust or escrow account under NY rules or Property Pro's licences, and must card or ACH receipts for managed properties go straight into it?
- Can rent for managed properties and company-owned properties land in the same Stripe balance and payout, or must they be kept apart from the moment of collection?
- Security deposits: are they collected online at all? NY has specific rules for holding tenant security deposits (commonly cited: NY General Obligations Law §7-103, **[Unverified]** here). If they are collected through Stripe, which account do they go to?
- Does Property Pro's real-estate or property-management licensing affect who must be the merchant of record?
- For Stripe (with Ellie): does collecting rent for outside owners fall under "Payment facilitation and aggregation" or "Escrow services" on Stripe's restricted list, or is a property manager collecting rent it is entitled to manage treated as its own sales? (Stripe's list doesn't mention property management or rent collection.)
- Who carries the loss when a managed property's tenant disputes or returns a payment after the owner draw has gone out?

---

## Pilot test cases required by the client docs

**PRD §13 criterion:** "The agreed Stripe pilot flow passes tests for successful payment, failure, confirmation and staff reconciliation before live use." PRD §9 adds pending states, failed-payment handling, history and settlement confirmation. Build plan P21 adds pending/ACH, refund and dispute.

| # | Case | How to simulate in a Stripe sandbox [Stripe] | Expected evidence |
|---|---|---|---|
| 1 | Card success | `4242 4242 4242 4242` | Paid status; receipt; history entry |
| 2 | Card decline | `4000 0000 0000 0002` (generic), `4000 0000 0000 9995` (insufficient funds) | Failed status; tenant sees a clear message; staff alert |
| 3 | 3D Secure | `4000 0084 0000 0027` (US) | Payment completes after the challenge |
| 4 | Debit vs credit detection (only if fees differ) | Visa debit `4000 0566 5566 5556`; prepaid `5105 1051 0510 5100` | Correct funding type recorded |
| 5 | ACH success | Account `000123456789`, routing `110000000` (verify with microdeposits `32`/`45` or code `SM11AA`), or Financial Connections test banks | Processing → Paid |
| 6 | ACH failure | `000222222227` (insufficient funds), `000111111113` (account closed), `000333333335` (debit not authorised) | Failed / returned status; staff alert |
| 7 | ACH stuck processing | `000000000009` | Stays Processing; cancellation works |
| 8 | ACH dispute | `000555555559` | Disputed status; mandate no longer usable |
| 9 | Card dispute | `4061 2199 4639 3810` (fraud, async); inquiry `4000 0000 0000 1976` | Disputed status; staff alert; balance debit |
| 10 | Refund (card, full and partial) | Refund via the API or Dashboard | Refunded status; audit entry |
| 11 | Refund failure | `4000 0000 0000 5126` | `refund.failed` handled |
| 12 | Duplicate or out-of-order webhooks | Resend events (Dashboard or CLI) | No double "Paid"; final state correct |
| 13 | Bad webhook signature | Send an unsigned request | Rejected; logged |
| 14 | Link expiry / reuse | Our own `publicLinks` expiry and use cap | "Link unavailable" (Figma P08) |
| 15 | Staff reconciliation | Compare the app's list with the payout reconciliation report | Totals and payout IDs match |

Notes: sandbox ACH settles instantly, so live timing must be explained to tenants separately [Stripe]. Use the `+test_email` address format to receive mandate emails in a sandbox [Stripe].

**Approval gates [Client]:** test mode first. Alex, Pat and the accountant (Delia) approve the flow before production (PRD §9). Ellie offered a Stripe technical review once the architecture is clear.

**Screens already listed [Client]:** F-1 payments overview, F-2 create payment request, F-3 verify, fail or resend (offline methods, C-7), F-4 public tenant pay page `/pay/[token]` with eight states and a "Test mode" badge, using Stripe-hosted fields (C-8), F-7 accountant dashboard. ROS screens F-5 and F-6 sit under B24.

---

## All open questions, by who answers

**Property Pro (Alex / Pat):**
1. Account model and owner of the Stripe account (Q1).
2. Card, ACH or both; keep phone card payments; allow saved methods (Q2).
3. Fee policy (Q6), after a compliance check.
4. Late fee and partial-payment handling (5.3); approval of tenant-facing wording.
5. Pilot tenants and units; whether Buildium autopay is switched off for them (Q7).

**Delia (accountant):**
6. Source of the amount due during the pilot (5.2).
7. Reconciliation method: per payout or per payment; daily or monthly; re-entry into Buildium (5.8).
8. Who may refund and answer disputes; her Stripe role (Q4); B31 (her view in our app).
9. Funds-flow and trust-account handling for managed properties and deposits.

**Legal / compliance (Property Pro's advisers):**
10. Surcharge or convenience-fee legality in NY; lease terms.
11. Trust or escrow handling of owner funds and security deposits; licensing.

**Stripe (Ellie / technical review):**
12. Can a standalone account later join a Simplr platform without re-collecting methods and mandates?
13. Does collecting rent for outside owners raise any restricted-business question?
14. PCI v4.0 scope for an embedded form vs a redirect.
15. Do mandates carry over in a PAN/ACH import?
16. Exact RAK resource names to request.

**Simplr (the user):**
17. Is payments maintenance inside the $600/month? Who holds production access? Incident contacts (Q3).
18. Whether other Simplr clients will need payments soon (it affects Q1).
19. Where the Next.js app is hosted.

---

## Sources

Stripe docs and pages (fetched 2026-11-04):
- Connected account types (legacy) and controller-property guidance: https://docs.stripe.com/connect/accounts
- Accounts v2 configuration (responsibilities, dashboard, controller property map): https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- Accounts v2 for SaaS platforms (limits: OAuth needs v1): https://docs.stripe.com/connect/accounts-v2/saas-platform-payments-billing
- Connect OAuth reference: https://docs.stripe.com/connect/oauth-reference
- Connect pricing: https://stripe.com/connect/pricing
- API keys (types, rotation, access policies): https://docs.stripe.com/keys
- Restricted API keys: https://docs.stripe.com/keys/restricted-api-keys
- Dashboard user roles: https://docs.stripe.com/get-started/account/teams/roles
- Online payments, Checkout Sessions vs Payment Intents: https://docs.stripe.com/payments/online-payments
- Payment Links (and Invoicing comparison): https://docs.stripe.com/payment-links
- ACH Direct Debit (timing, mandates, refunds, disputes, failures): https://docs.stripe.com/payments/ach-direct-debit
- Accept an ACH payment with Checkout (events, test accounts, target date): https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment?payment-ui=checkout
- Subscriptions overview (Billing): https://docs.stripe.com/billing/subscriptions/overview
- Webhooks (signatures, retries, duplicates, ordering): https://docs.stripe.com/webhooks
- Refunds: https://docs.stripe.com/refunds
- How disputes work: https://docs.stripe.com/disputes/how-disputes-work
- Payout reconciliation report: https://docs.stripe.com/reports/payout-reconciliation
- Testing (test cards): https://docs.stripe.com/testing
- Integration security guide: https://docs.stripe.com/security/guide
- PCI compliance guide (SAQ by integration): https://stripe.com/guides/pci-compliance
- Import payment data from another processor: https://docs.stripe.com/get-started/data-migrations/pan-import
- Pricing: https://stripe.com/pricing and https://stripe.com/pricing/local-payment-methods
- Surcharge fees (general information, not legal advice): https://stripe.com/resources/more/surcharge-fees
- Credit card surcharges explained: https://stripe.com/resources/more/credit-card-surcharges-explained-what-businesses-need-to-know
- Rent payments guide for landlords and property managers (general; no trust-account, deposit or Connect guidance): https://stripe.com/resources/more/how-to-accept-rent-payments-online
- Restricted businesses list: https://stripe.com/legal/restricted-businesses

Client and internal docs: `docs/context/prd-v2.md` (§9, §10, §11, §13, §17, §18), `docs/context/sarah-configuration.md` (§5, §8, §12), `docs/context/work-order-receipt-and-owner-statement-samples.md`, `docs/context/README.md`, `docs/design/figma-audit.md` (§8, C-7 to C-9), `docs/design/design-backlog.md` (F-1 to F-7), `BACKLOG.md` (B24 to B26, B31), `SIMPLR-518-BUILD-PLAN.md` (P21, P22), `dashboard/convex/schema.ts`, `dashboard/convex/authz.ts`, `dashboard/app/finance/page.tsx`.
