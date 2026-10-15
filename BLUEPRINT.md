# Discord AIO Bot + Dashboard Blueprint

## 1. Project goal

Build a polished, highly customizable, single-server Discord bot with a web dashboard. The bot should replace a pile of separate utility bots without replacing the human staff or the server's personality.

This project is **one main Discord bot for one Discord server** with up to two OPTIONAL additional music-only bot identities, allowing at most three concurrent voice rooms. Do not build a fleet, cluster manager, multi-server control plane, worlds, or sharding dashboard. Keep the code modular, but do not waste development time on unneeded infrastructure.

The bot should feel like a combination of the strongest parts of Mimu, Dyno, Carl-bot, UnbelievaBoat, Elphony-style music bots, Ticket Tool, and Honeypot, while keeping a consistent UX and a much cleaner dashboard.

### Core product principles

1. **Slash commands are the primary interaction model.** The dashboard is for heavy configuration, builders, history, logs, and settings.
2. **Human staff remain central.** Do not automate moderation judgment just because it is technically possible.
3. **Every major module is toggleable.** Disabled modules should stop registering/serving their commands and background behavior where practical.
4. **One shared component system.** Embeds, variables, actions, permissions, logs, and templates should be reusable across modules rather than reimplemented separately.
5. **Good defaults first, advanced controls second.** The dashboard should not look like aircraft maintenance software.
6. **Accessible and responsive UI.** Keyboard navigation, proper labels, sensible contrast, reduced-motion support, and mobile layouts are required.
7. **No economy module.** Economy was considered and explicitly dropped.
8. **No profiles/achievements system.** Leveling exists, but do not turn the bot into an RPG.

---

## 2. Environment, scope, and owner information

**One configured Discord guild, one main application, up to three concurrent music-player identities (main bot + two OPTIONAL music-only bots).** The optional music bots are NOT a fleet, sharding architecture, worlds, clusters, or separate dashboard instances. All configuration and queues live in one application/database. Only the main bot exposes slash commands and the dashboard. A single `TOKEN` is sufficient to run the initial setup and one music player.

The repository includes a root `.env` for local development, with `TOKEN=bottoken` as a placeholder, plus a safe `.env.example`. Existing real secrets must never be overwritten, printed, committed, or sent to the browser. The coding agent must ask for missing real credentials only when a live integration cannot be configured otherwise, and complete the surrounding code independently.

Developer/owner Discord user ID: `1080222698443124797`. Owner-only diagnostics may use it. All normal dashboard settings require Discord OAuth and a server-side check of the user's administrator permission in the ONE configured guild; knowing the ID alone does not grant ordinary access.

Environment variable contract (see `.env.example` for the annotated canonical list):

```env
TOKEN=bottoken
GUILD_ID=
OWNER_DISCORD_USER_ID=1080222698443124797
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=
PUBLIC_BASE_URL=http://localhost:3000
AUTH_SECRET=
DATABASE_URL=
MUSIC_BOT_2_TOKEN=
MUSIC_BOT_2_CLIENT_ID=
MUSIC_BOT_3_TOKEN=
MUSIC_BOT_3_CLIENT_ID=
LAVALINK_URL=
LAVALINK_PASSWORD=
LAVALINK_SECURE=false
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
AI_ENCRYPTION_KEY=
GOOGLE_API_KEY=
AI_DEFAULT_MODEL=gemini-3.5-flash-lite
AI_ESCALATION_MODEL=gemini-3.8-flash
AI_MONTHLY_TARGET_USD=10
```

Optional providers and backup keys are primarily configured in the owner-only dashboard and encrypted at rest using `AI_ENCRYPTION_KEY`; `GOOGLE_API_KEY` can optionally bootstrap the primary provider. Do not store readable secrets in a frontend bundle, database plaintext field, client log, or audit event. `.env` is local-only; production secrets should be injected through the deployment secret manager. The app should display Not Configured where an optional secret/service is absent.

---

## 3. Reference projects and licensing rules

Use these as references, not as an excuse to blindly merge unrelated codebases.

### Preferred base/reference

- KevinNovak/Discord-Bot-TypeScript-Template  
  https://github.com/KevinNovak/Discord-Bot-TypeScript-Template  
  License: MIT  
  Use as the preferred structural starting point if this repository is still empty or close to empty.

- barthofu/tscord  
  https://github.com/barthofu/tscord  
  License: MIT  
  Architectural inspiration only where useful. Good concepts include modular handlers, guards, typed localization, schedulers, structured logging, migrations, and separation between bot logic and external services. Do not force the project into TSCord's framework if the base architecture does not need it.

### Reference-only because of copyleft licensing

- TFAGaming/DiscordJS-V14-Bot-Template  
  https://github.com/TFAGaming/DiscordJS-V14-Bot-Template  
  License: GPL-3.0  
  Do not copy substantial code into this project. Study concepts only.

- RiskyMH/honeypot  
  https://github.com/RiskyMH/honeypot  
  License: AGPL-3.0  
  Do not copy implementation code. Reimplement the general honeypot-channel concept independently.

### Product behavior references

- Mimu docs: https://docs.mimu.bot/
- Dyno docs/site: https://dyno.gg/
- Carl-bot docs/site: https://carl.gg/
- UnbelievaBoat docs/site: https://unbelievaboat.com/

When borrowing MIT-licensed source code, preserve required license notices. When referencing GPL/AGPL projects, copy ideas and behavior only, not code.

---

## 4. Recommended stack

