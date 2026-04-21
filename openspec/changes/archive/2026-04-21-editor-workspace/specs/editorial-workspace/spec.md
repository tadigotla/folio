## ADDED Requirements

### Requirement: Draft and published issue schema
The system SHALL persist issues in an `issues` table with columns: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `status TEXT NOT NULL CHECK (status IN ('draft', 'published'))`, `title TEXT`, `created_at TEXT NOT NULL`, `published_at TEXT`. A partial UNIQUE index on `status` scoped to `status = 'draft'` SHALL enforce the invariant that at most one draft issue exists at any time.

#### Scenario: Table exists post-migration
- **WHEN** migrations are applied
- **THEN** the `issues` table SHALL exist with the column schema above and a partial unique index on `(status)` where `status = 'draft'`

#### Scenario: At most one draft
- **WHEN** a draft issue already exists and the system attempts to insert another row with `status = 'draft'`
- **THEN** the INSERT SHALL fail with a `SQLITE_CONSTRAINT_UNIQUE` error and no second draft row SHALL be created

### Requirement: Slot table
The system SHALL persist per-issue slot assignments in an `issue_slots` table with columns: `issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE`, `slot_kind TEXT NOT NULL CHECK (slot_kind IN ('cover', 'featured', 'brief'))`, `slot_index INTEGER NOT NULL`, `video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE`, `assigned_at TEXT NOT NULL`. Composite primary key `(issue_id, slot_kind, slot_index)`. A UNIQUE index on `(issue_id, video_id)` SHALL prevent the same video from occupying two slots of the same issue.

#### Scenario: Video uniqueness within an issue
- **WHEN** a video is already assigned to a slot of an issue and the system attempts to assign the same video to another slot of that same issue
- **THEN** the assignment SHALL fail with HTTP 409 and no second `issue_slots` row SHALL be created

#### Scenario: Cascade on issue delete
- **WHEN** an issue row is deleted
- **THEN** all `issue_slots` rows referencing that issue SHALL be deleted automatically via `ON DELETE CASCADE`

### Requirement: Slot shape
Every issue SHALL have exactly 14 addressable slots: one cover (`slot_kind = 'cover', slot_index = 0`), three featured (`slot_kind = 'featured', slot_index ∈ {0, 1, 2}`), and ten briefs (`slot_kind = 'brief', slot_index ∈ {0..9}`). An empty slot SHALL be represented by the absence of a row; empty-slot records SHALL NOT be inserted. Slot-index out-of-range values SHALL be rejected at the application layer with HTTP 400.

#### Scenario: Valid slot assignment
- **WHEN** the client assigns a video to `{ slot_kind: 'featured', slot_index: 2 }` of a draft issue
- **THEN** the assignment SHALL succeed and one `issue_slots` row SHALL exist with those coordinates

#### Scenario: Invalid slot index for kind
- **WHEN** the client attempts to assign a video to `{ slot_kind: 'featured', slot_index: 5 }`
- **THEN** the endpoint SHALL respond with HTTP 400 and no `issue_slots` row SHALL be inserted

#### Scenario: Empty slots omit rows
- **WHEN** a draft issue has no video assigned to `{ slot_kind: 'brief', slot_index: 7 }`
- **THEN** no `issue_slots` row SHALL exist with those coordinates; the UI SHALL render an empty placeholder

### Requirement: Create draft issue endpoint
The system SHALL expose `POST /api/issues` that creates a new draft issue. The response SHALL return the created issue id. If a draft issue already exists, the endpoint SHALL respond with HTTP 409 and `{ error: 'draft_exists', draft_id: <id> }` without creating a second row.

#### Scenario: First draft
- **WHEN** the endpoint is called and no draft issue exists
- **THEN** a new row SHALL be inserted with `status = 'draft'`, `created_at = NOW()`, `title = NULL`, `published_at = NULL`
- **AND** the response SHALL be HTTP 201 with `{ id: <new_id> }`

#### Scenario: Existing draft blocks creation
- **WHEN** the endpoint is called and a draft issue with id 7 already exists
- **THEN** the response SHALL be HTTP 409 with `{ error: 'draft_exists', draft_id: 7 }`
- **AND** no new issue row SHALL be inserted

### Requirement: Slot mutation endpoint
The system SHALL expose `POST /api/issues/:id/slots` that accepts a JSON action of one of three shapes:

- `{ action: 'assign', video_id, target: { kind, index } }`
- `{ action: 'swap', from: { kind, index } | { pool: video_id }, to: { kind, index } }`
- `{ action: 'clear', target: { kind, index } }`

The endpoint SHALL accept actions only when the issue is a draft (`status = 'draft'`); any action against a published issue SHALL return HTTP 409 with `{ error: 'issue_frozen' }`. All state changes SHALL run inside a single database transaction and the response SHALL include the full updated `{ slots, pool }` for the issue.

