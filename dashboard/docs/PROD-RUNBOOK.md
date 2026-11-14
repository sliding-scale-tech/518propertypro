# Production runbook: 518 Property Pro dashboard

The steps to stand up production, in order. Do them top to bottom: each one assumes the ones before it are done. Commands run from `dashboard/` unless a step says otherwise.

**What stays OFF until go-live** is in section 10. Read it before you start. The main rule: production holds real tenants, owners and technicians, so nothing may text, email or call anyone until Pat and Alex say go.

---

## 0. Before you start

- You need: owner access to the Convex project, a Clerk account that can create a production instance, the Vercel project, the ElevenLabs workspace, and the Twilio account.
- Keep two terminals apart: one for **dev** and one for **prod**. Every prod Convex command below uses `--prod`. Never paste a prod key into `.env.local`.
- Never print env var values. `npx convex env list --prod | sed 's/=.*//'` shows names only.

---

## 1. Convex production deployment

1. Deploy the code: `npx convex deploy`. It pushes `convex/` (schema, functions, crons, HTTP routes) to the project's production deployment. Note the deployment URL (`https://<name>.convex.cloud`) and the HTTP actions URL (`https://<name>.convex.site`). The `.convex.site` one is called `CONVEX_SITE_URL` below. Convex sets it itself.
2. Set the env vars below with `npx convex env set --prod <NAME> <value>`. Use fresh production values, not dev's (dev's are listed by `npx convex env list`). Names only:

| Name | What it is | Prod value comes from |
|---|---|---|
| `APP_BASE_URL` | Public origin of the app, no trailing slash. Used in email links and texts | The production domain |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk production issuer (Frontend API URL) | Clerk prod instance, step 2 |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Verifies the Clerk webhook (`/auth`) | Clerk prod webhook, step 2 |
| `ELEVENLABS_API_KEY` | ElevenLabs API | ElevenLabs (prod workspace, see 6) |
| `ELEVENLABS_TOOL_SECRET` | Shared secret on every Sarah tool call (`/tools/*`) | New random value, e.g. `openssl rand -hex 32` |
| `ELEVENLABS_POST_CALL_WEBHOOK_SECRET` | Verifies `/webhooks/elevenlabs/post-call` | ElevenLabs workspace webhook settings |
| `GEMINI_API_KEY` | SMS reply drafting (`geminiApi.ts`) | Google AI Studio |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar OAuth | Google Cloud, OAuth client for prod |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Encrypts stored Google tokens | New random value. Never reuse dev's |
| `GOOGLE_MAPS_API_KEY` | Address autocomplete | Google Cloud |
| `RESEND_API_KEY` | Email (invites, password-reset notes, transcripts) | Resend |
| `STAFF_PHONE_NUMBER` | Fallback staff number for call summaries | Pat's office decision |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio | Twilio console |
| `TWILIO_SMS_FROM_NUMBER` | Sarah's Twilio number, E.164 | Twilio, step 7 |
| `WAHA_BASE_URL`, `WAHA_API_KEY` | Self-hosted WhatsApp. **Optional: leave unset unless WhatsApp is going live** | `infra/waha/README.md` |
| `TWILIO_WHATSAPP_FROM_NUMBER` | Approved WhatsApp sender. Optional; not set on dev today | Twilio |
| `OUTBOUND_ENABLED` | **The go-live master switch. Do NOT set it now.** See section 10 | Leave unset |

3. Check: `npx convex env list --prod | sed 's/=.*//'` lists every name above except `OUTBOUND_ENABLED` (and the optional WhatsApp ones).

---

## 2. Clerk production instance

1. In Clerk, create the **production** instance for this application and add the production domain (Clerk shows the DNS records to add).
2. **Sign-up mode: Restricted.** Accounts are created by the seed (step 4). An open sign-up page would let anyone create an account. It would join the team with no role ("Waiting for access") and see nothing, but it should not exist at all.
3. **Password settings**: keep password sign-in on. Note the minimum length; the change-password page reads it from Clerk.
4. **JWT template for Convex**: create a template named exactly `convex`, audience/`aud` = `convex`. Add this claim, which the password gate reads:
   ```json
   { "mustChangePassword": "{{user.public_metadata.mustChangePassword}}" }
   ```
   Copy the template's issuer into Convex as `CLERK_JWT_ISSUER_DOMAIN` (step 1).
5. **Session token**: Sessions → Customize session token, add:
   ```json
   { "metadata": "{{user.public_metadata}}" }
   ```
   `proxy.ts` (Next.js middleware) reads `metadata.mustChangePassword` from it to redirect before any page loads.
6. **Webhook**: add an endpoint `https://<CONVEX_SITE_URL>/auth` with events `user.created`, `user.updated`, `user.deleted`, `session.created`. Copy its signing secret into Convex as `CLERK_WEBHOOK_SIGNING_SECRET`. `user.updated` is what clears the password flag in Convex after someone sets their own password, so this step is required before anyone signs in.
7. Keep the production **secret key** (`sk_live_...`) and **publishable key** (`pk_live_...`) for steps 3 and 4.

