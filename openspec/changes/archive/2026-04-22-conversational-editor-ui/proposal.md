## Why

Phase 3 of the [conversational-editor](../conversational-editor/) umbrella. Phase 1 (`taste-substrate`) built the cluster map; phase 2 (`taste-lab`) made it editable. The map is now legible, but nothing *uses* it — the home page is still a drag-and-drop board over a 5,665-video pool the user cannot reason about by eye. The corpus needs judgment, not arrangement.

This change inverts the primacy on `/`: the **editor agent** becomes the primary surface, and the slot board demotes to a rendered view of state you can manipulate when chat is the wrong tool. The agent reads your taste map (labels, weights, cluster membership), the current draft, and the inbox pool; writes slot assignments through the same API the drag board uses; and converses about composition one issue at a time.

This phase is **interactive only** — the agent runs when the user opens `/`, not overnight. The overnight brief (phase 4) sits on top of this once the conversational substrate is real.

## What Changes

- **NEW migration `013_conversational_editor.sql`** — adds `conversations` (one per draft issue), `conversation_turns` (role + content + tool-call/result payload + tokens + created_at). Additive; no changes to `issues`, `issue_slots`, `consumption`, `videos`, or any phase-1/2 table.
- **NEW `src/lib/agent/` module**:
  - `client.ts` — Anthropic SDK client (Claude Sonnet 4.6 default, Opus 4.7 opt-in via env), prompt-caching enabled, streaming on.
  - `tools.ts` — tool definitions + executors: `search_pool`, `rank_by_theme`, `assign_slot`, `swap_slots`, `clear_slot`, `get_video_detail`, `get_taste_clusters`. Each executor is a thin wrapper over existing read/write helpers (`getInboxPool`, `getIssueSlots`, slot-mutation APIs from phase editor-workspace, `getClusterSummaries` from taste-read).
  - `system-prompt.ts` — builds the system prompt from the current draft state, taste-cluster summary (id, label, weight, top members), and a short house-style note. Cached at the prefix boundary.
  - `run.ts` — the agentic loop: read conversation history, stream response, execute tool calls, persist turns, yield deltas.
- **NEW streaming API route `POST /api/agent/message`** — body `{ issueId, content }`; streams SSE events of shape `{ type: 'delta' | 'tool_call' | 'tool_result' | 'error' | 'done', ... }`. One call per user message; the server drives the agentic loop until it stops requesting tools.
- **NEW `GET /api/agent/conversation/[issueId]`** — returns the full conversation turn list for rehydration on page load.
- **MODIFIED `src/app/page.tsx`** — workspace branch gains a **two-column layout** on desktop: left = board (existing `EditorWorkspace`), right = chat panel. Mobile keeps the existing desktop-only message.
- **NEW `src/components/agent/`**:
  - `ChatPanel.tsx` — scrollable turn list, composer at the bottom, streaming text rendered incrementally.
  - `Message.tsx` — role-aware bubble; user = quiet sans, assistant = serif. Inline thumbnails when the agent cites a video.
  - `ToolTrace.tsx` — collapsed by default; one-liner per tool call ("searched pool for 'craft-tutorial' — 23 hits"); expandable for the raw args/result.
  - `Composer.tsx` — textarea with Enter-to-send, Shift+Enter for newline, Cmd+K to focus.
  - `AgentErrorBanner.tsx` — surfaces 402 / 429 / quota / network failures as a recoverable banner; conversation survives.
- **NEW env vars** in `.env.example`:
  - `ANTHROPIC_API_KEY` (required for phase 3; absent → `/` shows a "connect key in settings" card under the chat panel, board still works).
  - `AGENT_MODEL` (default `claude-sonnet-4-6`).
  - `AGENT_MAX_TURNS` (default `10` — cap on tool-use loop iterations per user message).
- **MODIFIED mutation surface** — the agent reuses the existing slot-mutation endpoints (`PUT /api/issues/[id]/slots`, `DELETE /api/issues/[id]/slots`). One implementation. This phase adds no new slot endpoints.
- **MODIFIED `RUNBOOK.md`** — new "Editor agent" section: model choice, cost expectations (~$0.05–0.20 per session at Sonnet pricing with caching), how to rotate the key, how to force-dump a runaway conversation, privacy posture (conversation logs are stored locally in SQLite and sent to Anthropic per-request).
- **MODIFIED `CLAUDE.md`** — new "Editor agent" paragraph under Architecture, pointing at `src/lib/agent/run.ts` as the only legal place that drives the agentic loop.

## Capabilities

### New capabilities

- **editorial-agent** — tool-using conversational agent bound to a single draft issue. Reads taste profile + draft state + pool; writes slot assignments through the existing mutation API. Conversations persist per issue and freeze with the issue on publish.

### Modified capabilities

- **editorial-workspace** — the home view gains a chat panel co-equal with the slot board; slot mutations remain the single source of truth but may now originate from the agent or the user. Board affordances (drag, keyboard) are unchanged.
- **home-view** — two-column workspace on desktop; chat column hides on mobile with the same desktop-only copy as the board.

### Removed capabilities

- None. The drag board survives as a first-class view.

## Impact

- **Code added:** ~2,000 LOC estimate. One migration, one lib module (`src/lib/agent/`), two API routes, one page rewrite, ~5 client components.
- **Database:** one additive migration (two tables). Storage footprint: a session is ~10 turns × ~2 KB/turn = ~20 KB per issue. Negligible at expected scale.
- **External services:** Anthropic API (new). Default `claude-sonnet-4-6` with prompt caching; Opus 4.7 opt-in for hard composition sessions. Streaming + tool use. Monthly cost estimate: $2–10 for daily use.
- **Operational:** no new scheduled jobs. The agent runs only while the user is on `/`. If `ANTHROPIC_API_KEY` is unset, the page degrades gracefully to the board-only experience.
- **Reversibility:** deleting the agent module + routes + page-layout change is sufficient. The migration's two tables can be dropped — no other code reads them.
- **Privacy posture:** conversation turns are stored in local SQLite. Each user message + the tool-use loop is sent to Anthropic per request; Anthropic's retention policies govern that path. No third party sees anything else (the taste cluster map and the slot board are local). The RUNBOOK documents this explicitly.
- **Out of scope (deferred):**
  - **Overnight autonomous runs** — phase 4.
  - **Discovery / `propose_import`** — phase 5.
  - **Agent memory across sessions** (e.g., "remember that I dislike talking-head interviews"). Memory notes are listed in the umbrella for later; not in phase 3.
  - **Conversation search / long-term archive UI.** The only thing you can do with a past conversation here is view it on the issue's page once published.
  - **Voice input / TTS output.**
  - **Mobile chat.** Mobile sees the existing "open on desktop" message for the workspace branch; once phase 4 lands, mobile gets a view-only morning brief.
  - **Multi-draft concurrency.** One draft at a time; one conversation at a time (already enforced by phase editor-workspace's partial-unique-draft constraint).

## Success metric

This phase is shipped when the user can open `/`, type "give me three featured picks that lean into rigor-over-rhetoric and avoid explainers," and see the board fill with sensible picks — *and* push back on any pick with "not this one, try another." The qualitative bar is that chat feels like the faster way to reason about the pool than dragging. The umbrella's longitudinal metric (the `/reflect` surface) lands later.
