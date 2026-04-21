## ADDED Requirements

### Requirement: Pre-loop subscription sync
When a YouTube OAuth token is present, the cron entrypoint SHALL call subscription sync once per run before entering the fetch loop. The sync SHALL be best-effort — failures SHALL be logged but SHALL NOT abort the subsequent fetch loop.

#### Scenario: Token present, sync succeeds
- **WHEN** `scripts/run-fetchers.ts` runs and `oauth_tokens` contains a row for `provider = 'youtube'`
- **THEN** subscription sync SHALL run to completion before the ingestion orchestrator begins iterating sources
- **AND** any new `sources` rows created by the sync SHALL be visible to the orchestrator in that same run

#### Scenario: Token present, sync fails
- **WHEN** the pre-loop sync throws (network failure, invalid_grant, etc.)
- **THEN** the error SHALL be logged to stderr
- **AND** the orchestrator SHALL still run and poll all enabled sources
- **AND** the error SHALL be surfaced on `/settings/youtube` via the most-recent-sync status

#### Scenario: No token present
- **WHEN** `oauth_tokens` has no row for `provider = 'youtube'`
- **THEN** the pre-loop sync SHALL be skipped entirely (no API call, no log entry beyond a debug line) and the orchestrator SHALL run normally
