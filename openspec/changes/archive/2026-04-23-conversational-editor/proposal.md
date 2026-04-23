## Why

The editor-workspace pivot gave the user a hand-editable slot-based magazine, but the corpus (5,665 videos, 563 channels) is larger than any human can reason about by scrolling. The original anti-algorithm motive — *discover within my taste without YouTube's recommender* — is not solved by drag-and-drop; it's only enabled by it. The corpus needs judgment, not just arrangement.

This umbrella change commits the app to a **conversational editor** shape: `/` becomes a chat-first surface with an editorial agent as the primary interaction, and the drag board is demoted to a rendered view of state that you can manipulate directly when chat is the wrong tool. The agent also **runs overnight**, composing a skeleton draft of tomorrow's issue from the prior day's imports, so the user wakes up to an argument to have rather than a pool to scroll.

This is additive to the existing data model — `issues`, `issue_slots`, `consumption`, `video_provenance` are unchanged. What we add is a computation layer (embeddings, taste clustering, per-video enrichment), a conversation layer (agent + tool use), and a scheduling layer (overnight job + morning brief).

## What Changes

This is an umbrella holding change. It captures the stance and phases. Concrete work is split into follow-on changes, each independently shippable:

1. **`taste-substrate`** — embeddings pipeline, transcript fetch, taste clustering, local-Gemma batch enrichment. No UI. Data plane only.
2. **`taste-lab`** — `/taste` page: cluster list, label / merge / split / weight. First user-visible delivery.
3. **`conversational-editor-ui`** — the `/` page becomes chat-first. Board renders as a view of state. Agent with tool-use (search_pool, rank_by_theme, assign_slot, swap_slots, clear_slot, get_video_detail). Conversations persist per issue. Interactive only — no autonomous runs yet.
4. **`overnight-brief`** — scheduled nightly job. `morning_briefs` table. Auto-drafts a skeleton issue if no user-authored draft exists. Surfaces at the top of `/` in the morning. Does NOT touch user-authored drafts.
5. **`discovery-tools`** — description-graph from video descriptions. Agent gains `propose_import` tool; candidates require user approval before import. Realizes the original "find channels YouTube would never surface" goal.

## Capabilities

### New capabilities
- **taste-profile** — per-user cluster map with editable labels, weights, and cluster membership for each video. Owned by phase 1 + 2.
- **editorial-agent** — tool-using agent that reads taste profile + draft state + pool, converses about composition, and mutates slot state. Owned by phase 3.
- **overnight-brief** — scheduled composition of a morning brief and optional skeleton draft. Owned by phase 4.
- **corpus-expansion** — discovery of new channels/videos via description-graph, delivered as user-approvable import proposals. Owned by phase 5.

### Modified capabilities
- **editorial-workspace** — `/` reorients from drag-primary to chat-primary. Drag affordances survive as micro-adjustment.
- **home-view** — the morning-brief surface becomes the first thing on `/` for the connected-and-non-empty-corpus branch.

### Removed capabilities
- None. Drag-and-drop survives as a view mode.

## Impact

- **Code:** new libs under `src/lib/` for embeddings, clustering, agent, enrichment. New routes: `/taste`, agent streaming endpoint, overnight-run CLI. The `/` rewrite in phase 3 is the largest single change.
- **Database:** several new tables across phases — `video_embeddings`, `taste_clusters`, `video_cluster_assignments`, `conversations`, `conversation_turns`, `morning_briefs`, `agent_memory_notes`, plus description-graph tables in phase 5. All additive; no changes to existing tables.
- **External services:** Anthropic API (interactive agent), OpenAI embeddings API (or local BGE-M3 as fallback), local Ollama for bulk enrichment (Gemma or similar). Cost estimate: ~$10–15/month at moderate use.
- **Operational:** a scheduled job returns (phase 4). Not cron on the system crontab this time — likely a launchd user agent on macOS or a `just nightly` invocable from a cron of the user's choice. Updates `justfile` + `RUNBOOK.md` accordingly.
- **Privacy posture:** documented. Transcripts are public content; agent conversation logs are the sensitive surface; retention policies of providers are acceptable for the user's risk tolerance. Local-model path remains viable as an escape hatch for users who'd prefer it.
- **Out of scope (deferred):**
  - Multi-user / shared taste profiles.
  - Pushing subscribe/unsubscribe actions to YouTube.
  - Voice input to the agent.
  - Mobile conversational UI (editor is desktop-first; mobile sees a view-only morning brief).
  - Watch Later / Google Takeout imports.
  - Re-opening published issues for edit (one-way freeze stands).

## Success metric

**North-star (qualitative):** *"I'm seeing videos I couldn't have found."* Operationalized by a small `/reflect` surface that, at the end of each issue, captures a one-sentence journal entry and a 1–5 feels-like-me rating. The dataset is subjective and small by design — quantity is not the goal.

**Health checks (quantitative):**
1. Slots filled via chat vs. drag (tells us whether the conversational pattern earns its place).
2. % of published-issue videos archived vs. dismissed after watch (quality of agent's picks).
3. Cluster count + label completeness on `/taste` (is the user tending the garden?).

Explicitly NOT tracked: issues-published-per-week, chat-turns-per-session. Those reward output and verbosity, not the felt quality of the experience.