Use a modern TypeScript stack with as few moving parts as practical.

### Runtime and package management

- Node.js 24 LTS or the current supported LTS at implementation time
- TypeScript with strict mode
- pnpm workspaces
- discord.js v14

### Web dashboard

- Next.js, current stable version
- React
- Tailwind CSS or equivalent utility styling
- shadcn/ui is acceptable as a component base, but the final UI should not look like an untouched shadcn starter
- Auth.js or another reputable OAuth library for Discord OAuth
- Zod for runtime validation

### Database

- PostgreSQL
- Prisma ORM and migrations, unless the existing repository already has a mature typed DB layer
- Never use YAML/JSON files as the main persistent database

### Testing and quality

- Vitest for unit/integration tests
- ESLint
- Prettier
- TypeScript typecheck

### Deployment

- Docker Compose is preferred for local and VPS deployment
- Separate long-running bot process and web process
- PostgreSQL service
- Optional Lavalink service for music
- Health endpoints for bot/web where practical

Do not add Redis unless a real requirement emerges. This is currently a single-guild system, even with up to three music-player identities, and should not be burdened with distributed-system machinery by default.

---

## 5. Repository layout

A monorepo is preferred:

```text
apps/
  bot/
    src/
      commands/
      events/
      modules/
      interactions/
      services/
  web/
    src/
      app/
      components/
      features/
      lib/
      api/
packages/
  db/
  core/
  discord-ui/
  variables/
  permissions/
  logging/
  config/
prisma/
  schema.prisma
AGENTS.md
BLUEPRINT.md
.env
.env.example
```

A module should expose services and small command handlers rather than putting business logic directly inside command files.

Example flow:

```text
/play -> PlayCommand -> MusicService -> QueueService -> PlaybackAdapter
```

Do not create 500-line slash command files.

---

## 6. Shared platform systems

These systems should be implemented once and reused everywhere.

### 6.1 Module system

Every major feature should have:

- module ID
- name
- description
- enabled/disabled setting
- required permissions/intents
- dashboard route
- optional commands/events registration
- health/config validation state

Minimum modules:

- music
- temporary voice channels
- embeds
- autoresponders
- leveling
- forms
- moderation
- tickets
- welcome/goodbye
- verification
- role panels
- honeypot
- AI helper

Economy is intentionally absent.

### 6.2 Permission service

Centralize permission logic.

Roles/categories to support conceptually:

- server admin
- staff/moderator
- music staff bypass (no separate DJ role)
- ticket staff
- bot developer/owner
- normal member

Dashboard access requires Discord OAuth and permission to manage the configured guild, `ADMINISTRATOR` in the single configured guild for editing. Store and check permissions server-side for each mutation. Never trust a client-side guild list without server-side verification.

### 6.3 Audit log

Record sensitive configuration and staff actions:

- who changed a setting
- old value/new value where reasonable
- timestamp
- guild ID
- module
- action

Do not log secrets, tokens, CAPTCHA answers, OAuth tokens, or AI API keys.

### 6.4 Saved embed/template system

Build one reusable Discord message-template engine.

Support:

- content outside embed
- title
- description
- color
- author text/icon
- footer text/icon
- thumbnail
- image
- timestamp
- fields
- buttons
- select menus
- links

Templates should be usable by:

- welcome/goodbye
- autoresponders
- ticket panels
- verification
- temp VC creation panel
- music panel
- level-up messages
- honeypot warning/logs
- forms notifications if later desired

### 6.5 Variable system

Use readable variables such as:

```text
{user}
{user.id}
{user.name}
{user.display_name}
{user.avatar}
{server.name}
{server.id}
{server.member_count}
{server.icon}
{channel}
{channel.id}
{channel.name}
{message.content}
{message.link}
{date}
```

`{user}` may render as a mention and therefore ping. `{user.name}` should not ping.

Support safe escaping and a preview mode in the dashboard.

### 6.6 Action engine

Reusable actions for autoresponders and future automations:

- send text
- send saved embed
- send to selected channel
- DM user where Discord permits
- add role
- remove role
- toggle role
- delete triggering message
- delete bot response after N seconds
- react to message
- write a log event

No economy actions.

Actions must pass permission and hierarchy checks before execution.

---

## 7. Dashboard UX

The dashboard should feel closer to Dyno's organization with a much more modern editor experience.

### Main navigation

- Overview
- Modules
- Music
- Temporary VCs
- Embeds
- Autoresponders
- Leveling
- Forms
- Moderation
- Tickets
- Welcome & Goodbye
- Verification
- Role Panels
- Honeypot
- AI Helper
- Logs / Audit
- Developer diagnostics, owner only

### Dashboard behavior

- Discord OAuth login
- Single configured guild
- Server-side guild permission verification
- Clear module enable/disable switches
- Good defaults
- Advanced sections collapsed by default
- Live Discord-style previews where useful
- Save state with validation and helpful errors
- Optimistic UI only where it cannot create dangerous mismatches
- Accessible forms and modals
- Reduced-motion preference respected

### Developer diagnostics page

If implemented, restrict to Discord user ID `1080222698443124797`.

Useful diagnostics:

- bot online/offline state
- gateway latency
- database health
- enabled modules
- command registration state
- recent application errors with secret redaction
- music/Lavalink health
- AI provider configured/not configured

Do not add a fleet or cluster manager. The Music page may show up to three optional music-player identities and their current voice rooms, but they share one guild and codebase.

---

## 8. Music module, V2 final contract

