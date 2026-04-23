## Context

The `consumption-first` umbrella's phases 1–3 landed the new substrate
(playlists, taste-weight-aware home ranking, consumption-first `/`, curation
agent at `/compose`). `/compose` holds the old magazine surface behind a
read-only burn-in flag so phase-3's flip could ship without a schema change.
`/` is already the consumption room; the magazine pieces (`issues`,
`issue_slots`, `sections`, `channels.section_id`, the 1:1 `conversations`
⇄ `issues` binding, `/compose`, `/issues*`, `/section/*`, `/sections`,
editor-workspace components, section-chip components, and the corresponding
OpenSpec specs) have no active reads from the user-facing consumption path.

The phase-4 work is codified in detail by
`openspec/changes/consumption-first/cleanup-inventory.md` — that document is
the ground truth. This design states the teardown's shape, the destructive-
migration posture, and the resolutions for the few decisions the inventory
deferred (conversation reshape strategy, the exact migration file number,
the `/compose` fate, the renaming of `editorial-agent` → `curation-agent`).

The user is the sole operator. Data loss of the `issues`/`issue_slots`
content is acceptable (nothing reads it) as long as a JSON export is taken
for cold archival. Loss of `conversations` turns **is not acceptable by
default** — a one-shot migration collapses per-issue conversations into
per-day conversations and repoints `conversation_turns`; the fallback of
dropping+recreating the tables is allowed only if the reshape fails on
real data and the user explicitly confirms.

## Goals / Non-Goals

**Goals:**

- Remove all magazine-shaped schema (`issues`, `issue_slots`, `sections`,
  `channels.section_id`) and rewire `conversations` to a per-day scope, in
  one idempotent SQL migration replayable on fresh installs.
- Delete every file on the `cleanup-inventory.md` "Delete entirely" list,
  including `/compose` (the phase-3 burn-in surface) and all issue/section
  routes.
- Rewrite OpenSpec capability specs to match code reality: delete
  `editorial-workspace` and `issue-archive`, rename `editorial-agent` to
  `curation-agent`, rewrite `home-view`. Minor touch-ups on
  `library-view` and `youtube-library-import` to strip section references.
- Scrub `CLAUDE.md` + `RUNBOOK.md` of magazine framing. Bump
  `RUNBOOK.md`'s `_Last verified:_` date. Preserve the operational invariant
  tying config/launch changes to both `justfile` and `RUNBOOK.md` — no
  launch/config surface changes here, so the invariant is a no-op, but the
  verification date gets updated.
- Preserve every consumption-shaped surface untouched (playlists, taste
  substrate + lab, home ranking, curation agent, library, inbox, watch).

**Non-Goals:**

- No new product surfaces, rankings, or tools. Net-subtractive only.
- No changes to the taste substrate (clusters, assignments, embeddings,
  enrichment, transcripts, weights, mutes).
- No changes to the home-ranking function (`rankForHome`), the rail stack,
  or the agent's tool set (phase-3 already removed slot tools).
- No reversal of phase-1/2/3 decisions; no re-opening of the 1:1
  conversation-issue binding question — the teardown resolves it by
  definition (binding gone).
- No retrofit of the history migrations (`008_magazine.sql`,
  `011_issues_slotted.sql`, `013_conversational_editor.sql`). They remain
  for fresh-install replay; the teardown migration is additive to history.
- No data preservation for `issues`/`issue_slots` beyond a single-file
  JSON export. No user-facing "archive" UI.

## Decisions

### 1. One teardown migration, additive to history

**Decision.** Write the teardown as a new migration
`db/migrations/016_magazine_teardown.sql` that performs (a) sections-to-tags
backfill, (b) `channels.section_id` drop, (c) drops `issue_slots` then
`issues` then `sections`, (d) reshapes `conversations` via a
`conversations_new` → rename dance, repointing `conversation_turns` inside
the same transaction.

**Why not** edit the original `008_magazine.sql` / `011_issues_slotted.sql`
to remove those tables at their creation site? Because `_migrations`
already records them as applied on every existing install, editing them
retroactively would skip re-application and silently diverge from fresh
installs. Additive teardown keeps history honest and keeps fresh installs
net-zero-footprint after all migrations run.

