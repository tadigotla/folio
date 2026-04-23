## 1. `/compose` route

- [x] 1.1 Create `src/app/compose/page.tsx`. Copy the `WorkspaceBranch` subtree from `src/app/page.tsx` verbatim — the `getDraftIssue()` / `getIssueSlots()` / `getInboxPool()` reads, the desktop/mobile branch (`isMobileUserAgent`), and the two-column `EditorWorkspace` + `ChatPanel` layout. Keep `export const dynamic = 'force-dynamic'`.
- [x] 1.2 Add a redirect at the top of `/compose`: when `!connected || videos === 0`, call `redirect('/')` from `next/navigation`. The empty-state CTAs live on `/`; `/compose` SHALL never render "Connect YouTube" or "Import your library" copy.
- [x] 1.3 Add the `Kicker` / header block to `/compose` that currently introduces the workspace on `/` (the "Compose" kicker + "A personal video magazine" language if it was present) — or a minimal one-line kicker `COMPOSE` if the source didn't have one. Purpose: make `/compose` self-identifying.
- [x] 1.4 Verify by running `npm run dev` and visiting `/compose` in three states: not connected (expect redirect to `/`), connected with empty corpus (expect redirect to `/`), connected with corpus and no draft (expect the **New issue** button), connected with corpus and a draft (expect the two-column workspace + chat panel).

## 2. `/` home flip

- [x] 2.1 In `src/app/page.tsx`, delete the `WorkspaceBranch` helper function and the `{workspaceBranch && !mobile && <WorkspaceBranch .../>}` render call. Keep the connection/corpus branching (the not-connected CTA and the empty-library CTA) — their copy is reworked in task 2.5.
- [x] 2.2 Delete the "Folio / A personal video magazine" masthead block (the header with Kicker + italic title that renders when `!workspaceBranch`). The consumption home runs without a masthead.
- [x] 2.3 Remove the `workspaceBranch && mobile` desktop-only branch from `/`. Mobile users on `/` see the same consumption rails as desktop; the desktop-only card now lives exclusively on `/compose`.
- [x] 2.4 Remove the conditional container width (`max-w-7xl` when `workspaceBranch && !mobile`). Use a consistent `max-w-5xl` (or similar) for the consumption-home layout. Document the chosen width in the RUNBOOK subsection.
- [x] 2.5 Rework the not-connected and empty-corpus copy to match the consumption framing. Keep CTAs pointing at `/settings/youtube` but drop "start composing an issue" / "begin seeding your library" phrasing. Short and direct: "Connect YouTube to get started." / "Import your library to start watching."
- [x] 2.6 Verify `/` renders correctly in all three connection/corpus states with the workspace gone.

## 3. Continue rail

- [x] 3.1 Create `src/components/home/ContinueRail.tsx` as an RSC. Query: `consumption.status = 'in_progress'` joined with `videos` + `channels`, ordered by `COALESCE(c.last_viewed_at, c.status_changed_at) DESC`, limit 4. Use a prepared statement via `getDb()`.
- [x] 3.2 Render a horizontal strip of cards. Reuse `VideoCard` if its props align (it already renders the progress bar when `status === 'in_progress'`). If reuse is awkward, build a thin local card that reuses the thumbnail + progress bar JSX pattern.
- [x] 3.3 Each card SHALL link to `/watch/[id]` via `encodeURIComponent(video.id)`.
- [x] 3.4 When the query returns zero rows, render nothing (no heading, no container, no empty-state text).
- [x] 3.5 Mount `ContinueRail` in `src/app/page.tsx` immediately below `RightNowRail` in the connected-with-corpus branch.

## 4. Shelf rail (home playlists)

- [x] 4.1 Add `listHomePlaylists()` in `src/lib/playlists.ts`. Return every playlist where `show_on_home = 1`, ordered by `updated_at DESC`. Include `id`, `name`, `description`, `updated_at`, and `item_count` (subquery). Type as a new exported shape (extend the existing `PlaylistSummary` if appropriate).
- [x] 4.2 Create `src/components/home/ShelfRail.tsx` as an RSC that calls `listHomePlaylists()` and renders each as a card (name + description + item count) linking to `/playlists/[id]`. Use existing typography — kicker + italic display serif for the name, font-sans small for description/count.
- [x] 4.3 When `listHomePlaylists()` returns `[]`, render nothing.
- [x] 4.4 Mount `ShelfRail` in `src/app/page.tsx` below `ContinueRail`.

