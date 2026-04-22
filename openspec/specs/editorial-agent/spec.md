## ADDED Requirements

### Requirement: Conversation persistence schema

The system SHALL persist conversations and turns in two additive tables: `conversations` (one row per draft issue, `UNIQUE` on `issue_id`, `ON DELETE CASCADE` from `issues`) and `conversation_turns` (`role IN ('user','assistant','tool')`, `content` JSON, token-usage columns, `created_at`). Discarding a draft issue SHALL cascade-delete the conversation and all turns. Publishing an issue SHALL freeze its conversation: no further `conversation_turns` rows MAY be inserted with that `conversation_id` once `issues.status = 'published'`.

#### Scenario: Tables exist post-migration
- **WHEN** migrations are applied
- **THEN** `conversations` and `conversation_turns` SHALL exist with the columns described above
- **AND** `conversations.issue_id` SHALL be `UNIQUE`
- **AND** both tables' references to their parent SHALL use `ON DELETE CASCADE`

#### Scenario: Discarding a draft cascade-deletes its conversation
- **GIVEN** a draft issue with id 7 has a conversation with 12 turns
- **WHEN** the issue row is deleted (e.g. via the discard-draft path)
- **THEN** the `conversations` row for `issue_id = 7` SHALL be deleted
- **AND** all 12 `conversation_turns` rows SHALL be deleted

#### Scenario: Publishing freezes the conversation
- **GIVEN** a draft issue with an open conversation
- **WHEN** the issue is published
- **AND** the agent loop attempts to insert a new `conversation_turns` row
- **THEN** the insert SHALL be rejected at the application layer with HTTP 409 `{ error: 'conversation_frozen' }`
- **AND** no `conversation_turns` row SHALL be inserted

### Requirement: One conversation per draft

The system SHALL allow at most one conversation per draft issue, enforced by a `UNIQUE` constraint on `conversations.issue_id`. The first call to `POST /api/agent/message` for an issue without a conversation SHALL create the row in the same transaction as the first turn insert.

#### Scenario: Conversation auto-created on first message
- **GIVEN** a draft issue with id 7 and no `conversations` row
- **WHEN** `POST /api/agent/message` is called with `{ issueId: 7, content: "..." }`
- **THEN** one `conversations` row SHALL be inserted with `issue_id = 7` and `created_at = NOW()`
- **AND** the user turn SHALL be inserted as the first `conversation_turns` row
- **AND** both inserts SHALL run in a single transaction

#### Scenario: Subsequent messages reuse the same conversation
- **GIVEN** a draft issue with an existing `conversations` row
- **WHEN** `POST /api/agent/message` is called again
- **THEN** no new `conversations` row SHALL be created
- **AND** the new user turn SHALL be appended to the existing conversation

### Requirement: Streaming agent message endpoint

The system SHALL expose `POST /api/agent/message` accepting `{ issueId: number, content: string }` and returning `text/event-stream`. The route SHALL drive the agentic loop server-side: load conversation history, send to Anthropic with the seven defined tools, execute tool calls server-side as they arrive, persist each turn (user, assistant, tool) to `conversation_turns`, and stream framing events (`delta`, `tool_call`, `tool_result`, `error`, `done`) to the client. The loop SHALL terminate when the model emits no further `tool_use` blocks OR when iterations reach `AGENT_MAX_TURNS` (default 10).

#### Scenario: User message creates user turn before model call
- **WHEN** the route receives a request
- **THEN** the user-message `conversation_turns` row SHALL be inserted before the first Anthropic API call
- **AND** the row SHALL persist even if the Anthropic call fails

#### Scenario: Tool call triggers server-side execution and tool turn
- **GIVEN** the model emits a `tool_use` block for `search_pool`
- **WHEN** that block completes streaming
- **THEN** the assistant turn SHALL be persisted with the `tool_use` block in its `content`
- **AND** the tool executor SHALL be invoked with the parsed arguments
- **AND** a `tool` turn SHALL be persisted with the tool result
- **AND** the tool result SHALL be passed back to the model in the next loop iteration

