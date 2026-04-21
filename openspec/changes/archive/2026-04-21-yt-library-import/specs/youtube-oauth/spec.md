## MODIFIED Requirements

### Requirement: OAuth callback and token persistence
The system SHALL expose `/api/youtube/oauth/callback` that accepts `code` and `state` query parameters. It SHALL verify the state against the cookie, exchange the code for access + refresh tokens at `https://oauth2.googleapis.com/token`, and upsert a row in `oauth_tokens` with `provider = 'youtube'`, the returned `access_token`, `refresh_token`, computed `expires_at` (ISO 8601 UTC), granted `scope`, and `updated_at = NOW()`. The callback SHALL NOT trigger any implicit data import — imports are explicit user actions on `/settings/youtube`.

#### Scenario: Successful callback
- **WHEN** Google redirects back with a valid `code` and matching `state`
- **THEN** the system SHALL exchange the code, store the token row, clear the state cookie, and redirect the browser to `/settings/youtube?connected=1`
- **AND** NO import or sync SHALL run as a side-effect of the callback

#### Scenario: State mismatch
- **WHEN** the `state` query parameter does not match the `youtube_oauth_state` cookie (or the cookie is missing)
- **THEN** the system SHALL respond with HTTP 400, NOT exchange the code, and NOT write to `oauth_tokens`

#### Scenario: User denies consent
- **WHEN** Google redirects back with `error=access_denied` instead of `code`
- **THEN** the system SHALL redirect to `/settings/youtube?error=access_denied` without writing any token

### Requirement: Transparent access-token refresh
The YouTube API client SHALL check `oauth_tokens.expires_at` before every outbound call. If the token expires within 60 seconds, it SHALL call `https://oauth2.googleapis.com/token` with `grant_type = refresh_token` and the stored refresh token, update the row with the new access token and expiry, and proceed with the original call using the refreshed token.

#### Scenario: Token near expiry
- **WHEN** an API call is made and `expires_at` is less than 60 seconds in the future
- **THEN** the client SHALL request a new access token using the stored refresh token and update `oauth_tokens` before issuing the original request

#### Scenario: Refresh token revoked
- **WHEN** the refresh call to Google returns `invalid_grant`
- **THEN** the client SHALL throw a typed `TokenRevokedError` that callers can catch and surface to the settings page; the existing `oauth_tokens` row SHALL NOT be deleted automatically

#### Scenario: 401 on API call triggers a single retry with refresh
- **WHEN** an API call returns HTTP 401 despite a seemingly-fresh access token
- **THEN** the client SHALL force a refresh and retry the call exactly once; if the retry also returns 401, the client SHALL throw `TokenRevokedError`

### Requirement: Disconnect clears tokens
The system SHALL expose `POST /api/youtube/oauth/disconnect` that deletes the `oauth_tokens` row for `provider = 'youtube'`. The imported corpus (videos, channels, consumption, provenance, import log) SHALL NOT be touched — disconnect is a credential operation, not a data operation. There is no `disable_sources` option because sources no longer exist.

#### Scenario: Disconnect deletes the token only
- **WHEN** the user clicks Disconnect on `/settings/youtube`
- **THEN** the `oauth_tokens` row for `provider = 'youtube'` SHALL be deleted
- **AND** no rows in `videos`, `channels`, `consumption`, `video_provenance`, or `import_log` SHALL be modified

#### Scenario: Disconnect when not connected
- **WHEN** the disconnect endpoint is called and no `oauth_tokens` row exists
- **THEN** the endpoint SHALL respond with HTTP 204 and perform no writes
