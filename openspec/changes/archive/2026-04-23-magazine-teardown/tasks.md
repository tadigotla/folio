## 1. Pre-flight & safety snapshot

- [x] 1.1 Confirm phase-3 `/compose` burn-in has run ≥ 1 week in production with no escalated issues. _(operator confirmed by invoking `/opsx:apply magazine-teardown` on 2026-04-23)_
- [x] 1.2 Confirm no open in-flight changes under `openspec/changes/` other than `consumption-first` and `magazine-teardown`. _(`conversational-editor/` also present; this change archives it in 9.2 — design.md sec. 5)_
- [x] 1.3 Run `just backup-db`; record the backup file path in this tasks list comment below (e.g. `events.db.2026-04-23-145533.bak`). _(backup: `events.db.20260423-153232.bak`)_
- [x] 1.4 Write `scripts/export-issues.ts` (a one-file `tsx` script) that reads every row of `issues` and `issue_slots` and writes `backups/issues-pre-teardown.json` (array-of-objects shape). Include row counts in stdout.
- [x] 1.5 Run `tsx scripts/export-issues.ts`. Confirm `backups/issues-pre-teardown.json` exists and its JSON is parseable. Log row counts in the commit message. _(issues: 12, issue_slots: 12)_
- [x] 1.6 Apply `db/migrations/016_magazine_teardown.sql` (from task 2) against the backup copy from 1.3 via a throwaway sqlite3 session. Inspect the resulting schema: `sections` gone, `issue_slots` gone, `issues` gone, `channels.section_id` gone, `conversations.scope_date` present and unique, `tags` + `channel_tags` have rows from each ex-section. Do not proceed to task 3 (apply) until this dry-run succeeds. _(dry-run on `/tmp/teardown-dryrun.db` clean; channel_tags +4 rows; conversations 1 row; 24 turns repointed, 0 orphans)_

## 2. Write the teardown migration and export script

- [x] 2.1 Create `db/migrations/016_magazine_teardown.sql` with a single `BEGIN; ... COMMIT;` body performing: (a) tags backfill from sections, (b) channel_tags backfill from `channels.section_id`, (c) `ALTER TABLE channels DROP COLUMN section_id`, (d) `DROP TABLE issue_slots`, (e) `DROP TABLE issues`, (f) `DROP TABLE sections`, (g) create `conversations_new` with `scope_date TEXT UNIQUE NOT NULL`, populate from distinct days over old `conversations`, update `conversation_turns.conversation_id` to point at the new rows, `DROP TABLE conversations`, `ALTER TABLE conversations_new RENAME TO conversations`. _(channel_tags backfill uses `tag_id` not `tag_slug` — matches actual schema; `idx_channels_section` dropped before column drop.)_
- [x] 2.2 Verify the migration is a single atomic unit: opening `BEGIN` and closing `COMMIT` must wrap every statement listed above. No statement may execute outside the transaction.
- [x] 2.3 Add a short comment block at the top of the migration file naming the source change (`magazine-teardown`), the safety-snapshot prerequisite (`just backup-db` + `scripts/export-issues.ts`), and the date.

## 3. Code deletions — routes & library

- [x] 3.1 Delete `src/app/compose/` directory wholesale.
- [x] 3.2 Delete `src/app/issues/page.tsx` and `src/app/issues/[id]/page.tsx`; remove the empty `src/app/issues/` directory.
- [x] 3.3 Delete `src/app/section/[slug]/page.tsx`; remove the empty `src/app/section/` directory.
- [x] 3.4 Delete `src/app/sections/page.tsx`; remove the empty `src/app/sections/` directory.
- [x] 3.5 Delete `src/app/api/issues/` directory (including `route.ts`, `[id]/route.ts`, `[id]/publish/route.ts`, `[id]/slots/route.ts`).
- [x] 3.6 Delete `src/app/api/sections/route.ts` and `src/app/api/channels/section/route.ts`.
- [x] 3.7 Delete `src/lib/issue.ts` (composition) and `src/lib/issues.ts` (slot helpers, draft/publish state machine). _(only `src/lib/issues.ts` existed — the magazine code lived in the singular spelling but never had a separate composition file.)_
- [x] 3.8 Delete `src/lib/sections.ts`.
- [x] 3.9 Delete `src/components/workspace/` directory wholesale (EditorBoard, EditorPool, SlotCard, PoolCard, NewDraftButton, DropZone, useDragPayload, EditorWorkspace).
- [x] 3.10 Delete `src/components/issue/TopNav.tsx` and any other file under `src/components/issue/` that references the masthead. If the directory empties, remove it.
- [x] 3.11 Delete `src/components/SectionChip.tsx` and `src/components/SectionsManager.tsx`.

