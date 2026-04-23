## Why

Phases 1–3 of the `consumption-first` umbrella have landed: playlists, home
ranking, and the consumption home are live, and `/compose` is a read-only
burn-in holdout of the old magazine surface. The `editorial-workspace`,
`issue-archive`, and `editorial-agent`-slot-tools capabilities now exist
only to keep that holdout breathing. Every read of `issues`, `issue_slots`,
`sections`, and `channels.section_id` is either dead or trivially reshapable
into the consumption-first idiom. Leaving the magazine schema in place costs
us two things: it keeps a 600+-LOC dead-code surface alive in `src/lib/issue.ts`,
`src/lib/issues.ts`, `src/lib/sections.ts`, slot components, and issue/section
routes, and it keeps the editor-in-chief framing visible in `CLAUDE.md`,
`RUNBOOK.md`, and the OpenSpec specs — which slows every subsequent change
by forcing future authors to reconstruct which framing is current.

This phase executes the teardown: drop the magazine tables, reshape
`conversations` off its 1:1 issue binding, collapse sections into tags, delete
the dead code, and rewrite the docs and specs to reflect what the app actually
is — a consumption room, not a publication. The taste substrate, taste lab,
playlists, home ranking, and consumption agent all survive untouched; this
change is net-deletive from the user's perspective and only touches surfaces
the `consumption-first/cleanup-inventory.md` already names.

## What Changes

- **BREAKING (schema):** drop `issues`, `issue_slots`, and `sections` tables.
  Drop `channels.section_id` column. Reshape `conversations` to scope by date
  instead of issue (`scope_date TEXT UNIQUE NOT NULL` replacing
  `issue_id UNIQUE NOT NULL FK`). Migrate existing section rows into `tags` +
  `channel_tags` via the one-shot migration before the drops. Export `issues`
  + `issue_slots` to `backups/issues-pre-teardown.json` and run `just backup-db`
  immediately before applying. History migrations (`008_magazine.sql`,
  `011_issues_slotted.sql`, `013_conversational_editor.sql`) stay — the new
  `NNN_magazine_teardown.sql` expresses the teardown so fresh installs
  replay cleanly with net-zero magazine footprint.
