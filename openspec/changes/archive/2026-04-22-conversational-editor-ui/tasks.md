## 1. Migration & schema

- [x] 1.1 Add `db/migrations/013_conversational_editor.sql` creating `conversations` (UNIQUE on `issue_id`, ON DELETE CASCADE from `issues`) and `conversation_turns` (role check, JSON `content`, token-usage columns, `created_at`) plus `idx_conv_turns_conv (conversation_id, id)`.
- [x] 1.2 Add the matching TypeScript types in `src/lib/types.ts` (`Conversation`, `ConversationTurn`, `TurnRole`, `TurnContentBlock`).
- [x] 1.3 Smoke: `tsx -e 'import("./src/lib/db").then(m => { m.runMigrations(); })'` runs cleanly; `sqlite3 events.db ".schema conversations conversation_turns"` shows the expected shape.

## 2. Read + write helpers (no agent yet)

- [x] 2.1 Add `src/lib/agent/turns.ts` exporting `getConversationTurns(issueId)`, `appendTurn(conversationId, role, content, usage?)`, and helpers to translate between DB-JSON and the SDK's `MessageParam` shape.
- [x] 2.2 Add `getOrCreateConversation(issueId)` that throws `ConversationFrozenError` if the issue is published.
- [x] 2.3 Wire ON-DELETE-CASCADE behavior into the existing discard-draft path — confirm by deleting a draft via the API and querying `conversations`/`conversation_turns` for orphans.

## 3. Anthropic client + system prompt + caching

- [x] 3.1 Add `@anthropic-ai/sdk` to `package.json`. Run `npm install`.
- [x] 3.2 Add `src/lib/agent/client.ts` exporting `getAnthropic()` (singleton), reads `ANTHROPIC_API_KEY`, throws a typed `AgentKeyMissingError` if absent.
- [x] 3.3 Add `src/lib/agent/system-prompt.ts` building the cached prefix: house-style preamble + tool descriptions. Include the `cache_control: { type: 'ephemeral' }` marker at the prefix boundary.
- [x] 3.4 Add `src/lib/agent/snapshot.ts` building the per-turn snapshot: current draft slots, inbox-pool digest, taste-cluster summary (id/label/weight/top-3 members). This snapshot becomes the second-cached chunk.
- [x] 3.5 Add `.env.example` entries: `ANTHROPIC_API_KEY=`, `# AGENT_MODEL=claude-sonnet-4-6`, `# AGENT_MAX_TURNS=10`.

## 4. Tool definitions + executors

