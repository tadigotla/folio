## Context

Phases 1 and 2 produced two artifacts the agent needs:

- A **per-video embedding** under `(provider, model)` keys (~5,665 vectors today).
- An **editable cluster map** with labels, weights, and one assignment per corpus video.

The editor-workspace pivot (archived 2026-04-21) produced the third artifact:

- A **single-draft issue model** with 14 slots (1 cover, 3 featured, 10 briefs), mutated through `POST /api/issues/:id/slots` inside one transaction per action.

Phase 3 connects them. The user types into a chat panel; an agent reads draft + pool + cluster map; calls tools; the slot board updates. The slot-mutation endpoint already exists and already enforces the right invariants (single-draft, no double-assign, frozen-on-publish, transactional). We do **not** add a parallel mutation surface for the agent — the agent calls the same endpoint the drag UI calls.

Project constraints: Next.js 16, React 19, SQLite via `better-sqlite3`, no test runner, desktop-first, single-user local install. No cron, no background processes, no auth beyond YouTube OAuth. Per `AGENTS.md`, this is **not the Next.js you know** — App Router routing, async params, streaming patterns differ from older training data; consult `node_modules/next/dist/docs/` before touching routing or streaming code.

## Goals / Non-Goals

**Goals:**

- Make `/` a place where typing a sentence is a faster way to fill the board than scrolling the pool.
- Keep the slot mutation surface single-sourced — the drag board and the agent call the same endpoint, and a slot change is indistinguishable in the DB regardless of which one made it.
- Persist conversations per draft so a refresh, a model crash, or a route navigation does not lose the thread.
- Surface tool use legibly. The user always knows what the agent looked at and what it did.
- Degrade gracefully when `ANTHROPIC_API_KEY` is missing or the API is down — the board remains usable.

**Non-Goals:**

- Autonomous overnight composition. That's phase 4 and depends on this surface existing first.
- Cross-session memory ("remember that I dislike talking-head interviews"). The umbrella sketches `agent_memory_notes`; this phase does not build it.
- Conversation search, export, or analytics.
- Multi-issue / multi-conversation concurrency. One draft, one conversation.
- A new mutation surface for the agent. The agent reuses `POST /api/issues/:id/slots`.
- Mobile chat. Mobile sees the existing "open on desktop" copy; the morning brief lands on mobile in phase 4.
- Self-hosted / local model fallback for the conversational agent. Cluster + enrichment work has the local fallback; the agent does not. Quality at this scale needs Claude.

## Decisions

### Anthropic SDK with prompt caching, streaming, and tool use

We use `@anthropic-ai/sdk` directly (not a wrapper). `claude-sonnet-4-6` is the default; `claude-opus-4-7` opts in via `AGENT_MODEL` for hard composition sessions. Prompt caching is enabled at three boundaries:

1. **System prompt prefix** (house-style note + tool descriptions) — stable across all sessions; cache TTL 5 min.
2. **Taste cluster summary** (id, label, weight, top-N members per cluster) — stable within a session; refreshed when `taste_clusters.updated_at` advances.
3. **Issue + pool snapshot** at the start of each user turn — cached for the duration of the multi-turn tool loop within that single user message.

Streaming surfaces incremental text and tool-use blocks via SSE so the user sees the agent thinking. Without streaming, a 30s agentic loop feels like a hang.

Alternative considered: Vercel AI SDK. Rejected because we don't need provider-switching and we want first-class control over caching boundaries.

### Tool set is intentionally narrow

```
search_pool(query?: string, cluster_id?: number, limit?: number)
rank_by_theme(theme: string, limit?: number)        // free-text → embed → top-K cosine
get_video_detail(video_id: string)                  // title, channel, summary, tags, transcript snippet
get_taste_clusters()                                // id, label, weight, member_count, top_members
assign_slot(video_id: string, slot_kind, slot_index)
swap_slots(from, to)                                // existing endpoint shape
clear_slot(slot_kind, slot_index)
```