#### Scenario: Loop terminates on text-only assistant response
- **GIVEN** the model returns an assistant message with no `tool_use` blocks
- **WHEN** that message completes
- **THEN** the assistant turn SHALL be persisted
- **AND** a `done` event SHALL be emitted
- **AND** the response stream SHALL close

#### Scenario: Loop hits the max-turns cap
- **GIVEN** the model has emitted 10 `tool_use` blocks in a single user-message session
- **WHEN** it attempts an 11th
- **THEN** the route SHALL emit an `error` event with `{ message: 'max turns reached' }`
- **AND** persist a final assistant turn flagging the cap
- **AND** close the stream

#### Scenario: Anthropic API failure produces error event
- **WHEN** the Anthropic call returns a non-2xx status (other than the explicit 401 path)
- **THEN** the route SHALL emit an `error` event with the API's error message
- **AND** the user turn SHALL remain persisted (so the UI can retry without losing the input)
- **AND** the route SHALL close the stream

#### Scenario: Missing API key
- **WHEN** `ANTHROPIC_API_KEY` is unset
- **THEN** the route SHALL respond with HTTP 412 `{ error: 'api_key_missing' }` without contacting Anthropic
- **AND** SHALL NOT insert a user turn

#### Scenario: Frozen conversation rejects new messages
- **WHEN** `POST /api/agent/message` is called with the `issueId` of a published issue
- **THEN** the route SHALL respond with HTTP 409 `{ error: 'conversation_frozen' }`
- **AND** SHALL NOT contact Anthropic
- **AND** SHALL NOT insert any rows

### Requirement: Tool set

The agent SHALL be configured with exactly seven tools:

- `search_pool({ query?: string, cluster_id?: number, limit?: number })` — returns inbox-pool videos matching a free-text query (substring on title/channel) and/or a cluster filter, capped at `limit` (default 20, max 50).
- `rank_by_theme({ theme: string, limit?: number })` — embeds the free-text theme using the active `(provider, model)` and returns top-K corpus videos by cosine similarity (default 10, max 25). REJECTS with a tool error if no embeddings exist under the active provider/model.
- `get_video_detail({ video_id: string })` — returns title, channel, duration, published date, summary (from `video_enrichment`), topic tags, transcript snippet (first ~500 chars from `video_transcripts`), current consumption status, and current cluster assignment.
- `get_taste_clusters({})` — returns active cluster summaries: id, label, weight, member count, top-N members. Read-only over the same tables `/taste` reads.
- `assign_slot({ video_id, slot_kind: 'cover'|'featured'|'brief', slot_index })` — POSTs `{ action: 'assign', ... }` to the existing slot-mutation endpoint for the current draft.
- `swap_slots({ from, to })` — POSTs `{ action: 'swap', from, to }`. `from` accepts `{ kind, index }` or `{ pool: video_id }`.
- `clear_slot({ slot_kind, slot_index })` — POSTs `{ action: 'clear', target: { kind, index } }`.

The agent SHALL NOT have tools for: cluster mutations (label, weight, merge, split, retire), publishing or discarding issues, importing videos, modifying consumption status outside of slot assignment's existing inbox→saved promotion.

#### Scenario: rank_by_theme without active embeddings
- **GIVEN** the corpus has zero rows in `video_embeddings` for the active `(provider, model)`
- **WHEN** the agent calls `rank_by_theme({ theme: "rigor over rhetoric" })`
- **THEN** the tool executor SHALL return `{ error: 'no_embedded_corpus' }` to the model
- **AND** SHALL NOT call the embedding provider

#### Scenario: assign_slot reuses the existing endpoint contract
- **WHEN** the agent calls `assign_slot({ video_id: 'vid_a', slot_kind: 'cover', slot_index: 0 })`
- **THEN** the executor SHALL call the same code path as `POST /api/issues/:id/slots` with `{ action: 'assign', video_id: 'vid_a', target: { kind: 'cover', index: 0 } }`
- **AND** all existing invariants (slot occupied → 409, video already on issue → 409, inbox→saved promotion) SHALL apply unchanged