- [x] 4.1 Add `src/lib/agent/tools.ts` exporting the seven tool definitions (`search_pool`, `rank_by_theme`, `get_video_detail`, `get_taste_clusters`, `assign_slot`, `swap_slots`, `clear_slot`) in Anthropic SDK format with strict JSON schemas.
- [x] 4.2 Implement `executeTool(name, args, ctx)` dispatching to executor functions; each executor returns `{ ok: true, data }` or `{ ok: false, error }`.
- [x] 4.3 `search_pool` reads from existing `getInboxPool()` filtered by optional cluster id and substring on title/channel.
- [x] 4.4 `rank_by_theme` calls `embed([theme])` via the active embedding config, then top-K cosine over `video_embeddings` for that `(provider, model)`. Reject with `no_embedded_corpus` if zero rows match.
- [x] 4.5 `get_video_detail` joins `videos`, `channels`, `video_enrichment`, `video_transcripts` (truncate transcript to ~500 chars), `consumption`, and `video_cluster_assignments`.
- [x] 4.6 `get_taste_clusters` reuses `getClusterSummaries()` from `taste-read.ts`.
- [x] 4.7 `assign_slot` / `swap_slots` / `clear_slot` call the same library function the existing slot-mutation route uses (refactor the route's logic into a shared helper if it currently lives inline).

## 5. Agentic loop + streaming route

- [x] 5.1 Add `src/lib/agent/run.ts` exporting `runAgentTurn({ issueId, userContent, onEvent })` that drives the multi-turn tool loop server-side, persisting each turn (user, assistant, tool) and yielding framing events.
- [x] 5.2 Honor `AGENT_MAX_TURNS` (default 10); on cap, emit a final assistant note + `error` event and persist the cap reason on the assistant turn.
- [x] 5.3 Add `POST /api/agent/message` returning `text/event-stream`; frame events as `delta` / `tool_call` / `tool_result` / `error` / `done`.
- [x] 5.4 Reject 412 if API key missing, 409 if issue is published, 400 if `issueId` is missing/invalid or `content` is empty.
- [x] 5.5 User-turn persistence happens before the first Anthropic call so a network failure doesn't lose the input.

## 6. Hydration + status routes

- [x] 6.1 Add `GET /api/agent/conversation/[issueId]` returning `{ turns: [{ id, role, blocks, createdAt }] }` shaped for the renderer (not the SDK shape). 404 if issue does not exist; `{ turns: [] }` if no conversation row.
- [x] 6.2 Add `GET /api/agent/status` returning `{ apiKeyPresent, model }` from env only — never calls Anthropic.

## 7. Chat panel + composer + streaming client

- [x] 7.1 Add `src/components/agent/ChatPanel.tsx` (client component): mounts, calls `GET /api/agent/conversation/[issueId]` once for hydration, then `GET /api/agent/status` for key presence, renders turn list + composer.
- [x] 7.2 Add `src/components/agent/Message.tsx` rendering role-aware bubbles: user = quiet sans, assistant = serif Fraunces. Inline thumbnails when blocks reference videos.
- [x] 7.3 Add `src/components/agent/ToolTrace.tsx` — collapsed by default, one-liner per tool call, expandable for raw args/result.
- [x] 7.4 Add `src/components/agent/Composer.tsx` — textarea, Enter sends, Shift+Enter newline, Cmd+K focuses (wire into existing `KeyboardHelp`).
- [x] 7.5 Add `src/components/agent/AgentErrorBanner.tsx` for 412/401/429/network surfacing; conversation history survives.
- [x] 7.6 Streaming client: parse SSE events, append `delta` text to the in-flight assistant bubble, render tool_call/tool_result inline, trigger `router.refresh()` on slot-tool results so the board picks up new state.
- [x] 7.7 Disabled-card state when `apiKeyPresent === false` per the spec.

## 8. Page rewrite

- [x] 8.1 Modify `src/app/page.tsx` so the workspace branch (connected + non-empty + draft) renders board + ChatPanel in a two-column grid at `xl:` and stacked below `xl:`.
- [x] 8.2 No-draft branch unchanged: empty state + "New issue" button only; ChatPanel does not render.
- [x] 8.3 Mobile branch unchanged: existing desktop-only message; ChatPanel does not render.
- [x] 8.4 Manual pass: connect, ensure board renders unchanged at narrow widths; widen viewport; chat appears to the right.

## 9. Runbook + docs

- [x] 9.1 Add an "Editor agent" section to `RUNBOOK.md`: model choice, cost expectations, key rotation, privacy posture (conversation turns sent to Anthropic; logs persisted locally), how to discard a runaway conversation (delete the draft).
- [x] 9.2 Update the `Last verified` date in `RUNBOOK.md`.
- [x] 9.3 Add an "Editor agent" paragraph to `CLAUDE.md` Architecture pointing at `src/lib/agent/run.ts` as the only place the agentic loop runs.
- [x] 9.4 No `justfile` change needed (no new scheduled jobs); confirm in the runbook.

## 10. Verification

- [x] 10.1 Without `ANTHROPIC_API_KEY`: `/` renders, board works, chat panel shows the disabled card; no requests to Anthropic occur (verify with the dev console / network panel).
- [x] 10.2 With `ANTHROPIC_API_KEY`: send "list my top three clusters by member count" → agent calls `get_taste_clusters` → assistant text appears; tool trace expands to show args + result.
- [x] 10.3 Send "find me three videos that lean rigor-over-rhetoric, then put one on cover and the others on featured 0 and 1" → agent calls `rank_by_theme` and `assign_slot` × 3 → board updates within ~200ms after each.
- [x] 10.4 Refresh the page; conversation rehydrates; new message appends to the same conversation.
- [x] 10.5 Publish the draft; attempt to send another message → API returns 409; UI surfaces "conversation frozen".
- [x] 10.6 Discard a draft mid-conversation; verify the conversation row + turns are cascade-deleted (`SELECT COUNT(*) FROM conversation_turns WHERE conversation_id = <id>` returns 0).
- [x] 10.7 Set `EMBEDDING_PROVIDER=bge-local` without rebuilding embeddings; ask the agent to `rank_by_theme` → tool returns `no_embedded_corpus`; agent surfaces the error in prose.
- [x] 10.8 `npm run lint` clean; `npm run build` succeeds.
- [ ] 10.9 Open PR; once merged, flip Phase 3 in `openspec/changes/conversational-editor/tasks.md` and archive `conversational-editor-ui` with `/opsx:archive`.
