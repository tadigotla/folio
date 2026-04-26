## MODIFIED Requirements

### Requirement: Curation tool set

The agent SHALL be configured with exactly these tools, and no others:

- `search_pool({ query?: string, cluster_id?: number, limit?: number })` — returns videos whose `consumption.status IN ('inbox','saved','in_progress')` matching a free-text query (substring on title/channel) and/or a cluster filter, capped at `limit` (default 20, max 50).
- `rank_by_theme({ theme: string, limit?: number })` — embeds the free-text theme using the active `(provider, model)` and returns top-K corpus videos by cosine similarity (default 10, max 25). REJECTS with a tool error if no embeddings exist under the active provider/model.
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
- **THEN** the tool executor SHALL return `{ error: 'no_embedded_corpus' }` to the model
- **AND** SHALL NOT call the embedding provider

#### Scenario: add_to_playlist reuses the existing library path

- **WHEN** the agent calls `add_to_playlist({ playlist_id: 3, video_id: 'abc123' })`
- **THEN** the executor SHALL invoke the same `src/lib/playlists.ts` `addToPlaylist` function used by `POST /api/playlists/[id]/items`
- **AND** the inserted `playlist_items` row SHALL be indistinguishable from a user-initiated add

#### Scenario: Tool failures surface as tool results, not stream errors

- **GIVEN** `add_to_playlist` fails because the video is already in the playlist
- **WHEN** the executor receives the typed error
- **THEN** the tool result SHALL be `{ error: 'duplicate_video' }` and SHALL be passed back to the model as a normal `tool_result` block
- **AND** the SSE stream SHALL NOT emit an `error` event for tool-level failures

#### Scenario: propose_import reuses the single legal mutation path

- **WHEN** the agent calls `propose_import({ kind: 'video', target_id: 'xyz', source_kind: 'description_link' })`
- **THEN** the executor SHALL invoke `proposeCandidate` from `src/lib/discovery/candidates.ts`
- **AND** no raw SQL `INSERT INTO discovery_candidates` statement SHALL appear in the agent code path

### Requirement: Status endpoint reports key presence

The system SHALL expose `GET /api/agent/status` returning
`{ apiKeyPresent: boolean, model: string, youtubeSearchEnabled: boolean }`. This endpoint SHALL NOT
call Anthropic or YouTube; it SHALL only inspect process env. It SHALL be safe
to call without any API key present.

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

## ADDED Requirements

### Requirement: Agent never auto-calls `search_youtube`

The agent's system prompt SHALL instruct the model that `search_youtube` performs an outbound API call that (a) counts against a daily quota and (b) sends the query string to Google, and that the model SHALL call the tool only when the user explicitly asks to find new content. The tool description field SHALL carry a one-line restatement of this rule so the model sees it at tool-selection time.

The agent SHALL NOT use `search_youtube` to: verify metadata of an existing corpus video, answer a factual question about an existing video, proactively propose content the user did not ask for, or enrich a response beyond what the conversation requires.

This is a model-behaviour contract enforced by the system prompt; no runtime guard blocks the call. The existing `AGENT_MAX_TURNS` cap (default 10) is the backstop against a runaway loop.

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
