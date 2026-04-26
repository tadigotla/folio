# Curation Agent

The conversational curation companion bound to today's local-day. Helps the
single user navigate the video pool, maintain playlists, and calibrate
taste-cluster signals. Replaces the prior `editorial-agent` capability; the
slot-tool surface and editor-in-chief framing are gone with the magazine
teardown.

### Requirement: Per-day conversation scope

The system SHALL persist one conversation per calendar day in
`America/New_York`, keyed by `conversations.scope_date` (ISO date, e.g.
`2026-04-23`). `scope_date` SHALL be `UNIQUE NOT NULL`. The first call to
`POST /api/agent/message` on a given day SHALL create the conversation
row in the same transaction as the first user turn. Subsequent calls on
the same day SHALL append to that conversation. Conversations SHALL NOT
be bound to any `issues` row (the `issues` table does not exist).

#### Scenario: First message on a new day creates the conversation

- **GIVEN** no `conversations` row exists with `scope_date = '2026-04-23'`
- **WHEN** `POST /api/agent/message` is called at `14:00 America/New_York` on `2026-04-23` with `{ content: "..." }`
- **THEN** one `conversations` row SHALL be inserted with `scope_date = '2026-04-23'` and `created_at = NOW()`
- **AND** the user turn SHALL be inserted as the first `conversation_turns` row
- **AND** both inserts SHALL run in a single transaction

#### Scenario: Subsequent message same day reuses the conversation

- **GIVEN** a `conversations` row exists with `scope_date = '2026-04-23'` and 3 turns
- **WHEN** `POST /api/agent/message` is called at `21:30 America/New_York` on `2026-04-23`
- **THEN** no new `conversations` row SHALL be created
- **AND** the new user turn SHALL be appended to the existing conversation

#### Scenario: Same wall-clock hour but different local date creates a new conversation

- **GIVEN** a conversation exists for `scope_date = '2026-04-23'`
- **WHEN** `POST /api/agent/message` is called at `00:30 America/New_York` on `2026-04-24`
- **THEN** a new `conversations` row SHALL be inserted with `scope_date = '2026-04-24'`

### Requirement: Streaming agent message endpoint

The system SHALL expose `POST /api/agent/message` accepting
`{ content: string }` validated through a Zod schema co-located in the
route file, and returning `text/event-stream`. Malformed bodies SHALL
respond with HTTP 400 per the Zod-validated agent boundaries
requirement. The route SHALL resolve today's `scope_date` server-side
(never from the client) and drive the agentic loop: load the current
day's conversation history, send to Anthropic with the curation tool
set, execute tool calls server-side as they arrive, persist each turn
(user, assistant, tool) to `conversation_turns`, and stream framing
events (`delta`, `tool_call`, `tool_result`, `error`, `done`) to the
client.

The `tool_result` event payload SHALL carry the typed envelope
`{ toolName, ok, result?, error? }` per the Typed tool-result envelope
requirement.

The loop SHALL terminate when the model emits no further `tool_use`
blocks, OR when iterations reach `AGENT_MAX_TURNS` (default 10), OR
when either of the token caps `AGENT_MAX_INPUT_TOKENS` /
`AGENT_MAX_OUTPUT_TOKENS` is exceeded between iterations per the
Token-budget cap requirement.

#### Scenario: User message creates user turn before model call

- **WHEN** the route receives a request that passes Zod validation
- **THEN** the user-message `conversation_turns` row SHALL be inserted before the first Anthropic API call
- **AND** the row SHALL persist even if the Anthropic call fails

#### Scenario: Tool call triggers server-side execution and tool turn

- **GIVEN** the model emits a `tool_use` block for `add_to_playlist`
- **WHEN** that block completes streaming
- **THEN** the assistant turn SHALL be persisted with the `tool_use` block in its `content`
- **AND** the tool executor SHALL parse the input through the per-tool Zod schema, then invoke the implementation
- **AND** a `tool` turn SHALL be persisted with the typed-envelope tool result
- **AND** the result SHALL be passed back to the model in the next loop iteration