#### Scenario: Tool failures surface as tool results, not stream errors
- **GIVEN** `assign_slot` fails because the slot is occupied
- **WHEN** the executor receives HTTP 409
- **THEN** the tool result SHALL be `{ error: 'slot_occupied' }` and SHALL be passed back to the model as a normal `tool_result` block
- **AND** the SSE stream SHALL NOT emit an `error` event for tool-level failures

### Requirement: Conversation hydration endpoint

The system SHALL expose `GET /api/agent/conversation/[issueId]` returning the full ordered turn list for that issue's conversation, shaped for client rendering: `[{ id, role, blocks: [{ kind, ... }], createdAt }]`. The endpoint SHALL respond with `{ turns: [] }` if the issue exists but has no conversation. The endpoint SHALL respond with HTTP 404 if the issue does not exist.

#### Scenario: Existing conversation returned in order
- **GIVEN** an issue with id 7 and 4 turns in `conversation_turns`
- **WHEN** `GET /api/agent/conversation/7` is called
- **THEN** the response SHALL be HTTP 200 with `{ turns: [...] }` containing all 4 turns ordered by `id ASC`

#### Scenario: Issue exists but conversation does not
- **GIVEN** an issue with id 7 and no `conversations` row
- **WHEN** the endpoint is called
- **THEN** the response SHALL be HTTP 200 with `{ turns: [] }`

#### Scenario: Issue does not exist
- **GIVEN** no issue with id 999
- **WHEN** the endpoint is called
- **THEN** the response SHALL be HTTP 404

### Requirement: Status endpoint reports key presence

The system SHALL expose `GET /api/agent/status` returning `{ apiKeyPresent: boolean, model: string }`. This endpoint SHALL NOT call Anthropic; it SHALL only inspect process env. It SHALL be safe to call without an API key.

#### Scenario: API key present
- **GIVEN** `ANTHROPIC_API_KEY` is set
- **WHEN** the endpoint is called
- **THEN** the response SHALL be `{ apiKeyPresent: true, model: <AGENT_MODEL or default> }`

#### Scenario: API key absent
- **GIVEN** `ANTHROPIC_API_KEY` is unset
- **WHEN** the endpoint is called
- **THEN** the response SHALL be `{ apiKeyPresent: false, model: <AGENT_MODEL or default> }`

### Requirement: Slot mutations from the agent share the user mutation path

The agent's `assign_slot`, `swap_slots`, and `clear_slot` tools SHALL invoke the same library-level code path as the user-facing `POST /api/issues/:id/slots` endpoint. Slot rows inserted, updated, or deleted by the agent SHALL be indistinguishable in the database from those produced by drag-and-drop or keyboard input.

#### Scenario: Agent-driven assignment is identical to user-driven
- **GIVEN** the agent assigns video `vid_a` to cover slot 0
- **WHEN** the resulting `issue_slots` row is inspected
- **THEN** the row SHALL contain the same columns and values as if the user had performed `POST /api/issues/:id/slots` with the equivalent payload
- **AND** the `consumption.status` SHALL have been promoted from `inbox` to `saved` if applicable, per the existing rule

### Requirement: Agent has no write access to taste tables

The agent SHALL NOT have tools that mutate `taste_clusters` or `video_cluster_assignments`. Cluster labels, weights, merges, splits, retires, and reassignments remain exclusively user-initiated through `/taste`.

#### Scenario: User asks the agent to rename a cluster
- **WHEN** the user types "rename cluster 7 to 'craft tutorials'"
- **THEN** the agent SHALL respond with assistant text directing the user to `/taste`
- **AND** SHALL NOT call any tool that writes to `taste_clusters`
- **AND** no `taste_clusters` row SHALL be modified