---

## 3. Vercel (Next.js) production env

Set these on the Vercel project's Production environment (names only):

- `NEXT_PUBLIC_CONVEX_URL` = the prod `.convex.cloud` URL
- `NEXT_PUBLIC_CONVEX_SITE_URL` = the prod `.convex.site` URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_live_...`
- `CLERK_SECRET_KEY` = `sk_live_...` (server only; the change-password server action uses it)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` (same values as dev: `/sign-in`, `/sign-up`, `/home`, `/home`)

Deploy the app. Check: opening `/home` signed out goes to `/sign-in`.

---

## 4. Seed the people (staff accounts)

The seed creates each person's Clerk account with a unique random temporary password, flags it so they must set their own on first sign-in, and adds their Convex user, team membership, roles, phone and team photo email. It also writes Sarah's owner phone menu as a **draft** (not live). Code: `scripts/prod/seedPeople.mjs` and `convex/prodSeed.ts`. Example input: `scripts/prod/people.example.json`.

1. Get the real input file `scripts/prod/people.local.json` from the project owner (see section 4a). It is git-ignored (`scripts/prod/*.local.json`) and must never be committed. Its shape is `people.example.json`.
2. Check it offline (nothing is created, nothing is sent): `node scripts/prod/seedPeople.mjs plan --input scripts/prod/people.local.json`
3. Run it against prod. The Clerk key comes only from the environment. The output file must be outside the repo and must not exist yet:
   ```sh
   CLERK_SECRET_KEY=sk_live_... node scripts/prod/seedPeople.mjs apply --target prod \
     --input scripts/prod/people.local.json --out ~/Desktop/518-temp-passwords.csv
   ```
   It refuses a test key with `--target prod`, a path inside the repo, or an existing file. Passwords go only to that CSV (mode 600). They are never printed, never stored in Convex, never committed.
4. The console lists each person's `users id` and the team id. Keep them for step 5.
5. Safe to repeat: a second run changes nothing. An existing account keeps its password unless you pass `--reset-password email1,email2`.
6. People without an email are **not** created (a login needs one). They are listed at the end. When their email arrives, add it to the file and run again.
7. Hand each temporary password over in person or by phone, never by email or text. Delete the CSV once everyone has signed in.

### 4a. The real people (input for step 4)

