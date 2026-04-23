## REMOVED Requirements

### Requirement: Draft and published issue schema

**Reason**: The `issues` table is dropped as part of the magazine teardown. The app no longer has a publication framing; the single operator consumes from the pool through playlists and home rails, not by composing issues.

**Migration**: `db/migrations/016_magazine_teardown.sql` drops `issues`. Before the drop, `scripts/export-issues.ts` writes every row of `issues` and `issue_slots` to `backups/issues-pre-teardown.json` as cold archive. No runtime code reads issues after this change.

### Requirement: Slot table

**Reason**: The `issue_slots` table is dropped. Slots are a magazine-framing concept and have no analog in consumption-first.

**Migration**: Cascade-dropped with `issues`. Exported to the JSON archive above.

### Requirement: Slot shape

**Reason**: Slots no longer exist. The 14-slot cover/featured/briefs structure is entirely removed from both schema and UI.

**Migration**: Users who relied on the slot board to curate can use playlists — create a playlist and add videos in the desired order. See `playlists` capability.

### Requirement: Create draft issue endpoint

**Reason**: Draft issues no longer exist; the endpoint is removed. The `POST /api/issues` route returns 404 after this change.

**Migration**: None. No client code should call this endpoint (phase-3 already removed the UI affordances that did).

### Requirement: Slot mutation endpoint

**Reason**: `issue_slots` no longer exists. `POST /api/issues/[id]/slots` returns 404.

**Migration**: None. Phase-3 already removed the agent tools that called this route.

### Requirement: Publish endpoint

**Reason**: Publication is no longer a concept. `POST /api/issues/[id]/publish` returns 404.

**Migration**: None.

### Requirement: Discard draft endpoint

**Reason**: Draft issues no longer exist. `DELETE /api/issues/[id]` returns 404.

**Migration**: None.

### Requirement: Inbox pool query

**Reason**: The pool concept persists (it is the `consumption.status IN ('inbox','saved','in_progress')` set read by `rankForHome` and `search_pool`), but the specific query contract this requirement defined was tied to the workspace's server-rendered pool column on `/compose`. That surface is gone. The curation-agent's `search_pool` tool and the home-ranking function cover the remaining read patterns.

**Migration**: Callers that depended on this query should route through either `GET /api/home/ranking` (for ranked consumption candidates) or through the `search_pool` agent tool (for free-text / cluster-filtered searches).

### Requirement: Editor workspace UI

**Reason**: `/compose` is deleted. The slot board, pool column, and their two-column desktop layout are all removed. The `src/components/workspace/*` tree is deleted wholesale.

**Migration**: Ordered video collections are expressed as playlists (`/playlists`). Triage of the inbox moves to `/inbox`. Rails on `/` surface taste-aware recommendations without requiring manual composition.

### Requirement: Dismiss affordance in pool

**Reason**: The pool column no longer exists. Dismissing videos happens from `/inbox` via the existing `POST /api/consumption` transition to `dismissed`.

**Migration**: None. The underlying consumption-lifecycle contract is unchanged; only the UI access point moved.

### Requirement: Desktop-only workspace

**Reason**: `/compose` is deleted outright, so the "desktop-only" breakpoint rule no longer has a subject. Home rails work on every viewport by default.

**Migration**: None.

### Requirement: Workspace renders a chat panel co-equal with the slot board

**Reason**: The slot board is removed; the chat panel's co-equal layout no longer exists. The curation agent continues to exist (see `curation-agent` capability) but its UI surface is defined by phase 5's forthcoming work, not by this requirement.

**Migration**: None for this change. Phase 5 will redefine where the chat panel lives (likely on `/`, embedded in a rail or a sheet).

### Requirement: Chat panel hidden on mobile

**Reason**: No chat panel on `/compose` → no mobile rule to enforce here. The curation agent's mobile behavior is redefined when phase 5 places the chat UI.

**Migration**: None.

### Requirement: Chat panel degrades gracefully without an API key

**Reason**: The `/compose` chat panel is gone. The `GET /api/agent/status` endpoint survives under the `curation-agent` capability with the same contract (so the "API-key-absent" degradation pattern persists — it just lives under a different spec).

**Migration**: None. Any new chat surface phase 5 builds should read `/api/agent/status` the same way.

### Requirement: Slot mutations originate from agent or user with identical semantics

**Reason**: Slot mutations no longer exist — neither from the agent nor from the user. No replacement.

**Migration**: None. Playlist mutations (the remaining ordering mechanism) share code paths between agent and user via `src/lib/playlists.ts`, preserving the spirit of this guarantee in a different namespace.

### Requirement: Conversation hydration on page load

**Reason**: `/compose` no longer exists, so there is no page-load hydration contract here. The hydration endpoint itself survives under `curation-agent`'s "Conversation hydration endpoint" requirement, with the path reshaped from `/api/agent/conversation/[issueId]` to `/api/agent/conversation/[date]`.

**Migration**: Clients that hydrated on mount should call `GET /api/agent/conversation/<today's YYYY-MM-DD>` instead.
