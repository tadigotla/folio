# Personal Live Events Aggregator — Build Proposal

A personal web app that pulls upcoming live events from multiple sources across six categories, organizes them into a unified schedule, lets you resolve conflicts when events overlap, and plays the chosen stream via embedded official players.

This document is a working brief intended to be handed to a Claude Code session. It is opinionated on purpose — every decision has a reason, and you can push back on any of them.

---

## 1. Guiding Principles

1. **Personal tool, not a product.** No auth, no users table, no polish beyond what you need. One operator: you.
2. **Narrow first, then widen.** Ship Phase 1 end-to-end before adding sources. A working slice beats a broad skeleton.
3. **Embed, don't restream.** The app never proxies video. It embeds official YouTube / Twitch / NASA / Explore.org players. This is both legal and simpler.
4. **Schedules lie.** Every event has a `last_checked_at` and is re-polled. Delays and cancellations are first-class states, not edge cases.
5. **UTC in storage, local in display.** Every timestamp stored as UTC ISO 8601. Displayed in America/New_York (Tampa). One conversion point.
6. **Idempotent ingestion.** Re-running a fetcher never creates duplicates. Events have stable IDs derived from `(source, source_event_id)`.

---

## 2. System Architecture

Three components, kept deliberately simple:

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Fetchers       │────▶│  SQLite DB   │◀────│  Web UI         │
│  (cron / loop)  │     │  events.db   │     │  (Next.js)      │
└─────────────────┘     └──────────────┘     └─────────────────┘
       │                                              │
       │ pulls from APIs                              │ embeds official
       │ and RSS/scrape                               │ players in iframe
       ▼                                              ▼
  External sources                            YouTube / Twitch / etc.