**Why 016?** Next free integer after `015_taste_cluster_mutes.sql`.

### 2. SQLite-native `DROP COLUMN` for `channels.section_id`

**Decision.** Use `ALTER TABLE channels DROP COLUMN section_id;`. SQLite
3.35+ (shipped with `better-sqlite3` ≥ 8) supports this directly.

**Why not** rebuild `channels` via a shadow table? Simpler. `section_id`
has no dependent indexes or FKs in our schema (`channels.section_id`
references `sections.id` but that reference evaporates once `sections` is
dropped, which happens in the same transaction). Rebuilding a 4-column
table for one dropped column is overhead without payoff.

### 3. `conversations` reshape: rebuild + repoint, with documented fallback

**Decision.** Inside the same transaction, create `conversations_new`
(`id`, `scope_date TEXT UNIQUE NOT NULL`, `created_at TEXT NOT NULL`),
populate it from `SELECT DISTINCT DATE(created_at, 'localtime')` over the
old `conversations` (one row per day, `created_at` = `MIN(created_at)` for
that day), update `conversation_turns.conversation_id` to point at the
new row for the same day, drop the old table, and rename. Two existing
conversations on the same day collapse to a single scope-day conversation;
their turn histories intermix in `created_at` order — acceptable since
conversation identity was never user-visible.

**Fallback (with explicit user confirmation only).** If the subquery
`UPDATE` fails on the real database (e.g., collation or date-function
issue), drop `conversations` and `conversation_turns` entirely and
recreate both empty. Phase-3 conversations are recoverable from
`ANTHROPIC_API_KEY` usage logs if absolutely needed; the loss is
acceptable for a single-user app and cheaper than a multi-hour recovery.
This path is not executed without the user saying yes.

**Why not** keep the `issue_id` column and null it out? Because the
entire point of the teardown is to remove the magazine shape from the
spec. A nullable `issue_id` perpetuates the binding in schema and in
every reader's mental model.

### 4. `/compose` is deleted in this change, not earlier

**Decision.** `/compose` and all `src/components/workspace/*` files are
deleted here, not in phase 3. Phase 3 moved user entry off `/compose`
and replaced it with `/` + the consumption rails, but kept the
`/compose` route reachable as a read-only burn-in safety net. Phase 4
ends the burn-in.

**Why not** delete it earlier? Because phase 3's atomic risk budget was
"new `/` works + agent still works + no data loss"; folding a delete
into that would have conflated rollback paths. Phase-4's deletion is
safe because phase-3 has now been in production and any follow-on
issues surfaced there, not on the drag board.

**Why not** leave it longer? Because it is the single largest remaining
locus of magazine code. Leaving it keeps phase-4's goals half-done.

### 5. `editorial-agent` → `curation-agent` rename (specs only)

**Decision.** This change renames the OpenSpec capability directory
`openspec/specs/editorial-agent/` to `openspec/specs/curation-agent/`
and rewrites the spec body to match what phase-3 actually shipped:
new tool set (`create_playlist`, `add_to_playlist`, `remove_from_playlist`,
`reorder_playlist`, `triage_inbox`, `mute_cluster_today`, `resurface`),
per-day conversation scope, curation-companion voice, no slot tools, no
house-style "editor-in-chief" framing.

No code changes here for the agent — phase 3 already did them. This
step just makes the spec tree honest.

**Why not** keep `editorial-agent` as a name and only edit content? The
name is a vestige of the prior framing and shows up in directory
listings, PR titles, and greps. Renaming is cheap; leaving the old name
is a lingering cost.

### 6. `editorial-workspace` and `issue-archive` spec directories deleted

**Decision.** Delete both directories outright (not mark deprecated).
These capabilities do not exist in the running app after this change;
there is no value to future readers in preserving their requirement
text. Git history preserves them for archaeology.

### 7. `home-view/spec.md` rewritten, not delta-patched