#### Scenario: Loop terminates on text-only assistant response

- **GIVEN** the model returns an assistant message with no `tool_use` blocks
- **WHEN** that message completes
- **THEN** the assistant turn SHALL be persisted
- **AND** a `done` event SHALL be emitted
- **AND** the response stream SHALL close

#### Scenario: Loop hits the max-turns cap

- **GIVEN** the model has emitted `AGENT_MAX_TURNS` `tool_use` blocks in a single user-message session
- **WHEN** it attempts one more
- **THEN** the route SHALL emit an `error` event identifying the turn cap and the measured value
- **AND** persist a final assistant turn flagging the cap
- **AND** close the stream

#### Scenario: Missing API key

- **WHEN** `ANTHROPIC_API_KEY` is unset
- **THEN** the route SHALL respond with HTTP 412 `{ error: { code: 'precondition_failed', message: 'api_key_missing' } }` without contacting Anthropic
- **AND** SHALL NOT insert a user turn

#### Scenario: Malformed request body rejected with 400

- **WHEN** the request body fails Zod validation
- **THEN** the response SHALL be HTTP 400 with `{ error: { code: 'validation', message, details } }`
- **AND** no `conversation_turns` row SHALL be inserted
- **AND** no Anthropic API call SHALL be made

### Requirement: Curation tool set

The agent SHALL be configured with exactly these tools, and no others:

- `search_pool({ query?: string, cluster_id?: number, limit?: number })` — returns videos whose `consumption.status IN ('inbox','saved','in_progress')` matching a free-text query (substring on title/channel) and/or a cluster filter, capped at `limit` (default 20, max 50).
- `rank_by_theme({ theme: string, limit?: number })` — embeds the free-text theme using the active `(provider, model)` and returns top-K corpus videos by cosine similarity (default 10, max 25). REJECTS with a `precondition_failed` typed-envelope error if no embeddings exist under the active provider/model.
- `get_video_detail({ video_id: string })` — returns title, channel, duration, published date, summary (from `video_enrichment`), topic tags, transcript snippet (first ~500 chars from `video_transcripts`), current consumption status, and current cluster assignment.
- `get_taste_clusters({})` — returns active cluster summaries: id, label, weight, member count, top-N members. Read-only over the taste tables.
- `create_playlist({ name: string, description?: string })` — creates a new playlist row via the same code path as `/api/playlists`.
- `add_to_playlist({ playlist_id: number, video_id: string })` — appends a video to the named playlist.
- `remove_from_playlist({ playlist_id: number, video_id: string })` — removes a video from the named playlist.
- `reorder_playlist({ playlist_id: number, video_id: string, position: number })` — moves a playlist item to a new position.
- `triage_inbox({ video_id: string, action: 'save'|'archive'|'dismiss' })` — transitions a video's consumption status via the same code path as `POST /api/consumption`.
- `mute_cluster_today({ cluster_id: number })` — ephemeral per-day mute of a taste cluster for home ranking.
- `resurface({ video_id: string })` — moves an `archived` video back to `saved`.
- `search_youtube({ query: string, channel_id?: string, max_results?: number })` — user-initiated YouTube Data API v3 `search.list`. Returns normalized `{ kind, target_id, title, channel_name }` items. Requires `YOUTUBE_API_KEY`; returns a tool-error when the key is unset. Defined in full by the `discovery` capability.
- `propose_import({ kind: 'video'|'channel', target_id: string, title?: string, channel_name?: string, source_kind: 'description_link'|'description_handle'|'transcript_link' })` — wraps `src/lib/discovery/candidates.ts#proposeCandidate`. Stages a row in `discovery_candidates` for user-gated approval on `/inbox`. Defined in full by the `discovery` capability.

Each tool SHALL have BOTH a model-facing JSON Schema (for the
Anthropic tool definition) AND a server-side Zod schema (for executor
validation), per the Zod-validated agent boundaries requirement.

