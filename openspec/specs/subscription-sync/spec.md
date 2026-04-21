### Requirement: Sync subscriptions endpoint
The system SHALL expose `POST /api/youtube/subscriptions/sync` that reads the current YouTube access token, calls `GET https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50` paginating via `pageToken` until complete, and upserts one `sources` row per subscribed channel.

#### Scenario: Sync with no existing tokens
- **WHEN** the sync endpoint is called with no row present in `oauth_tokens` for `provider = 'youtube'`
- **THEN** the endpoint SHALL respond with HTTP 409 and a body indicating the user must connect first; no `sources` rows SHALL be modified

#### Scenario: Sync with a connected account
- **WHEN** the sync endpoint is called and a valid token exists
- **THEN** the endpoint SHALL fetch every page of subscriptions, aggregate the results, upsert each channel as described in "Channel-to-source mapping", and respond with HTTP 200 and a JSON body `{ imported: N, reenabled: N, disabled: N }`

#### Scenario: Sync during token refresh failure
- **WHEN** the endpoint attempts to refresh an expired access token and Google returns `invalid_grant`
- **THEN** the endpoint SHALL respond with HTTP 401 and NOT modify any `sources` rows; the `oauth_tokens` row SHALL NOT be deleted

### Requirement: Channel-to-source mapping
For each subscribed channel returned by the YouTube API, the system SHALL upsert a row in `sources` with `id = 'youtube_channel_' || <UCxxx> || '_user'`, `kind = 'youtube_channel'`, `name = <channel title>`, `config = JSON { channels: [{ id: <UCxxx>, name: <channel title> }], rss_base: 'https://www.youtube.com/feeds/videos.xml?channel_id=' }`, `enabled = 1`, `min_interval_minutes = 30`. Existing rows matching that ID SHALL be UPDATEd (name + config) and have `enabled` set to 1.

#### Scenario: New subscription imported
- **WHEN** a channel UC123 is in the subscription response and no `sources` row exists with id `youtube_channel_UC123_user`
- **THEN** a new `sources` row SHALL be inserted with the mapping above and `enabled = 1`

#### Scenario: Previously-disabled source re-enabled
- **WHEN** a channel UC123 is subscribed to and a row with id `youtube_channel_UC123_user` exists with `enabled = 0`
- **THEN** the sync SHALL set `enabled = 1` on that row and update its `name` / `config` from the latest API response

### Requirement: Disable unsubscribed channels
For each user-imported source (id matching `youtube_channel_%_user`) whose corresponding channel ID is NOT in the latest subscription response, the sync SHALL set `enabled = 0` on that `sources` row. The row SHALL NOT be deleted; `videos` and `consumption` rows referencing channels that passed through those sources SHALL remain intact.

#### Scenario: User unsubscribes from a channel
- **WHEN** channel UC456 was present in the previous sync but is absent from the current response, and a row with id `youtube_channel_UC456_user` exists
- **THEN** the sync SHALL update that row to `enabled = 0`
- **AND** any `videos` rows whose `channel_id = UC456` SHALL remain in the database
- **AND** any `consumption` rows referencing those videos SHALL remain in the database

#### Scenario: Non-user sources are not affected
- **WHEN** a source id does NOT match `youtube_channel_%_user` (e.g., the categorical `youtube_space` seed source)
- **THEN** the sync SHALL NOT modify its `enabled` state or any other field

### Requirement: Settings page shows connection state
The system SHALL expose `/settings/youtube` as a server-rendered page showing the current connection status, the timestamp of the most recent successful sync, the count of enabled user-imported sources, the count of disabled user-imported sources, and any error from the most recent sync attempt.

#### Scenario: Not connected
- **WHEN** no row exists in `oauth_tokens` for `provider = 'youtube'`
- **THEN** the page SHALL render a "Connect YouTube account" button that submits to `/api/youtube/oauth/authorize`

#### Scenario: Connected and synced
- **WHEN** a token row exists and at least one successful sync has completed
- **THEN** the page SHALL render the last-sync timestamp (localized via `src/lib/time.ts`), the imported-channel count, and buttons for "Re-sync now" and "Disconnect"

#### Scenario: Reconnect required after refresh failure
- **WHEN** the most recent sync attempt failed with `OAuthRefreshError`
- **THEN** the page SHALL render a prominent "Reconnect required" banner linking to `/api/youtube/oauth/authorize`, while still showing the existing imported-channel count (ingestion continues independently)
