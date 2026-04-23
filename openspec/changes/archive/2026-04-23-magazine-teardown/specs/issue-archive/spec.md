## REMOVED Requirements

### Requirement: Published-issue list

**Reason**: `/issues` is deleted along with the magazine lifecycle. Published issues no longer exist as a concept; there is nothing to list. The historical rows are exported to `backups/issues-pre-teardown.json` for cold archival before the `issues` table is dropped.

**Migration**: Users who want to revisit a previously-published issue's video set can reconstruct it from the JSON export if ever needed; no runtime UI exposes them. The cold archive is intended for one-shot data recovery, not browsing.

### Requirement: Published-issue detail view

**Reason**: `/issues/[id]` is deleted. With `issues` and `issue_slots` dropped, there is no data to render.

**Migration**: None. Navigation to `/issues/<id>` returns HTTP 404 after this change. External bookmarks to specific issue URLs break; this is acceptable since the only reader was the single operator.

### Requirement: Published issues are frozen

**Reason**: No published issues exist, so no frozen-state invariant is needed. All magazine mutation endpoints (`POST /api/issues/[id]/slots`, `POST /api/issues/[id]/publish`, `DELETE /api/issues/[id]`) are deleted and return 404 regardless of hypothetical status.

**Migration**: None.
