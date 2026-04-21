## REMOVED Requirements

### Requirement: Home becomes a navigation hub
**Reason**: The home page is being radically simplified in Phase 1 as a stepping stone toward the Phase 3 editorial-workspace redesign. The "nav hub with consumption-status count tiles" framing belongs to the feed-reader product we are retiring. In Phase 1, `/` is a minimal connection-state page (not connected → "connect", connected → "your library has N videos, import more or browse /inbox /library"). In Phase 3 it becomes a list of composed issues.
**Migration**: Existing tile UI in `src/app/page.tsx` is replaced by a small RSC that reads `oauth_tokens` and the counts it needs. No routing change. Users clicking the old "Inbox / Library / Archive" tiles now navigate via inline links in the new empty-state page.

### Requirement: Live Now indicator
**Reason**: The Live Now strip relied on RSS ingestion setting `videos.is_live_now`. With RSS removed and the YouTube Data API client not interrogating live state on import (we import snapshots of titles/durations, not live signals), the `is_live_now` column is never set to 1 in practice. Surfacing an always-empty strip is misleading.
**Migration**: The strip is removed from `/`. The `videos.is_live_now` column is preserved in schema (for a potential Phase 4 revival) but is expected to remain 0 for every row in Phase 1. Users who want live streams go directly to YouTube.