The agent SHALL NOT have tools for: slot assignment (`assign_slot`,
`swap_slots`, `clear_slot` — these are removed with the magazine
teardown), cluster mutations (label, weight, merge, split, retire),
publishing/discarding issues (issues do not exist), or importing videos
directly (import only happens via user-initiated approve on `/inbox`,
never via an agent tool).

#### Scenario: No slot tools present

- **WHEN** the agent's tool schema is inspected
- **THEN** no tool named `assign_slot`, `swap_slots`, `clear_slot`, or any other slot verb SHALL be present

#### Scenario: rank_by_theme without active embeddings

- **GIVEN** the corpus has zero rows in `video_embeddings` for the active `(provider, model)`
- **WHEN** the agent calls `rank_by_theme({ theme: "rigor over rhetoric" })`
- **THEN** the tool executor SHALL return `{ ok: false, error: { code: 'precondition_failed', message: 'no_embedded_corpus' } }` to the model
- **AND** SHALL NOT call the embedding provider

#### Scenario: add_to_playlist reuses the existing library path

- **WHEN** the agent calls `add_to_playlist({ playlist_id: 3, video_id: 'abc123' })`
- **THEN** the executor SHALL parse the input through the tool's Zod schema, then invoke the same `addToPlaylist` function used by `POST /api/playlists/[id]/items`
- **AND** the inserted `playlist_items` row SHALL be indistinguishable from a user-initiated add

#### Scenario: Tool failures surface as typed tool results, not stream errors

- **GIVEN** `add_to_playlist` fails because the video is already in the playlist
- **WHEN** the executor receives the typed `DuplicateVideoInPlaylistError`
- **THEN** the tool result SHALL be `{ ok: false, error: { code: 'conflict', message: <human-readable>, details?: <playlist + video info> } }` and SHALL be passed back to the model as a normal `tool_result` block
- **AND** the SSE stream SHALL NOT emit an `error` event for tool-level failures

#### Scenario: propose_import reuses the single legal mutation path

- **WHEN** the agent calls `propose_import({ kind: 'video', target_id: 'xyz', source_kind: 'description_link' })`
- **THEN** the executor SHALL invoke `proposeCandidate` from `src/lib/discovery/candidates.ts`
- **AND** no raw SQL `INSERT INTO discovery_candidates` statement SHALL appear in the agent code path

### Requirement: Curation-companion voice

The system prompt SHALL frame the agent as a curation companion
assisting the single user's consumption, not as an editor-in-chief
publishing an issue. The prompt SHALL NOT use the words *issue*,
*cover*, *featured*, *brief*, *slot*, *publish*, *draft*, *masthead*,
or *editor-in-chief*. The prompt SHALL describe the agent's purpose as
helping the user navigate the video pool, maintain playlists, and
calibrate taste-cluster signals.

#### Scenario: Prompt vocabulary audit

- **WHEN** the system prompt string is inspected
- **THEN** none of the words *issue*, *cover*, *featured*, *brief*, *slot*, *publish*, *draft*, *masthead*, *editor-in-chief* SHALL appear (case-insensitive, word-boundary match)

### Requirement: Conversation hydration endpoint

The system SHALL expose `GET /api/agent/conversation/[date]` returning
the full ordered turn list for that day's conversation, shaped for
client rendering: `[{ id, role, blocks: [{ kind, ... }], createdAt }]`.
The endpoint SHALL accept `[date]` in `YYYY-MM-DD` format interpreted
in `America/New_York`. The endpoint SHALL respond with `{ turns: [] }`
if no conversation exists for that date. The endpoint SHALL respond
with HTTP 400 if `[date]` is not a valid ISO date.

#### Scenario: Existing conversation returned in order

- **GIVEN** a conversation on `2026-04-23` with 4 turns in `conversation_turns`
- **WHEN** `GET /api/agent/conversation/2026-04-23` is called
- **THEN** the response SHALL be HTTP 200 with `{ turns: [...] }` containing all 4 turns ordered by `id ASC`

