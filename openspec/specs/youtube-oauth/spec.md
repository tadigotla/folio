### Requirement: OAuth consent flow
The system SHALL expose `/api/youtube/oauth/authorize` that initiates a Google OAuth 2.0 authorization code flow with `scope = https://www.googleapis.com/auth/youtube.readonly`, `access_type = offline`, `prompt = consent` (to ensure a refresh token is returned on re-consent), and `redirect_uri = http://localhost:6060/api/youtube/oauth/callback`. A CSRF-protection `state` value SHALL be generated per request, stored in an HttpOnly, SameSite=Lax cookie expiring in 10 minutes, and included in the authorization URL.

#### Scenario: Authorize route redirects to Google
- **WHEN** the user navigates to `/api/youtube/oauth/authorize`
- **THEN** the system SHALL respond with an HTTP 302 redirect to `https://accounts.google.com/o/oauth2/v2/auth?…` including the client ID, scope, redirect URI, access_type, prompt, and a generated state parameter
- **AND** the response SHALL set a `youtube_oauth_state` cookie containing the same state value

#### Scenario: Missing client credentials
- **WHEN** `/api/youtube/oauth/authorize` is called and `YOUTUBE_OAUTH_CLIENT_ID` is not set in the environment
- **THEN** the system SHALL respond with HTTP 500 and an inline error page linking to the RUNBOOK section on OAuth setup

### Requirement: OAuth callback and token persistence
The system SHALL expose `/api/youtube/oauth/callback` that accepts `code` and `state` query parameters. It SHALL verify the state against the cookie, exchange the code for access + refresh tokens at `https://oauth2.googleapis.com/token`, and upsert a row in `oauth_tokens` with `provider = 'youtube'`, the returned `access_token`, `refresh_token`, computed `expires_at` (ISO 8601 UTC), granted `scope`, and `updated_at = NOW()`.

#### Scenario: Successful callback
- **WHEN** Google redirects back with a valid `code` and matching `state`
- **THEN** the system SHALL exchange the code, store the token row, clear the state cookie, trigger an initial subscription sync, and redirect the browser to `/settings/youtube?connected=1`

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
- **THEN** the client SHALL throw a typed `OAuthRefreshError` that callers can catch and surface to the settings page; the existing `oauth_tokens` row SHALL NOT be deleted automatically

### Requirement: Disconnect clears tokens
The system SHALL expose a POST endpoint that deletes the `oauth_tokens` row for `provider = 'youtube'` and optionally disables all user-imported sources.

#### Scenario: Disconnect without touching sources
- **WHEN** the user submits the Disconnect form with `disable_sources = false`
- **THEN** the `oauth_tokens` row SHALL be deleted and user-imported `sources` rows SHALL remain enabled (RSS continues)

#### Scenario: Disconnect and disable sources
- **WHEN** the user submits Disconnect with `disable_sources = true`
- **THEN** the `oauth_tokens` row SHALL be deleted AND all rows matching `sources.id LIKE 'youtube_channel_%_user'` SHALL be updated to `enabled = 0`