Seven tools. No `propose_import` (phase 5), no `set_cluster_weight` (the user does that on `/taste`), no `publish` (publishing is a deliberate user action, never the agent's). The narrowness is the point: the agent should be obviously bounded, and every tool should be one the user could imagine wanting before opening the app.

`rank_by_theme` is the one tool that does novel computation — it embeds the user-supplied theme on the fly (same provider/model as the corpus) and returns top-K corpus videos by cosine. This is what makes prose like "find me three things that lean rigor-over-rhetoric" actually work.

### One conversation per draft, frozen on publish

Schema (additive):

```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL UNIQUE
    REFERENCES issues(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,             -- JSON: text blocks + tool_use blocks + tool_result blocks
  tokens_input INTEGER,
  tokens_output INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_conv_turns_conv ON conversation_turns(conversation_id, id);
```

The 1:1 with draft issue means: discarding a draft cascades to deleting the conversation; publishing freezes the conversation alongside the issue (no new turns may be appended once `issues.status = 'published'`). On `/issues/[id]` for a published issue we render the conversation read-only beneath the magazine view; this surfacing is **out of scope** for phase 3 (deferred to a phase-3.5 polish pass) but the schema admits it.

`content` stores the Anthropic message-block JSON verbatim (text, tool_use, tool_result blocks). Reconstructing a conversation for the SDK is a `JSON.parse` per row, then a flat array.

Alternative considered: a separate `tool_calls` table normalized out of `conversation_turns`. Rejected — premature normalization for a single-user, append-only log; JSON is the right shape for the SDK call.

### Streaming via SSE, not WebSockets

The route returns `text/event-stream` with one event per Anthropic SSE chunk plus our own framing events:

```
event: delta        data: { text: "..." }
event: tool_call    data: { name, args }
event: tool_result  data: { name, result_summary }
event: error        data: { message }
event: done         data: { final_message_id }
```

WebSockets are overkill for a one-direction-at-a-time chat. SSE works through the existing fetch pipeline, has clean reconnection semantics if we ever need them, and Next.js 16 streams from a route handler natively via `ReadableStream`.

### The agentic loop runs server-side per user message

One `POST /api/agent/message` call drives the full multi-turn tool loop until the model stops asking for tools or hits `AGENT_MAX_TURNS` (default 10). Each iteration:

1. Send accumulated message history + tools to Anthropic with stream:true.
2. Stream `delta` events to the client as text arrives.
3. When a `tool_use` block completes, invoke the tool executor, persist the assistant turn, push a `tool_result` block onto the message array, persist the tool turn, repeat.
4. When the response ends with no `tool_use`, persist the assistant turn, send `done`, close.

Why server-side? The slot-mutation endpoint already runs server-side; doing tool dispatch client-side would mean shipping every tool result over the wire and re-prompting from the browser, which 3× the round-trips and makes prompt caching strictly harder.

Cap of 10 turns is high for safety and low enough that a runaway loop costs <$0.50 worst case at Sonnet pricing. We surface the cap in the UI ("agent stopped after 10 tool turns — keep going?") so it's visible, not silent.

### The board updates from `router.refresh()` after each agent slot mutation

The agent's slot tools call the same `POST /api/issues/:id/slots` the drag UI calls, then the SSE handler emits a synthetic `tool_result` with a small invalidation marker. The chat panel listens for that marker and triggers `router.refresh()` so the board picks up new slot state. We do **not** push slot snapshots over SSE — that would duplicate the read path and create reconcile bugs.

Trade-off: a slot fill on the agent side has a 100–200ms perceived latency before the board reflects it. Acceptable for chat (the user just typed); not acceptable for drag (the drag handler keeps its current optimistic-update pattern).

### Two-column layout on desktop, chat hidden on mobile

```
+----------------------------------------+----------------+
|         EditorWorkspace (board)        |  ChatPanel     |
|         existing component, unchanged  |  new component |
+----------------------------------------+----------------+
```

On mobile (existing `isMobileUserAgent` check), the workspace branch keeps the existing "open on desktop" message; chat does not appear at all. This matches phase-2's posture and the umbrella's mobile non-goal.

The chat column is `~360px` fixed-width on `xl:` screens, full-width on `lg:` (chat below board). The board adapts to the remaining width using the existing `max-w-7xl` container.

Alternative considered: chat as a slide-over panel toggled with a button. Rejected because the whole pivot is "chat is co-equal with the board"; hiding it behind a toggle communicates the opposite.

### When `ANTHROPIC_API_KEY` is missing, the board still works

The chat panel renders an inline card: "Connect your Anthropic API key in `.env` to enable the editor agent." The composer is disabled. Every existing slot-board affordance keeps working — drag, click, keyboard shortcuts, publish, discard. This means a user upgrading from phase 2 without an API key gets a strictly-non-broken experience.

The chat panel queries `/api/agent/status` once on mount to discover key presence. If the key is set but the first call returns 401, we down-grade the same way and surface "your Anthropic API key was rejected — see RUNBOOK".

### The agent has read-only access to taste, not write

The `/taste` lab is the only place to set labels and weights. The agent can read the cluster summary (via `get_taste_clusters`) and use it in prose, but it cannot rename, merge, split, retire, or reweight clusters. Rationale: cluster judgment is the user's calibration of their own taste; an agent that re-labels mid-session erodes that calibration in invisible ways.

If the user types "rename cluster 7 to 'craft tutorials'", the right answer is "open `/taste` to do that" — surfaced as a normal assistant text response, not a tool call.

### Conversation history reload on page open uses `GET /api/agent/conversation/[issueId]`

When `/` mounts with an existing draft and existing conversation, the chat panel hydrates from a single GET that returns the turn list shaped for the message renderer (not the SDK shape — that's a server-side concern). The SDK message-array reconstruction happens on the next `POST /api/agent/message` server-side from the persisted turns.

Trade-off: two shapes for the same data (DB JSON ↔ SDK array ↔ render list). The conversion is mechanical and centralized in `src/lib/agent/turns.ts`.

### House-style system-prompt note

A short stable preamble that sets the agent's voice and posture:

> You are Folio's editorial assistant. The user is composing one issue of a personal video magazine. Your job is to help them find and place videos from their library. Be specific — cite cluster labels and video titles, not IDs. Be opinionated — if a pick feels weak, say so. Never assume; if you don't know, call a tool. Don't apologize, don't summarize what you just did, don't propose to do work the user hasn't asked for. Publishing is the user's call, never yours.

This preamble is part of the cached system-prompt prefix.

## Risks / Trade-offs

- **Anthropic API outage** → the page degrades to board-only (same path as missing key). Mitigation: the SSE handler emits a clear `error` event; the chat panel surfaces it as a banner with retry; the slot board is unaffected.

- **Runaway tool loop** → bounded at `AGENT_MAX_TURNS = 10`. A loop that hits the cap is logged + surfaced in the UI with a "keep going?" continuation. Worst-case cost per stuck loop: ~$0.50 at Sonnet pricing.

- **Stale board after agent mutation** → the `router.refresh()` pattern is a 100–200ms delay. Mitigation: acceptable in chat context. If it ever feels wrong we can push a tiny invalidation event over SSE that the workspace listens for via a custom event.

- **Conversation drift across long sessions** → after dozens of turns the model may lose the thread. Mitigation: the cap + the per-turn taste/draft snapshot keep each user message anchored. We do **not** auto-summarize; that's a future change with its own design budget.

- **Embedding mismatch on `rank_by_theme`** → if the user has switched embedding providers since corpus build, the new theme-vector lives in a different space than the corpus vectors. Mitigation: `rank_by_theme` reads `getActiveEmbeddingConfig()` and rejects with "no embedded videos under the active provider" if the corpus has none under that provider. The runbook flags this as a "switch providers → rebuild" rule (already true for clustering).

- **Prompt-caching cache misses cost real money** → if cache TTL expires mid-session the system-prompt prefix re-bills. Mitigation: refresh boundary placement keeps the cluster summary outside the per-turn cache so per-turn cost stays low; the system prefix is cheap to re-cache.

- **The chat panel feels "AI-shaped" on a magazine app** → real risk. Mitigation: tone, typography, and the inline house-style preamble. The chat column uses the same Fraunces serif for assistant messages as the board uses for headlines; tool traces are quiet sans like editorial sidebars; no avatars; no emoji. Visual quietness is the design feedback we'll iterate on after the smoke pass.

- **Privacy posture** → conversation turns sent to Anthropic include cluster labels, video titles, and user prose. Documented in the runbook as the trade for the conversational shape. Local-only fallback for the agent itself is **out of scope** for phase 3.

- **Single-user assumption holds, but the conversation table is keyed on issue, not user** → if Folio ever becomes multi-user (umbrella non-goal), this table needs a `user_id` column. We accept the future migration cost; adding a `user_id` column today is YAGNI.

## Migration Plan

Sequential rollout — each step is independently shippable but the full UX needs all of them.

1. Migration `013_conversational_editor.sql` — adds the two tables. Safe to land standalone.
2. `src/lib/agent/` — client, tools, system prompt, run loop, turn serialization. No UI yet; can be exercised by a scratch script.
3. `POST /api/agent/message` + `GET /api/agent/conversation/[issueId]` + `GET /api/agent/status`. Hit with curl to validate.
4. Page rewrite — chat panel + two-column layout. Behind no flag (this is a single-user local app), but landed only once 1–3 are stable.
5. Runbook + CLAUDE.md updates.

Rollback: revert the page-layout change; the API routes and the tables are inert without it. Drop `conversations` and `conversation_turns` if the schema needs to disappear too.

## Open Questions

- **Should the chat panel persist its scroll position across `router.refresh()`?** Likely yes. Pick the implementation when we get there — the obvious `scrollIntoView` on the last turn is probably enough.
- **Should `rank_by_theme` cache its computed theme-vector for the duration of the conversation?** Optimization for later. First pass: re-embed each call, costs ~$0.00002 per call.
- **Where do we surface conversation cost (token usage) per session?** A small footer in the chat panel ("12K input / 2K output / $0.04") seems honest. Pick at build time.
- **Should the agent see the user's `consumption.last_position_seconds` so it can favor "in-progress" picks?** Maybe. Defer to first usage feedback.
- **Tool trace verbosity default — collapsed or expanded?** Lean collapsed; the chat is the primary surface, the trace is forensic.