#### Scenario: No conversation for that day

- **GIVEN** no `conversations` row with `scope_date = '2026-04-30'`
- **WHEN** `GET /api/agent/conversation/2026-04-30` is called
- **THEN** the response SHALL be HTTP 200 with `{ turns: [] }`

#### Scenario: Malformed date

- **WHEN** `GET /api/agent/conversation/not-a-date` is called
- **THEN** the response SHALL be HTTP 400

### Requirement: Status endpoint reports key presence

The system SHALL expose `GET /api/agent/status` returning
`{ apiKeyPresent: boolean, model: string, youtubeSearchEnabled: boolean }`.
This endpoint SHALL NOT call Anthropic or YouTube; it SHALL only inspect
process env. It SHALL be safe to call without any API key present.

#### Scenario: All keys present

- **GIVEN** `ANTHROPIC_API_KEY` is set and `YOUTUBE_API_KEY` is set
- **WHEN** the endpoint is called
- **THEN** the response SHALL be `{ apiKeyPresent: true, model: <AGENT_MODEL or default>, youtubeSearchEnabled: true }`

#### Scenario: Anthropic present, YouTube absent

- **GIVEN** `ANTHROPIC_API_KEY` is set and `YOUTUBE_API_KEY` is unset
- **WHEN** the endpoint is called
- **THEN** the response SHALL be `{ apiKeyPresent: true, model: <AGENT_MODEL or default>, youtubeSearchEnabled: false }`

#### Scenario: Anthropic absent

- **GIVEN** `ANTHROPIC_API_KEY` is unset
- **WHEN** the endpoint is called
- **THEN** the response SHALL be `{ apiKeyPresent: false, model: <AGENT_MODEL or default>, youtubeSearchEnabled: <true|false depending on YOUTUBE_API_KEY> }`

### Requirement: Agent never auto-calls `search_youtube`

The agent's system prompt SHALL instruct the model that `search_youtube`
performs an outbound API call that (a) counts against a daily quota and
(b) sends the query string to Google, and that the model SHALL call the
tool only when the user explicitly asks to find new content. The tool
description field SHALL carry a one-line restatement of this rule so
the model sees it at tool-selection time.

The agent SHALL NOT use `search_youtube` to: verify metadata of an
existing corpus video, answer a factual question about an existing
video, proactively propose content the user did not ask for, or enrich
a response beyond what the conversation requires.

This is a model-behaviour contract enforced by the system prompt; no
runtime guard blocks the call. The existing `AGENT_MAX_TURNS` cap
(default 10) is the backstop against a runaway loop.

#### Scenario: User asks a factual question about a known video

- **GIVEN** the user asks "when was that slow-cinema video from last Tuesday published?"
- **WHEN** the agent processes the turn
- **THEN** the agent SHALL NOT call `search_youtube`
- **AND** SHALL use `search_pool` or `get_video_detail` to find the answer in the corpus

#### Scenario: User asks for new content

- **GIVEN** the user asks "find me more cast-iron metallurgy channels, I liked that video from last month"
- **WHEN** the agent processes the turn
- **THEN** the agent MAY call `search_youtube({ query: 'cast iron metallurgy' })`
- **AND** the agent MAY follow up with `propose_import` on individual results

#### Scenario: Missing key surfaces through the tool, not a silent skip

- **GIVEN** `YOUTUBE_API_KEY` is unset and the user asks for new content
- **WHEN** the agent calls `search_youtube`
- **THEN** the tool SHALL return `{ error: 'youtube_api_key_missing', ... }`
- **AND** the agent SHALL relay a human-readable message pointing at `/settings/youtube` or the RUNBOOK section rather than silently no-opping

### Requirement: Agent has no write access to taste tables

