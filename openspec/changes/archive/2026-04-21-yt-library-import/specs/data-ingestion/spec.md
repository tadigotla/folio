## REMOVED Requirements

### Requirement: Fetcher interface compliance
**Reason**: The entire RSS-polling pipeline is being removed. The app no longer uses the `Fetcher` abstraction; the YouTube Data API client in `youtube-library-import` replaces it.
**Migration**: No user-facing migration. The `src/fetchers/` directory is deleted. Any module that referenced `Fetcher`, `NormalizedVideo`, or the registry is rewritten to call the import endpoints directly.

### Requirement: Idempotent video upsert
**Reason**: Idempotent upsert semantics are preserved but restated under the new `youtube-library-import` capability (see "Idempotent upsert and user-state preservation"). The orchestrator no longer performs upserts — import endpoints do.
**Migration**: Callers that previously relied on the orchestrator's upsert behavior are replaced by calls to the new import endpoints, which preserve the same idempotency guarantees (ON CONFLICT(id) DO UPDATE keyed by YouTube video ID; consumption state preserved across re-imports).

### Requirement: Orchestrator respects polling intervals
**Reason**: There is no orchestrator. All imports are manual, initiated by the user from the settings page. Polling intervals are moot.
**Migration**: None. `sources.min_interval_minutes` and `last_fetched_at` are dropped with the `sources` table itself.

### Requirement: Fetcher errors are isolated
**Reason**: There are no fetchers. Import endpoints are discrete user-initiated operations; failures surface directly to the UI rather than being rolled up across sources.
**Migration**: Per-import error reporting lives in `import_log.error` under `youtube-library-import`.

### Requirement: Orchestrator updates source metadata
**Reason**: There is no orchestrator and no `sources` table. Last-import bookkeeping lives in the new `import_log` table under `youtube-library-import`.
**Migration**: Code paths that read `sources.last_fetched_at` or `sources.last_error` are rewritten to read `import_log` (most recent row per kind).

### Requirement: Pre-loop subscription sync
**Reason**: There is no orchestrator loop. Subscription import is an explicit user action.
**Migration**: The pre-loop sync logic is deleted. The user's "import subscriptions" button performs what the archived spec called the pre-loop sync, on demand.