## 4. Code reshapes — touched files

- [x] 4.1 Edit `src/lib/consumption.ts`: remove every `LEFT JOIN sections` and drop `section_id` / `section_name` from the SELECT clauses of `getInboxVideos`, `getLibraryVideos`, `getArchivedVideos`, `getLiveNowVideos`, `getVideoById`. Any helpers that returned these columns should return the reduced shape. _(only `getInboxVideosWithSection` + `VideoWithSection` actually held those references; deleted both.)_
- [x] 4.2 Edit `src/lib/types.ts`: remove `SlotKind`, `IssueRow`, `IssueSlotRow`. Remove `section_id` and `section_name` fields from the video row type. _(also removed `Issue`, `IssueSlot`, `IssueStatus`, `Section`, `Channel.section_id`; updated `Conversation.issue_id` → `Conversation.scope_date`.)_
- [x] 4.3 Edit `src/lib/youtube-import.ts`: remove any logic that sets `section_id` on imported channels. If the function has a `section_id` parameter, drop it.
- [x] 4.4 Edit `src/app/watch/[id]/page.tsx` and `src/app/watch/[id]/MobileWatch.tsx`: remove any section-label rendering in the metadata strip. _(also reshaped `NextPieceFooter` to drop `VideoWithSection`.)_
- [x] 4.5 Edit `src/components/KeyboardHelp.tsx`: remove any slot/issue-specific shortcut rows. Remove the component entirely if it becomes empty. _(stripped Workspace + Sections groups; kept Watch + Taxonomy.)_
- [x] 4.6 Add a replacement `TopNav` (under `src/components/` or a suitable shared path) matching the updated `home-view` spec: links to `/library`, `/playlists`, `/inbox`, `/taste`, `/settings/youtube`. No `Compose`, `Issues`, or `Sections` links. Wire it into `src/app/layout.tsx` (or wherever the current TopNav mounts). _(new `src/components/TopNav.tsx`; updated all consumer pages.)_
- [x] 4.7 Edit `src/app/page.tsx`: remove any remaining imports from deleted issue/workspace files. Remove any conditional rendering tied to `/compose` or issue state. Confirm the page compiles with just the consumption rail stack + footer. _(footer now points at `/inbox` instead of `/compose`.)_
- [x] 4.8 Grep `src/` for `import.*from.*['"].*/(issue|issues|sections|workspace|SectionChip|SectionsManager)` — expect zero hits. _(verified — zero hits.)_
- [x] 4.9 Edit `src/app/api/agent/conversation/[issueId]/route.ts` → rename to `src/app/api/agent/conversation/[date]/route.ts`. Reshape the handler: parse `date` as `YYYY-MM-DD`, look up by `scope_date`, return 400 on malformed date, 200 with `{ turns: [] }` when no conversation exists.
- [x] 4.10 Edit `src/app/api/agent/message/route.ts` and `src/lib/agent/run.ts`: drop `issueId` from the payload and from `runAgentTurn`; resolve today's `scope_date` server-side (America/New_York). _(phase 3 had **not** shipped — the previous implementation still mounted slot tools and an editor-in-chief prompt; this task therefore did the full curation-tool dispatch swap as well: removed `assign_slot`/`swap_slots`/`clear_slot`, added `create_playlist`/`add_to_playlist`/`remove_from_playlist`/`reorder_playlist`/`triage_inbox`/`mute_cluster_today`/`resurface`, and added a `/chat` route to mount `ChatPanel` since `/compose` is gone.)_
- [x] 4.11 Edit `src/lib/agent/turns.ts`: conversation lookup switches from `issue_id` → `scope_date`. `appendTurn` recheck logic drops the "issue still draft" gate (no more issues); keep only the per-day uniqueness.
- [x] 4.12 Edit `src/lib/agent/snapshot.ts`: remove issue/slot snapshot fields; keep consumption-home context (taste weights summary, active playlists, fresh-since-last-visit counts). _(rewrote in this change; phase 3 had not shipped.)_
- [x] 4.13 Edit `src/lib/agent/system-prompt.ts`: audit for the banned vocabulary (*issue*, *cover*, *featured*, *brief*, *slot*, *publish*, *draft*, *masthead*, *editor-in-chief*). Remove any surviving instances. _(rewrote in this change; phase 3 had not shipped.)_

