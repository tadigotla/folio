## REMOVED Requirements

### Requirement: Multi-day fixture fetching
**Reason**: TheSportsDB fetcher is being dropped as part of the pivot to a YouTube-primary content library. Sports content outside YouTube is out of scope.
**Migration**: Delete `src/fetchers/sportsdb.ts`, remove the `thesportsdb` row from `sources` via migration, and remove the registry entry.

### Requirement: Fixture normalization
**Reason**: TheSportsDB fetcher removed.
**Migration**: No replacement.

### Requirement: External link stream kind
**Reason**: TheSportsDB fetcher removed; `external_link` stream kind is also removed in this change.
**Migration**: No replacement.

### Requirement: Thumbnail from event art
**Reason**: TheSportsDB fetcher removed.
**Migration**: No replacement.

### Requirement: Graceful handling of empty days
**Reason**: TheSportsDB fetcher removed.
**Migration**: No replacement.