```

### 2.1 Stack

- **Runtime:** Node.js + TypeScript. One language across fetchers and UI.
- **Web framework:** Next.js (App Router). Single process serves UI + API routes + can host cron handlers.
- **Database:** SQLite via `better-sqlite3`. Single file, zero config, trivial to back up, more than enough for a personal tool.
- **Scheduler:** `node-cron` running inside a long-lived Next.js custom server, OR a separate `fetchers/` script triggered by system cron. Pick the second — cleaner separation.
- **HTTP client:** native `fetch`.
- **HTML parsing (for sources without APIs):** `cheerio`.
- **iCal parsing:** `node-ical`.
- **Dates:** `date-fns` + `date-fns-tz`. Avoid Moment.
- **UI:** Tailwind + shadcn/ui. Minimal component work.
- **State:** React Server Components for the schedule view; a small amount of client state for the "pick which stream" interaction.

### 2.2 Why not X

- **Why not Postgres?** Overkill for one user, one machine.
- **Why not a calendar library like FullCalendar?** The conflict-resolution UX is the whole point of this app and deserves a custom view, not a generic calendar grid.
- **Why not Python?** Fine choice, but keeping the fetchers and UI in one language removes a whole class of friction.

---

## 3. Data Model

Four tables. That's it.

### 3.1 `sources`

Registry of where events come from. Seeded once, edited rarely.

| column | type | notes |
|---|---|---|
| id | TEXT PK | e.g. `launch_library_2`, `explore_org_bears` |
| name | TEXT | Human label |
| category | TEXT | one of: `space`, `nature`, `sports`, `news`, `culture`, `philosophy` |
| kind | TEXT | `api` \| `rss` \| `ical` \| `scrape` \| `youtube_channel` |
| config | TEXT (JSON) | URLs, channel IDs, etc. |
| enabled | INTEGER | 0/1 |
| last_fetched_at | TEXT | UTC ISO |
| last_error | TEXT | nullable |

### 3.2 `events`

The core table. One row per distinct upcoming/live/past event.

| column | type | notes |
|---|---|---|
| id | TEXT PK | `${source_id}:${source_event_id}` — stable, deterministic |
| source_id | TEXT FK | → sources.id |
| title | TEXT | |
| description | TEXT | nullable, trimmed |
| category | TEXT | denormalized from source for fast filtering |
| starts_at | TEXT | UTC ISO, nullable for always-on cams |
| ends_at | TEXT | UTC ISO, nullable (often unknown) |
| status | TEXT | `scheduled` \| `live` \| `delayed` \| `ended` \| `cancelled` \| `unknown` |
| stream_kind | TEXT | `youtube` \| `twitch` \| `nasa` \| `explore_org` \| `generic_iframe` \| `external_link` |
| stream_ref | TEXT | YouTube video ID, Twitch channel name, iframe URL, etc. |
| thumbnail_url | TEXT | nullable |
| source_url | TEXT | link back to origin |
| last_checked_at | TEXT | UTC ISO |
| first_seen_at | TEXT | UTC ISO |
| raw | TEXT (JSON) | original payload for debugging |

Indexes: `(starts_at)`, `(category, starts_at)`, `(status)`.

### 3.3 `picks`

Your selections when multiple events compete for a timeslot. Lets the app remember what you chose to watch.

| column | type | notes |
|---|---|---|
| id | INTEGER PK | |
| event_id | TEXT FK | → events.id |
| picked_at | TEXT | UTC ISO |
| note | TEXT | optional |

### 3.4 `always_on`

Ambient streams that aren't scheduled events — bear cams, ISS feed, aquarium tanks. Surfaced separately in the UI as a "right now" rail.

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| title | TEXT | |
| category | TEXT | |
| stream_kind | TEXT | |
| stream_ref | TEXT | |
| thumbnail_url | TEXT | |
| notes | TEXT | e.g. "best in summer", "seasonal, Alaska" |

---

## 4. Sources — Phase 1 (ship this first)

Six sources, one per category. All chosen because they have real APIs or trivially parseable feeds. No scraping in Phase 1.

| Category | Source | Kind | Notes |
|---|---|---|---|
| Space | **Launch Library 2** (`ll.thespacedevs.com/2.2.0/launch/upcoming/`) | api | Free, no key. Covers NASA, SpaceX, ESA, JAXA, Rocket Lab, ISRO, CNSA. Gives `webcast_live`, `net` (launch time), and `vidURLs` with YouTube links. This one source covers most of your space needs. |
| Space | **NASA public calendar** | ical | Backup for non-launch events (spacewalks, press briefings). |
| Nature | **Explore.org** | scrape (light) | No public API, but their cam listing page is stable HTML. Treat all their cams as `always_on` entries, not scheduled events. |
| Sports | **TheSportsDB** (`thesportsdb.com/api/v1/json/`) | api | Free tier covers upcoming fixtures for major leagues. Doesn't include stream links — you'll pair each fixture with a manually-configured broadcaster note. |
| News/civic | **C-SPAN schedule** | rss | `c-span.org/rss/` has daily programming. |
| Culture | **NPR Tiny Desk + KEXP YouTube channels** | youtube_channel | Use YouTube Data API v3 `search.list` with `eventType=upcoming` and `eventType=live` against specific channel IDs. |
| Philosophy | **Curated YouTube channels** | youtube_channel | Same mechanism as culture. You maintain the channel list in `sources.config`. Example seeds: Sam Harris, Rupert Spira, Hoover Institution, Closer To Truth, plus any monastery / sangha channels you follow. |

**YouTube Data API note:** free quota is 10,000 units/day. `search.list` costs 100 units. That's 100 calls/day — plenty if you poll each channel every 15–30 min. You'll need a Google Cloud project and API key. Store in `.env.local` as `YOUTUBE_API_KEY`.

---

## 5. Sources — Phase 2 (add after Phase 1 works)

Only attempt these after Phase 1 is running reliably for a week.

- **SpaceflightNow** launch schedule (RSS) — cross-check against Launch Library 2 to catch delays faster.
- **Virtual Telescope Project** — scraped, for astronomy livestreams (eclipses, comets).
- **Twitch categories** — via Twitch Helix API, for esports, "Science & Technology", "Just Chatting" philosophy streams.
- **Cornell Bird Cams** — additional `always_on` entries.
- **Chess.com / Lichess** broadcast APIs — tournament coverage.
- **Met Opera / BBC Proms / Boiler Room** — likely scrape.
- **Sotheby's / Christie's** upcoming auction calendars — scrape.

Each Phase 2 source is a self-contained fetcher module and should be added one at a time.

---

## 6. Fetcher Design

Every source implements the same interface:

```ts
interface Fetcher {
  sourceId: string;
  fetch(): Promise<NormalizedEvent[]>;
}