**Decision.** The phase-3 change already reshaped `/` in code; the
current `home-view/spec.md` is a mix of phase-1 magazine requirements
and phase-3 amendments. Rather than layer another delta, this change
writes a clean consumption-first spec: the five requirements are the
Right Now rail, Continue rail, Fresh rail, Playlist entry points, and
the global "magazine vocabulary absent" invariant.

**Why rewrite vs. delta-patch?** Deltas compound into unreadable specs.
At the boundary of a major capability reframe, rewriting is clearer for
future readers. The delta for OpenSpec purposes is "full replacement of
requirements." Archive the prior text in the change's `specs/home-view/`
sub-tree for traceability.

### 8. No feature flag; deploy as a single atomic change

**Decision.** All changes in this phase ship together (migration + file
deletions + doc updates + spec updates). No feature flag gates the
teardown.

**Why?** The burn-in period is phase-3's entire production lifetime.
Flagging the teardown just delays cost without reducing risk — users
(one) cannot A/B between "magazine deleted" and "magazine still there."

### 9. Pre-migration export + backup are runbook steps, not SQL

**Decision.** `scripts/export-issues.ts` writes
`backups/issues-pre-teardown.json` with every row of `issues` and
`issue_slots`. `just backup-db` copies `events.db` to a timestamped
path. Both are explicit tasks in `tasks.md`, executed by the operator
(the user) before applying the migration. Neither is part of the SQL
migration (migrations run inside the app on startup — they cannot
shell out to create backups).

### 10. Copy audit is part of tasks.md, not a separate artifact

**Decision.** Grep-based verification of magazine vocabulary
(`\b(issue|cover|featured|brief|slot|publish|draft|masthead|section|
department|editor-in-chief)\b` in `src/` and docs) is a task-list item,
not a separate capability. The goal is code + doc cleanliness, not a
durable invariant — once the terminology is gone, it is gone. (Taste
substrate section labels and spec-owned historical references are
exempt from the grep — tasks.md calls out the exclusions.)

## Risks / Trade-offs

- **[Risk] Conversation reshape loses turn history on collision.** Two
  conversations on the same day collapse into one, merging turn histories.
  **Mitigation:** acceptable (conversation identity was never
  user-visible; `created_at` preserves chronology). If unacceptable on
  real data, user switches to fallback (drop + recreate).

- **[Risk] Section labels disappearing from `/library`, `/watch` cards.**
  Cards in these pages may have rendered `section_name` badges.
  **Mitigation:** sections → tags migration creates a `tag_slug` for every
  channel that had a `section_id`. Card components should read from tags
  via existing helpers. If a card relied on `section_id`/`section_name`
  specifically, change it to the closest tag.

- **[Risk] `016_magazine_teardown.sql` fails partway through on a live
  DB.** SQLite transactions roll back on error, but `DROP COLUMN` is
  executed after `DROP TABLE sections`, so a failure here leaves the
  DB in a half-migrated state if the transaction boundary is wrong.
  **Mitigation:** wrap the entire migration in `BEGIN; ... COMMIT;`
  explicitly; let the migration runner record it atomically. Test the
  migration against a `just backup-db` copy before applying to the
  real DB (task-list item).

- **[Risk] Fresh-install replay breaks because history migrations
  reference now-dropped tables.** The 008/011/013 migrations create
  `issues`, `issue_slots`, `sections`; 016 drops them. A stale migration
  in between that reads (for example) from `sections` would fail on a
  fresh install. **Mitigation:** audit migrations 008–015 for any
  cross-table read on magazine tables (there are none: 009/010 touch
  tags, 012 taste, 013 conversations, 014 playlists, 015 mutes). 016
  is the only place magazine schema is dropped. Fresh install replay
  net: "created then dropped, net zero."

- **[Risk] The rename `editorial-agent` → `curation-agent` confuses
  change history.** **Mitigation:** leave a redirect note in the
  archived `conversational-editor` umbrella's README (already under
  `changes/archive/`) if needed. OpenSpec's archive index survives.

- **[Trade-off] `issues`/`issue_slots` export is JSON, not SQL.**
  Recovery into a resurrected schema would require writing an importer.
  Accepted because (a) there are no realistic resurrection scenarios
  and (b) JSON is strictly easier to diff and audit than a SQL dump.

