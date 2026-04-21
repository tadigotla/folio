## REMOVED Requirements

### Requirement: iCal feed parsing
**Reason**: The NASA iCal fetcher is being dropped as part of the pivot to a YouTube-primary content library. NASA broadcast streams that live on YouTube will surface via the YouTube channel fetcher for NASA's channels.
**Migration**: Delete `src/fetchers/nasa-ical.ts`, remove the `nasa_ical` row from `sources` via migration, remove the `node-ical` dependency if no other code uses it, and remove the registry entry.

### Requirement: Event field mapping
**Reason**: NASA iCal fetcher removed.
**Migration**: No replacement.

### Requirement: YouTube link extraction from description
**Reason**: NASA iCal fetcher removed. YouTube discovery now happens directly via channel RSS.
**Migration**: No replacement.

### Requirement: Date range limit
**Reason**: NASA iCal fetcher removed.
**Migration**: No replacement.

### Requirement: Stable source event ID
**Reason**: NASA iCal fetcher removed.
**Migration**: No replacement.