Build a polished slash-first music system, optionally serving **three simultaneous voice channels within the same guild**. Default player #1 is the main bot (`TOKEN`); optional `MUSIC_BOT_2_TOKEN` and `MUSIC_BOT_3_TOKEN` add player identities #2 and #3. Only the main bot registers public slash commands; music identities are controlled centrally via a shared music coordinator. Never implement the abandoned cluster/world control plane. Sessions are keyed by guild + voice channel and mapped to an available identity. If three players are busy, respond clearly rather than moving an existing room's player.

### Source and playback design

- `/play <query-or-url>` automatically selects the first/top search result. No five-choice prompt by default.
- At minimum accept YouTube search/URLs and Spotify / Apple Music links and playlists. Use legitimate service APIs/metadata resolvers where allowed; Spotify and Apple Music links provide metadata, not an entitlement to stream their DRM audio into Discord. Match to a licensed/permitted playable source and label substitutions transparently. If source resolution is unavailable, give a useful error, never claim playback succeeded.
- Provider abstraction around Lavalink and suitable maintained resolver extensions, subject to current technical/legal compatibility at implementation. Track playlist import progress and partial errors. Technical safety ceiling: 500 tracks per import (configurable by admins), even when temp VC per-user queue caps are disabled. Do not impose a general maximum track duration.
- Source adapters must be independently configurable/disableable. Gracefully display not-configured state when external audio sources cannot run.

### Commands, permissions, and queue

Support `/play`, `/queue` (`/q` if Discord command registration permits), `/history`, `/skip`, `/previous`, `/pause`, `/resume`, `/stop`, `/loop`, `/shuffle`, `/volume`, `/seek`, `/lyrics`, `/remove`, `/move`, `/clear mine`, `/queue search`; staff additionally get `/forceplay`, `/forceskip`, `/clear`, `/jump`, `/disconnect` and controls over any queue entry. Reasonable command group nesting is okay. Buttons, selects, and dashboard actions share these exact permission checks.

- One requester is recorded on every track; queue entries display title, artist/uploader, duration, source, position and requester. Duplicate tracks ARE allowed.
- Public rooms: normal user can add **at most 5 consecutive queued tracks**. This is a run-length rule, not five total tracks. A different requester's entry breaks the run; a subsequent run of five is permitted. Staff bypass it. Playlist adds queue only the tracks fitting the rule and report accepted/rejected counts. Check atomically to avoid racing enqueues.
- A normal user may remove/move their own queued tracks, and skip only their own currently playing song. Staff/administrators may manage/skip anybody's songs. No vote-skip and no separate DJ role. Staff can manipulate live queues from dashboard, including reorder by drag-and-drop.
- Temporary VCs have independent, unlimited-per-user queue sessions. Their queues are deleted with the temporary room lifecycle. They do not share state or Now Playing panel with public rooms.
- `/previous` ALWAYS attempts the previous track (not restart-current if elapsed time exceeds a threshold). Implement a session play-history cursor. `/seek 1:32` jumps to timestamp where source supports seeking. Audio filters (including EQ/speed/filter presets) are optional per-track/session controls, validated against backend capabilities.
- Loop states are off / one track / whole queue. Shuffle actually reorders pending tracks and preserves requester/limits metadata; never shuffle the playing song. No autoplay. When queue ends, playback stops; 24/7 connection mode is independently toggleable.
- Empty voice room: when last human leaves, **preserve the current track, queue and playback state** in persistent storage, then disconnect under ordinary mode. No arbitrary queue expiry. When listeners return, allow explicit `/resume` or `/play` to reattach to that room; best-effort restore playback position with fallback restart of track and visible notice if position cannot be restored. In 24/7 mode remaining connected is permitted. Recovery after process crashes/restarts must reconstruct sessions and queue, not silently flush them; never blindly autojoin an empty room.

### Persistent Now Playing panel and synced lyrics

- Store room/channel/message IDs and repair a missing panel on startup. For configured permanent music room, keep **one persistent message per session**. Temp VCs use the voice room's associated text chat/panel without creating extra server text channels.
- Panel shows album art (when available), title, artist/uploader, source, requester, duration, elapsed/remaining time, queue position, volume, loop mode, playback state, and a cute generated timeline/progress bar. Edit this one message about every **10 seconds** during playback (configurable within 5-15 seconds), coalesce edits and respect Discord rate limits. Do not post a fresh message every tick.
- Components: previous, pause/resume, skip, loop selector, shuffle, queue/lyrics buttons, and volume selector of 0%, 10%, ... 200% inclusive. Staff ownership rules apply to controls as well as commands. Ephemeral queue-added acknowledgments by default.
- `/lyrics` and a Lyrics button support time-aligned lyric lines synchronized with player position when legally available. Show current-line highlighting and advance reasonably without flooding channel edits. Fall back to nonsynchronized lyrics or a clear unavailable state; display source/attribution, do not hallucinate lyrics, and comply with lyrics provider licensing/usage limits. Do not embed copyright-violating bulk lyric storage in the repository. Image/lyrics/panel update APIs should handle missing data safely.
- Queue embeds and Now Playing template customization happen in dashboard with live preview. Component layout must fit Discord platform component and select-menu limits; paginate as needed.

### Playback workers and history

