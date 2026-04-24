# Cleanup Inventory — Magazine Teardown

_Last completed: 2026-04-23 (phase 5 / `overnight-maintenance` shipped — nightly pipeline + discovery substrate; phase 6a (description-graph) was absorbed into phase 5, so the remaining phase 6 is **active discovery only**: `search_youtube` agent tool + `/inbox` Proposed rail + approve/dismiss endpoints + `YOUTUBE_API_KEY`.)_

_Prior: 2026-04-23 (phase 4 / `magazine-teardown` shipped — see `openspec/changes/archive/2026-04-23-magazine-teardown/`)._

This file is the authoritative checklist for everything the magazine framing touches in the codebase, the database, the docs, and the OpenSpec tree. It is the ground truth for **phase 4 (`magazine-teardown`)** and a reference for phases 1–3 to avoid touching surfaces that are about to go away.

All paths are repo-root-relative. Inventory taken on 2026-04-23.

---

## Section key

Each table below uses:

- **Action** — `DELETE` (remove entirely), `RESHAPE` (rewrite to a new form), `KEEP` (survives untouched), `MIGRATE-DATA` (one-shot data move, then the source goes).
- **Phase** — which umbrella phase performs the action.
- **Blocker** — what must be true before the action can execute (data migration, spec update, user confirmation, etc.).

---

## 1. Database schema

### 1a. Tables

| Table | Action | Phase | Blocker |
|---|---|---|---|
| `issues` | DELETE | 4 | Export rows to `backups/issues-pre-teardown.json`; `just backup-db` run; no live reads remaining (phase 3 retired them) |
| `issue_slots` | DELETE | 4 | Cascades with `issues`; no live reads/writes |
| `sections` | MIGRATE-DATA → tags; then DELETE | 4 | Data copied to `tags` + `channel_tags`; `channels.section_id` column dropped |
| `conversations` | RESHAPE | 4 | `issue_id UNIQUE NOT NULL FK` replaced with `scope_date TEXT UNIQUE NOT NULL`; see `design.md` "Conversation scope" |
| `conversation_turns` | KEEP | — | Structure unchanged; its parent FK target is the reshaped `conversations` |
| `videos` | KEEP | — | Unchanged |
| `channels` | RESHAPE | 4 | `section_id` column dropped; everything else unchanged |
| `consumption` | KEEP | — | Unchanged; remains the user-state lifecycle table |
| `sources` | KEEP | — | Unchanged |
| `channel_tags` | KEEP | — | Gains new rows from sections migration |
| `tags` | KEEP | — | Gains new rows from sections migration |
| `oauth_tokens` | KEEP | — | Stub still pending; unrelated to magazine |
| `highlights` | KEEP | — | Stub still pending; unrelated to magazine |
| `video_embeddings` | KEEP | — | Taste substrate, preserved |
| `video_enrichment` | KEEP | — | Taste substrate, preserved |
| `video_transcripts` | KEEP | — | Taste substrate, preserved |
| `taste_clusters` | KEEP | — | Taste substrate, preserved; `weight` column gains active read path in phase 2 |
| `video_cluster_assignments` | KEEP | — | Taste substrate, preserved |
| `video_provenance` | KEEP | — | Preserved |
| **NEW: `playlists`** | ADD | 1 | New in phase 1 |
| **NEW: `playlist_items`** | ADD | 1 | New in phase 1 |
| **NEW: `nightly_runs`** | ADD | 5 | New in phase 5 |
| **NEW: `discovery_candidates`** | ADD | 6 | New in phase 6 — staging for proposed imports |
| **NEW: `discovery_rejections`** | ADD | 6 | New in phase 6 — dismissed candidate identities |

### 1b. Migrations

Existing magazine-related migrations are not deleted — they are part of history and must replay cleanly on a fresh DB. The teardown is expressed as a NEW migration that drops/reshapes:

| Migration | Status |
|---|---|
| `db/migrations/008_magazine.sql` | KEEP as history (introduced `sections` + early `issues`) |
| `db/migrations/011_issues_slotted.sql` | KEEP as history (introduced slotted `issues` + `issue_slots`) |
| `db/migrations/013_conversational_editor.sql` | KEEP as history (introduced `conversations` bound to `issues`) |
| **NEW `NNN_playlists.sql`** | ADD in phase 1 |
| **NEW `NNN_nightly_runs.sql`** | ADD in phase 5 |
| **NEW `NNN_discovery.sql`** | ADD in phase 6 — `discovery_candidates` + `discovery_rejections` |
| **NEW `NNN_magazine_teardown.sql`** | ADD in phase 4 — drops `issues`, `issue_slots`, `sections`; drops `channels.section_id`; reshapes `conversations` |

