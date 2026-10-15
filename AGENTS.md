# AGENTS.md

## Mission and reading order

Implement the single-guild Discord all-in-one bot and dashboard in `BLUEPRINT.md`. The blueprint is the product source of truth; read it **fully**, and inspect the existing codebase and git status before editing. `AGENT_PROMPT.md` is the handoff brief and `.env.example` is the canonical configuration contract.

Scope: ONE main Discord bot application (`TOKEN`) and ONE guild. Music can have up to TWO OPTIONAL music-only secondary identities (`MUSIC_BOT_2_TOKEN`, `MUSIC_BOT_3_TOKEN`), giving at most THREE simultaneous rooms under ONE coordinator/database/dashboard. These music identities do not justify implementing a fleet, world, cluster, sharding UI, or multiple guilds.

## Environment and secrets

- `.env` already has `TOKEN=bottoken` as an illustrative placeholder. Never assume this is a valid token or claim a successful Discord connection without a real one.
- Never print, commit, embed in browser, or overwrite actual `.env` credentials. Read variable **names** only when possible. Add missing names to `.env.example`; if absolutely needed, insert empty keys into a local `.env` without touching existing values.
- Required secret slots include `AUTH_SECRET`, Discord OAuth client secret, DB credentials, and `AI_ENCRYPTION_KEY` for dashboard BYOK. Do not generate/commit production secrets; show a secure local generation procedure instead. Treat optional music worker, Lavalink, CAPTCHA and provider credentials as optional with explicit Not Configured states.
- Developer Discord user ID: `1080222698443124797` for owner-only diagnostics. Normal web access requires Discord OAuth and server-side check of admin permissions in configured `GUILD_ID`.
- `AI_MONTHLY_TARGET_USD=10` reflects $10/month Google AI Pro Google Cloud benefit. Verify eligible billing project/credit application before claiming this funds Gemini API calls. Display LOCAL COST ESTIMATES as estimates, and never silently bypass a hard budget stop with a backup key.

## Engineering architecture

- TypeScript strict mode, discord.js v14, pnpm workspace (`apps/bot`, `apps/web`, shared packages), PostgreSQL and Prisma migrations unless established repository stack merits adapting instead.
- Thin slash handlers; domain logic in testable services. Shared module flag/permission/audit/embed/template/variables/action systems.
- One main application owns slash commands. Additional optional music identities only connect to voice via central coordinator. Playback/queue state keyed by voice channel; cross-room state isolation. Don't turn three music tokens into three independent codebases.
- Lavalink/audio-source adapters and legal provider metadata resolution. YouTube, Spotify and Apple Music support where permitted and configured; metadata link != unrestricted audio stream.
- One reusable visual embed builder across modules; dashboard should be polished, responsive, accessible, live-preview driven and simple for normal admins. Advanced options collapsed by default.
- Source-of-truth durable state stored in Postgres. Write migrations, indexes, transactions and explicit recovery behavior; do not replace DB with YAML/JSON or add Redis casually.
- Preserve any useful repo code and existing package conventions. If repo empty, preferred MIT structure reference: https://github.com/KevinNovak/Discord-Bot-TypeScript-Template . MIT architecture ideas: https://github.com/barthofu/tscord . Preserve license notices when copying substantial MIT code.
- GPL-3.0 https://github.com/TFAGaming/DiscordJS-V14-Bot-Template and AGPL-3.0 https://github.com/RiskyMH/honeypot are behavior-only references; never copy their source into this project without explicit change of licensing plan.

## Non-negotiable product invariants