The main bot's TOKEN is music player #1. Additional two tokens are OPTIONAL and must be distinct Discord bot applications invited into the same guild. All identities use one orchestration process/code, shared permissions, shared PostgreSQL, and a compatible shared Lavalink service; do not make three dashboards or independent databases. Coordinator selects an existing player for the caller's current VC, otherwise assigns idle identity. Avoid cross-room control and release identity when leaving. A failure of one identity should not corrupt another room's queue.

Store track-play history and requester in PostgreSQL. Support `/history`, a configurable played-song log channel, and searchable dashboard history. Never implement a massive song blacklist; staff retain moderation control. No economy integration.

Music acceptance tests: first-result selection, Spotify/Apple metadata resolution fallback, five-in-row boundary and mixed playlists, duplicate allowance, requester-only skip, previous semantics, loop modes, queue persistence/disconnect/recovery, shuffle ownership metadata, 10s panel edit scheduling/rate limits, lyric time alignment, three independent concurrent sessions and capacity error.

---

## 9. Temporary voice channel module

### Creation panel

A pinned persistent embed/message should let users create temporary VCs.

Buttons/options:

- Public
- Private
- Friends Only
- Custom
- Presets

### Friends Only

Discord does not expose a user's friends list. Use a Discord user-select component and let the creator select one or multiple allowed server members.

### Presets

Admins can create named presets in the dashboard, for example:

- Gaming
- Study
- Music
- Chill

A preset may define sensible defaults such as user limit, bitrate, visibility, and naming template.

### Room customization

Allow the owner to manage:

- room name
- optional emoji in name
- user limit
- bitrate within guild limits
- lock/unlock
- hide/show
- allowed users
- transfer ownership
- kick member from the VC

Do not add permanent room bans. Owners can kick and lock.

### Lifecycle

- Temp rooms live inside one or more configured categories.
- The bot should move the creator into the new VC immediately.
- Do not delete a newly created room before the creator has a chance to be moved into it.
- Delete the temporary VC immediately when the last human leaves.
- Ignore bots when deciding whether a room is empty.
- Clean up its temporary music session and control state when deleted.

### Text controls

Prefer the voice channel's built-in text chat instead of creating a separate text channel for every VC.

Provide persistent controls/messages there for room management and music.

### Music integration

Each temporary VC has its own independent music session and queue.

The five-consecutive-song limit does not apply inside these temp rooms.

---

## 10. Embeds module

Use Mimu's usability as inspiration but improve the editing experience.

### Slash commands

Support commands such as:

```text
/embed create
/embed list
/embed show
/embed edit
/embed delete
/embed send
```

`/embed create` and `/embed edit` should use Discord buttons and modals for editing rather than requiring giant command strings.

### Dashboard editor

Build a Discohook-like visual editor with:

- live preview
- content
- title
- description
- fields
- author
- footer
- color
- image
- thumbnail
- timestamp
- buttons
- select menus
- links
- variables preview

Saved embeds are server-wide reusable components, not one-off messages.

---

## 11. Autoresponder module

### Trigger matching

Support:

- exact
- starts with
- ends with
- contains/includes
- regular expression as an advanced option

Regex handling must have length/time safeguards to avoid catastrophic patterns or ReDoS.

### Response types

- text
- saved embed
- random choice of responses
- shared action engine actions

### Settings

Per autoresponder:

- enabled
- trigger
- match mode
- response
- allowed/blocked channels
- allowed/blocked roles
- optional cooldown
- delete trigger message
- optional response auto-delete timer
- logging

The dashboard should make this visual. Do not force users to write function soup like `{requirerole:}{cooldown:}{addrole:}` unless an advanced raw syntax mode is later added.

---

## 12. Leveling module

Leveling is intentionally configurable but not an RPG.

### Dashboard options

- module on/off
- text XP on/off
- voice XP on/off
- XP cooldown
- XP range
- level formula/difficulty
- ignored channels
- ignored roles
- bonus XP channels
- bonus XP roles
- role rewards by level
- level-up notification on/off
- level-up channel
- custom level-up embed/template
- `/rank` on/off
- `/leaderboard` on/off
- user opt-out
- optional staff XP bypass/bonus settings

### Presets

Provide presets such as:

- Casual
- Active
- Competitive
- Custom

### Commands

Minimum:

```text
/rank
/leaderboard
/xp add
/xp remove
/xp set
/level set
```

Staff mutation commands must be permission protected and audited.

No economy/currency tie-in.

---

## 13. Public forms module

This should feel like a small Google Forms-style system built into the bot dashboard.

### Public behavior

- no Discord login required for respondents
- every published form gets a shareable URL
- administrators can optionally ask for Discord username and Discord user ID as normal form fields
- clearly understand that a typed Discord ID is **not verified identity** without OAuth

Do not automatically grant sensitive permissions or roles solely because a respondent typed a user ID. Staff can review and manually approve an action.

### Builder

Support at minimum:

- short text
- long text
- single choice
- multiple choice
- dropdown
- checkbox
- number
- date
- optional file upload only if a safe storage implementation exists
- required/optional
- descriptions/help text
- validation
- reordering
- sections if feasible

### Submission settings

Admins can configure:

- form title
- description
- theme/accent
- open/closed state
- custom closed message
- custom success/submission message
- whether responses may be edited after submission

### Edit-after-submit

If enabled:

- create a high-entropy random edit token
- store only a hash of the token in the database
- show the respondent a private edit URL on the confirmation page
- make the confirmation text customizable
- never expose edit links to other respondents

### Admin response dashboard

- response list
- response detail
- timestamps
- search/filter
- status such as New / Reviewing / Accepted / Denied / Archived
- private admin notes
- CSV export
- delete/archive with confirmation

