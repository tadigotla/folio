## Context

Phase 2 of `consumption-first` shipped the "For right now" rail (`src/lib/home-ranking.ts`, `src/components/home/RightNowRail.tsx`) and wired it onto `/`. The rail was initially flag-gated; a follow-up edit made it the default. What's left on `/` underneath the rail is the full editor workspace: `TopNav`, `EditorWorkspace` (drag board + inbox pool), and `ChatPanel` (Anthropic-backed). That workspace is fed by the magazine pipeline (`src/lib/issues.ts`, `issues` + `issue_slots` tables) and is scheduled for removal in phase 4 (`magazine-teardown`).

Phase 3 is the flip: `/` becomes a consumption-shaped room, the editor moves to `/compose` so it stays reachable during burn-in without squatting on the landing page, and a couple of quiet rails fill in below the "For right now" strip. The rails are thin — the point of this phase is reorganization, not new machinery.

The personal corpus is small (1–10k videos; typically tens of `in_progress`, single-digit pinned playlists). Every read is a single SQLite query; nothing here needs caching. Stakeholders: solo user. Environment: `npm run dev` on port 6060, App Router RSC pages, SQLite via `better-sqlite3`.

Existing assets phase 3 reuses as-is:
- `rankForHome()` and `<RightNowRail />` — no changes.
- `playlists.show_on_home` column — exists since phase 1 (migration `014_playlists.sql`), already writable via `PATCH /api/playlists/[id]`, zero current readers.
- `EditorWorkspace`, `ChatPanel`, `NewDraftButton`, `TopNav` — moved wholesale, not rewritten.
- `consumption.last_viewed_at`, `consumption.last_position_seconds` — populated by the player since the library-pivot phase; `getLibraryVideos()` in `src/lib/consumption.ts` already sorts `in_progress` by those keys.

## Goals / Non-Goals

**Goals:**
- Make `/` feel like walking into a consumption room: rail at the top, resumables next, playlist entry points next, quiet links to the rest. No draft board visible.
- Preserve the editor workspace byte-for-byte — same slot rules, same chat semantics, same URL bookmarkability — under the new path `/compose`.
- Turn `playlists.show_on_home` from "stored-but-unread" into a first-class surface.
- Keep the phase small enough that revert is "git revert"; no schema changes, no migrations, no external-service changes.

**Non-Goals:**
- **No agent retooling.** Tools stay as phase 2 set them. Swapping `assign_slot`/`swap_slots`/`clear_slot` for playlist + triage verbs is a separate sub-phase.
- **No magazine teardown.** Editor workspace, issue tables, slot machinery, agent panel — all intact, just moved. Phase 4 owns deletion.
- **No mobile redesign.** Mobile already bypasses the editor ("Desktop only" card); phase 3 preserves that on `/compose`. `/` on mobile gets the same consumption rails as desktop, minus the workspace link.
- **No "Fresh since last visit" counter** in this phase. That was mentioned in the umbrella proposal but needs its own design discussion about what "visit" means. The rail covers most of what a Fresh counter would do.
- **No analytics.** A single user + feature flag + "does it feel right" is still the test.
- **No new caching / precompute.** Each `/` render runs three queries. Phase 5's overnight-enrichment may later precompute the home pool; phase 3 does not.

## Decisions

### 1. Relocate, don't rewrite the editor

**Decision.** Create `src/app/compose/page.tsx` that imports the exact same `EditorWorkspace` + `ChatPanel` subtree currently living under the `WorkspaceBranch` helper in `src/app/page.tsx`. Move the `getDraftIssue()`, `getIssueSlots()`, `getInboxPool()` calls and the two-column layout block verbatim. Delete the `WorkspaceBranch` helper from `page.tsx` once the new route is in place.

**Why.** The workspace has load-bearing behaviors (drag-and-drop, sticky chat panel, `await headers()` mobile branch, `force-dynamic`) that are easy to break in a rewrite. A copy-paste preserves all of them. Phase 4 deletes the whole thing anyway — there's no ROI in refactoring surface that's about to be torn down.

**Alternatives considered:**
- **Render the workspace inside a modal on `/`** — preserves "one URL" but adds a layout variant phase 4 has to undo, and breaks deep-link bookmarks to the draft board.
- **Keep `/` branching on "has draft?" like it does now but under the rail** — doesn't achieve the flip. The point is that `/` stops being an editor surface.

### 2. `/compose` redirects to `/` when nothing is to compose

**Decision.** When `connected && videos > 0` is false, `/compose` redirects to `/` (via `redirect()` from `next/navigation`). The empty-state CTAs live on `/`, and landing on `/compose` without a corpus should not show a broken workspace.