The agent SHALL NOT have tools that mutate `taste_clusters` or
`video_cluster_assignments`. Cluster labels, weights, merges, splits,
retires, and reassignments remain exclusively user-initiated through
`/taste`. The one exception is `mute_cluster_today`, which writes to
`taste_cluster_mutes` for the current day only and expires automatically;
it does not modify any cluster definition or membership.

#### Scenario: User asks the agent to rename a cluster

- **WHEN** the user types "rename cluster 7 to 'craft tutorials'"
- **THEN** the agent SHALL respond with assistant text directing the user to `/taste`
- **AND** SHALL NOT call any tool that writes to `taste_clusters`
- **AND** no `taste_clusters` row SHALL be modified

### Requirement: Typed tool-result envelope

Tool results SHALL conform to a typed discriminated-union envelope on every path that exits the agent module — both the `tool_result` content block sent back to the model and the SSE `tool_result` event emitted to the client. Success SHALL be `{ ok: true, result: unknown }`; failure SHALL be `{ ok: false, error: { code: ToolErrorCode, message: string, details?: unknown } }`. The TypeScript shape is:

```ts
type ToolResult =
  | { ok: true;  result: unknown }
  | { ok: false; error: { code: ToolErrorCode; message: string; details?: unknown } };
```

`ToolErrorCode` SHALL be one of: `validation`, `not_found`, `conflict`,
`precondition_failed`, `permission_denied`, `upstream_unavailable`,
`internal`. The set is closed; new codes require a spec change.

The executor SHALL map known typed errors thrown by tool implementations
to their corresponding code (e.g., `IllegalTransitionError` →
`conflict`, `PlaylistNotFoundError` → `not_found`,
`DuplicateVideoInPlaylistError` → `conflict`,
`InvalidPositionError` → `validation`,
`ClusterNotFoundError` → `not_found`, `no_embedded_corpus` precondition
on `rank_by_theme` → `precondition_failed`). Uncaught exceptions SHALL
be mapped to `internal`, logged server-side with the stack, and
returned to the model with a generic `message` (no stack leakage).

Tool failures SHALL continue to surface as `tool_result` blocks fed
back to the model, NOT as SSE `error` events. The SSE `error` event
remains reserved for model/API faults and the loop caps.

#### Scenario: Successful tool result is wrapped in ok envelope

- **GIVEN** a tool implementation returns a value `V` without throwing
- **WHEN** the executor processes the result
- **THEN** the `tool_result` block sent back to the model SHALL have shape `{ ok: true, result: V }`
- **AND** the SSE `tool_result` event SHALL carry the same envelope alongside `toolName`

#### Scenario: Known typed error maps to its code

- **GIVEN** the agent calls `triage_inbox({ video_id, action: 'archive' })` for a video currently in the `inbox` state
- **AND** `setConsumptionStatus` throws `IllegalTransitionError`
- **WHEN** the executor catches the error
- **THEN** the result SHALL be `{ ok: false, error: { code: 'conflict', message: <human-readable>, details?: <transition info> } }`
- **AND** the SSE `tool_result` event SHALL carry the same envelope

#### Scenario: Unknown exception maps to internal without leaking stack

- **GIVEN** a tool implementation throws an unexpected error (e.g., a SQLite I/O failure)
- **WHEN** the executor catches it
- **THEN** the server SHALL log the full stack
- **AND** the result returned to the model SHALL be `{ ok: false, error: { code: 'internal', message: 'tool execution failed' } }` with no stack details
- **AND** the SSE event SHALL carry the same redacted envelope

#### Scenario: Validation failure on tool input

- **GIVEN** the model emits a `tool_use` block whose input fails the per-tool Zod schema
- **WHEN** the executor parses the input
- **THEN** the implementation SHALL NOT be invoked
- **AND** the result SHALL be `{ ok: false, error: { code: 'validation', message: <Zod issue summary>, details: <Zod issue list> } }`

### Requirement: Zod-validated agent boundaries

Every external boundary of the agent surface SHALL validate its input
against a Zod schema before any further work. Boundaries are:

1. The HTTP request body of `POST /api/agent/message`.
2. The path param of `GET /api/agent/conversation/[date]`.
3. Each tool's input parameters at the executor (in addition to the
   model-facing JSON Schema).

Validation failures at HTTP boundaries SHALL respond with HTTP 400 and
a body of shape `{ error: { code: 'validation', message: string, details?: unknown } }`. Validation failures at the tool boundary
SHALL surface as `validation` tool results per the typed envelope
requirement above.

Internal helper functions, RSC pages, and the consumption / taste-edit
modules SHALL NOT add Zod validation; they remain typed at the function
signature level.

#### Scenario: Malformed POST body rejected with 400

- **WHEN** `POST /api/agent/message` is called with a body that fails Zod validation (missing `content`, non-string `content`, `content` exceeding the configured max length, or extra unknown fields beyond what the schema accepts)
- **THEN** the response SHALL be HTTP 400 with `{ error: { code: 'validation', message, details } }`
- **AND** no `conversation_turns` row SHALL be inserted
- **AND** no Anthropic API call SHALL be made

#### Scenario: Tool input validated server-side before implementation runs

- **GIVEN** the model emits a `tool_use` block whose JSON-Schema-validated input still drifts from the executor's Zod schema (e.g., a numeric field arriving as a string)
- **WHEN** the executor parses the input
- **THEN** Zod parsing SHALL fail
- **AND** the implementation SHALL NOT be invoked
- **AND** the model SHALL receive a `validation` tool result per the typed envelope

#### Scenario: Conversation hydration date param validated

- **WHEN** `GET /api/agent/conversation/[date]` is called with a `[date]` that is not a valid `YYYY-MM-DD` ISO date in `America/New_York`
- **THEN** the response SHALL be HTTP 400 with `{ error: { code: 'validation', message, details } }`

### Requirement: Token-budget cap on the agent loop

In addition to `AGENT_MAX_TURNS`, the agent loop SHALL enforce two
optional environment-driven caps **per `POST /api/agent/message` user-message
session**:

- `AGENT_MAX_INPUT_TOKENS` (default `200000`) — cumulative input tokens
  across all turns produced in this session.
- `AGENT_MAX_OUTPUT_TOKENS` (default `20000`) — cumulative output
  tokens across all turns produced in this session.

Caps are evaluated **between iterations** by summing the
`input_tokens` / `output_tokens` columns of `conversation_turns` rows
created during this session. If either cap is exceeded after the
current iteration completes, the loop SHALL stop before the next
iteration the same way `AGENT_MAX_TURNS` stops it: emit an `error`
event identifying which cap was hit and the measured value, persist a
final assistant turn flagging the cap, and close the stream. A turn in
flight SHALL NOT be interrupted mid-stream.

Both caps SHALL be optional. Unset (or set to `0`) SHALL disable the
respective cap. Caps SHALL be **per session**, never per conversation
or per day.

#### Scenario: Input-token cap stops the loop

- **GIVEN** `AGENT_MAX_INPUT_TOKENS=10000` is set
- **AND** a user-message session has produced turns whose summed `input_tokens` is `10500` after iteration N
- **WHEN** iteration N completes
- **THEN** the loop SHALL NOT begin iteration N+1
- **AND** the SSE stream SHALL emit an `error` event identifying the input-token cap and the measured value
- **AND** a final assistant turn SHALL be persisted noting the cap
- **AND** the stream SHALL close

#### Scenario: Output-token cap stops the loop

- **GIVEN** `AGENT_MAX_OUTPUT_TOKENS=5000` is set
- **AND** a user-message session has produced turns whose summed `output_tokens` is `5200` after iteration N
- **WHEN** iteration N completes
- **THEN** the loop SHALL NOT begin iteration N+1
- **AND** the SSE stream SHALL emit an `error` event identifying the output-token cap and the measured value
- **AND** a final assistant turn SHALL be persisted noting the cap
- **AND** the stream SHALL close

