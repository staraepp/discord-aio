# Development notes: assumptions and deviations

Decisions made where `BLUEPRINT.md` left room, plus the places where the implementation differs from the blueprint. Nothing here changes a product invariant from `AGENTS.md`.

## Architecture

- **Single writer to Discord.** The dashboard never calls mutating Discord endpoints. It writes to PostgreSQL and enqueues a `DashboardCommand`; the bot claims commands with `FOR UPDATE SKIP LOCKED`, is woken by `LISTEN/NOTIFY` (with 5 s polling as fallback), and re-queues commands that were in progress during a crash. The dashboard waits up to ~8 s for a result and otherwise says the change is queued; it never reports success it did not observe.
- **Read-only Discord REST in the web app** (bot token, server-side only) for the admin check and channel/role pickers. Results are cached 30–60 s. When Discord cannot be reached, pickers fall back to typed IDs, which are still checked for format server-side and fully re-checked by the bot.
- **Ingress is Cloudflare Tunnel.** The `web` container publishes no ports; `cloudflared` (compose profile `tunnel`) is the only way in. With `TRUST_PROXY=cloudflare` the rate-limit IP comes from `CF-Connecting-IP`. Otherwise it uses `X-Real-IP` or the last `X-Forwarded-For` entry, never the client-supplied first entry.
- **Rate limiting is in-process** (one bot process, one web process by design). Running several web replicas would need a shared limiter.
- **Shared packages use extensionless relative imports** (`moduleResolution: Bundler`) so that Next.js/Turbopack, tsup and Vitest all resolve the TypeScript sources directly.
- Prisma 7 with the `prisma-client` generator and the `pg` driver adapter. The AI full-text-search column is a `tsvector` maintained by a trigger created in the initial migration.
- Local development used Node 26; the declared target is Node 24+.

## Security

- Dashboard sessions: random session row + HMAC-signed HttpOnly `SameSite=Lax` cookie, 12 h lifetime, revoked on logout. Administrator status is re-checked on every request (Discord data cached ≤60 s). OAuth scope is `identify` only, and the OAuth access token is revoked right after the user is identified.
- CSRF: mutations require a same-origin `Origin` header **and** the custom header `X-AIO-CSRF: 1`, plus a JSON body.
- `DASHBOARD_DEV_LOGIN` creates a preview session for user ID `0` and only works when `NODE_ENV` is not `production`. It never grants owner diagnostics.
- Built-in CAPTCHA answers are stored only as `HMAC(AUTH_SECRET, attemptId:answer)`. Verification link tokens and form edit tokens are stored only as SHA-256 hashes. Form edit links rotate on every save, so each link works once.
- AI provider keys: AES-256-GCM with a versioned server-only keyring; the API only ever returns provider, label, models and the last four characters.
- Private staff notes (moderation notes, form admin notes) are never copied into the audit log; only the fact that they changed.

## Music

- **"Five in a row"** is counted on the tail of the pending queue: an ordinary member may not have more than N (default 5) consecutive pending entries. Playlists add the subset that fits and say how many were skipped. Staff, and anyone queueing in a temporary room, bypass it.
- **Previous** moves the timeline cursor back one track. If playback has finished, it replays the last track.
- **Jump** (staff only) moves the chosen track to the front and skips to it; the rest of the queue keeps its order.
- Ordinary members can skip, pause, resume, seek and go back only while their own track is playing. The owner of a temporary room has staff-level music control inside that room.
- The dashboard's queue actions (reorder, remove, jump, clear) address tracks by ID, not position, so a stale page cannot hit the wrong track.
- Synced lyrics are shown in a separate message that is edited on the same 5–15 s cadence as the Now Playing panel, not word-by-word.
- Room emptied → as soon as the last human leaves, the queue and position are saved and the player disconnects (unless 24/7 is on); `/resume` or `/play` continues later. Deleting a temporary room deletes that room's music session.
- The Lavalink YouTube plugin version in `docker/lavalink/application.yml` (`1.18.2`, current as of 2026-09-26) should be kept up to date; YouTube changes often.
- `lavalink-client` and Discord voice behavior are implemented against their documented APIs but have not been exercised against a live node.

## Verification

