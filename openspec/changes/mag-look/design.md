## Context

After the OAuth import change, the app holds ~3,800 videos in Inbox across 210 channels. The existing surface — a tile hub at `/` plus a scrolling Inbox — was designed when the video set was small and seed-driven. It doesn't degrade gracefully past a few dozen items. Rather than bolt on filters and search (the usual inbox-scaling moves), this change **reframes consumption as reading a periodical**. The metaphor is load-bearing: magazines are solved instances of "curate too much into something a person can read."

The user pre-committed to Warm Editorial aesthetic (variant A of an earlier wireframe exploration at [/tmp/wall-mockup.html](/tmp/wall-mockup.html)): cream + oxblood + sage palette, Fraunces/Inter/Plex Mono typography, rules-and-whitespace instead of bordered cards, duotone-treated thumbnails, light-only for v1.

Existing invariants carried forward:
- App is Next.js 16 with RSC pages reading SQLite via `better-sqlite3` directly. No API layer between pages and DB except for mutations.
- Consumption lifecycle (`inbox/saved/in_progress/archived/dismissed`) stays untouched — this change is presentation only.
- Ingestion pipeline and OAuth/subscription sync remain as-is.

## Goals / Non-Goals

**Goals:**
- Make opening the app feel like sitting down with something considered, not processing a queue.
- Turn 3,800 items into a bounded "today" experience with a clear done-state.
- Give the user an organic way to build a taxonomy of channels (sections) without a setup wall.
- Keep consumption seamless: finishing a piece flows naturally to the next without a trip back to the firehose.
- Commit fully to the aesthetic — typography, palette, spacing — not a "gray shadcn with a serif headline" half-measure.

**Non-Goals:**
- Not introducing ranking / recommendation personalization beyond a deterministic cover rule.
- Not deprecating the Inbox page (kept as escape hatch).
- Not color-coding sections. Palette stays tight.
- Not multi-issue navigation beyond today / previous.
- Not dark mode.

## Decisions

### 1. Issue is a persisted row, not a computed view

**Chosen:** new `issues` table with one row per "published issue". A composition is written on first visit of the day (or on explicit publish). The page renders from the stored row.

**Alternative considered:** compute the issue on every request from current Inbox state. Simpler — no table, no freeze logic. Rejected: the whole point of magazine framing is *stability* across a session. If the cover changes every time you refresh, the metaphor collapses.

**Rationale:** Freeze-at-open means you can walk away, come back after lunch, and your morning's issue is still there. It also gives a natural "historical issues" capability later without schema change.

### 2. Freeze semantics: frozen at open, refreshed by explicit publish

**Chosen:** The "current issue" is the most-recent row in `issues`. On a page request to `/`, if the latest issue is dated today (America/New_York timezone), render it. If the latest is from a previous day (or the table is empty), the RSC publishes a new issue (inserts a row) and renders that. A `"Publish new issue"` button in the masthead inserts a fresh row on demand.

**Alternative considered:** fixed publish time (e.g. 6am). Rejected: the user isn't on a schedule and shouldn't have to be. Rejected also: rolling issue that keeps growing during the day — violates "bounded today."

**Rationale:** First-open-of-day-freezes matches user intuition and avoids "the cover changed while I was scrolling" surprises. Manual refresh gives the user control without making it a constant question.

### 3. Cover selection rule

**Chosen:** among videos with `consumption.status = 'inbox'` arrived since the previous issue's `created_at` (or any inbox item if this is the first-ever issue):
  1. Rank by (channel affinity × published recency × duration-depth).
  2. Channel affinity: count of `consumption.status IN ('saved', 'in_progress', 'archived')` videos from that channel in the last 30 days. Boost channels the user has actually watched.
  3. Pick the top one. Tie-break by newest `published_at`.

If the user has pinned a cover (see Decision 4) and that video is still inbox-valid, the pinned video wins.

**Alternative considered:** simple "most recent long video." Rejected: a user with 210 channels subscribes to lots of channels they don't watch — would surface noise. Affinity matters.

**Rationale:** The rule is fully deterministic and inspectable. No ML, no embeddings, no "why did it pick that." A developer can read the SQL and predict the cover.

### 4. Manual cover pin

**Chosen:** A `.` keyboard action (or "make cover" button) on any video sets `issues.pinned_cover_video_id` on the current issue. If the pinned video is later dismissed/archived/removed, the pin is silently cleared and the rule-based selection resumes.

**Alternative considered:** pinning persists across issues until explicitly unpinned. Rejected: a pinned cover should be about *this* issue, not a standing preference.

### 5. Featured strip: 3 items, one per top section

**Chosen:** after the cover, pick 3 featured videos. Algorithm: for each of the user's top 3 sections by `inbox` count, pick one video — highest affinity × recency, same ranking as cover but excluding the cover itself. If fewer than 3 sections exist (e.g. user hasn't assigned), fall back to the global top-3 after cover.

**Rationale:** The featured strip is the part of a magazine that says "we curated across our beats." Picking one per department makes the variety feel editorial.

### 6. Departments: top N sections with counts and sample channels

**Chosen:** the departments strip shows up to 6 sections, ranked by inbox count descending. Each row shows section name, inbox count (in oxblood), and the 3 most-active channels in that section (italic sage). Clicking a section navigates to `/section/[slug]` — a department page listing its inbox videos.

*Unsorted* is always shown last, if it has any members. `/section/unsorted` lists all unassigned-channel videos.