#### Scenario: Cap is per-session, not per-conversation

- **GIVEN** earlier sessions today have already accumulated `9000` input tokens on this conversation
- **AND** `AGENT_MAX_INPUT_TOKENS=10000`
- **WHEN** a new `POST /api/agent/message` session begins
- **THEN** the cap SHALL be measured against this session's turns only, starting at `0`
- **AND** the session SHALL be allowed to consume up to `10000` input tokens before the cap fires

#### Scenario: Cap unset disables enforcement

- **GIVEN** `AGENT_MAX_INPUT_TOKENS` is unset and `AGENT_MAX_OUTPUT_TOKENS` is unset
- **WHEN** a session runs
- **THEN** only `AGENT_MAX_TURNS` SHALL bound the loop
- **AND** no token-cap `error` event SHALL be emitted regardless of token usage

#### Scenario: In-flight turn is not interrupted

- **GIVEN** the input-token cap is `10000`
- **AND** iteration N begins with cumulative `input_tokens` at `9500`
- **WHEN** iteration N's assistant response causes cumulative `input_tokens` to reach `12000`
- **THEN** iteration N's `delta` events and final assistant turn SHALL stream through to completion
- **AND** the cap-stop SHALL fire only between iteration N and N+1

### Requirement: Deterministic test seam for state-machine modules

The repository SHALL include a vitest-based test runner with
deterministic in-memory SQLite tests covering exactly two modules:

1. `src/lib/consumption.ts` — every legal transition in
   `setConsumptionStatus`, every illegal transition raising
   `IllegalTransitionError`, the `recordProgress` auto-promotion paths
   (`inbox → saved → in_progress` on `start`, `saved → in_progress` on
   `start`, `archived → in_progress` on `start`), the
   `recordProgress` auto-archive on `end`, and `last_position_seconds`
   write/clear behavior.
2. `src/lib/taste-edit.ts` — every transition surfaced through the
   module's exported API (label, weight, reassign, merge, split, retire),
   plus the `IllegalEditError` (HTTP 422) and `ConcurrentEditError`
   (HTTP 409 optimistic-lock) error paths.

Tests SHALL run via `npm run test` (added to `package.json`) and the
`just test` verb (already declared in `justfile`). Tests SHALL use an
in-memory SQLite database via `better-sqlite3` `:memory:` and SHALL run
`runMigrations()` against that database before each test. Tests SHALL
NOT contact Anthropic, OpenAI, YouTube, or any other external service.
Tests SHALL NOT touch the on-disk `events.db`.

The `getDb()` singleton in `src/lib/db.ts` SHALL expose a test-only
override (e.g., `setDbForTest(db)`) so test setup can inject the
in-memory instance without monkey-patching. The override SHALL be
cleared between tests.

This requirement SHALL NOT be interpreted as a mandate for broader
test coverage. Other modules remain untested unless a future change
proposes otherwise.

#### Scenario: just test runs the suite

- **WHEN** `just test` is invoked
- **THEN** vitest SHALL execute the consumption and taste-edit test files
- **AND** the suite SHALL NOT contact any external service
- **AND** the suite SHALL NOT modify the on-disk `events.db`

#### Scenario: Consumption test covers illegal transition

- **GIVEN** an in-memory database seeded with a video whose `consumption.status = 'inbox'`
- **WHEN** the test calls `setConsumptionStatus(videoId, 'in_progress')`
- **THEN** the call SHALL throw `IllegalTransitionError`
- **AND** the database row SHALL still show `status = 'inbox'`

#### Scenario: Taste-edit test covers concurrent-edit conflict

- **GIVEN** an in-memory database with a `taste_clusters` row whose `updated_at = T1`
- **WHEN** a test calls a taste-edit mutation passing `expectedUpdatedAt = T0` (older than `T1`)
- **THEN** the call SHALL throw `ConcurrentEditError`
- **AND** the row SHALL remain at `updated_at = T1` with no other column changes
