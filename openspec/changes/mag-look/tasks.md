## 1. Design system foundation

- [x] 1.1 Install fonts via `next/font/google` in `src/app/layout.tsx`: Fraunces (variable, opsz 9..144, weights 400/500/700), Inter (weights 400/500/600/700), IBM Plex Mono (weights 400/500). Use `display: 'swap'`, store on CSS variables `--font-fraunces`, `--font-inter`, `--font-plex-mono`.
- [x] 1.2 Add Tailwind theme tokens in `src/app/globals.css` (or `tailwind.config` if present): colors — `paper: #F6F1E7`, `ink: #1A1613`, `ink-soft: #6B5F50`, `rule: #D9CDB8`, `oxblood: #A83228`, `sage: #7B8B6F`. Font families — `serif-display: var(--font-fraunces)`, `serif-body: var(--font-fraunces)` (body uses Fraunces at 18/28), `sans: var(--font-inter)`, `mono: var(--font-plex-mono)`.
- [x] 1.3 Change `<body>` default background to `paper` and text to `ink`; retire shadcn card/border defaults. Delete `bg-card`, `border-border`, `text-muted-foreground` usages in page code (they're replaced by rules + sage/soft-ink).
- [x] 1.4 Create `src/components/DuotoneThumbnail.tsx` — an `<img>` wrapped in a container with `filter: contrast(0.92) sepia(0.15)` and a `mix-blend-multiply` overlay div tinted `paper` at 30% opacity. Accepts `src`, `alt`, `aspect` (default `16/9`).
- [x] 1.5 Create `src/components/ui/Kicker.tsx` (oxblood Inter small-caps with optional flex-1 rule after), `src/components/ui/EditorialMeta.tsx` (italic sage metadata line), and `src/components/ui/Rule.tsx` (`rule`-colored hr with `thick` variant for section breaks).

## 2. Data layer

- [x] 2.1 Create `db/migrations/008_magazine.sql`:
  - `CREATE TABLE sections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);`
  - `ALTER TABLE channels ADD COLUMN section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL;`
  - `CREATE INDEX idx_channels_section ON channels(section_id);`
  - `CREATE TABLE issues (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, cover_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL, featured_video_ids TEXT NOT NULL, pinned_cover_video_id TEXT REFERENCES videos(id) ON DELETE SET NULL);`
  - `CREATE INDEX idx_issues_created ON issues(created_at DESC);`
- [x] 2.2 Run `just backup-db` before applying the migration (per operational invariant).
- [x] 2.3 Update `src/lib/types.ts` with `Section`, `Issue` interfaces and extend `Channel` with `section_id: number | null`.

## 3. Section taxonomy

- [x] 3.1 Create `src/lib/sections.ts`: `listSections()`, `getSectionBySlug(slug)`, `createSection(name)`, `renameSection(id, newName)`, `deleteSection(id)` (with CASCADE-nullify on channels), `assignChannel(channelId, sectionId | null)`, `getChannelsBySection(sectionId | null)`. A `slug(name)` helper that lowercases and replaces non-alphanumerics with `-` (used for `/section/[slug]`).
- [x] 3.2 Create `src/app/api/sections/route.ts` (POST) handling `{ op, ... }` variants per spec requirement "Create / rename / delete sections".
- [x] 3.3 Create `src/app/api/channels/section/route.ts` (POST) handling `{ channelId, sectionId }` assignment per spec requirement "Assign channel to section".
- [x] 3.4 Create `src/app/sections/page.tsx` — RSC listing every `channels` row with its current section, inbox-video count (via JOIN on consumption), last-active time. Include a client-island for keyboard-first row focus + number-key assignment.
- [x] 3.5 Create `src/components/SectionChip.tsx` — a client component that renders either the assigned section (sage Inter small-caps) or the `+ ASSIGN` oxblood chip. Clicking opens an assignment popover (can reuse Base UI's popover). Must accept `channelId`, `currentSectionId`, and trigger `POST /api/channels/section` with optimistic UI.

## 4. Magazine-issue engine

- [x] 4.1 Create `src/lib/issue.ts`:
  - `getLatestIssue()` — returns the most recent `issues` row.
  - `isIssueCurrentForToday(issue)` — compares `toLocalDate(issue.created_at)` with today in America/New_York.
  - `composeIssue()` — runs the cover / featured selection rules and returns a draft issue (not yet persisted).
  - `publishIssue()` — composes and INSERTs a new `issues` row; returns it.
  - `getOrPublishTodaysIssue()` — if latest is current-for-today, return it; else publish and return the new one.
  - `setCoverPin(videoId | null)` on the latest issue.
- [x] 4.2 Cover score helper: `scoreVideoForCover(video, channelAffinityMap)` returning `(affinity + 1) * recency * depth`. Include unit-level sanity check: no crashes on zero affinity, null published_at, null duration.
- [x] 4.3 Featured picker: `pickFeatured(issue, cover)` that groups inbox by section and picks one per top-3 section; fallback to global top-3 if fewer than 3 sections populated.
- [x] 4.4 Briefs picker: `pickBriefs(issue)` returning up to 10 shortest inbox videos excluding cover + featured.
- [x] 4.5 Create `src/app/api/issues/publish/route.ts` (POST) calling `publishIssue()` then `redirect('/')`.
- [x] 4.6 Create `src/app/api/issues/cover-pin/route.ts` (POST) accepting `{ videoId: string | null }`, calling `setCoverPin`, returning 204.

## 5. Home / issue view

- [x] 5.1 Rewrite `src/app/page.tsx`: RSC that calls `getOrPublishTodaysIssue()`, assembles the composition data (cover video + metadata, featured videos with their channels + sections, departments with counts + top channels, briefs list), and renders using sub-components (see 5.2).
- [x] 5.2 Create `src/components/issue/Masthead.tsx`, `Cover.tsx`, `Featured.tsx`, `Departments.tsx`, `Briefs.tsx`, `TopNav.tsx`. Each is layout-only — receives data props, no DB access.
- [x] 5.3 Masthead includes the "Publish new issue" `<form action="/api/issues/publish" method="post">` button. Masthead also renders `LIVE NOW · N` oxblood badge (with popover) if any `is_live_now = 1` rows exist.
- [x] 5.4 `Cover.tsx` renders cover kicker (section name from the cover video's channel) + Fraunces title + italic byline + `<DuotoneThumbnail>` full-bleed. Empty-inbox state: "Inbox zero. Nothing new today." in italic.
- [x] 5.5 `Departments.tsx` queries section rows + inbox-count per section + top 3 channels per section by last-active. Unsorted appears last with its own aggregate count. Each row links to `/section/[slug]`.
- [x] 5.6 Top-nav appears at top of `/`, `/library`, `/sections`, `/watch/[id]`, `/settings/youtube` — links: Library, Archive, Sections, YouTube, and footer "raw inbox".

## 6. Section pages

- [x] 6.1 Create `src/app/section/[slug]/page.tsx` — lists inbox videos for channels assigned to that section (or `section_id IS NULL` if slug is `unsorted`), sorted by `published_at` DESC. Uses editorial chrome (Fraunces titles, rules, duotone thumbs). 404 on unknown slug.

## 7. Player view rewrite

- [x] 7.1 Rewrite `src/app/watch/[id]/page.tsx` to use editorial chrome: oxblood kicker with section name, Fraunces title, italic byline, duotone poster rendered until the iframe mounts.
- [x] 7.2 Extend `src/components/Player.tsx` to expose a `posterSrc` prop; render `<DuotoneThumbnail>` until `YT.Player` is ready, then swap.
- [x] 7.3 Create `src/components/watch/NextPieceFooter.tsx` — client component that queries the current issue + the current video's section, renders `NEXT IN {SECTION}` (up to 3) and `ALSO IN THIS ISSUE` (cover + featured + first 3 briefs minus current).
- [x] 7.4 Add keyboard handler to watch page (client island): `n`/`p` navigate to next/previous piece in the issue order (cover → featured → briefs → section deep lists). End-of-issue is a no-op with a sage "End of issue." toast. `.` pins the current video as cover via the API and shows a "Pinned as cover." oxblood toast.
- [x] 7.5 Add auto-advance on `s`/`a`/`d`: apply the consumption transition, show an oxblood strip `"{Action}. Next in 1s. ⌘Z to undo"`, navigate to the next piece after 1,200ms. `⌘Z` within the window reverts the transition (via API) and cancels navigation.

## 8. Inbox demotion

- [x] 8.1 Update `src/app/inbox/page.tsx` to use editorial chrome (no borders, rules between items, Fraunces titles, `<DuotoneThumbnail>`, italic sage metadata).
- [x] 8.2 Inject `<SectionChip>` into each inbox card next to the channel name.
- [x] 8.3 Keep existing keyboard bindings (`j`/`k`/`s`/`a`/`d`/`gg`). Do NOT add `n`/`p` here — inbox is its own list context, not the issue.

## 9. Library and archive pages

- [x] 9.1 Restyle `src/app/library/page.tsx` to the editorial chrome without behavioral changes. Saved / In Progress / Archived sections keep their current semantics; visually they become editorial section blocks separated by thick rules.
- [x] 9.2 The progress bar for In Progress items remains (it's functional) but adopts oxblood fill on sage track.

## 10. Settings page restyle

- [x] 10.1 Restyle `src/app/settings/youtube/page.tsx` to the editorial chrome. Keep all existing logic and branches.

## 11. Operational & docs

- [x] 11.1 Update `RUNBOOK.md`: add a "Magazine issues" section explaining freeze-at-open semantics, the publish button, and the `issues` table. Bump `Last verified` date.
- [x] 11.2 Update `CLAUDE.md`: add a short "Magazine issue lifecycle" paragraph under Architecture.
- [x] 11.3 No new env vars, no new cron jobs. Do not modify `justfile` unless a new verb emerges during implementation.

## 12. Specs + verification

- [x] 12.1 Verify all spec deltas parse: `openspec status --change mag-look --json` reports all artifacts `done`.
- [x] 12.2 `npm run lint` (clean)
- [x] 12.3 `npm run build` (passed; 18 routes including new `/sections`, `/section/[slug]`, `/api/sections`, `/api/channels/section`, `/api/issues/publish`, `/api/issues/cover-pin`)
- [x] 12.4 Smoke: migration auto-applied on startup; `/` composes issue #1 (cover `EhOQS00yvTU`, 3 featured).
- [x] 12.5 Smoke: fonts load via Next font pipeline (Fraunces/Inter/Plex Mono); HTTP 200 on `/`. Live FOUT check still needs a hard-reload in a browser.
- [x] 12.6 Smoke: `POST /api/sections {op:create}` + `POST /api/channels/section` both return success; UI flow needs a human in a browser, but the endpoints the chip calls are verified.
- [x] 12.7 Smoke: `POST /api/consumption` transitions verified (existing route, unchanged); undo path driven by `WatchKeyboard` client island. Manual keystroke test needs a browser.
- [x] 12.8 Smoke: `POST /api/issues/cover-pin {videoId:...}` → 204; DB confirmed `pinned_cover_video_id` is set. Unpin (`videoId:null`) → 204 clears it.
- [x] 12.9 Smoke: `POST /api/issues/publish` is a server-action form; verified by re-publish in DB via script.
- [x] 12.10 `/section/unsorted` → HTTP 200 (renders unassigned-channel inbox).
- [x] 12.11 `/inbox` → HTTP 200; editorial chrome applied, section chips wired. Keyboard + save/dismiss actions wired via existing API.