Fresh-install replay note: new installs will apply all history migrations including the teardown, net effect being "magazine schema never existed." No branches in migration logic.

### 1c. Data migration steps (phase 4)

Executed inside a single transaction in `NNN_magazine_teardown.sql`, with `just backup-db` run immediately before:

1. Export: `SELECT * FROM issues` and `SELECT * FROM issue_slots` dumped to `backups/issues-pre-teardown.json` via a pre-migration script (`scripts/export-issues.ts`). Not part of the SQL migration; run in tasks.md for phase 4.
2. Sections → tags:
   ```sql
   INSERT OR IGNORE INTO tags (slug, name)
     SELECT lower(replace(name, ' ', '-')), name FROM sections;
   INSERT OR IGNORE INTO channel_tags (channel_id, tag_slug, created_at)
     SELECT c.id, lower(replace(s.name, ' ', '-')), datetime('now')
     FROM channels c
     JOIN sections s ON c.section_id = s.id
     WHERE c.section_id IS NOT NULL;
   ```
3. Reshape `channels`:
   ```sql
   ALTER TABLE channels DROP COLUMN section_id;
   ```
4. Drop magazine tables:
   ```sql
   DROP TABLE issue_slots;
   DROP TABLE issues;
   DROP TABLE sections;
   ```
5. Reshape `conversations`:
   ```sql
   CREATE TABLE conversations_new (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     scope_date TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   );
   INSERT INTO conversations_new (scope_date, created_at)
     SELECT DISTINCT DATE(created_at, 'localtime'), MIN(created_at)
     FROM conversations
     GROUP BY DATE(created_at, 'localtime');
   -- Repoint conversation_turns to new conversation ids:
   UPDATE conversation_turns SET conversation_id = (
     SELECT cn.id FROM conversations_new cn
     JOIN conversations c ON DATE(c.created_at, 'localtime') = cn.scope_date
     WHERE c.id = conversation_turns.conversation_id
     LIMIT 1
   );
   DROP TABLE conversations;
   ALTER TABLE conversations_new RENAME TO conversations;
   ```

**Fallback for conversation reshape:** if `UPDATE` complexity above fails on the real data, the acceptable fallback is to drop `conversations` and `conversation_turns` entirely and recreate empty. Document the choice in phase 4's tasks.md; ask the user to confirm before committing.

---

## 2. Code — files and functions

### 2a. Delete entirely

| Path | Phase | Notes |
|---|---|---|
| `src/lib/issues.ts` | 4 | Slot helpers, draft/publish state machine, `assignSlot`/`swapSlots`/`clearSlot` |
| `src/lib/sections.ts` | 4 | Sections CRUD |
| `src/app/api/issues/route.ts` | 4 | List/create draft |
| `src/app/api/issues/[id]/route.ts` | 4 | Read/discard a draft |
| `src/app/api/issues/[id]/publish/route.ts` | 4 | Publish endpoint |
| `src/app/api/issues/[id]/slots/route.ts` | 4 | Slot mutations |
| `src/app/api/sections/route.ts` | 4 | Sections CRUD API |
| `src/app/api/channels/section/route.ts` | 4 | Section assignment API |
| `src/app/issues/page.tsx` | 4 | Archive index (already part of `issue-archive` capability) |
| `src/app/issues/[id]/page.tsx` | 4 | Read-only published issue view |
| `src/app/section/[slug]/page.tsx` | 4 | Department page |
| `src/app/sections/page.tsx` | 4 | Sections management page |
| `src/components/issue/TopNav.tsx` | 4 | Masthead with `↻ Publish new` button |
| `src/components/SectionChip.tsx` | 4 | Section assignment chip |
| `src/components/SectionsManager.tsx` | 4 | Sections manager UI |
| `src/components/workspace/EditorWorkspace.tsx` | 3 or 4 | Two-column slot + chat workspace (phase 3 replaces it on `/`; phase 4 deletes the file) |
| `src/components/workspace/EditorBoard.tsx` | 4 | Slot board |
| `src/components/workspace/EditorPool.tsx` | 4 | Pool column |
| `src/components/workspace/SlotCard.tsx` | 4 | Slot card component |
| `src/components/workspace/PoolCard.tsx` | 4 | Pool card component |
| `src/components/workspace/NewDraftButton.tsx` | 4 | New-draft action |
| `src/components/workspace/DropZone.tsx` | 4 | Drag target |
| `src/components/workspace/useDragPayload.ts` | 4 | Drag payload hook |