- NO economy, profiles/achievements, multi-guild fleet/world/cluster, song blacklist, VPN detection, automatic warning-count escalation or inactivity ticket auto-close.
- Humans moderate: warns, kicks, bans (including variants) require reasons; show updated warn count, preserve cases and staff decision-making. Honeypot is separately opt-in with deliberately chosen trap actions.
- Staff-only ticket closing/reopening; user cannot close/reopen. First staff message sets the ticket's historical channel-name handler ONCE; takeover never renames it. Unclaimed format is waiting-user.
- Temp VCs only clean up after room lifecycle and last human leaving; own music state is removed on temp VC deletion. No persistent temp-room user ban; presets and permitted-user controls are customizable.
- Music: auto top search result; source metadata/resolution for YouTube/Spotify/Apple; duplicates allowed; public **max five consecutive songs per ordinary requester**, not five total; accept fitting subset of playlist; staff bypass and may alter every entry; temp queues bypass; no vote-skip, no DJ role, no autoplay. Normal user may skip only own song. Previous means prior track. Loop off/track/queue; shuffle pending queue. Queue survives empty-room disconnect and process crash. 24/7 mode optional. One persistent Now Playing panel per session, approximately 10-second progress bar updates within configurable 5-15 sec, volume 0-200% by 10, synced lyrics with graceful fallback. Main bot is music player #1; up to two optional music-only identities, centrally allocated.
- Verification: Unverified sees #verify plus explicit allowlist; simple accessible CAPTCHA; after third failure apply verification-only cooldown 5m then 15m then 1h then max 6h on further failed cycles. Never kick for noncompletion or Discord-timeout member for CAPTCHA failures. Account younger than THREE days triggers staff ping in verification log but remains allowed to verify. Success gives Verified, removes Unverified, DMs user if allowed; staff reset supported.
- AI: only selected AI-context channels are indexed and ONE configured AI output channel can receive messages. Trigger on @bot, whole `help`, whole `apple`, or role `1551266433604780221`; case-insensitive, no `pineapple`. AI is ONLY helper, never moderates. Context page allowlists channels; Memory page supports auto-learn, citation source links, pin/edit/purge/forget; Providers page offers encrypted BYOK, Google Gemini default inexpensive model, ordered backup credentials and budget controls; filter retrieval/citations by requester's actual visibility; delete/disable sources invalidates stored references. No leaks from hidden staff channels.
- Forms: public, no Discord login; optional one-use/private edit URL shown on configurable confirmation page; dashboard-only response review, no forced Discord-channel linkage.
- Welcome/goodbye, role panels, leveling, embeds and autoresponders reuse configurable templates and safe variables/actions.

## Security and operational constraints

- Never trust dashboard client role/guild IDs or state-changing requests; check server-side Discord access, role hierarchy, OAuth, CSRF, session cookies, request validation.
- Public forms use high-entropy edit tokens stored as hashes; verify signed one-time CAPTCHA sessions and expiry; sanitize URLs and uploads, rate-limit regex, forms, verification and AI.
- Do not log raw Discord/OAuth/API tokens, CAPTCHA secrets or answers, user private notes. AI-indexed Discord messages are untrusted data, never instructions; don't expose `.env` to model. Handle deletion and channel-permission changes. Optional image input must use bounded and authorized attachment handling.
- Protect stored AI provider keys with a server-only encryption key; never return stored keys to browser. Confirm billing/credit usage independently of app token-cost estimates; fallback must not evade budget locks.
- Music/player state and persistent component IDs must recover from restarts; never claim the bot is connected when external services or credentials are unavailable.

## Agent autonomy and completion contract

Carry out full implementation in a substantial autonomous run. Internally work in dependency order, use separate services/files, document minor assumptions in `DEV_NOTES.md`, and ask user only if essential security/licensing/destructive product decision blocks progress. Never ship fake feature implementations or misleading tests. For missing external creds, fully implement integration adapter, settings, failure state and focused tests without pretending live setup was performed.

Run and fix `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and clean DB migrations if feasible. Include tests for player allocation/limits, persistent queue/lyrics panel, verification cooldowns/account-age check, AI four triggers/privacy/retrieval/deletion, ticket rename lock, forms tokens and other blueprint domains.

Final report must separate implemented/tested behavior from unconfigured external integrations, list missing environment keys and portal intents, setup/migration commands, actual check outcomes and all deviations from the blueprint. Do NOT declare completion if compilation or tests fail for implementation reasons.