interface NormalizedEvent {
  sourceEventId: string;     // stable per source
  title: string;
  description?: string;
  startsAt?: string;         // UTC ISO
  endsAt?: string;           // UTC ISO
  status: EventStatus;
  streamKind: StreamKind;
  streamRef: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  raw: unknown;
}
```

The orchestrator:

1. Loads enabled sources from DB.
2. For each, calls `fetch()` inside a try/catch. Failures are logged to `sources.last_error` but never crash the run.
3. For each returned event, computes `id = sourceId + ":" + sourceEventId` and does an `INSERT ... ON CONFLICT(id) DO UPDATE` — this is how re-polls catch delays and status changes.
4. Marks `last_fetched_at` on the source.
5. Runs a sweep: any event whose `starts_at` is more than 6 hours in the past and still `scheduled` gets marked `ended`.

**Cadence:**

- Space launches: every 10 min within 24h of start, every hour otherwise.
- YouTube channels (culture + philosophy): every 20 min.
- C-SPAN: every 2 hours.
- TheSportsDB: every 6 hours.
- Explore.org cam list: once a day (it barely changes).

Implement cadence as a `minIntervalMinutes` field on the source; the orchestrator skips sources fetched more recently than that. Then run the orchestrator every 5 minutes via system cron. Simpler than per-source schedulers.

---

## 7. The UI

Four views. Keep it tight.

### 7.1 Home — "Right Now & Next Up"

- Top strip: `LIVE NOW` — any event with `status = 'live'`, plus featured always-on cams.
- Below: next 6 hours, hour-by-hour. Each hour is a row. If the hour has ≥2 events, it becomes a **conflict card** (see 7.3). If it has 1, a normal card. If it has 0, it collapses.
- Category filter chips at the top: Space / Nature / Sports / News / Culture / Philosophy. Click to toggle.

### 7.2 Schedule — 7-day view

- Vertical list grouped by day (Today, Tomorrow, Wed, …).
- Inside each day, events sorted by `starts_at`.
- Overlapping events (within a 30-min window of each other) are visually grouped into a conflict card.
- Past events from today are shown but dimmed, at the bottom of Today's section.

### 7.3 Conflict card — the interesting UX

When two or more events overlap, show them side by side as tiles with:
- Thumbnail
- Title
- Source + category
- Start time (local) + relative ("in 12 min")
- Duration if known
- Two buttons: **Watch** (opens player view) and **Remind** (just highlights it as you approach the time)

The tile you pick is recorded in `picks`. Over time this gives you a personal history of what you chose, which is a nice dataset to have.

### 7.4 Player view

- Big embedded iframe (YouTube / Twitch / NASA / Explore.org).
- To the right on desktop (below on mobile): event metadata, a "now playing" label, and a small list of the *other* events currently live, so you can hop.
- A persistent "mini player" is overkill for v1 — skip it.

### 7.5 Always-On rail

A single horizontal strip at the bottom of Home showing ambient cams (bear cam, ISS live, coral reef). One click opens them in player view. These never appear in conflict cards — they're always available, so they'd pollute the schedule.

---

## 8. Embedding Cheat Sheet

```
YouTube:     https://www.youtube.com/embed/{videoId}?autoplay=1
Twitch:      https://player.twitch.tv/?channel={name}&parent={yourDomain}
                (locally: parent=localhost)
NASA:        https://www.youtube.com/embed/{NASA live video ID}
Explore.org: each cam page has an <iframe src="..."> — store that URL directly
             in stream_ref with stream_kind='generic_iframe'