No Discord review channel is required. The dashboard is the primary inbox.

---

## 14. Moderation module

The design goal is strong staff tooling, not staff replacement.

### Commands

Implement a clean set including:

```text
/warn
/warnings
/modhistory
/case view
/case edit
/case delete
/note
/timeout
/untimeout
/kick
/voicekick
/ban
/tempban
/softban
/unban
/purge
/slowmode
/lock
/unlock
/lockdown
```

Exact naming can be normalized during implementation, but the capabilities must exist.

### Required reasons

A reason is mandatory for:

- warn
- kick
- ban
- tempban
- softban

Other actions may accept an optional reason.

### Warning behavior

After a successful warn, show the user's updated warning total in the staff response.

Warn count is informational only. Do **not** automatically escalate because a user reached N warnings.

### Cases

Every meaningful moderation action should create an auditable case where applicable:

- case ID
- target user
- acting staff member
- action
- reason
- timestamp
- duration where applicable
- evidence/message link fields when supplied
- edits/history

### No automatic escalation

Do not automatically timeout, kick, or ban based on warning count.

### Automod

Automod may exist for obvious repetitive abuse such as:

- configurable slur/keyword filters
- spam/flooding
- repeated mentions
- obvious repeated-message spam

Default automated behavior should be conservative, for example delete/contain the violating message and alert staff. Do not silently create an aggressive autonomous moderation system.

Honeypot is a separate explicit exception because the user intentionally enabled a trap-channel module.

---

## 15. Tickets module

The ticket system should be intuitive and significantly easier to configure than Ticket Tool.

### Ticket panel builder

Dashboard should provide live Discord-style preview and let admins configure:

- panel title
- description
- color
- image
- thumbnail
- button labels
- button emojis
- ticket category/types
- opening questions
- role visibility/access
- naming templates

Support multi-button ticket panels such as:

- Support
- Report
- Appeal
- Other

Each button can have its own opening questions shown as Discord modals when possible.

### Ticket channel naming

Before staff responds:

```text
waiting-{user}
```

or a customizable equivalent.

The **first staff member who sends a message** becomes the initial handler and triggers a one-time rename using a template such as:

```text
{staff}-{user}
```

Important behavior:

- this initial name is permanent for the ticket lifetime unless staff manually renames it
- if another staff member later takes over, the channel name does **not** update to the new handler
- a takeover action may update internal handler metadata, but must not rewrite the historical first-responder naming

### Claiming

Do not build a restrictive claim system that blocks other staff from helping.

Other staff can always participate.

### Closing/reopening

- users cannot close their own tickets
- only staff can close
- closing revokes the opener's permissions to view the ticket
- only staff can reopen
- reopening restores the appropriate user access
- users cannot self-reopen
- no inactivity auto-close

### Useful controls

- close
- reopen
- add user
- remove user
- rename
- optional takeover metadata
- transcript/export

Transcripts should be stored or exported safely without leaking channels to unauthorized users.

---

## 16. Welcome and goodbye module

Use the shared saved-embed system.

Admins choose:

- welcome enabled/disabled
- goodbye enabled/disabled
- destination channel
- saved embed/template
- optional plain content around the embed

Variables allow either pinging or non-pinging content.

Examples:

```text
Welcome {user}!
Welcome {user.name}!
```

The first can mention/ping. The second should not.

Do not create a separate special-purpose embed editor just for welcome messages.

---

## 17. Verification module, finalized

Goal: simple accessible CAPTCHA, not VPN checks, invasive identity detection, fingerprinting, or automatic kicks.

### Role and visibility lifecycle

- On join assign configured `Unverified` role. Carefully configure Discord channel/category permission overwrites so it can see ONLY the configured verification channel and an admin-maintained allowlist of additional channels; validate effective role/channel permissions and avoid exposing hidden staff channels through another role.
- Admin chooses a reusable saved embed/template for a persistent **Verify** button panel. Persist panel IDs for restart/repair.
- Click Verify opens an ephemeral, signed, short-lived one-use verification URL bound to the clicking Discord member and the configured guild. A simple accessible CAPTCHA (Cloudflare Turnstile or equivalent) runs on that website, is verified server-side, and does not require another Discord OAuth login. Bind attempt/session, protect CSRF/replay, validate callback; never accept client-reported CAPTCHA success.
- Successful completion removes `Unverified`, adds `Verified`, confirms success on screen only (private in-Discord reply or the verify web page; no success DM, because Discord flagged the bot for unsolicited DMs on 2026-10-14), records timestamp/log, invalidates pending tokens and resets failure cycle. No user or role can close/open hidden channels solely based on untrusted form fields.
- Accounts created in the **last 3 days** are flagged in the configured verification log with a ping to a configured staff role; they are still allowed to verify. Do not block based on account age.
- No time limit to complete verification, **no kick** for inactivity, and no actual Discord timeout for failures.

### Failure cooldowns and staff controls

Track failed CAPTCHA verifications per user per guild. Allow 3 failures in a cycle, then impose a VERIFICATION-ONLY retry cooldown. Repeated failed cycles escalate: first 5 minutes, next 15 minutes, next 1 hour, subsequent 6 hours maximum. Show the next-allowed attempt time; during cooldown member remains Unverified but can use their other allowed channels. Set and enforce cooldown atomically server-side; rate-limit token issuance and validate session expiry. A success or staff reset clears the counter.