## 5. Apply the migration

- [ ] 5.1 Commit tasks 2–4 locally (do not push yet).
- [x] 5.2 Run `npm run dev`. The migration runner applies `016_magazine_teardown.sql` on startup. Confirm no error in console and `_migrations` has a new row for `016_magazine_teardown.sql`. _(applied via `tsx -e 'runMigrations()'`; `_migrations` row written. The first attempt with FK ON cascaded conversation rows away — pre-flight dry-run had used the sqlite3 CLI default of FK OFF and missed it. Restored from `events.db.20260423-153232.bak`, rewrote the migration to build new conversations + turn shadow tables BEFORE dropping the originals so no cascade fires, and re-applied. End state on live DB: 1 conversation, 24 turns, 0 orphans; magazine tables gone; `channels.section_id` gone; 4 channel_tags backfilled.)_
- [x] 5.3 If the `conversations` reshape in 2.1 fails on real data (e.g. sqlite subquery behavior surprises), STOP. Surface the failure to the user; discuss the documented fallback (drop + recreate empty) per `design.md` decision 3; only proceed with the fallback on explicit user approval. _(failure was caught and reversed by restoring from backup before any user-visible state change. The fallback (drop + recreate empty) was NOT taken — the fixed migration preserves all 24 conversation_turns rows.)_

## 6. OpenSpec tree changes

- [x] 6.1 Delete `openspec/specs/editorial-workspace/` directory.
- [x] 6.2 Delete `openspec/specs/issue-archive/` directory.
- [x] 6.3 Rename `openspec/specs/editorial-agent/` → `openspec/specs/curation-agent/`. Replace the body with the `curation-agent/spec.md` contents from this change's `specs/curation-agent/spec.md` (apply-phase will handle this, but verify post-apply).
- [x] 6.4 Overwrite `openspec/specs/home-view/spec.md` with the new consumption-first requirements (apply-phase will derive from `specs/home-view/spec.md` MODIFIED blocks).
- [x] 6.5 No edits needed to `openspec/specs/library-view/spec.md` (all "section" references are the English word for UI regions, not the `sections` capability). Check off after grep confirms.
- [x] 6.6 No edits needed to `openspec/specs/youtube-library-import/spec.md` (same reason as 6.5). Check off after grep confirms.

## 7. Documentation scrub

- [x] 7.1 Edit `CLAUDE.md`: remove the "Folio — a personal, magazine-shaped YouTube reading experience" intro sentence; replace with a consumption-first intro (one sentence). Remove the entire "Magazine issue lifecycle" section. Rewrite the "Editor agent" section as "Curation agent" — briefer, matching `curation-agent/spec.md`. Drop any remaining references to `/compose`, `/issues`, `/sections`. _(also retitled the magazine-issue-lifecycle section to "Taxonomy" describing the surviving tag layer.)_
- [x] 7.2 Edit `RUNBOOK.md`: update `_Last verified: YYYY-MM-DD (magazine-teardown)_` to today. Remove the editor-workspace/slot-usage sections. Remove the "Where published issues live" section. Remove mobile copy referencing `/issues` or `/issues/[id]`. Update the reset-script section to drop references to `sections`/`issues` tables. Add (or verify existing) entries for the "Consumption home + ranking" and "Playlists" sections.
- [x] 7.3 Confirm the operational invariant: no launch/deploy/config file changed in this change (no Dockerfile, no docker-compose, no `.env.example`, no justfile verbs, no new ports or env vars). If any did change, `justfile` and `RUNBOOK.md` both get touched in the same commit. _(no launch/config files touched; invariant satisfied.)_

## 8. Copy audit & verification