- **[Trade-off] No staged rollout.** This is a single atomic
  change — doc + schema + code + specs all land together. Accepted
  because the user is the sole operator and this is not a multi-tenant
  system.

## Migration Plan

This plan is the canonical sequence; `tasks.md` expresses it as a
checklist. Steps are executed by the operator (user); code changes land
in a single commit series on `main`.

1. **Pre-flight**
   - Confirm `/compose` has had ≥ 1 week of burn-in since phase-3
     shipped. If not, pause and continue consumption-first phase 3
     observation.
   - Confirm no open in-flight changes under
     `openspec/changes/` other than `consumption-first` and
     `magazine-teardown`.

2. **Safety snapshot**
   - `just backup-db` → copies `events.db` to a timestamped file;
     path recorded in this change's `tasks.md` checklist.
   - `tsx scripts/export-issues.ts` → writes
     `backups/issues-pre-teardown.json`. Log the row counts
     (issues, issue_slots) in `tasks.md`.
   - Run the new `016_magazine_teardown.sql` against the backup copy
     (`events.db.YYYY-MM-DD-HHMMSS.bak`) via a throwaway `tsx` script
     or manual `sqlite3`. Inspect the resulting schema; confirm the
     sections→tags migration produced the expected `channel_tags`
     rows. Do not proceed unless this succeeds.

3. **Code + doc changes (single commit or PR series)**
   - Add `db/migrations/016_magazine_teardown.sql`.
   - Add `scripts/export-issues.ts`.
   - Delete the "Delete entirely" file list from `cleanup-inventory.md`.
   - Reshape `consumption.ts`, `types.ts`, `youtube-import.ts`,
     `watch/[id]/page.tsx`, `watch/[id]/MobileWatch.tsx`,
     `components/KeyboardHelp.tsx` (remove `section` references).
   - Rename `openspec/specs/editorial-agent/` →
     `openspec/specs/curation-agent/` and rewrite body.
   - Delete `openspec/specs/editorial-workspace/` and
     `openspec/specs/issue-archive/`.
   - Rewrite `openspec/specs/home-view/spec.md`.
   - Minor edits to `openspec/specs/library-view/spec.md` and
     `openspec/specs/youtube-library-import/spec.md`.
   - Scrub `CLAUDE.md` and `RUNBOOK.md`; bump `_Last verified:_`.

4. **Apply**
   - Run `npm run dev`; migration runner applies `016_magazine_teardown.sql`
     on startup. Confirm no error, confirm `_migrations` row added.
   - Hit `/` — consumption-first home loads. Hit `/inbox`, `/library`,
     `/watch/<id>`, `/taste`, `/taste/<id>`, `/playlists`, `/playlists/<id>` —
     all 200. Hit `/compose`, `/issues`, `/issues/<id>`, `/section/<slug>`,
     `/sections` — all 404.
   - Run `grep -rE '\b(issue|cover_video|pinned_cover|composeIssue|
     pickFeatured|pickBriefs|effectiveCoverId|setCoverPin|
     getOrPublishTodaysIssue|assignSlot|swapSlots|clearSlot|SlotKind)\b'
     src/ db/` — returns only history migrations and archived OpenSpec
     changes. No active code references.

5. **Archive**
   - Move `openspec/changes/magazine-teardown/` to
     `openspec/changes/archive/YYYY-MM-DD-magazine-teardown/`.
   - Move `openspec/changes/conversational-editor/` to
     `openspec/changes/archive/YYYY-MM-DD-conversational-editor/` (its
     remaining specs are gone).
   - Update `consumption-first/cleanup-inventory.md` phase-4 checklist
     items to checked.

**Rollback.** `cp events.db.YYYY-MM-DD-HHMMSS.bak events.db` and
`git revert` the teardown commits. The JSON export is not used in
rollback (the restore is schema + data).

## Open Questions

- None. `cleanup-inventory.md` resolved scope; this design resolves
  the reshape strategy, rename, and sequencing. Proceed to specs +
  tasks.