Dashboard: enabled toggle, role selectors, verification channel/allowlist, CAPTCHA key/config state, panel preview, staff-alert role, verification-log channel and log filters. Log join, successful/failed attempts (without answer/token), cooldown, under-three-day account alert, reset actions. `/verification reset @member` is staff only and removes Verified, assigns Unverified, clears existing cooldown/attempt tokens, and reopens verification. Log all staff resets.

Tests: gate effective visibility, under-3-day threshold, three-attempt cycling/escalation/cap, no Discord timeout or automatic kick, one-time signed link replay rejection, success DM failure fallback, idempotent role mutation, reset and log permission checks.

---

## 18. Role panel module

Combine Carl-bot style role panels with the flexibility of Mimu-style components.

Support:

- button roles
- select-menu roles
- reaction roles

Per option allow:

- role
- label
- emoji
- description where Discord supports it
- add/remove/toggle behavior

Per panel/group allow:

- exclusive selection, one role from group
- maximum selected roles
- prerequisite roles
- blocked roles
- logging
- custom embed/template

Role hierarchy and bot permissions must be validated before saving or applying changes.

---

## 19. Honeypot module

Reimplement the honeypot concept independently. Do not copy AGPL source from RiskyMH/honeypot.

### Behavior

Admins configure a trap channel that clearly tells normal users not to post there.

If a non-exempt user posts in the channel, configurable actions may include:

- delete message and alert staff
- kick
- softban
- ban

Because this is an intentionally enabled trap, automatic action is allowed here even though ordinary moderation does not use autonomous escalation.

### Configuration

- enabled/disabled
- honeypot channel
- action
- exempt staff roles
- exempt user IDs if needed
- log channel
- warning/embed template
- whether to delete the triggering message
- optional DM notification where appropriate

Use confirmation UI for destructive action selection in the dashboard.

---

## 20. AI helper, memory, context, provider, and billing contract

This module is optional, purely a helper, not moderation or an autonomous staff member. The AI can read ONLY channels explicitly selected for AI context and may send messages in exactly ONE configured output channel (`#ai-help` or custom). It never sends messages, reacts, or moderates in context-only channels. It does not read DMs and does not browse private staff channels unless deliberately enabled; even then, never disclose sources/content to people lacking access. Inform members of AI indexing and allow admins to exclude and purge channels.

### Triggers and reply rules

In the single designated AI response channel, activate on (a) direct bot mention, (b) whole standalone word `help`, (c) whole standalone word `apple`, (d) mention of role ID `1551266433604780221`. Triggers are case-insensitive, editable in dashboard, and use actual token/word boundaries (not `pineapple`); deduplicate when multiple triggers appear. Ignore bot/webhook/self messages and prevent self-loops. Optional `/ai ask` routes output to the AI channel; commands from elsewhere must not cause unsolicited output in that other channel. No conversational replies outside the one channel.

### Dashboard IA: Overview / Context / Memory / Providers

**Overview:** configured output channel, provider/model health, number of context channels, indexed records, summaries/pinned memories, indexing freshness, requests and estimated spend today/month, failures, last refresh, test query. Mark estimates as ESTIMATES rather than claiming authoritative Google billing.

**Context:** response-channel selector, trigger editing, explicit channel allowlist with per-channel switches for (1) searchable text, (2) attachments/images, (3) learned long-term memory vs search-only, (4) optional initial history depth, (5) citation priority. Private/staff channels OFF by default and require explicit confirmation before enabling; do not expose their contents in public AI answers. Add/remove channel, backfill/reindex, pause collection, forget channel. Respect changed channel permissions: delete inaccessible records and exclude them immediately. Only store data needed for search, attribution, and memory. For public responses, filter each retrieved source by the requester's current channel visibility and the output channel's visibility.

**Memory:** automatically learn project names, server vocabulary, documented decisions, commonly referenced terms, and inside jokes, but never treat a random joke or allegation as unquestioned fact. Keep recent AI conversation window, searchable indexed messages, rolling summaries, and compact longer-term memories. Each record has source message IDs/jump URLs, source channel, timestamps, confidence, status (proposed/learned/pinned/archived/superseded) and provenance. Admin can search, inspect citation, pin, edit, delete, archive, unpin, pause learning, export, purge memories, forget one channel, and re-index. Admin-pinned facts take precedence over inferred facts, while preserving history of superseded decisions. Handle deletion/edit of source Discord message by invalidating/reindexing and reevaluating derived memories. Do not build profiles of private or sensitive traits of members. Summaries and memories must be editable and auditable.

**Providers:** server-side encrypted BYOK UI supports Google Gemini as primary, plus OpenAI, Anthropic, OpenRouter and compatible alternatives where adapters are implemented. Provider/model dropdown, key setter (write-only after save), Test Connection, optional independent chat, extraction, embedding and vision models; one or more priority-ordered backup credentials/models. `AI_ENCRYPTION_KEY` protects stored secrets at rest, with rotation plan. Redact key values from browser responses and logs; no API keys available to ordinary server members. Provider failover happens on actual timeout/rate limit/provider errors, not to circumvent safety restrictions or intentional budget shutoffs. Persist request/provider usage and failure metadata without raw private secrets.

### Processing pipeline and provenance

