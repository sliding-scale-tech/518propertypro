# WAHA — self-hosted WhatsApp for Leaseline

WAHA (`devlikeapro/waha`) is an unofficial WhatsApp HTTP API. It logs in the way WhatsApp Web
does — you scan a QR code with a real phone — and then exposes REST endpoints for sending and
a webhook for receiving.

## The one thing that trips everyone up locally

Traffic goes **both ways**, and only one direction works out of the box:

| Direction | Who calls who | Works locally? |
|---|---|---|
| Inbound | WAHA (your machine) → Convex `/wa/webhook` | ✅ Convex is public |
| Outbound | Convex cloud → WAHA `/api/sendText` | ❌ **Convex cannot reach your localhost** |

So the bot will *receive* messages but silently fail to *reply* until WAHA has a public URL.
Fix it with a tunnel:

```bash
ngrok http 3001
# -> https://something.ngrok-free.dev
npx convex env set WAHA_BASE_URL https://something.ngrok-free.dev
```

Free ngrok URLs change every restart, so re-run `convex env set` each time. On the VPS this
problem disappears — WAHA has a real address and `WAHA_BASE_URL` stops changing.

## Local setup

```bash
cp .env.example .env          # then edit: openssl rand -hex 16 for WAHA_API_KEY
docker compose up -d
docker compose logs -f waha   # watch for "WhatsApp API is running"
```

Then set the same values on the Convex deployment, so the backend can talk to WAHA and can
verify the webhook is genuinely from WAHA:

```bash
npx convex env set WAHA_API_KEY  <same value as .env>
npx convex env set WAHA_BASE_URL <your ngrok https url>
```

Now open the dashboard's **WhatsApp** page and click Connect. A QR code appears — scan it from
the phone whose number the bot should use (WhatsApp → Linked devices → Link a device).

WAHA's own dashboard at <http://localhost:3001> is useful while debugging: it shows session
state and the raw webhook payloads.

## Use a spare number

WAHA is not an official WhatsApp API — it drives WhatsApp Web. Numbers running automation on
it can get banned. Use a cheap spare SIM, not a personal or business-critical number.

## Putting this on a VPS that is already running something else

### 1. Survey before you touch anything

```bash
scp vps-inspect.sh user@your-vps:~/
ssh user@your-vps 'bash vps-inspect.sh'
```

It changes nothing — it only reports. Read the output before removing anything. What matters:

- **Is port 3001 free?** If not, set `WAHA_HOST_PORT` in `.env`.
- **How is the existing bot run?** Docker container, systemd unit, pm2, or a cron job. Each
  needs a different stop command, and stopping the wrong layer means it comes back on reboot.
- **How much free RAM?** If the box is already near its ceiling, WAHA will be OOM-killed, or
  will get the neighbour killed.
- **Is a reverse proxy already installed?** If nginx or Caddy is there, add a server block to
  it rather than installing a second one and fighting over port 443.

### 2. Stop the old bot properly

Find the layer first, then stop that layer. Stopping a container that systemd restarts, or a
process that cron re-launches, just wastes an hour.

```bash
# Docker container
docker stop <name> && docker rm <name>
# ...and if it came from a compose file, do it from that folder instead, or it returns:
cd /path/from/vps-inspect-output && docker compose down

# systemd service
sudo systemctl stop <name> && sudo systemctl disable <name>   # disable = won't come back on boot

# pm2
pm2 stop <name> && pm2 delete <name> && pm2 save

# cron
crontab -e        # comment the line out rather than deleting it, until you are sure
```

**Do not run these:**

```bash
docker system prune -a --volumes   # deletes every unused image AND every volume on the box
docker volume prune                # deletes volumes — including WhatsApp logins
```

They do not distinguish "mine" from "theirs". If you want the old bot's disk space back,
delete its specific image and volume by name.

### 3. Bring WAHA up

```bash
cd infra/waha
cp .env.example .env      # set WAHA_API_KEY, dashboard password, port if needed
docker compose up -d
docker stats leaseline-waha    # the real memory number, rather than a guess
```

### How this stays out of the way of your other scripts

Every one of these is a deliberate choice in `docker-compose.yml`, not a default:

| Concern | What stops it |
|---|---|
| `docker compose down` elsewhere killing WAHA | `name: leaseline-waha` scopes every command to this project only |
| WAHA eating all the RAM | `deploy.resources.limits` caps it at 1 GB / 1 CPU |
| A neighbour eating all the RAM | Same limits mean WAHA has a floor it cannot be squeezed below |
| Logs filling the disk and taking the whole box down | `max-size: 10m`, `max-file: 3` |
| Port collisions | `WAHA_HOST_PORT` is configurable, and bound to loopback |
| Another container reaching WAHA | Dedicated `leaseline-net` bridge, not the shared default network |
| A stray `docker volume prune` costing you a QR re-scan | Named volume `leaseline-waha-sessions`, not an anonymous one |
| The API key being exposed to the internet | Published on `127.0.0.1` only; the reverse proxy is the sole way in |

Nothing here writes outside its own project, so the old bot — or a new one you add later — is
unaffected either way.

### Reaching it from Convex

Convex runs in the cloud and has to call WAHA, so loopback alone is not enough: put a reverse
proxy in front and point `WAHA_BASE_URL` at the public HTTPS address.

The certificate question is covered separately — Let's Encrypt now issues certificates for
bare IP addresses (generally available since January 2026), but they are mandatory 6-day
certs, so renewal has to actually work. A free `sslip.io` hostname gets you normal 90-day
certs with no domain purchase and less to go wrong.

## Which engine, and why there is no browser

WAHA is a wrapper over several community WhatsApp libraries, and the engine you pick decides
how much server you need:

| Engine | How it talks to WhatsApp | Browser? |
|---|---|---|
| `WEBJS` (WAHA's default) | Puppeteer driving real Chromium | **Yes** |
| `WPP` | Puppeteer driving real Chromium | **Yes** |
| `NOWEB` | WebSocket, Node.js/TypeScript (Baileys) | No |
| **`GOWS`** ← we use this | WebSocket, Golang (whatsmeow) | No |

We set `WHATSAPP_DEFAULT_ENGINE: GOWS`, so **no browser runs at all** — not headless Chrome,
not Chromium, nothing. It is a Go program holding a WebSocket open to WhatsApp, the same
protocol WhatsApp Web uses, without the web page.

That matters on a small VPS: a Chromium instance per session is the single biggest thing that
would drive the RAM requirement up. Skipping it is why this fits comfortably on a cheap box.

The trade-offs of GOWS: no screenshot endpoint (a browser-only feature we do not use), and
webhook payloads are shaped differently from WEBJS — which is exactly why the webhook handler
parses defensively and logs anything it does not recognise.

WAHA publishes no official per-session RAM figures. Measure the real number once the container
is up rather than guessing:

```bash
docker stats leaseline-waha
```

## Known WAHA behaviour, and why the code looks the way it does

These are the things that cost real debugging time. All of them are handled in
`convex/wahaApi.ts` and `convex/http.ts`, with comments pointing back here.

**A dead session must be restarted, not started.** If a session is `FAILED` or `STOPPED`,
`POST /api/sessions/start` returns 422 and leaves it dead — the UI then polls forever for a QR
that never arrives. Check the status first and call `/restart` instead.

**422 on start means "already started".** Not an error; carry on.

**`@lid` senders.** WhatsApp is migrating to LID identifiers, so `from` can be
`123456@lid` rather than a phone number. Resolve it via `GET /api/{session}/lids/{jid}` which
returns `{ pn }`. If that fails, keep the **full JID** as the chat id — a bare LID number with
`@c.us` appended is undeliverable and replies vanish.

**Sending needs a suffix.** `chatId` must be `<digits>@c.us`, unless it is already a full JID.

**Skip `fromMe`.** The webhook fires for your own outgoing messages too. Without this filter
the bot replies to itself.

**Engine payload shapes differ.** GOWS, WEBJS and NOWEB do not agree on payload shape. The
webhook handler validates defensively and logs the raw body when it does not match, rather
than dropping the message silently.

**Everything is free now.** WAHA used to gate media, multiple sessions and storage behind a
paid "Plus" image. Since 2026.6.1 every one of those features ships in the free
`devlikeapro/waha` image and the paid tiers are gone — there is an optional $5/mo Community
subscription that buys nothing but supports the project. Ignore any older guide that tells
you to pull `waha-plus`.