### 2b. Reshape (partial delete + rewrite)

| Path | Phase | What changes |
|---|---|---|
| `src/app/page.tsx` | 3 | Complete rewrite to the consumption-first layout (see design.md "The new shape of `/`"). Phase 3 delivers the new file; phase 4 removes any remaining issue-related imports |
| `src/app/api/agent/conversation/[issueId]/route.ts` | 3 | Route moves from `[issueId]` to `[date]` (or deleted if conversation lookup becomes implicit). Phase 3 decides final path |
| `src/app/api/agent/message/route.ts` | 3 | Payload loses `issueId`, gains conversation-per-day semantics. Tool dispatch swaps to new tool set |
| `src/lib/agent/run.ts` | 3 | `runAgentTurn` signature drops `issueId`; gains `scopeDate` resolved server-side. Tool-dispatch updated |
| `src/lib/agent/tools.ts` | 3 + 6 | Phase 3: remove `assign_slot`/`swap_slots`/`clear_slot`; add `create_playlist`/`add_to_playlist`/`remove_from_playlist`/`reorder_playlist`/`triage_inbox`/`mute_cluster_today`/`resurface`. Phase 6: add `search_youtube` + `propose_import` |
| `src/lib/agent/snapshot.ts` | 3 | No longer snapshots issue/slot state; snapshots the consumption-first home context (taste weights summary, active playlists, fresh-since-last-visit counts) |
| `src/lib/agent/system-prompt.ts` | 3 | Rewrite to curation-companion voice; drop editor-in-chief framing |
| `src/lib/agent/turns.ts` | 3 | Conversation lookup is per-day, not per-issue |
| `src/lib/consumption.ts` | 4 | `section_id` / `section_name` columns dropped from query results (see `getInboxVideos` etc.). Drop the LEFT JOIN on `sections` |
| `src/lib/types.ts` | 4 | Remove `SlotKind`, `IssueRow`, `IssueSlotRow`, `section_id`, `section_name` from video row type |
| `src/lib/youtube-import.ts` | 4 | Drop any logic that sets `section_id` on imported channels |
| `src/app/watch/[id]/page.tsx` | 4 | Remove any section-label rendering in the metadata strip |
| `src/app/watch/[id]/MobileWatch.tsx` | 4 | Same |
| `src/components/KeyboardHelp.tsx` | 3 | Remove slot/issue-specific shortcuts |

### 2c. Reintroduce (was removed during the conversational-editor phase)

| Path | Phase | What it is |
|---|---|---|
| `src/app/inbox/page.tsx` | 3 | RUNBOOK notes `/inbox` was removed and replaced by in-workspace triage. The consumption-first home pushes users to a triage surface again via the "browse fresh →" link. This route must exist, with pre-sorted taste-aware ordering |
| `src/app/playlists/page.tsx` | 1 | New: list + manage playlists |
| `src/app/playlists/[id]/page.tsx` | 1 | New: single playlist view + edit |
| `src/lib/playlists.ts` | 1 | New: playlist mutation + read helpers |
| `src/lib/home-ranking.ts` | 2 | New: `rankForHome()` |
| `src/lib/nightly/run.ts` | 5 | New: nightly entry point |
| `scripts/nightly.ts` | 5 | New: cron/launchd entrypoint |
| `src/lib/discovery/description-graph.ts` | 6 | New: parse saved-video descriptions + transcripts for YouTube links and @handles |
| `src/lib/discovery/search.ts` | 6 | New: YouTube Data API `search.list` wrapper |
| `src/lib/discovery/score.ts` | 6 | New: candidate scoring against taste clusters |
| `src/lib/discovery/candidates.ts` | 6 | New: read/write `discovery_candidates` + `discovery_rejections` |
| `src/lib/discovery/approve.ts` | 6 | New: approve → write to `sources`/`videos`/`consumption` |
| `src/app/api/discovery/candidates/route.ts` | 6 | New: list proposed candidates |
| `src/app/api/discovery/candidates/[id]/approve/route.ts` | 6 | New: approve a candidate |
| `src/app/api/discovery/candidates/[id]/dismiss/route.ts` | 6 | New: dismiss a candidate |
| `src/app/api/discovery/rejections/route.ts` | 6 | New: clear rejections (GET = list, DELETE = clear all or one) |
| `src/components/discovery/ProposedRail.tsx` | 6 | New: `/inbox` top rail |
| `src/components/discovery/CandidateCard.tsx` | 6 | New: single candidate card |