The real contact details (names, emails, phones, the phone menu) are **not in this repo**, because the repo is public. They are in `scripts/prod/people.local.json` (git-ignored, kept on the project owner's machine only). Ask the project owner for it.

Shape: 2 admins, 3 asset managers (Gold, Silver, Make Up; the Make Up one is also the accountant), 10 technicians, and Sarah's owner phone menu with 5 keys (admin 1, admin 2, Silver, Gold, Make Up/Accounting). People without an email yet are listed with `"email": null` and are skipped until it arrives. `orgName`: `518 Property Pro`.

---

## 5. Import the properties and units (fresh from the Google Sheet)

Production data comes **from the live Google Sheet**, never copied from dev.

1. Download the current sheet to `docs/rosters/518-unit-rosters-normalized.xlsx` (the importer's local mirror), so the import is the sheet as it is today.
2. Importer: `scripts/roster/import_roster.py` (mapping in `convex/rosterMapping.ts`). It runs one tab at a time, with the team id from step 4 as `--org` and that team's asset manager's users id as `--asset-manager`: Gold → Nina, Silver → Nikki, Make Up → Delia. Do `dry-run`, then `apply`, then `verify` for each tab.
3. Owners: `scripts/owners/import_owners.mjs` (`dry-run`, then `apply`). Owners come from the roster columns (`properties.ownerName` / `ownerEmails`), never from the Rental Owners PDF.
4. **Blocker:** both importers deliberately refuse anything but the dev deployment in `.env.local` and never pass `--prod`. Running them on prod needs a guarded prod mode added on purpose (see the open question in the hand-off). Do not edit `.env.local` to trick them.

After the import:

- Photo emails: `npx convex run --prod photoEmails:seedDefaults '{"dryRun": true}'` should report `kept_existing` for all three teams (the seed already set them). Run without `dryRun` only if one shows `would_set`.
- Tour staff: nothing to seed. A team with no saved list uses its asset managers. Check Team → Lead routing → Tour staff shows Nina (Gold), Nikki (Silver), Delia (Make Up).
- Time zone: an admin sets it on the Availability page (`America/New_York`). Tour booking stays capture-only until it is set.

---

## 6. ElevenLabs production agent

1. Use a **separate ElevenLabs workspace (or account) for production**. The post-call webhook is set per workspace, so a shared workspace would send production calls to one deployment's webhook only.
2. In that workspace, set the post-call webhook to `https://<CONVEX_SITE_URL>/webhooks/elevenlabs/post-call` and copy its secret into Convex (`ELEVENLABS_POST_CALL_WEBHOOK_SECRET`).
3. Create the agent and its tools: `npx convex run --prod agents:ensure '{"orgId":"<team id>","userId":"<Pat users id>"}'`. It also runs by itself the first time an admin signs in (Clerk `session.created`). Then check with `npx convex run --prod agents:listForOps`.
4. Open `/sarah` as Pat, review everything, and save. Saving publishes the config and pushes it to the agent. No simulations or test calls without Pat's and the owner's OK (they cost credits).

---

## 7. Twilio number

1. Decide which number production answers on. Today the 518 number serves dev. Moving it to production takes it off dev.
2. In ElevenLabs (prod workspace) → Phone numbers, import the Twilio number and assign it to the production agent.
3. In Twilio, set the number's messaging webhook to `https://<CONVEX_SITE_URL>/webhooks/twilio/sms` (POST). Set `TWILIO_SMS_FROM_NUMBER` in Convex.
4. A2P 10DLC: the "518 Property Pro" campaign must be registered on this number before any text is sent (prefix and STOP line are already in `twilioApi.ts`).
5. Do **not** switch the client's main office forwarding to this number until go-live.

---

## 8. Google Calendar OAuth

Add `https://<CONVEX_SITE_URL>/google/oauth/callback` as an authorized redirect URI on the production OAuth client, and keep `/privacy` and `/terms` reachable (they are public routes).

---

## 9. Verification checks (before go-live)

Run each one and tick it off.

- [ ] `npx convex env list --prod | sed 's/=.*//'`: every name from step 1 is there; `OUTBOUND_ENABLED` is **not**.
- [ ] Convex logs (Dashboard → Logs) show no errors after deploy; the three crons are listed.
- [ ] **Password gate.** Sign in as one seeded person with their temporary password. You land on "Set your new password", and typing `/dashboard` sends you back there. Wrong temporary password, too-short password, same-as-temporary password and a mismatched confirmation each mark their own field in red with a toast. After a good change you reach your dashboard, and a second sign-in does not ask again.
- [ ] Clerk → Users → that person: `public_metadata.mustChangePassword` is now `false`. Convex `users` row: `mustChangePassword` is `false`.
- [ ] **Outbound switch.** Trigger an emergency maintenance request on a test unit. The Convex logs show `[outbound] sms to +1518•••xxxx skipped (emergency_alert)`, and `notificationLog` shows `skipped`. Nobody's phone rings. Resend and Twilio dashboards show no sends.
- [ ] Roles: Pat and Alex see the admin view; Nina, Nikki and Delia see their units; Delia also sees finance; a technician sees only `/tech`.
- [ ] `/sarah` → Routing directory shows keys 1–5 as in `people.local.json` and the menu is **off**.
- [ ] A test call to the Twilio number reaches the production agent; the call appears in the dashboard (post-call webhook works).
- [ ] Owner statements, payments and leases show only data imported in step 5.

---

## 10. Must stay OFF until go-live

| Switch | Where | State until go-live |
|---|---|---|
| `OUTBOUND_ENABLED` | Convex env (prod) | **Unset.** Blocks every SMS, WhatsApp, email and staff transfer call, including crons (lease follow-ups), notifications, invites, password-reset notes and transcripts. When it is off, each skip is logged with the recipient masked and nothing fails. Turn on with `npx convex env set --prod OUTBOUND_ENABLED true` |
| SMS template allowlist | `SMS_ALLOWED_TEMPLATES` / `SMS_TECHNICIAN_ENABLED` in `convex/twilioApi.ts` | Unchanged: only `emergency_alert`. Technician texts stay off. Even with `OUTBOUND_ENABLED=true`, only allowlisted texts go |
| Owner call routing menu | `/sarah` call type "Owner call routing menu" + routing directory switch | Off. The seed writes the directory as a draft only |
| Main office forwarding | Client's carrier | Not pointed at Sarah's number |
| WhatsApp (WAHA) | `WAHA_*` env | Unset |
| Clerk sign-up | Clerk prod instance | Restricted |
| ElevenLabs tests/simulations | ElevenLabs | None without explicit OK (credits) |

Go-live, in order: Pat and Alex approve → set `OUTBOUND_ENABLED=true` on prod → send one emergency test to Pat only → switch the office forwarding.

---

## Notes for developers

- **Dev and `OUTBOUND_ENABLED`.** The switch is in the code for every deployment, so dev is blocked as well while the variable is unset. To make dev send exactly as before: `npx convex env set OUTBOUND_ENABLED true` (dev). Dev holds real owners and tenants, so think twice before you do.
- **Password gate layers.** `proxy.ts` (session claim) → `components/password-gate.tsx` (Clerk metadata + `users.passwordGate`) → `convex/authz.ts` (every data function, via `currentUser` / `requireUserId` / `requireOrgId`). The flag is cleared only by `app/change-password/actions.ts` (server action, Clerk Backend API) and mirrored to Convex by the Clerk webhook.
- **Re-flag someone** (forgot password, new temporary one): `node scripts/prod/seedPeople.mjs apply --target prod --input ... --out <new file> --reset-password their@email`.
