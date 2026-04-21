## Why

After [oauth-youtube-import](openspec/changes/archive/2026-04-21-oauth-youtube-import/) the Inbox holds 3,813 videos across 210 channels. A flat list of thumbnails is the wrong interface at that scale — it rewards scrolling, punishes choosing, and makes triage feel like homework. The user wants the app to *mimic an interesting magazine* — a bounded, thoughtful, consumable experience with a point of view.

This change introduces a **magazine-shaped reading experience** on top of the existing data. It does not change ingestion, consumption-status semantics, or the player wiring. It reorganizes *presentation* so 3,813 items become "today's issue" — a cover story, a few featured pieces, department columns, and a quick-scan briefs list — and turns the watch page into something that feels like reading rather than queue-processing.

## What Changes

- **NEW capability `magazine-issue`** — a concept of *today's issue*: a persisted composition of `cover`, `featured`, `departments`, and `briefs` drawn from the user's Inbox. An issue is **frozen at open** — on first request of the day, the app computes a composition and stores an `issues` row; subsequent requests render that same issue. An explicit "Publish new issue" control recomputes. Cover selection is rule-based (longest new piece from a channel with recent watch affinity, tie-break: most recent) and can be manually overridden via a "make cover" action on any video.
- **NEW capability `section-taxonomy`** — user-defined sections (departments). A `sections` table plus `channels.section_id` (nullable, 1:1). Channels without a section live in a virtual *Unsorted* department. A `/sections` page for bulk assignment. Inline section chips on every video card for one-click re-assignment.
- **MODIFIED `home-view`** — the home page at `/` becomes today's issue. The three-tile navigation hub (Inbox/Library/Archive) is removed in favor of editorial layout: masthead, cover, featured strip, departments strip, briefs list. `Library` and `Archive` move into a discreet top-nav.
- **MODIFIED `player-view`** — watch page gets editorial chrome (oxblood kicker, Fraunces title, italic byline, duotone thumbnail poster) and a `NEXT IN {SECTION}` + `ALSO IN THIS ISSUE` footer. `n` / `p` keyboard bindings advance through the current issue. Auto-archive/dismiss triggers an in-place undo strip and auto-advances to the next piece after a grace period.
- **MODIFIED `inbox-view`** — remains as a power-user raw-list fallback, but gains inline section chips and drops the primary nav position. Reachable via a discreet "raw inbox" link in the footer.
- **MODIFIED `video-library`** — the `channels` table gains a nullable `section_id` foreign key; a new `sections` table is added; a new `issues` table caches composed issues and their cover-pin overrides. No changes to `videos` or `consumption`.
- **NEW design system** — Fraunces (variable) + Inter + IBM Plex Mono web fonts installed. New Tailwind theme tokens for the warm editorial palette (cream paper `#F6F1E7`, ink `#1A1613`, soft-ink `#6B5F50`, rule `#D9CDB8`, oxblood `#A83228`, sage `#7B8B6F`). A shared `<DuotoneThumbnail>` component applies the duotone treatment to YouTube thumbnails so they sit inside the palette. Borders-and-cards pattern is retired in favor of horizontal rules and whitespace. Light-only for v1.

## Capabilities

### New capabilities
- **magazine-issue** — composition, freezing, refresh, cover-pin semantics; the `/` issue view.
- **section-taxonomy** — sections data model, assignment UX (`/sections` page + inline chips).

### Modified capabilities
- **home-view** — replaced from tile hub to issue view. The live-now strip survives as a small masthead indicator.
- **player-view** — editorial chrome, next-piece footer, in-issue navigation (`n`/`p`), auto-advance with undo.
- **inbox-view** — demoted to power-user fallback; gains section chips.
- **video-library** — new `sections` and `issues` tables; `channels.section_id` FK.

## Impact

- **Code:** new migration `008_magazine.sql` (sections, issues, channels.section_id). New `src/lib/issue.ts` (composition + freeze). New `src/lib/sections.ts` (CRUD + assignment). New `src/app/sections/page.tsx`. Rewrite of `src/app/page.tsx` and `src/app/watch/[id]/page.tsx`. New `src/components/DuotoneThumbnail.tsx`. New `src/components/issue/*` for Masthead/Cover/Featured/Departments/Briefs sub-components. Tailwind theme additions in `globals.css`. Font loading via `next/font/google` in `layout.tsx`.
- **Database:** one migration, additive only — no existing columns changed, no data backfilled. Existing 210 channels will all have `section_id = NULL` until the user assigns them.
- **API:** new `POST /api/sections` (create/rename/delete), `POST /api/channels/section` (assign), `POST /api/issues/publish` (create new issue), `POST /api/issues/cover-pin` (pin/unpin cover). Existing `/api/consumption*` untouched.
- **Operational:** no new env vars, no new cron jobs, no ports. The `RUNBOOK.md` gains a short "Magazine issues" section explaining the freeze/refresh mental model.
- **Aesthetic change is user-facing and non-reversible short of rolling back:** this commits to a distinct visual identity. Agreed up front.
- **Out of scope (deferred):**
  - Multi-section channels (M:N). Channel→section stays 1:1.
  - Cross-issue history browsing (old issues beyond "today" / "previous" stay out of the UI).
  - Personalized cover ML. The rule is deterministic and inspectable.
  - Dark mode. Magazine aesthetic is paper-first; dark mode is a separate later design pass.
  - Renaming the app / masthead. Stays "Videos" in code; masthead text can be set later.
  - Per-section color coding. Tight palette discipline holds.