- Only whitelisted channels are eligible. Ingest new/edit/delete events and optionally backfill approved history with rate-limit handling; store message ID, guild ID, channel ID, author ID, timestamp, content/attachment references, deletion state. Use Postgres text search/pgvector or a reasonably lightweight comparable index. Store snowflakes as strings.
- Do NOT send every posted message to Gemini. Generate/search embeddings within budget, retrieve relevant messages, summaries, pinned memories and a bounded recent AI conversation window on-demand. Summarize periodically and consolidate overlapping memories; avoid replaying the full server transcript on every prompt.
- Read/describe images when needed and permitted; don't blindly vision-analyze every attachment. Handle images, text/code, and supported docs with safe MIME/size limits, URL restrictions, attachment expiration, and provider capability checks. Never permanently mirror all images as a default.
- Sources in output should point to original Discord jump links when permitted: channel + author + date/message. Differentiate quoted source evidence vs AI-inferred summary vs admin-pinned fact. If no relevant sources, state uncertainty rather than fabricate citation. Only cite messages the requester can see. A deleted/inaccessible source must not remain retrievable.
- Treat user/server message text as untrusted data, never system instructions. Never allow retrieved text to request secrets, tools, extra permissions, channel writes, or prompt changes. No env/OAuth/admin notes sent to provider.

### Persona, privacy, and technical safeguards

One editable server persona/system prompt, with tone controls and preview/test. The AI can learn vocabulary but cannot become a staff impersonator or issue warns, kicks, bans, timeout, reports, Honeypot triggers, or automatic moderation. No background announcements outside configured AI channel. User-facing Q&A is effectively unlimited, but enforce quiet technical burst/concurrency/abuse limits to protect availability and spend, plus configurable monthly estimated-spend warning and stop/limit thresholds. Display when an API key, embedding model, or credit integration is not configured.

### Google credits and sensible defaults

User's credits: $10 MONTHLY Google Cloud credits from Google AI Pro / Google Developer Program, **subject to correct benefit redemption, linked GCP billing project, and credit eligibility**. They are not a raw Gemini app subscription token. Official program/explanation: https://blog.google/innovation-and-ai/technology/developers-tools/gdp-premium-ai-pro-ultra/ and https://ai.google.dev/gemini-api/docs/google-ai-plans . Do not promise that the key is funded until actual billing linkage is verified. Estimate local token costs based on up-to-date provider pricing rather than hardcoding 2026 pricing in business logic; official: https://ai.google.dev/gemini-api/docs/pricing . Default inexpensive everyday model `gemini-3.5-flash-lite`; optionally route harder questions to `gemini-3.8-flash` only when configured. The defaults are config, not frozen dependencies. Dashboard tracks estimated requests, input/output tokens, vision/extraction calls, errors, and current monthly local budget; show warning near $8 and optional low-cost-only/fallback near $9.50, with configurable hard limit. An app-level estimate is NOT guaranteed to prevent a Google billing overage; document Google Cloud budgets/alerts and provider-side controls separately. Do not automatically charge a backup account when hitting a deliberately configured hard cap.

AI acceptance tests: only configured channels ingested; output confined to one channel; correct four triggers incl role and whole-word behavior; permission-safe citations; deleted-source invalidation; pinned-vs-learned precedence; key never returned to browser; fallback order; spending guard; 3.5 Flash-Lite default; vision errors handled; jailbreak/prompt-injection isolation from indexed messages.

---

## 21. Database model guidance

Exact schema naming is flexible, but expected entities include:

- GuildConfig
- ModuleConfig or per-module settings
- SavedEmbed
- Autoresponder
- AutoresponderAction
- AuditLog
- MusicPlayerIdentity / MusicSession / MusicQueueEntry / MusicPlaybackCursor / MusicNowPlayingPanel
- MusicHistory / MusicLyricsCacheMetadata (subject to licensing)
- TempVoiceRoom / TempVoicePreset
- LevelProfile
- LevelRoleReward
- Form
- FormQuestion
- FormSubmission
- FormAnswer
- FormEditTokenHash
- ModerationCase
- ModerationNote
- TicketPanel
- Ticket
- TicketParticipant
- RolePanel
- RolePanelOption
- VerificationAttempt / VerificationCooldown / VerificationPanel
- HoneypotConfig
- AIChannelConfig / AIIndexedMessage / AIAttachmentReference / AIEmbedding
- AISummary / AIMemory / AIMemorySource / AIProviderEncryptedCredential / AIUsageLedger

Discord snowflakes should be stored as strings, not JS numbers.

Use indexes on frequently queried fields such as guild ID, user ID, channel ID, ticket status, form slug, and moderation case ID.

Use transactions for multi-step sensitive changes such as closing/reopening tickets, atomic music queue enqueue/room assignment, AI source purge, or consuming verification/edit tokens.

---

## 22. Discord intents and permissions

Enable only what is required.

Likely gateway intents include (main bot; music-only secondary bots should request only the minimal required voice/guild intents):

- Guilds
- GuildMembers for verification/role workflows
- GuildMessages
- GuildVoiceStates
- MessageContent for autoresponders, moderation filters, AI source-channel reading, and first-staff-message ticket handling

Because Message Content and Guild Members are privileged intents for larger bots, document this clearly even though the current bot is single-server.

Request only necessary bot permissions and surface missing-permission diagnostics in the dashboard.

---

## 23. Command UX standards

- Prefer slash commands.
- Use autocomplete for saved embeds, channels, roles, tickets, users, presets, and other DB-backed selections where appropriate.
- Use modals for multi-line or multi-field edits.
- Use ephemeral replies for private configuration/errors.
- Destructive actions require confirmation where reasonable.
- Error messages should explain what the user can do next.
- Commands should remain thin and delegate to services.

