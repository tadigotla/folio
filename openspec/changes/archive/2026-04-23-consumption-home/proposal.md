## Why

`/` still opens into the editor workspace for anyone with a corpus — the drag board squats on the landing page and the "For right now" rail (phase 2) lives as a strip above it. That's a half-flip. The umbrella's promise is that `/` should feel like a *consumption* room: a handful of picks, resumables, playlists to step into — not a publishing surface with a composer in front of it. The editor still needs to be reachable during the phase-4 burn-in, but it should not be the thing the user lands on.

Phase 2 already made the rail default (commit after the `taste-ranking-loop` archive, unguarded by a flag). Phase 3 finishes the flip: relocate the editor to a dedicated route, rebuild `/` around the rail + resumables + home-pinned playlists, and make `playlists.show_on_home` load-bearing instead of a persisted-but-unread column.

## What Changes

- **`/` flips to consumption-first.** Layout, top to bottom: "For right now" rail (unchanged from phase 2), **Continue** strip (up to 4 in-progress videos, ordered by `last_viewed_at` desc), **On the shelf** strip (playlists where `show_on_home = 1`, ordered by `updated_at` desc), and quiet entry points to `/library`, `/playlists`, `/taste`, `/compose`.
- **`/compose` route added.** Hosts the current `EditorWorkspace` + `ChatPanel` wiring verbatim (two-column board/chat at ≥1280px, stacked below, mobile fallback unchanged). The existing component tree moves; no behavioral changes.
- **TopNav gains a `Compose` link** and the "Start draft / draft exists" affordance moves with it. `/` no longer renders the draft board, new-draft button, or chat panel under any branch.
- **`playlists.show_on_home` becomes load-bearing.** The column has existed since phase 1 but no reader consumes it. Phase 3 adds the reader on `/`. The existing `PATCH /api/playlists/[id]` contract is unchanged.
- **Empty-state copy reworked** on `/` for the not-connected and empty-corpus branches — same CTAs, updated prose to match the consumption framing (no "start composing an issue" language).
- **No schema changes.** No migrations.
- **No removals.** The editor, chat panel, issue pipeline, and `/compose` are fully intact — phase 4 is the one that tears down.
- **Agent tool-set unchanged in this phase.** The agent still speaks slot verbs against the draft at `/compose`. Retooling to curation verbs (playlist + triage + mute) is a separate piece of work; phase 3 only moves the agent's host route.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities

- `home-view` — `/` flips from the editor-first branching (draft board + chat panel) to a consumption rail stack. The connection/corpus branches remain, but the "draft exists" branch no longer renders on `/` — it's reachable at `/compose`.
- `editorial-workspace` — the workspace surface renders at `/compose` instead of `/`. Lifecycle, slot rules, and mutation contracts are unchanged. Spec delta is a route change only.
- `playlists` — `show_on_home` gains a defined reader: the home page SHALL render playlists with `show_on_home = 1` as an entry-point strip. The mutation path and schema are unchanged.

## Impact

- **Code moved:** `src/components/workspace/*`, `src/components/agent/ChatPanel.tsx`, and the `WorkspaceBranch` subtree in `src/app/page.tsx` shift from `/` into a new `src/app/compose/page.tsx`. `ChatPanel`, `EditorWorkspace`, `NewDraftButton`, `TopNav` remain unchanged internally.
- **Code added:** `src/app/compose/page.tsx` (~40 LOC, wraps the existing workspace). New components under `src/components/home/`: `ContinueRail.tsx`, `ShelfRail.tsx` (home playlists). `src/lib/home-view.ts` (or extended `src/lib/playlists.ts`) gains a `listHomePlaylists()` helper that reads `show_on_home = 1` ordered by `updated_at DESC`. TopNav gains a `Compose` anchor.
- **Code deleted:** nothing. Phase 4 handles teardown.
- **Database:** no changes. No new migrations.
- **External services:** none.
- **Performance:** `/` now runs three SQLite reads (rank, in_progress, home playlists). All are <50ms against the personal corpus. No caching.
- **Operational:** `justfile` / `RUNBOOK.md` get a "Compose route" note under the home-ranking-rail section. The rail-default note already landed; this change appends the relocation context.
- **Reversibility:** flip back by restoring the prior `src/app/page.tsx` and deleting `src/app/compose/page.tsx`. No data mutations; no migrations to roll back.
- **Agent behavior:** unchanged. Chat panel still binds 1:1 with the current draft issue, still freezes on publish, still uses the phase-2 agent tool set. The panel's URL changes from `/` to `/compose`. Deep links into a chat are not a thing today, so there are no broken bookmarks.
- **Bookmarks:** users who bookmarked `/` land on the consumption home instead of their draft. Recovery is one click on the new **Compose** link in TopNav. Document this in RUNBOOK.
