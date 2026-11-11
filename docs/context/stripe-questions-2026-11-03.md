# Stripe questions before live access (Ellie Conway, Stripe, 2026-11-03)

- **Source:** email from Ellie Conway, Strategic Partnerships, Stripe, sent 2026-11-03 to Alex Buell, Pat Fiore and Faarid at Simplr, following a call with Alex. Transcribed from the text the user passed on. Greetings, signature block and contact details are left out on purpose.
- **Received:** 2026-11-03

## What this doc is

Stripe's list of questions it wants answered before anyone creates or shares live Stripe access for 518 Property Pro. It covers the account model (a Property Pro-owned account or one connected through Simplr), the Stripe products for card and ACH, code ownership and maintenance, Dashboard roles and API permissions, the payment lifecycle (recurring rent, async ACH, failures, refunds, disputes, reconciliation), card fee pass-through, and Buildium migration. It also sets expectations about payment finality and says how credentials must not be shared.

## Key facts & rules

- Stripe wants seven points answered before any live access is created or shared (listed below).
- Payment finality: cards give an immediate authorization result, but any payment can later be disputed or reversed. ACH is asynchronous and can be returned after the first confirmation. The aim is to reduce avoidable failures and show payment status clearly, not to promise that a payment is final when it is authorized.
- **Never send over email:** passwords, two-factor codes, raw card or bank data, or live API keys.
- Once Stripe understands the proposed architecture, Ellie can help set up a technical review and confirm what access is needed.
- Related client requirements: PRD v2 §9 (Stripe is net-new, test mode first, Alex, Pat and the accountant approve before production). Simplr's working notes are in `docs/finance/stripe-options-factsheet.md`.

---

# Transcription

Before anyone creates or shares live access, please confirm:

1. Whether this will be a custom integration directly into a Property Pro-owned Stripe account, or a connection through a Simplr platform/account.
2. Which Stripe products, APIs or hosted components we plan to use for card and ACH payments.
3. Who will own, host and maintain the code after launch.
4. The exact Dashboard role and API permissions we expect to need.
5. How the integration will handle recurring rent, asynchronous ACH updates, failed payments, refunds, disputes and reconciliation.
6. How card fees will be passed through, including how credit, debit and ACH will be treated.
7. Whether existing Buildium customers or saved payment methods need to be migrated.

Clarification from the call with Alex:

> Cards provide an immediate authorization result, but no payment method is completely immune from later disputes or reversals. ACH is asynchronous and can be returned after initial confirmation. Our goal should be to reduce avoidable failures and make payment status clear, rather than promise that every payment is permanently final at authorization.

> Please do not send passwords, two-factor authentication codes, raw card or bank data, or live API keys over email. Once I understand the proposed architecture, I can help coordinate a technical review and confirm the access needed.