```

Twitch's `parent` parameter is the one that trips people up — it must match the hostname the iframe is loaded from. For local dev, `localhost`. If you ever deploy, update it.

---

## 9. Project Layout

```
live-events/
├── package.json
├── .env.local                 # YOUTUBE_API_KEY, etc.
├── db/
│   ├── schema.sql
│   ├── seed-sources.sql       # seed the 6 Phase 1 sources
│   └── migrations/
├── src/
│   ├── lib/
│   │   ├── db.ts              # better-sqlite3 singleton
│   │   ├── time.ts            # UTC↔local helpers, all date logic here
│   │   └── types.ts
│   ├── fetchers/
│   │   ├── index.ts           # orchestrator
│   │   ├── launch-library.ts
│   │   ├── nasa-ical.ts
│   │   ├── explore-org.ts
│   │   ├── sportsdb.ts
│   │   ├── cspan-rss.ts
│   │   └── youtube-channel.ts
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Home
│   │   ├── schedule/page.tsx
│   │   ├── watch/[id]/page.tsx
│   │   └── api/
│   │       └── fetch/route.ts # manual trigger: POST to run fetchers now
│   └── components/
│       ├── EventCard.tsx
│       ├── ConflictCard.tsx
│       ├── Player.tsx
│       └── AlwaysOnRail.tsx
├── scripts/
│   └── run-fetchers.ts        # entry point for system cron
└── README.md
```

System cron entry (macOS/Linux):

```
*/5 * * * * cd /path/to/live-events && /usr/local/bin/node --loader ts-node/esm scripts/run-fetchers.ts >> fetchers.log 2>&1
```

---

## 10. Build Order (for the Claude Code session)

Do these in order. Don't skip ahead. Each step ends at a point where you can actually run the thing and see something.

1. **Scaffold.** `create-next-app`, Tailwind, shadcn/ui, better-sqlite3, TypeScript strict mode. Commit.
2. **DB layer.** `schema.sql`, migration runner, `db.ts` singleton. Write and run seed for the 6 Phase 1 sources.
3. **Types + time lib.** `NormalizedEvent`, `EventStatus`, and the UTC↔America/New_York helpers. Unit test the time helpers — this is the one place worth testing.
4. **First fetcher: Launch Library 2.** No auth, rich data, gives immediate visible results. Write it, run it once, look at the rows in the DB. This is your "does the pipeline work?" checkpoint.
5. **Orchestrator + cron script.** Wire step 4 into the orchestrator pattern. Run every 5 min locally. Watch the logs.
6. **Minimal Home view.** Just render all upcoming events from the DB as a list. Ugly is fine. Goal: see Launch Library events in the browser.
7. **Player view.** Click an event → embedded YouTube iframe. Now you have a working end-to-end slice for *one* source and *one* category. Stop and use it for a day.
8. **Remaining Phase 1 fetchers**, one at a time: YouTube channel fetcher (culture + philosophy share this code), C-SPAN RSS, TheSportsDB, NASA iCal, Explore.org scraper (populates `always_on`, not `events`).
9. **Schedule view + conflict card.** Now that you have events from multiple sources, the conflict UX actually has something to resolve.
10. **Always-On rail** on Home.
11. **Picks table + history.** Lightweight — just record what you click Watch on.
12. **Polish pass.** Category filter chips, dimmed past events, "delayed" badge, keyboard shortcuts if you want them.

After step 12, stop. Use it for a week. *Then* consider Phase 2 sources.

---

## 11. Things That Will Bite You (pre-mortem)

- **YouTube `search.list` with `eventType=upcoming` is flaky.** Sometimes streams aren't returned until shortly before going live. Complement it with `eventType=live` polled on the same cadence. Accept that "upcoming" for YouTube means "next few hours", not "next week".
- **Twitch `parent` mismatch** will silently show a black player. If the embed is blank, that's almost always why.
- **iCal files can contain recurrence rules** (`RRULE`). `node-ical` expands them, but double-check — you don't want one weekly event to appear as one row forever.
- **Launch Library 2 rate limit** is generous but not infinite. Cache aggressively; don't hammer it. 10-min cadence near launches, hourly otherwise.
- **SQLite + long-running Next.js dev server + file watcher** can occasionally lock. If you see `SQLITE_BUSY`, open the DB with `{ timeout: 5000 }`.
- **Timezones around DST transitions.** `date-fns-tz` handles it, but write a test for "the Sunday in March when clocks spring forward" so you trust it.
- **Philosophy category will feel sparse.** That's accurate to reality, not a bug. Seed it with 10+ channels so something always shows up.
- **Streams that require login (some sports, Nebula, MasterClass).** The app should detect these and show an "Open on source" button instead of trying to embed.

---

## 12. Explicit Non-Goals for v1

Saying no up front saves time:

- No accounts, no auth, no multi-user.
- No mobile app. Responsive web only.
- No notifications/push. The app is pull-based — you open it.
- No recording, no DVR, no rewind. Live only.
- No social features, comments, sharing.
- No recommendation engine. You curate the sources.
- No hosting. Runs on your machine. If you later want it on a home server or a tiny VPS, that's a day of work, not a redesign.

---

## 13. What to Hand Claude Code

When you start the Claude Code session, paste this whole document and then say something like:

> "I want to build this. Start with sections 9 and 10. Do step 1 (scaffold) and step 2 (DB layer) now. Stop after step 2 and show me what you did before continuing."

Working in two-step increments with a checkpoint between each is how this stays manageable. Don't let the session try to build everything at once — you'll lose the thread and the DB seed will be wrong and nothing will work and you won't know why.

---

## 14. Review of Your Thinking

You asked me to review how your thinking is going, so:

**Strong:** You correctly identified that the interesting problem is *conflict resolution between overlapping events*, not aggregation itself. Most people would have described this as "a list of livestreams" and missed the whole point. The fact that you framed it as "pick from multiple events in any timeslot" is the reason this app is worth building — it's a real UX contribution, not just a feed reader.

**Worth adjusting:** The word "relay" suggested re-streaming, which is a legal and technical wall. Switching your mental model to "embed the official player" removes that wall entirely and costs you nothing as a viewer. Everything in this proposal assumes that shift.

**The honest limit:** Your six categories aren't equal. Space and sports have clean data. Nature is ambient, not scheduled. News is okay. Culture and philosophy live on YouTube and will always feel a little hand-curated because that's what the underlying reality is. A good version of this app makes that asymmetry feel intentional (different rails for different rhythms) rather than fighting it.

**The meta-point:** You noticed that live events energize you and immediately asked "how do I get more of this, systematically?" That instinct — turning a felt experience into a piece of infrastructure — is exactly the right move. The app is worth building even if it only ever serves you.
