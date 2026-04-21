## REMOVED Requirements

### Requirement: C-SPAN RSS feed parsing
**Reason**: The C-SPAN fetcher is being dropped as part of the pivot to a YouTube-primary content library.
**Migration**: Delete `src/fetchers/cspan-rss.ts`, remove the `cspan_rss` row from the `sources` table via migration, and remove the registry entry in `src/fetchers/registry.ts`.

### Requirement: Event timing extraction
**Reason**: C-SPAN fetcher removed.
**Migration**: No replacement.

### Requirement: Stream kind
**Reason**: C-SPAN fetcher removed; `external_link` stream kind is also removed in this change.
**Migration**: No replacement.