#### Scenario: Assign to empty slot
- **WHEN** the client sends `{ action: 'assign', video_id: 'vid_a', target: { kind: 'cover', index: 0 } }` for a draft issue with an empty cover slot and `vid_a` not already on the issue
- **THEN** one `issue_slots` row SHALL be inserted with those coordinates and `assigned_at = NOW()`
- **AND** the response SHALL be HTTP 200 with `{ slots, pool }` reflecting the new state

#### Scenario: Assign promotes consumption status from inbox to saved
- **WHEN** the client assigns a video whose `consumption.status = 'inbox'` to any slot
- **THEN** the same transaction that inserts the `issue_slots` row SHALL also update that video's `consumption` row to `status = 'saved'` with `status_changed_at = NOW()`

#### Scenario: Assign does not change consumption for other statuses
- **WHEN** the client assigns a video whose `consumption.status = 'archived'` (or `'saved'`, or `'in_progress'`) to a slot
- **THEN** the `issue_slots` row SHALL be inserted and the `consumption.status` SHALL be left unchanged

#### Scenario: Assign to occupied slot is rejected
- **WHEN** the client sends `{ action: 'assign', ... }` targeting a slot that is already occupied
- **THEN** the endpoint SHALL respond with HTTP 409 and `{ error: 'slot_occupied' }`
- **AND** no DB writes SHALL occur (use `swap` to replace)

#### Scenario: Assign a video already on the issue is rejected
- **WHEN** the client sends `{ action: 'assign', video_id: 'vid_a', ... }` and `vid_a` is already assigned to some slot on this issue
- **THEN** the endpoint SHALL respond with HTTP 409 and `{ error: 'video_already_on_issue' }`
- **AND** no DB writes SHALL occur

#### Scenario: Swap between two occupied slots
- **WHEN** the client sends `{ action: 'swap', from: { kind: 'featured', index: 0 }, to: { kind: 'featured', index: 1 } }` and both slots are occupied
- **THEN** the two `issue_slots` rows SHALL have their `video_id` values exchanged inside a single transaction
- **AND** `assigned_at` SHALL be updated to `NOW()` on both rows

#### Scenario: Swap pool video into occupied slot
- **WHEN** the client sends `{ action: 'swap', from: { pool: 'vid_b' }, to: { kind: 'cover', index: 0 } }` where the cover is occupied by `vid_a`
- **THEN** the `issue_slots` row for cover SHALL be updated to reference `vid_b`, `vid_a` SHALL return to the pool (no `issue_slots` row references it on this issue), and `vid_b`'s `consumption.status` SHALL be promoted from `inbox` to `saved` if it was `inbox`

#### Scenario: Clear removes the slot row
- **WHEN** the client sends `{ action: 'clear', target: { kind: 'brief', index: 3 } }` and that slot is occupied
- **THEN** the `issue_slots` row SHALL be deleted; no `consumption.status` change SHALL occur

#### Scenario: Clear on empty slot is a no-op
- **WHEN** the client sends `{ action: 'clear', ... }` for a slot that has no row
- **THEN** the response SHALL be HTTP 200 with the current (unchanged) `{ slots, pool }`

#### Scenario: Mutation on published issue rejected
- **WHEN** the client sends any action to a published issue
- **THEN** the endpoint SHALL respond with HTTP 409 and `{ error: 'issue_frozen' }`; no DB writes SHALL occur

### Requirement: Publish endpoint
The system SHALL expose `POST /api/issues/:id/publish` that transitions a draft issue to published. The transition SHALL be atomic and one-way: `status` updates to `'published'`, `published_at` SHALL be set to the current UTC time, and no subsequent mutation of that issue's slots SHALL be permitted. A partial slot set (fewer than 14 slots filled) SHALL NOT block publish.

#### Scenario: Publish a full draft
- **WHEN** the endpoint is called for a draft issue with 14 slots filled
- **THEN** the issue row SHALL be updated with `status = 'published'` and `published_at = NOW()`
- **AND** the response SHALL be HTTP 200 with `{ id, status: 'published', published_at }`

#### Scenario: Publish a partial draft
- **WHEN** the endpoint is called for a draft issue with 3 slots filled
- **THEN** the issue SHALL be published unchanged (3 slots still filled, 11 slots still empty)
- **AND** the response SHALL be HTTP 200 reflecting the new status

#### Scenario: Publish an already-published issue
- **WHEN** the endpoint is called for an issue whose `status = 'published'`
- **THEN** the response SHALL be HTTP 409 with `{ error: 'already_published' }` and no writes SHALL occur