---

## 24. Security requirements

1. Never expose or log `TOKEN`.
2. Never store raw Discord OAuth access tokens unless the auth library requires it, and encrypt/limit retention if stored.
3. Use secure, HTTP-only, same-site cookies.
4. Use CSRF protections appropriate to the chosen framework.
5. Rate limit public forms, verification endpoints, login callbacks, and AI endpoints.
6. Hash edit tokens and one-time verification secrets in the database.
7. Validate all Discord IDs as snowflake strings.
8. Sanitize/validate URLs used for embed images and links.
9. Never trust client-provided role/channel IDs without checking they belong to the configured guild.
10. Check role hierarchy before role mutation or moderation action.
11. Secret-redact logs.
12. Avoid unsafe dynamic `eval` for variables/autoresponders.
13. Use bounded/safe regex handling.
14. Public form admin actions must require authenticated authorization.
15. AI prompts must not include `.env`, tokens, private dashboard data, or server channels outside the configured read list.

---

## 25. Accessibility requirements

Dashboard must include:

- semantic headings
- labels for all inputs
- keyboard-operable dialogs and menus
- focus indicators
- adequate color contrast
- status information not encoded by color alone
- reduced-motion support
- alt text or accessible labels for meaningful images/icons
- clear validation errors linked to fields
- mobile layouts that do not require precision tapping

---

## 26. Observability and reliability

Implement:

- structured logging
- startup config validation
- global Discord interaction error handler
- global process rejection/exception logging without hiding fatal errors
- database health check
- optional `/health` for web
- bot status/latency on owner diagnostics page
- error IDs users can provide to staff

Do not swallow failures and pretend commands succeeded.

For persistent panels such as music/temp-VC/verification/ticket panels, store message/channel IDs so they can be repaired or recreated after restarts. Queue and temporary VC lifecycle recovery must not rejoin/depend on deleted rooms.

---

## 27. Testing requirements

At minimum, write meaningful tests for:

- permission service
- variable rendering
- autoresponder match modes
- five-consecutive-song rule, partial playlist import, requester-only skip, previous behavior, persistence and three music identities
- temp VC deletion logic
- form edit-token generation/verification
- moderation reason requirements
- warning count updates
- ticket first-responder naming lock
- ticket close/reopen permission changes
- verification signed token consumption, escalating verification-only cooldown and under-three-day alert
- role-panel exclusive selection
- honeypot exemptions
- AI channel output restriction, trigger word boundary and role mention, deletion-safe context retrieval and citation permissions

Also run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Do not call the project complete while these are failing because of code defects.

---

## 28. Implementation order for an agent doing a large one-pass build

A capable coding agent may implement the project in one long run, but it should still build in dependency order internally:

1. Inspect repository and preserve existing work.
2. Establish workspace, shared config, lint/typecheck/test.
3. Add PostgreSQL + Prisma schema/migrations.
4. Add Discord bot bootstrapping and command registration.
5. Add web app + Discord OAuth + guild authorization.
6. Add shared module/permission/audit/embed/variable/action systems.
7. Implement modules one at a time behind feature flags.
8. Add persistent panels and recovery logic.
9. Add tests.
10. Run full lint/typecheck/test/build.
11. Fix failures.
12. Produce setup/run instructions and a concise implementation report.

“One pass” means one autonomous work session, not one giant unreviewable file or one mega-commit.

---

## 29. Explicit non-goals for this version

Do not implement:

- multi-bot fleet/world/cluster manager (optional music player identities #2/#3 are explicitly allowed, but NOT separate worlds)
- cross-server sharding dashboard
- economy/currency/shop/gambling
- user profiles/achievements system
- VPN detection
- invasive device fingerprinting
- automatic warn-count punishment escalation
- song blacklist database
- ticket inactivity auto-close
- user self-close or self-reopen of tickets
- verification automatic kick for noncompletion or real Discord timeout for CAPTCHA failures
- vote-skip, autoplay, separate DJ-role system
- permanent temp-VC user bans
- autonomous AI posting outside its configured AI channel

---

## 30. Definition of done

The project is done for this phase only when:

- bot boots and connects with `TOKEN`
- web dashboard boots
- Discord OAuth works
- configured guild admin can access dashboard
- owner diagnostics are restricted to user ID `1080222698443124797` if implemented
- PostgreSQL migrations work from a clean DB
- each planned module exists and can be toggled
- slash commands register successfully
- dashboard builders save and load correctly
- destructive permission flows are validated
- public forms work without Discord login
- edit-after-submit works when enabled
- temp VCs clean themselves up correctly
- ticket naming behavior matches this blueprint
- moderation reason rules match this blueprint
- main music bot and optional music players #2/#3 coordinate independently in same guild; queues persist on disconnect/crash and now-playing panel + optional synced lyrics behave as specified, or external service is clearly reported unconfigured
- AI module cannot speak outside its configured channel, cannot cite hidden/deleted messages, has editable context/memory/providers and actual four specified triggers
- verification is one-time and replay resistant; three attempts escalate verification-only cooldown (5m/15m/1h/6h cap), account age under 3 days logs and pings staff without blocking
- lint, typecheck, tests, and production build pass
- README includes local setup, environment variables, Discord Developer Portal intents/permissions, database migration steps, and deployment commands

If external credentials or services are unavailable, the implementation should still be complete structurally and the dependent module should show a clear disabled/not-configured state rather than being left as an unexplained TODO.