**Why.** Keeps the empty-state copy in one place. The editor's "no draft" state (renders `NewDraftButton` and a kicker) stays on `/compose` as today — that's a valid state because a corpus exists.

### 3. "Continue" rail: in_progress only, capped at 4

**Decision.** New RSC component `src/components/home/ContinueRail.tsx`. Reads `consumption` joined with `videos` + `channels`:

```
SELECT ... FROM consumption c
  JOIN videos v   ON v.id = c.video_id
  LEFT JOIN channels ch ON ch.id = v.channel_id
 WHERE c.status = 'in_progress'
 ORDER BY COALESCE(c.last_viewed_at, c.status_changed_at) DESC
 LIMIT 4
```

Renders a horizontal strip of cards (reuse `VideoCard` or a thin local variant) with a per-card progress bar derived from `last_position_seconds / duration_seconds` (existing `VideoCard` already renders this bar). Clicking a card jumps to `/watch/[id]`; the player auto-seeks.

**Why.** The "Continue" rail is the most-requested consumption move in the umbrella doc. Capping at 4 keeps it a narrow strip instead of a paged grid — consistent with "it's a room, not an inbox." If the cap feels wrong we tune the constant in-place, as we did with `HOME_RANKING_HALF_LIFE_DAYS`.

**Hidden when empty.** If there are no `in_progress` rows, the rail renders nothing (not an empty-state message). Consumers don't need to be told their backlog is clean.

### 4. "On the shelf" rail: home-pinned playlists

**Decision.** New RSC `src/components/home/ShelfRail.tsx` + helper `listHomePlaylists()` in `src/lib/playlists.ts`:

```
SELECT id, name, description, updated_at,
       (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count
  FROM playlists p
 WHERE show_on_home = 1
 ORDER BY updated_at DESC
```

Renders each pinned playlist as a title + description + count card linking to `/playlists/[id]`. No inline thumbnails in this phase — the playlist detail page already shows them. Hidden when there are no pinned playlists; the user hasn't opted any in yet.

**Why.** Playlists are "rooms the user made for themselves." Putting up to N of them on `/` gives the consumption home a sense of depth without more machinery. `show_on_home` already exists — we just need a reader.

### 5. TopNav gains `Compose`

**Decision.** `src/components/issue/TopNav.tsx` — add a `Compose` anchor pointing at `/compose`. Existing links (library, playlists, taste, issues) stay. The anchor is visible on all screens but the `/compose` target is desktop-only (it already guards with an `isMobileUserAgent` branch).

**Why.** One-click return path for users who bookmarked `/` expecting the editor, and the discoverability hook for the new route. Do not hide on mobile — the user may be on mobile and want to note "I'll do this later on desktop"; the existing mobile card on `/compose` explains the situation. Hiding it would be magic.

### 6. `/` layout order: rail → Continue → Shelf → entry points

**Decision.** From top:

1. `TopNav` (unchanged).
2. "Folio / A personal video magazine" masthead — **removed**. The masthead was the editor's marketing surface; the consumption room doesn't need a title card. (Phase 4 can reinstate a quieter one if we miss it.)
3. `RightNowRail` (unchanged from phase 2).
4. `ContinueRail` (new; hidden when empty).
5. `ShelfRail` (new; hidden when empty).
6. Quiet entry-point footer: `Library · Playlists · Taste · Compose · Settings`. Inline, font-sans small uppercase, spacing consistent with existing TopNav tertiaries.

**Why.** Top-of-page is for "what do you want to watch right now"; the rest tapers off. Empty rails hide entirely so a low-state user doesn't face a grid of holes. The masthead-removal is the single most visible change — worth calling out in the PR and the runbook.

**Alternatives considered:**
- **Keep the masthead** — costs vertical space for nothing the consumption room needs.
- **Reorder Shelf above Continue** — tested mentally against "I have one video I'm halfway through"; continuing wins.

### 7. No schema changes

**Decision.** `playlists.show_on_home` is already in place. `consumption.last_viewed_at` and `last_position_seconds` are already in place. No new tables, columns, indexes, or migrations.

**Why.** Phase 3 is a reorg, not a schema step. The first write path the home-flip surfaces is the `show_on_home` toggle — which already exists (`PATCH /api/playlists/[id]`). If we find a missing index during burn-in we can add it in a follow-up; none are obviously needed on the personal corpus.

### 8. `/compose` inherits the editor's chat-panel-disabled state