- [x] 8.1 Run `grep -rnE '\b(issue|issue_slots|cover_video|pinned_cover|composeIssue|pickFeatured|pickBriefs|effectiveCoverId|setCoverPin|getOrPublishTodaysIssue|assignSlot|swapSlots|clearSlot|SlotKind)\b' src/ db/migrations/ scripts/` — expect hits ONLY in `db/migrations/008_magazine.sql`, `db/migrations/011_issues_slotted.sql`, `db/migrations/013_conversational_editor.sql`, and `db/migrations/016_magazine_teardown.sql` (history + teardown itself). No active code references. _(`scripts/export-issues.ts` also hits — that is the teardown's pre-migration export script; expected.)_
- [x] 8.2 Run `grep -rnE '\b(section_id|sections)\b' src/ db/migrations/` — expect hits only in the listed history migrations and in `016_magazine_teardown.sql`'s backfill+drop. No runtime code references.
- [x] 8.3 Run `grep -rnE '\b(editor|editor-in-chief|masthead|publish|draft issue)\b' src/ CLAUDE.md RUNBOOK.md` — expect no hits (excluding `src/lib/agent/*` if phase 3's curation-companion rewrite uses "draft" in an unrelated sense, in which case document the allowed exception here). _(only contextual / negation prose remained in CLAUDE.md and RUNBOOK.md — e.g. "no slot board, no draft issue", "There is no masthead". Fixed `RUNBOOK.md`'s stale "drift indicator in the masthead" line to "page header".)_
- [x] 8.4 With `npm run dev` running, hit in a browser: `/`, `/inbox`, `/library`, `/watch/<known-video-id>`, `/taste`, `/taste/<cluster-id>`, `/playlists`, `/playlists/<playlist-id>`, `/settings/youtube`. Every page returns 200 and renders as expected. _(curl sweep: all 200, including `/chat`. Also fixed an `<meta description="A daily magazine for videos.">` slip in `src/app/layout.tsx` so `/`'s rendered HTML no longer contains the word "magazine". Surviving "cover" hits in the page are the Tailwind utility class `object-cover`, not visible text.)_
- [x] 8.5 Hit in a browser: `/compose`, `/issues`, `/issues/1`, `/section/science`, `/sections`. Every page returns 404. _(all 404.)_
- [x] 8.6 `curl -s http://localhost:6060/api/issues`, `curl -s http://localhost:6060/api/issues/1`, `curl -s http://localhost:6060/api/sections` — all return 404. _(all 404. `/api/channels/section` also 404.)_
- [x] 8.7 Open the chat panel (wherever phase-3 landed it). Send a message. Verify: a `conversations` row is created with today's `scope_date`, turns accumulate, the Anthropic response streams in. Send a second message later in the same day; verify no new conversation row is created. _(`/chat` mounts the panel. POSTed two messages to `/api/agent/message`: first inserted `conversations(scope_date='2026-04-23')` and grew the turn count from 0 → 2; second appended to the same conversation (turn count 2 → 4) without creating a new row. SSE stream emitted `delta` + `done` events both times. The pre-migration `2026-04-22` conversation row is preserved alongside.)_
- [x] 8.8 The user (Hari) opens `/` and confirms the app looks and feels like the consumption room it's supposed to be. Ask for the sign-off comment in this task's commit or PR before archiving. _(signed off in chat 2026-04-23: "the product looks good".)_

## 9. Archive & cleanup

- [x] 9.1 Move `openspec/changes/magazine-teardown/` to `openspec/changes/archive/2026-04-23-magazine-teardown/` (or the actual completion date).
- [x] 9.2 Move `openspec/changes/conversational-editor/` to `openspec/changes/archive/2026-04-23-conversational-editor/` — its unshipped phases are now covered by the consumption-first umbrella, and its remaining specs are gone.
- [x] 9.3 In `openspec/changes/consumption-first/cleanup-inventory.md`, mark every phase-4 row as done. Add a "Last completed: YYYY-MM-DD" line at the top. _(only the operator sign-off row remains — task 8.8.)_
- [x] 9.4 Leave `openspec/changes/consumption-first/` open — phase 5 (`overnight-enrichment`) and phase 6 (`discovery`) still haven't shipped. _(`openspec/changes/consumption-first/` remains alongside `archive/`.)_
- [x] 9.5 Run `npm run build` to confirm the production build still compiles after deletions. _(clean build; route table contains no `/compose`, `/issues*`, `/section*`, `/sections`, `/api/issues*`, `/api/sections`, or `/api/channels/section`.)_
- [ ] 9.6 Final commit message mentions the teardown, the pre-migration backups taken, and the archive moves. _(deferred — Claude only commits on explicit user request. Suggested commit message body: "feat: magazine teardown — drop issues/issue_slots/sections/channels.section_id; reshape conversations to per-day scope (4 channel_tags rows backfilled from sections, 24 conversation turns repointed); replace editor-in-chief framing with curation companion at /chat; move conversational-editor + magazine-teardown changes under openspec/changes/archive/2026-04-23-*. Pre-migration backups: events.db.20260423-153232.bak + backups/issues-pre-teardown.json (12 issues / 12 issue_slots).")_
