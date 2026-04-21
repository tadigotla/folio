## MODIFIED Requirements

### Requirement: Idempotent upsert and user-state preservation
All import endpoints SHALL upsert videos using `INSERT ... ON CONFLICT(id) DO UPDATE` keyed by the raw YouTube video ID. Upserts SHALL update mutable metadata (title, description, duration_seconds, thumbnail_url, updated_at) while preserving `first_seen_at`, `discovered_at`, and the existing `consumption` row (status, status_changed_at, last_position_seconds). When an import inserts a NEW `videos` row, it SHALL also insert a `consumption` row with the provenance-appropriate default status.

Application-driven state changes (e.g., an editor assigning a video to an issue slot, which promotes `inbox → saved` per the `editorial-workspace` capability) SHALL be preserved across subsequent re-imports — the upsert does not interact with consumption state beyond the NEW-row insertion path.

#### Scenario: Consumption state survives re-import
- **WHEN** a video was imported via subscription_upload (default `inbox`), the user saved it (status = `saved`), and the subscription import runs again
- **THEN** the `consumption.status` SHALL remain `saved`; the `videos` row's metadata SHALL be refreshed from the latest API response; the provenance row's `imported_at` SHALL be updated

#### Scenario: Editor-driven saved state survives re-import
- **WHEN** a video was imported via subscription_upload (default `inbox`), the editor assigned it to a draft-issue slot (which promoted `inbox → saved` per `editorial-workspace`), and the subscription import runs again
- **THEN** the `consumption.status` SHALL remain `saved` and the slot assignment on the draft issue SHALL remain unchanged