- **BREAKING (routes):** delete `/issues`, `/issues/[id]`, `/section/[slug]`,
  `/sections`, and `/compose` pages; delete all `/api/issues/*`,
  `/api/sections`, `/api/channels/section` handlers. `/compose`'s burn-in
  role ends here. Conversation lookup moves from
  `/api/agent/conversation/[issueId]` to `/api/agent/conversation/[date]`
  (or becomes implicit if phase 3's final shape picked that route).
- **BREAKING (library / code):** delete `src/lib/issue.ts`, `src/lib/issues.ts`,
  `src/lib/sections.ts`, `src/components/issue/*`, `src/components/workspace/*`,
  `src/components/SectionChip.tsx`, `src/components/SectionsManager.tsx`, and
  the `SlotKind` / `IssueRow` / `IssueSlotRow` types. `src/lib/consumption.ts`
  drops its `LEFT JOIN sections` and `section_id`/`section_name` columns from
  every query. `src/lib/types.ts` loses the related fields.
- Rewrite `editorial-agent` capability to `curation-agent` (rename the spec
  directory and drop slot-tool requirements; slot-tool code was already
  removed in phase 3, this makes the spec tree match). Delete
  `editorial-workspace` and `issue-archive` spec directories entirely.
  Rewrite `home-view/spec.md` to describe the consumption-first home
  (rails: Right Now / Continue / Fresh / Playlists).
- Scrub `CLAUDE.md` of the "Magazine issue lifecycle" section and the
  "magazine-shaped" intro line. Delete the "Editor agent" prose or replace
  with a short "Curation agent" paragraph consistent with phase-3 reality.
  Scrub `RUNBOOK.md`'s workspace/slot/published-issues sections, update
  `_Last verified:_` date, and remove mobile copy referencing `/issues`.
- Update `src/app/watch/[id]/page.tsx` + `MobileWatch.tsx` to drop any
  section-label rendering. Remove slot/issue-specific shortcuts from
  `src/components/KeyboardHelp.tsx` (if phase 3 left any). Remove
  `section_id` assignment from `src/lib/youtube-import.ts`.
- Archive the long-running `conversational-editor/` umbrella change under
  `openspec/changes/archive/YYYY-MM-DD-conversational-editor/` once this
  change ships — its remaining specs are gone.

## Capabilities

### New Capabilities

- `curation-agent`: replaces `editorial-agent` (see Modified). Codifies
  the phase-3 shipped reality: curation-companion voice, per-day
  conversation scope, playlist + triage + mute tool set, no slot tools,
  no editor-in-chief framing.

### Modified Capabilities

- `editorial-agent`: **removed** (renamed). Every requirement is removed
  from this capability; the replacement lives at `curation-agent`.
  The editor-in-chief house style, the `assign_slot` / `swap_slots` /
  `clear_slot` tools, and the 1:1 binding to a draft issue are gone.
  (Agent code for this landed in phase 3; this change makes the spec
  tree match.)
- `home-view`: rewritten to describe the consumption-first `/` — rails for
  Right Now, Continue, Fresh since last visit, Playlist entry points.
  Removes all "today's issue" / cover / featured / briefs / masthead
  / publish requirements.
- `editorial-workspace`: **removed**. The slot-board composition surface
  no longer exists. Spec directory deleted.
- `issue-archive`: **removed**. The published-issue archive no longer
  exists. Spec directory deleted.
- `library-view`, `youtube-library-import`: minor — remove any requirement
  text referencing `section` filtering or section-assignment-on-import.

## Impact

- **Code removed (~1,200 LOC).** `src/lib/issue.ts`, `src/lib/issues.ts`,
  `src/lib/sections.ts`, the `src/components/workspace/*` tree, issue + section
  API routes, `/compose`, `/issues/*`, `/section/[slug]`, `/sections`,
  `SectionChip`, `SectionsManager`. `src/lib/consumption.ts` loses its
  sections JOIN. `src/lib/types.ts` loses `SlotKind`, `IssueRow`,
  `IssueSlotRow`, `section_id`, `section_name`.
- **Code added (~200 LOC).** `db/migrations/NNN_magazine_teardown.sql`,
  `scripts/export-issues.ts`, minor patches to `consumption.ts` /
  `types.ts` / `youtube-import.ts` / watch pages.
- **Database.** Drops 3 tables (`issues`, `issue_slots`, `sections`),
  drops 1 column (`channels.section_id`), reshapes 1 table
  (`conversations`). Net: one SQL migration + one pre-migration export
  script. Reversible via the JSON backup + `events.db` backup taken
  immediately before.
- **Docs.** `CLAUDE.md`, `RUNBOOK.md` scrubbed as described above.
  `_Last verified:_` date in `RUNBOOK.md` bumped.
- **OpenSpec.** Deletes `openspec/specs/editorial-workspace/` and
  `openspec/specs/issue-archive/`. Renames `editorial-agent/` →
  `curation-agent/` and rewrites the spec body. Rewrites
  `home-view/spec.md`. Minor edits to `library-view/spec.md` and
  `youtube-library-import/spec.md`. On archive, moves
  `openspec/changes/conversational-editor/` under `changes/archive/`.
- **External services / config.** No new dependencies. No env-var changes.
  `justfile` unchanged. `just backup-db` is the only operational step
  outside the migration runner.
- **Users.** The `/compose` drag board, `/issues*`, `/sections`, and
  `/section/*` pages disappear. All previously-reachable content
  (saved videos, inbox, library, taste clusters, playlists, watch
  pages) remains intact. Section labels on cards degrade to tag chips
  where applicable (where the sections→tags migration preserved them).
