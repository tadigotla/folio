## REMOVED Requirements

### Requirement: Sync subscriptions endpoint
**Reason**: The `POST /api/youtube/subscriptions/sync` endpoint never shipped and is being replaced by `POST /api/youtube/import/subscriptions`, which does more (imports actual uploaded videos, not just channel rows) and is spec'd under `youtube-library-import`.
**Migration**: Callers (none, since unshipped) would point to `/api/youtube/import/subscriptions`. Response shape changes from `{ imported, reenabled, disabled }` to `{ videos_new, videos_updated, channels_new }`.

### Requirement: Channel-to-source mapping
**Reason**: The `sources` table is deleted. There is no per-channel source row to upsert.
**Migration**: Subscribed channels become rows in `channels` (already exists). No parallel `sources` identity per channel. `enabled`/`disabled` semantics are replaced by "present in the last subscription import" — implicit, not a column.

### Requirement: Disable unsubscribed channels
**Reason**: There are no source rows to disable. If the user unsubscribes from a channel on YouTube, a subsequent subscription import simply won't bring in new uploads from it; existing `videos` and `channels` rows remain in the corpus untouched. This is the desired behavior.
**Migration**: No code. The absence of a channel from the latest subscription response is no longer tracked — it's inert.

### Requirement: Settings page shows connection state
**Reason**: The settings page requirement is restated and expanded under `youtube-library-import` ("Settings page for YouTube library"). The archived version tied connection state to subscription sync results; the new version ties it to `oauth_tokens` presence and the `import_log` table, reflecting the three distinct import surfaces.
**Migration**: `/settings/youtube` URL is preserved. The Connect / Disconnect / Reconnect flows are preserved. "Last sync" is replaced by per-kind "Last import" timestamps.
