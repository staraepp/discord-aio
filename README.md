# Discord AIO — single-server bot and dashboard

One Discord bot and one web dashboard for **one server**. Modules: music (up to three rooms), temporary voice channels, embeds, autoresponders, leveling, public forms, manual moderation, tickets, welcome/goodbye, verification, role panels, an opt-in honeypot and an AI helper.

- `apps/bot` — the Discord bot (discord.js v14). The only process that talks to the Discord gateway or changes anything in Discord.
- `apps/web` — the dashboard and public pages (Next.js). Changes that need Discord are queued to the bot.
- `packages/*` — shared config, database (Prisma/PostgreSQL), domain logic, permissions, message templates, variables and logging.

The product specification is [`BLUEPRINT.md`](BLUEPRINT.md). Assumptions and deviations are in [`DEV_NOTES.md`](DEV_NOTES.md).

> Nothing in this repository has been tested against a live Discord server, Lavalink node, Google AI key or Turnstile account. The code, tests and builds are verified locally; live integrations need your own credentials. See [What is verified](#what-is-verified).

---

## Requirements

- Node.js 24+ and pnpm 11 (`corepack enable`)
- PostgreSQL 16+ (17 recommended; Docker Compose file included)
- A Discord application for the main bot
- Optional: a Lavalink v4 node (for audio), up to two extra Discord applications (extra music players), Spotify API credentials, Apple Music developer token, Cloudflare Turnstile keys, a Google Gemini API key

## 1. Configure secrets

```bash
cp .env.example .env      # only if you don't have a .env yet — never overwrite an existing one
```

`.env` is git-ignored. Never commit it or paste its values into issues or chats. Generate secrets **locally**:

```bash
# AUTH_SECRET (dashboard sessions, OAuth state, CAPTCHA answer hashing) — 32+ random characters
openssl rand -base64 48
# AI_ENCRYPTION_KEY (encrypts AI provider keys at rest) — exactly 32 random bytes, base64
pnpm gen:secret            # or: openssl rand -base64 32
# POSTGRES_PASSWORD (Docker Compose database)
openssl rand -base64 24
```

Keep a secure offline copy of `AI_ENCRYPTION_KEY`. If it is lost, stored AI provider keys cannot be decrypted and must be re-entered. To rotate it, set the new key, bump `AI_ENCRYPTION_KEY_VERSION`, put the old one in `AI_ENCRYPTION_KEY_PREVIOUS` as `<oldVersion>:<base64>`, re-save each provider key in the dashboard, then remove the previous key.

Every variable is documented in [`.env.example`](.env.example). Missing optional integrations show as **Not configured** in the dashboard instead of failing.

## 2. Discord Developer Portal

### Main bot application
1. Create an application → **Bot** → reset/copy the token into `TOKEN`.
2. Under **Privileged Gateway Intents** enable **Server Members Intent** and **Message Content Intent**. (Presence intent is not needed.)
3. **OAuth2** → add the redirect URL `PUBLIC_BASE_URL + /api/auth/callback/discord`, e.g. `http://localhost:3000/api/auth/callback/discord` locally. Copy the client ID/secret into `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`, and set `DISCORD_REDIRECT_URI` to the same URL.
4. Set `GUILD_ID` to your server ID (Developer Mode → right-click server → Copy ID).
5. Invite the bot. After signing in, **Dashboard → Setup checklist** shows a ready-made invite link with exactly the permissions the modules need (scopes `bot applications.commands`). Permissions requested: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Manage Messages, Manage Channels, Manage Roles, Kick/Ban/Moderate Members, Move Members, Connect, Speak.
6. In **Server Settings → Roles**, drag the bot's role **above** every role it must assign (Verified/Unverified, level rewards, role panels, autoresponder role actions). The dashboard rejects roles the bot cannot manage.

Slash commands are registered **per guild** by the main bot only, and only for enabled modules (`/help` and `/modules` are always present).

### Dashboard access
Sign-in uses Discord OAuth with the `identify` scope only. The server then checks — with the bot token, never trusting the browser — that you have **Administrator** in `GUILD_ID`. The OAuth access token is revoked right after sign-in. `OWNER_DISCORD_USER_ID` additionally unlocks the owner-only Diagnostics page; it never replaces the admin check for normal pages.

### Optional music-only players (#2 and #3)
The main bot is music player #1. For up to three simultaneous rooms, create one or two more applications, put their tokens in `MUSIC_BOT_2_TOKEN` / `MUSIC_BOT_3_TOKEN` (and client IDs in `MUSIC_BOT_2_CLIENT_ID` / `MUSIC_BOT_3_CLIENT_ID`), and invite them with scope `bot` only and permissions View Channels, Connect, Speak (the Setup checklist has the links). They need no privileged intents and never register commands; the main bot allocates them automatically.

## 3. Database

```bash
# Local PostgreSQL in Docker (or use your own server and set DATABASE_URL)
docker compose up -d postgres
# DATABASE_URL for tools running on the host needs the port published — uncomment `ports` in docker-compose.yml,
# then: DATABASE_URL=postgresql://aio:<POSTGRES_PASSWORD>@localhost:5432/aio

pnpm install
pnpm db:migrate            # prisma migrate deploy — applies migrations, never drops data
```

`pnpm db:check` creates a temporary database, applies all migrations from scratch, checks for drift against `prisma/schema.prisma`, verifies the full-text-search trigger and drops only that temporary database.

## 4. Run

### Development
```bash
pnpm dev:bot               # bot with reload (tsx)
pnpm dev:web               # dashboard on http://localhost:3000
```
Stop with Ctrl+C. The bot shuts down gracefully: it saves music positions, closes voice connections and the database pool.

For UI work without Discord credentials you can set `DASHBOARD_DEV_LOGIN=true` (ignored when `NODE_ENV=production`) to get a local preview session. Discord-backed pickers then fall back to typing IDs.

### Production with Docker Compose
```bash
docker compose build
docker compose up -d postgres
docker compose --profile tools run --rm migrate      # apply migrations
docker compose up -d                                 # start everything in COMPOSE_PROFILES
docker compose logs -f bot                           # logs
docker compose stop                                  # stop (data is kept)
```
Which optional services run is set by `COMPOSE_PROFILES` in `.env` (`tunnel` for Cloudflare Tunnel, `music` for Lavalink).

**Publishing the dashboard with Cloudflare Tunnel (recommended).** No ports are opened on the server; `cloudflared` keeps an outbound connection to Cloudflare, which serves HTTPS for you.
1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared → name it (e.g. `discord-aio`).
2. Copy the token (the long value after `--token` in the install command) into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`. You don't need to run the install command; the `cloudflared` container uses the token.
3. **Public hostname**: subdomain `bot`, domain `prismshade.fun` (or yours), service type `HTTP`, URL `web:3000`. Cloudflare creates the DNS record itself; don't add an A record.
4. Set `PUBLIC_BASE_URL=https://<that hostname>`, `DISCORD_REDIRECT_URI=https://<that hostname>/api/auth/callback/discord`, `TRUST_PROXY=cloudflare` and `COMPOSE_PROFILES=tunnel` (plus `,music` if you use Lavalink).

`TRUST_PROXY=cloudflare` makes rate limits use the visitor IP Cloudflare reports. Only set it when the tunnel is the only way to reach the dashboard. Without a tunnel, put the dashboard behind an HTTPS reverse proxy instead (publish `127.0.0.1:3000:3000` in a compose override). Cookies are marked `Secure` automatically for https URLs.

Optional extra layer: a Cloudflare Access policy on the `/dashboard` path (allow only your email). Don't put Access in front of `/f/`, `/verify/`, `/api/public/` or `/api/auth/`; those must stay reachable.

Health checks: bot `GET http://<bot>:8081/health` (`BOT_HEALTH_PORT`), dashboard `GET /api/health`. Both report degraded instead of claiming success when Discord or the database is unavailable.

### Without Docker
```bash
pnpm build
pnpm db:migrate
node apps/bot/dist/index.js                              # bot
node apps/web/.next/standalone/apps/web/server.js        # dashboard (copy .next/static and public next to it, see Dockerfile)
```
Use a process manager (systemd, pm2) to restart on failure.

## 5. Optional integrations

### Music (Lavalink)
Audio is played through a Lavalink v4 node. Set `LAVALINK_URL` (e.g. `http://lavalink:2333` in Compose) and `LAVALINK_PASSWORD`. The included [`docker/lavalink/application.yml`](docker/lavalink/application.yml) loads the community YouTube source plugin — check its latest release and update the version before first start. Respect the terms of the platforms you play from.

- **Spotify/Apple Music links** are resolved to track metadata and matched to a playable source by search; the reply says when a substitute was used. Set `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` for Spotify. Single Apple Music tracks use Apple's public lookup; playlists/albums need `APPLE_MUSIC_DEVELOPER_TOKEN`.
- **Lyrics** use LRCLIB and are off until you enable them and acknowledge the provider terms in the dashboard. Lyric text is not stored.

### Verification CAPTCHA
By default verification happens inside Discord: **Verify** sends a private message with a picture code in an embed, and the member types it into a pop-up. Capital or lowercase both work, and members can switch to a plain-text math question if they can't read the picture. It needs `AUTH_SECRET` (used to hash answers). Optionally, choose Cloudflare Turnstile in Verification → Advanced (set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`); that opens a one-use web page instead, and the token is verified server-side. If Turnstile is selected but not configured, the picture code is used.

### AI helper (Google Gemini by default)
1. Set `AI_ENCRYPTION_KEY` (see step 1).
2. Create a Gemini API key in Google AI Studio (or a Google Cloud project with the Generative Language API enabled). Either add it in **AI helper → Providers** (stored encrypted; never shown again or sent to the browser) or set `GOOGLE_API_KEY` as a last-resort bootstrap key.
3. Default everyday model: `gemini-3.5-flash-lite`; harder-question model: `gemini-3.8-flash` (used only when escalation is enabled and the budget allows).
4. Enter current per-million-token prices in **Usage & budget** so the local estimate is meaningful. Prices are not hard-coded because they change.

**Google AI Pro $10 monthly credit.** `AI_MONTHLY_TARGET_USD=10` reflects the Google Cloud credit included with some Google AI Pro plans. Before relying on it:
1. Sign in to the Google Developer Program with the Google account that has the AI Pro subscription and claim the Google Cloud credit benefit there (if your plan includes it).
2. Make sure the credit is attached to the **Cloud billing account** of the project that owns your Gemini API key (Cloud Console → Billing → Credits).
3. Confirm in Billing → Reports that Gemini API charges are actually offset by the credit. Free-tier AI Studio keys and keys from other projects are not covered.

**Gemini free tier.** A free-tier key from Google AI Studio works too: set `AI_MONTHLY_TARGET_USD=0` and leave the model prices in **Usage & budget** empty or at 0, so the local estimate stays at $0 and the hard stop never triggers. The free tier has per-minute and per-day request limits; when Google says the limit is reached, the helper tells the member it hit the request limit and to try again later. **Privacy:** on the free tier Google may use prompts and responses to improve its products, and prompts include messages from the channels you let the AI index. Only index channels whose content you are comfortable sending on those terms, or use a paid (billing-enabled) key.

The dashboard's cost figures are **local estimates only** and cannot see your real bill. The hard budget stop pauses the AI at your limit; backup providers are never used to get around it. Set a budget alert in Google Cloud Billing as well.

## 6. Backup and restore

Everything durable lives in PostgreSQL. Secrets live only in `.env`.

```bash
# Backup (custom format, compressed)
docker compose exec -T postgres pg_dump -U aio -d aio -Fc > backup-$(date +%F).dump

# Restore into an EMPTY database (stop bot and web first)
docker compose stop bot web
docker compose exec -T postgres createdb -U aio aio_restore
docker compose exec -T postgres pg_restore -U aio -d aio_restore --no-owner < backup-2026-09-26.dump
# then point DATABASE_URL at aio_restore (or rename databases) and start bot/web again
```
Back up `.env` separately and securely (especially `AI_ENCRYPTION_KEY` and `AUTH_SECRET`). Test restores periodically. After a restore, run `pnpm db:migrate` to apply any newer migrations.

## 7. Quality checks

```bash
pnpm lint
pnpm typecheck
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres pnpm test
pnpm build
TEST_DATABASE_URL=... pnpm db:check
```
`TEST_DATABASE_URL` must point at a server where the test user may create databases. Each test run creates its own throwaway database, migrates it from scratch and drops only that database. Without it, database suites are skipped (and reported as skipped).

## What is verified

| Area | Status |
| --- | --- |
| Domain logic (queue rules, allocation, cooldowns, triggers, budget, permissions, templates, forms, tickets, …) | Unit + PostgreSQL integration tests |
| Migrations | Applied from an empty database, drift-checked |
| Bot | Type-checked, bundled; startup validation tested manually (fails fast on missing config) |
| Dashboard | Type-checked, production build; API security helpers unit-tested; smoke-tested against a real database (CSRF rejection, settings validation, encrypted write-only AI keys, owner-only diagnostics, public form submit/edit-link rotation, verification failure cooldown, success and link replay); every page rendered in a browser without runtime errors |
| Docker | `bot` and `web` images build; the `web` image was started and served health, login, form and verification pages |
| Discord gateway, slash commands, voice, Lavalink, Spotify/Apple, LRCLIB, Gemini/OpenAI/Anthropic, Turnstile | **Not live-verified** — implemented against the documented APIs, needs your credentials |

## Licensing and references

This project is [MIT licensed](LICENSE). Architecture ideas were taken from MIT-licensed templates (KevinNovak/Discord-Bot-TypeScript-Template, barthofu/tscord); no substantial code was copied. GPL-3.0 (TFAGaming/DiscordJS-V14-Bot-Template) and AGPL-3.0 (RiskyMH/honeypot) projects were used as behavior references only; none of their source is included.