**Decision.** The `ANTHROPIC_API_KEY`-missing path that phase 3 of `conversational-editor` added — disabled chat card with a pointer to RUNBOOK — moves with the panel. `/compose` renders the disabled card when no key is set; the board remains fully functional. `/` never renders the chat panel (no key check needed).

**Why.** This was phase 2's contract. We're not touching it.

### 9. RUNBOOK + CLAUDE.md deltas land in this change

**Decision.** Same invariant as phase 2: any launch/deploy/config change updates both docs in the same PR. Phase 3's changes are route-level (no new env vars, no new just verbs), but the runbook "Home ranking rail" section grows a "Compose route" subsection and bumps `Last verified`. `CLAUDE.md`'s Home-ranking paragraph gets one sentence about the editor moving to `/compose`.

## Risks / Trade-offs

- **[Users with bookmarks to `/` lose their draft board one click away]** → Acceptable: `Compose` is prominent in TopNav, the first workspace visit is one click, and the RUNBOOK note documents the flip. If we hear pain we can add a dismissible "Looking for the editor?" banner on `/` that autolinks to `/compose`; not building it preemptively.
- **[`/compose` and `/` both being active surfaces during burn-in = two home pages]** → Mitigated by `/compose` redirecting to `/` when there's no corpus (single empty-state source) and by TopNav making the distinction visible. Phase 4 collapses it to one.
- **[`show_on_home` has no existing UI toggle]** → True; phase-1 shipped the column and the API, but the `/playlists/[id]` page does not expose a checkbox yet. Phase 3 adds the rail reader but leaves toggling to `PATCH /api/playlists/[id]` + manual SQL (or a future UI add). Users who want to pin a playlist today need to SQL it or curl the endpoint. Document both in the runbook. A proper toggle is a trivially small follow-up and belongs to a different change (it's a UI add, not a consumption-home concern).
- **[`ContinueRail` may duplicate videos already in `RightNowRail`]** → Expected. `RightNowRail` includes `in_progress` via the `stateBoost = 1.5` path. Fine: a rail-top video that you're mid-watch through is the right thing to show twice — it's the same "watch this now" intent, once under "ranked top picks" and once under "you were already here." If we see it be ugly we can de-dupe, but de-duplication hides the structural reason the rail showed it.
- **[Removing the masthead is the most visible change and could feel jarring]** → Acceptable. The masthead was tied to the editor-in-chief framing. The consumption room is quieter by design. Easy to reinstate behind a one-liner if we miss it.
- **[Phase-3 changes increase `/`'s SQLite read count from 1 (getCorpusSize) + (draft reads) to 3 + corpus check]** → Still <50ms on the personal corpus, still well under any budget we'd want to care about.
- **[The agent panel stays on `/compose` but its tool set still speaks slot verbs]** → Confusing for a user who thinks of `/compose` as "the old editor still here for burn-in." Acceptable — phase 3 does not re-scope the agent. A follow-up change will rebind it to curation verbs or retire it.

## Migration Plan

1. Land `src/app/compose/page.tsx` with the workspace subtree copied from `src/app/page.tsx`. Verify both `/` (unchanged, still renders workspace) and `/compose` (new, renders workspace) work in dev.
2. Add `ContinueRail`, `ShelfRail`, `listHomePlaylists()`. Render them under `RightNowRail` on `/` in a new order. Workspace still on `/` at this point.
3. Remove the `WorkspaceBranch` from `src/app/page.tsx`. Remove the masthead block. `/` is now consumption-only.
4. Add `Compose` anchor to `TopNav`. Verify nav works from every page.
5. Update `RUNBOOK.md` and `CLAUDE.md`; bump the runbook's `Last verified` date.
6. Use the feature locally for a day; if nothing feels wrong, close the change and archive.

**Rollback:** single `git revert` of the phase 3 commits restores the phase-2 `/`. No data mutations, no migrations. `/compose` becomes a 404; that's fine.

## Open Questions

- **Should `/` on mobile render the rails or stay the "Desktop only" card?** Leaning render — the rails are read-only browsing with mobile-friendly cards (they reuse the same grid patterns `/library` uses). Mobile users who don't want to compose still want to watch. Will confirm in implementation; if it doesn't look right, revert to the desktop-only branch.
- **Do we want an explicit "Fresh since last visit" counter now?** Decided no: it needs a notion of "visit" we don't have a clean definition for, and the rail already surfaces fresh high-weight content. Revisit in phase 4 or 5.
- **Does `show_on_home` need a UI toggle in this phase?** Decided no (see Risks). The column is load-bearing on read; the write path (API + manual SQL) is sufficient for burn-in. Add a checkbox to `/playlists/[id]` in a follow-up.