- Each check is one-use, expires after 15 minutes by default, and a member may start at most 5 checks per 10 minutes. Starting a new one invalidates the previous one.
- Three wrong answers end a cycle and start a verification-only pause: 5 min, 15 min, 1 h, then 6 h for every further cycle. Members are never kicked or timed out. A staff reset clears everything.
- The default check happens inside Discord: pressing **Verify** sends a private (ephemeral) message with an embed showing a picture code. The member presses **Enter code** and types it into a pop-up. The code is 6 random letters/numbers (no 0/O/1/I/L), case-insensitive, drawn as warped strokes with noise lines and rendered to PNG by a small built-in rasteriser (Discord can't show SVG; no native image library needed). Members can get a new picture or switch to the plain-text math question at any time; switching does not count as a failed attempt, and new pictures are capped at 20 per 10 minutes per member. Only an HMAC of the answer is stored.
- Turnstile runs in a browser, so choosing it keeps the one-time web link flow.
- If Turnstile is selected but its keys are missing, the picture code is used. A Turnstile outage returns an error without counting as a failed attempt.
- Role changes after passing are applied by the bot. If the bot is offline, the success is recorded with `pendingRoleSync` and applied on startup.
- Passing never sends a DM. The private reply or the web page is the confirmation. On 2026-10-14 Discord quarantined the bot for "many unsolicited DMs in a short period" (60 to 80 success DMs an hour), and the Developer Policy forbids frequent unsolicited DMs. Do not add one back.
- Honeypot catches never send a DM either (removed on 2026-10-15 for the same reason; trapped accounts are mostly spam and report DMs). Staff learn about a catch from the log channel and moderation case.

## AI helper

- Retrieval uses PostgreSQL full-text search (`simple` configuration), not vector embeddings. This keeps the stack to PostgreSQL only; the retrieval layer is isolated if embeddings are wanted later.
- The bot computes, at question time, which context channels the **asking member** can currently view. Only those messages and memories whose every source is visible are used and cited. Channels hidden from `@everyone` need explicit confirmation before indexing.
- Deleted Discord messages are removed from the index and memories that depended on them are archived; edited messages re-open dependent memories for review.
- Model prices are admin-entered (none are hard-coded). Usage figures are local estimates; the hard stop is checked before every call, including fallbacks and dashboard test calls.
- Every AI answer starts with an "AI-generated answer" label and ends with "AI can make mistakes. Double-check important info." (`formatAiReply` in `packages/core/src/ai/prompt.ts`). This is fixed, not a setting. Long answers are cut and citations dropped first, so neither line is ever lost. The dashboard Test tab shows the same two lines.
- Bot copy style: plain, casual wording, no em dashes, no decorative emojis. A few of the owner's preferred emojis (😭🥹🥺😔😛😣😨🫩) are used sparingly. Model output has em dashes replaced, and the prompt asks for no emoji decoration.
- Model names `gemini-3.5-flash-lite` and `gemini-3.8-flash` come from the handoff brief and were not checked against a live key.

## Other modules

- **Autoresponders:** "contains" is a substring match (the blueprint didn't require word boundaries here; the AI triggers do use whole words). Use regex with `\b` for whole words. Regexes are screened for catastrophic patterns and executed with a 25 ms timeout.
- **Honeypot:** kick/softban/ban only run if an administrator explicitly confirmed that action in the dashboard (`actionConfirmedBy`); otherwise the bot falls back to delete + alert. Admins, staff roles, bots and exempt roles/users are never actioned. Every trigger creates a moderation case.
- **Moderation:** deleting a case hides it and removes it from the warning count; a deleted tempban still lifts on schedule. Automod only deletes/contains and alerts — it never warns, times out, kicks or bans.
- **Leveling:** the dashboard mirrors the presets from `packages/core/src/leveling` for instant feedback; the server re-validates on save. Keep them in sync if presets change. XP edits are done with `/xp` and `/level` in Discord so that reward roles are re-synced immediately.
- **Tickets:** transcripts are stored in the database (JSON) and viewable in the dashboard. Ticket channel name variables are `{user.name}`, `{staff.name}`, `{number}` and `{type}`.
- **Forms:** optional Turnstile on submission when configured, plus a hidden honeypot field and per-IP rate limits.
- **Suggestions:** `/suggest` and `+suggest` post through a bot-owned webhook in the suggestions channel so the post shows the member's name and avatar, with `User ID` in the footer. Without Manage Webhooks, or when Discord rejects the display name for a webhook, the bot posts the embed itself with the member as the embed author. The `+suggest` message is always deleted (`deletePrefixTrigger`), and the per-member cooldown lives in memory, so a restart clears it.

## Database backups

The `backup` compose profile runs `docker/backup/backup.sh`: a `pg_dump` in custom format shortly after start and then once a day, kept for `BACKUP_KEEP_DAYS` (default 14) in the Docker volume `pgbackups`. Deploys sync the code folder only, so they never touch the dumps.

- List backups: `docker compose exec backup ls -lh /backups`
- Copy one off the server: `docker compose cp backup:/backups/<file> ./`
- Restore (stop the bot and web first so nothing writes during the restore):
  ```sh
  docker compose stop bot web
  docker compose exec backup sh -c 'pg_restore --clean --if-exists -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" /backups/<file>'
  docker compose start bot web
  ```

## Process notes

- `prisma migrate reset` refused to run for an automated agent; it was not bypassed. Tests and `pnpm db:check` instead create and drop their own uniquely named databases.
- The initial migration was regenerated from the final schema during development (no deployed database existed yet).