### 7. Briefs: 10 shortest unread items, one line each

**Chosen:** the briefs block surfaces up to 10 inbox videos shortest-duration-first. One-liners: `• CHANNEL · title · 4m`. The durational bias rewards quick wins — the user is more likely to actually consume them. Clicking navigates to `/watch/[id]`.

**Alternative considered:** chronological briefs. Rejected: chronology duplicates what the cover/featured surface.

### 8. Section assignment UX

**Chosen:** two entry points.
  1. **Inline chip** on every video card (including the watch page). If the channel has a section, the chip shows `PHILOSOPHY` in sage caps (Inter). If unassigned, shows `+ assign` in a muted oxblood. Clicking opens a small popover: existing sections list + "New section…" input.
  2. **`/sections` page**: a table of all 210 channels, sortable by name / inbox-count / last-active, with per-row section assignment. Keyboard-first (`j`/`k` to move, number keys to assign to that section's slot).

No onboarding modal. The app works on day one with everything `Unsorted`.

### 9. Duotone thumbnail treatment

**Chosen:** thumbnails render inside a `<DuotoneThumbnail>` component that applies `filter: contrast(0.92) sepia(0.15)` plus a mix-blend-multiply overlay of the paper color at 30% opacity. The net effect: YouTube's loud reds and blues dampen toward ink-and-paper tones without losing legibility.

**Alternative considered:** full grayscale. Rejected: kills too much information (you can't tell a talking head from a landscape at a glance). The sepia/contrast mix keeps structure while muting chroma.

### 10. Font loading

**Chosen:** `next/font/google` in `src/app/layout.tsx` loads Fraunces, Inter, IBM Plex Mono with `display: 'swap'` and variable-weight subsets. Self-hosted by Next's font pipeline, no FOIT.

**Rationale:** Next.js 16's font pipeline eliminates layout shift and the privacy concern of hitting Google Fonts at runtime.

### 11. Keyboard in the issue

Adds to the existing inbox keybindings (j/k/s/a/d):
- `n` next piece (from current issue context — works in watch page and issue page)
- `p` previous piece
- `.` pin as cover (on a video card or watch page)
- `r` refresh issue (on `/` only — with confirm if unread items would be lost from the current issue)

### 12. Auto-advance with undo

After `s`/`a`/`d` or click of the equivalent button in the watch page, the page shows an inline oxblood strip: `"Archived. Next in 1s. ⌘Z to undo"`. After 1.2s, the app navigates to the next piece in the issue (via `n` logic). Pressing `⌘Z` during the window reverts the consumption transition and cancels the advance.

**Alternative considered:** instant advance. Rejected: one misclick and the app silently ate a video. The undo grace period is the difference between "magical" and "anxious."

## Risks / Trade-offs

- **[Risk] Issue composition misses a fresh upload** if the issue is frozen at 8am and a priority video arrives at 10am → user hits "Publish new issue" to refresh. Acceptable; the button is right there in the masthead.
- **[Risk] Aesthetic is polarizing.** The warm editorial look is a strong commitment. If the user stops liking it, changing it is a real redesign, not a token flip. Mitigated by user-led wireframe selection before this change was scoped.
- **[Risk] 210 unsorted channels stays unsorted forever.** The app is usable in that state (Unsorted department carries everything), but the magazine metaphor weakens without real departments. Mitigated by the `/sections` page making bulk assignment ergonomic.
- **[Risk] Duotone treatment on thumbnails obscures visual cues** (e.g. thumbnail contains a face the user recognizes). Mitigated by tuning the filter mildly; strong enough to unify the palette, weak enough to preserve recognizability.
- **[Risk] Keyboard-action collisions** between the issue's `n`/`p` and the existing inbox `j`/`k`. Resolved: inbox keeps `j`/`k` (existing spec); issue view uses `n`/`p` (distinct). No conflict at the same route.

## Migration Plan

1. Apply migration `008_magazine.sql` (creates `sections`, `issues`, adds `channels.section_id` FK).
2. Restart dev server; first visit to `/` publishes issue #1 (everything still in one bucket: Unsorted).
3. User can immediately navigate, watch, and triage — app is functional. Over time they assign channels to sections, and the departments strip fills in meaningfully.
4. No data backfill. Existing `videos`, `consumption`, `sources`, `oauth_tokens` rows all remain as-is.

**Rollback:** revert the app code. The new tables stay (harmless) but the UI no longer reads them. Old tile-based home page returns.

## Open Questions

- **Section deletion semantics.** If the user deletes a section that has 5 channels assigned, what happens? Reassign-to-Unsorted seems right (preserves channel rows) but the prompt language matters. Defer to impl.
- **Masthead text.** "The Wall"? "The Daily"? "Videos"? Ships as placeholder — user decides at implementation time.
- **Issue timezone** is America/New_York (per existing `src/lib/time.ts` convention). Edge case: user opens the app at 11:55pm, issue is frozen. At 12:05am they refresh — do they get yesterday's issue, or a new one? Decision: the freeze check compares `toLocalDate(issues.created_at) === toLocalDate(now)`. Crossing midnight = new issue on next open. Skipping "yesterday's paper" is a feature, not a bug — periodicals are today-focused.
- **Live-now carrying** into the magazine. Keep the small "Live Now" strip in the masthead? Or promote a live video into the cover slot? Defer: start by keeping the small strip; promote to cover if user wants it.