## 5. Entry-point footer

- [x] 5.1 Add a footer block at the bottom of the connected-with-corpus branch of `src/app/page.tsx`. Render anchors to `/library`, `/playlists`, `/taste`, `/compose`, `/settings/youtube`. Style: `font-sans text-xs uppercase tracking-wide text-ink-soft`, space-separated with middle-dots or inline gaps matching the TopNav tertiary aesthetic.
- [x] 5.2 The footer renders unconditionally in the connected-with-corpus branch — even when all three rails above return empty. The footer SHALL NOT render in the not-connected or empty-corpus branches (those branches already surface their own CTA to `/settings/youtube`).

## 6. TopNav integration

- [x] 6.1 In `src/components/issue/TopNav.tsx`, add a `Compose` anchor to `/compose`. Place it alongside the existing tertiary links (library / playlists / taste). Match existing link styling.
- [x] 6.2 Verify the link appears on every page that renders TopNav (currently `/`, `/library`, `/playlists`, `/taste`, `/taste/[clusterId]`, `/watch/[id]`, `/issues`, `/issues/[id]`, `/settings/youtube`).
- [x] 6.3 Do NOT hide the `Compose` anchor on mobile. Mobile users clicking it will hit `/compose`'s desktop-only card, which already explains the situation.

## 7. Documentation

- [x] 7.1 Update `RUNBOOK.md`'s "Home ranking rail" section to add a "Compose route" subsection: the editor workspace now lives at `/compose`, `/` is the consumption home, bookmarks to the editor should be updated to `/compose`, the TopNav exposes the link. Bump the `Last verified` date to the current day.
- [x] 7.2 Update `CLAUDE.md` — the "Home ranking (phase 2 of consumption-first)" architecture paragraph gets one sentence about the route split: `/` owns the consumption-home rail stack; `/compose` hosts `EditorWorkspace` + `ChatPanel` via a copy of the prior `WorkspaceBranch` helper.
- [x] 7.3 Update the "Editor workspace" section of `RUNBOOK.md` to point at `/compose` instead of `/`. Any URL references in that section should change. No behavior documented in that section changes.
- [x] 7.4 Update the "Editor agent" section of `RUNBOOK.md` — references to the chat panel rendering "on `/`" should change to "on `/compose`".

## 8. Manual verification

- [x] 8.1 With no `ANTHROPIC_API_KEY`, visit `/compose` with a draft open. Chat panel renders as the disabled card (unchanged phase-2 contract); board + drag work.
- [x] 8.2 Visit `/` with a corpus. Confirm rail order: "For right now" → Continue (or hidden if empty) → Shelf (or hidden) → footer. Confirm no draft board, no chat panel, no masthead.
- [x] 8.3 Visit `/compose` without a corpus — confirm redirect to `/`.
- [x] 8.4 Toggle a playlist's `show_on_home` to 1 via `curl -X PATCH /api/playlists/[id]` (or SQL). Reload `/`. Confirm the playlist appears in `ShelfRail`. Toggle back to 0 and confirm it disappears.
- [x] 8.5 Start watching an in-progress video on `/watch/[id]` for 30+ seconds so `last_position_seconds` is written. Reload `/`. Confirm the video appears in `ContinueRail` with a progress bar.
- [x] 8.6 Click the `Compose` link in TopNav from three different pages (`/`, `/library`, `/playlists`) — confirm each lands on `/compose` with the workspace intact.
- [x] 8.7 On a mobile user-agent (or with dev-tools emulation), visit `/` — confirm the rails render. Visit `/compose` — confirm the desktop-only card renders.
- [x] 8.8 Confirm no page regression: `/library`, `/playlists`, `/playlists/[id]`, `/taste`, `/taste/[clusterId]`, `/watch/[id]`, `/issues`, `/issues/[id]`, `/settings/youtube` all render unchanged.