### Requirement: Discard draft endpoint
The system SHALL expose `DELETE /api/issues/:id` that deletes a draft issue. Deleting a published issue SHALL be rejected with HTTP 409 and `{ error: 'issue_frozen' }`. Deletion SHALL cascade to `issue_slots` via the `ON DELETE CASCADE` foreign key; no explicit slot cleanup code SHALL be required.

#### Scenario: Discard a draft
- **WHEN** the endpoint is called for a draft issue id 7
- **THEN** the `issues` row SHALL be deleted, all `issue_slots` rows referencing issue 7 SHALL be deleted via cascade, and the response SHALL be HTTP 204

#### Scenario: Cannot discard a published issue
- **WHEN** the endpoint is called for an issue whose `status = 'published'`
- **THEN** the response SHALL be HTTP 409 with `{ error: 'issue_frozen' }` and no writes SHALL occur

### Requirement: Inbox pool query
The system SHALL expose an inbox-pool query used by the editor workspace. The pool SHALL contain every video whose `consumption.status IN ('inbox', 'saved')` AND that is NOT currently assigned to a slot of the given draft issue. `consumption.status IN ('in_progress', 'archived', 'dismissed')` videos SHALL NOT appear in the pool. The query SHALL return each video's metadata joined with its channel name and the maximum `signal_weight` across its provenance rows (NULL if no provenance exists).

#### Scenario: Inbox and saved candidates present
- **WHEN** the pool is queried and the corpus has 5 inbox videos, 3 saved videos, 2 archived videos
- **THEN** the pool SHALL contain exactly 8 videos (5 + 3); the archived videos SHALL NOT appear

#### Scenario: Slotted videos excluded from pool
- **WHEN** a video with `consumption.status = 'saved'` is assigned to a slot on the current draft
- **THEN** that video SHALL NOT appear in the pool for that draft

#### Scenario: Published-issue assignments do not affect pool
- **WHEN** a video is assigned to a slot on a published issue
- **THEN** that video's presence in the pool for a DIFFERENT draft SHALL depend only on its own `consumption.status` and its assignment to THAT draft, not to the published issue

### Requirement: Editor workspace UI
The system SHALL expose an editor workspace as part of the home page at `/` for connected accounts with a non-empty corpus. The workspace SHALL display a slot board on one side showing the 14 slots of the current draft (empty slots rendered as placeholders) and an inbox pool on the other side showing the candidate videos per the pool query. When no draft issue exists, the workspace SHALL render a **New issue** button that `POST /api/issues`. When a draft exists, the workspace SHALL render the board + pool with drag-and-drop affordances, a title input for the draft, and **Publish** and **Discard** buttons.

#### Scenario: No draft, empty-state CTA
- **WHEN** the user visits `/` with a connected account, non-empty corpus, and no draft issue
- **THEN** the workspace SHALL render a "No draft yet" message and a **New issue** button; the board and pool SHALL NOT be rendered

#### Scenario: Draft exists, full workspace
- **WHEN** the user visits `/` with a connected account and a draft issue
- **THEN** the workspace SHALL render the 14-slot board (any empty slots as placeholders), the inbox pool on the side, a title input, and **Publish** / **Discard** buttons

#### Scenario: Drag pool to empty slot
- **WHEN** the user drags a pool video card onto an empty slot and releases
- **THEN** the client SHALL POST an `assign` action; on success, the card SHALL appear in the slot and be removed from the pool

#### Scenario: Drag slot to occupied slot (swap)
- **WHEN** the user drags a slot card onto another occupied slot and releases
- **THEN** the client SHALL POST a `swap` action and both slots' video assignments SHALL be exchanged

#### Scenario: Drag slot off the board (clear)
- **WHEN** the user drags a slot card into the pool area and releases
- **THEN** the client SHALL POST a `clear` action; on success, the slot SHALL be empty and the video SHALL reappear in the pool

### Requirement: Dismiss affordance in pool
The system SHALL provide a per-card **Dismiss** affordance on every video in the inbox pool that calls `POST /api/consumption` with `next = 'dismissed'`. Successful dismissal SHALL remove the card from the pool (the video's status moves to `dismissed`, which is excluded from the pool query).

#### Scenario: Dismiss from pool
- **WHEN** the user clicks Dismiss on a pool card
- **THEN** the client SHALL POST to `/api/consumption` with `{ videoId, next: 'dismissed' }`; on 204, the card SHALL be removed from the pool

### Requirement: Desktop-only workspace
The editor workspace SHALL detect mobile user agents and render a simplified "open on desktop" message in place of the board + pool. Drag-and-drop SHALL NOT be invoked on mobile.

#### Scenario: Mobile visits home
- **WHEN** a request to `/` arrives with a user-agent matching the existing `isMobileUserAgent` helper
- **THEN** the workspace SHALL render a text message instructing the user to open the app on desktop, and the drag-and-drop components SHALL NOT mount