---

## 3. API routes — final state

Target shape after umbrella completion:

| Route | Status |
|---|---|
| `POST /api/consumption` | KEEP |
| `POST /api/consumption-progress` | KEEP |
| `POST /api/agent/message` | RESHAPE (phase 3) |
| `GET /api/agent/status` | KEEP |
| `GET /api/agent/conversation/[date]` | NEW (phase 3, replaces `[issueId]`) |
| `GET /api/issues`, `POST /api/issues` | DELETE (phase 4) |
| `GET /api/issues/[id]`, `DELETE /api/issues/[id]` | DELETE (phase 4) |
| `POST /api/issues/[id]/publish` | DELETE (phase 4) |
| `PUT/PATCH/DELETE /api/issues/[id]/slots` | DELETE (phase 4) |
| `GET/POST/PATCH /api/sections` | DELETE (phase 4) |
| `POST /api/channels/section` | DELETE (phase 4) |
| `GET/POST/PATCH /api/tags`, `/api/channels/tags` | KEEP |
| `GET/POST /api/playlists`, `/api/playlists/[id]`, `/api/playlists/[id]/items` | NEW (phase 1) |
| `POST /api/home/rank` | NEW (phase 2, optional if `/` can call the function directly in RSC) |
| `GET /api/discovery/candidates` | NEW (phase 6) — list proposed |
| `POST /api/discovery/candidates/[id]/approve` | NEW (phase 6) |
| `POST /api/discovery/candidates/[id]/dismiss` | NEW (phase 6) |
| `GET /api/discovery/rejections`, `DELETE /api/discovery/rejections`, `DELETE /api/discovery/rejections/[id]` | NEW (phase 6) |
| `GET/POST/PATCH /api/taste/*` | KEEP |
| `GET/POST /api/youtube/*` | KEEP (OAuth-based library import — distinct from phase 6's API-key-based `search_youtube`) |

---

## 4. Pages / routes

| Route | Action | Phase |
|---|---|---|
| `/` | RESHAPE | 3 |
| `/inbox` | RE-ADD; phase 6 adds "Proposed" rail at top | 3 + 6 |
| `/library` | KEEP | — |
| `/watch/[id]` | KEEP (minor: drop section label) | 4 |
| `/taste`, `/taste/[clusterId]` | KEEP | — |
| `/tag/[slug]` | KEEP | — |
| `/section/[slug]` | DELETE | 4 |
| `/sections` | DELETE | 4 |
| `/issues`, `/issues/[id]` | DELETE | 4 |
| `/playlists`, `/playlists/[id]` | NEW | 1 |
| `/settings/youtube` | KEEP | — |
| `/settings/discovery` | NEW (optional; clear-rejections affordance) | 6 |

---

## 5. Docs

| File | Action | Phase |
|---|---|---|
| `CLAUDE.md` — "Folio — a personal, magazine-shaped..." intro line | RESHAPE | 3 (soft) + 4 (final) |
| `CLAUDE.md` — "Magazine issue lifecycle" section | DELETE | 4 |
| `CLAUDE.md` — "Editor agent" section | RESHAPE to "Curation agent" | 3 |
| `CLAUDE.md` — Taste substrate + Taste lab sections | KEEP (minor wording: drop "conversational-editor umbrella" framing) | 4 |
| `CLAUDE.md` — "Web UI" section, route list | RESHAPE (replace route list) | 3 |
| `RUNBOOK.md` — "_Last verified: 2026-04-22 (conversational-editor-ui)_" | UPDATE each phase | every phase |
| `RUNBOOK.md` — "Folio — a personal YouTube-library magazine" intro | RESHAPE | 3 |
| `RUNBOOK.md` — editor workspace / slot usage sections | DELETE | 4 |
| `RUNBOOK.md` — "Where published issues live" | DELETE | 4 |
| `RUNBOOK.md` — mobile section referencing `/issues`, `/issues/[id]` | DELETE | 4 |
| `RUNBOOK.md` — reset script references to `sections`/`issues` tables | UPDATE | 4 |
| `RUNBOOK.md` — NEW "Playlists" section | ADD | 1 |
| `RUNBOOK.md` — NEW "Consumption home + ranking" section | ADD | 2–3 |
| `RUNBOOK.md` — NEW "Overnight enrichment" section | ADD | 5 |
| `RUNBOOK.md` — NEW "Discovery" section (how description-graph runs, how direct-search costs quota, how approvals flow, how to clear rejections) | ADD | 6 |
| `.env.example` — NEW `YOUTUBE_API_KEY=` | ADD | 6 |
| `AGENTS.md` | KEEP (no magazine-specific content) | — |
| `justfile` | REVIEW (add `just nightly`, `just nightly-install`, `just nightly-uninstall` in phase 5; otherwise no magazine-specific verbs to remove) | 5 |
| `.env.example` | REVIEW (phase 5 adds `NIGHTLY_HOUR` etc.; no magazine-specific env vars to remove) | 5 |
| `docs/original-proposal.md` | KEEP as history | — |

The `RUNBOOK.md` "operational invariant" applies: any change to launch/deploy/config (Dockerfile, docker-compose, .env.example, package scripts, ports, env vars) must update both `justfile` and `RUNBOOK.md` in the same change. Update `_Last verified:_` date on each touch.

---

## 6. OpenSpec

### 6a. Specs (authoritative capability definitions)

| Spec | Action | Phase |
|---|---|---|
| `openspec/specs/editorial-workspace/spec.md` | DELETE | 4 |
| `openspec/specs/editorial-agent/spec.md` | RESHAPE → `curation-agent/spec.md` (rename capability) | 3 |
| `openspec/specs/home-view/spec.md` | REWRITE | 3 |
| `openspec/specs/issue-archive/spec.md` | DELETE | 4 |
| `openspec/specs/library-view/spec.md` | KEEP (minor: remove references to section filters if any) | 4 |
| `openspec/specs/player-view/spec.md` | KEEP | — |
| `openspec/specs/video-library/spec.md` | KEEP | — |
| `openspec/specs/youtube-library-import/spec.md` | KEEP (minor: remove section assignment on import if present) | 4 |
| `openspec/specs/youtube-oauth/spec.md` | KEEP | — |
| NEW `openspec/specs/playlists/spec.md` | ADD | 1 |
| NEW `openspec/specs/home-ranking/spec.md` | ADD | 2 |
| NEW `openspec/specs/overnight-enrichment/spec.md` | ADD | 5 |
| NEW `openspec/specs/discovery/spec.md` | ADD | 6 |

Each phase's sub-change is the proper vehicle for spec edits — specs should never be edited directly outside of a change proposal.

### 6b. Changes

| Change | Action |
|---|---|
| `openspec/changes/archive/*` | KEEP (history) |
| `openspec/changes/conversational-editor/` | KEEP until its unshipped phases are formally superseded by `consumption-first`. Archive this umbrella once phase 4 of `consumption-first` ships and the editor-workspace + editor-agent specs are rewritten |
| `openspec/changes/overnight-brief/` | ✅ DELETED (2026-04-23) |
| `openspec/changes/consumption-first/` | active umbrella |

### 6c. Archive order

When each phase ships, archive its sub-change under `openspec/changes/archive/YYYY-MM-DD-<name>/`. The umbrella stays open across phases. After phase 4 ships and retires the editorial specs, archive the `conversational-editor/` umbrella as well (since its remaining specs are gone). `consumption-first/` is archived after phase 5.

---

## 7. Config / operational

| Surface | Action | Phase |
|---|---|---|
| `package.json` scripts | REVIEW — no magazine-specific scripts present today | — |
| `tsconfig.json` path aliases | REVIEW — none are magazine-specific | — |
| `next.config.*` | REVIEW — no magazine-specific config | — |
| `eslint.config.mjs` | REVIEW — no magazine-specific rules | — |
| System cron (if `fetch` is installed) | KEEP | — |
| Launchd agent (`com.folio.nightly.plist`) | ADD in phase 5 | 5 |
| `YOUTUBE_API_KEY` env var | ADD in phase 6 (Google Cloud project with Data API v3 enabled; distinct from the OAuth client used for library import) | 6 |
| `events.db` | NO DIRECT ACTION — migrations handle it; user runs `just backup-db` before phase 4 | 4 |

---

## 8. User-visible vocabulary

These words should disappear from the running app's copy, nav, buttons, and microcopy during phase 3 (UI flip) and be fully absent after phase 4:

**Out:** *issue, cover, featured, brief, slot, publish, draft, masthead, section, department, editor, editor-in-chief, morning brief*

**In:** *for right now, continue, fresh, playlist, room, tag, cluster, mood, proposed, approve, dismiss, discovered*

(This is a soft guideline, not a schema migration. Each phase's tasks include a "copy audit" step.)

---

## 9. Verification checklist (phase 4 definition of done)

Phase 4's `tasks.md` must check all of the following before the change is archived:

- [x] `just backup-db` ran; backup file retained and its path logged in the phase's `design.md`. _(`events.db.20260423-153232.bak`.)_
- [x] `scripts/export-issues.ts` ran; `backups/issues-pre-teardown.json` present. _(12 issues, 12 issue_slots dumped.)_
- [x] `NNN_magazine_teardown.sql` applied cleanly on a copy of production `events.db` before running against the real one. _(initial dry-run with FK OFF missed a cascade — caught by FK-ON re-run; migration was rewritten to build shadow conversation/turn tables before dropping the originals; second dry-run + live apply both clean.)_
- [x] Sections → tags migration verified: every `channel_tags` row expected from the migration is present; `channels.section_id` column absent; `sections` table absent. _(4 channel_tags rows backfilled from 4 pre-migration channels with section_id; `sections` and the `idx_channels_section`/`section_id` column both gone.)_
- [x] `conversations` reshape: no rows reference a nonexistent `conversation_id`; every existing `conversation_turns` row has a valid parent; `conversations.scope_date` is unique. _(post-apply: 1 conversation, 24 turns, 0 orphans; `scope_date` UNIQUE constraint enforced by schema.)_
- [x] `grep -rE '\b(issue|issue_slots|sections|cover_video|pinned_cover|composeIssue|pickFeatured|pickBriefs|effectiveCoverId|setCoverPin|getOrPublishTodaysIssue|assignSlot|swapSlots|clearSlot|SlotKind)\b' src/ db/ scripts/` returns no active code references (only historical migrations and archived OpenSpec changes). _(only history migrations 008/011/013, the teardown migration 016, and `scripts/export-issues.ts` (the teardown's own export tool) hit.)_
- [x] `/section/*` and `/issues/*` routes return 404. _(verified.)_
- [x] `/sections` management route returns 404. _(verified.)_
- [x] No navigation entry in the app points to a deleted route. _(grep on rendered `/` HTML: nav anchors are `/library`, `/playlists`, `/inbox`, `/taste`, `/settings/youtube` only.)_
- [x] `CLAUDE.md` contains no references to the magazine lifecycle, editorial workspace, or editor-in-chief framing. _(replaced; only contextual / negation prose remains.)_
- [x] `RUNBOOK.md` "Last verified" date updated; magazine sections removed; replacement sections present. _(date is `2026-04-23 (magazine-teardown: ...)`; editor-workspace/published-issues sections removed; Curation agent + Playlists + Home ranking rail sections present.)_
- [x] `openspec/specs/editorial-workspace/` and `openspec/specs/issue-archive/` directories absent; `editorial-agent/` renamed to `curation-agent/` with rewritten content; `home-view/spec.md` rewritten. _(verified.)_
- [x] User has opened `/` and confirmed the app looks and feels like the consumption room it's supposed to be. _(operator sign-off 2026-04-23.)_

---

## 10. What this file is NOT

- It is not a spec. Specs live under `openspec/specs/`.
- It is not a proposal. The why lives in `proposal.md`.
- It is not a design. The how lives in `design.md`.
- It is a **checklist**: a grounded, line-item inventory that phase 4 works through. Its purpose is ensuring nothing is forgotten or leaks past the teardown.

If reality diverges from this inventory (new magazine code lands between now and phase 4, or an existing surface turns out to be load-bearing), update this file in the relevant phase's sub-change. Do not silently improvise.
