## MODIFIED Requirements

### Requirement: OAuth tokens stub table
The system SHALL provision an `oauth_tokens` table with columns: `provider` (primary key), `access_token`, `refresh_token`, `expires_at`, `scope`, `updated_at`. The table SHALL be populated by the `youtube-oauth` capability; it is no longer a stub. Exactly zero or one row per provider value SHALL exist at any time. A row for `provider = 'youtube'` indicates the user has connected their YouTube account; absence indicates disconnected state.

#### Scenario: Table exists post-migration
- **WHEN** migrations are applied
- **THEN** the `oauth_tokens` table SHALL exist with the column schema above

#### Scenario: Connected-state invariant
- **WHEN** the app is running and any module needs to check YouTube connection state
- **THEN** the presence of a row with `provider = 'youtube'` in `oauth_tokens` SHALL be the single source of truth for "connected"

#### Scenario: Disconnected-state invariant
- **WHEN** the user disconnects via `/api/youtube/oauth/disconnect`
- **THEN** the row for `provider = 'youtube'` SHALL be deleted, and no other state (videos, channels, consumption, provenance) SHALL be modified as a side-effect
