## 1. Read layer

- [x] 1.1 Add `src/lib/taste-read.ts` exporting `getClusterSummaries()`, `getClusterDetail(id)`, `getClusterMembers(id, { limit, offset })`, `getClusterDrift()`, and type declarations. Read-only; reuses `getDb()` and the vector helpers in `src/lib/taste.ts` / `src/lib/embeddings.ts`.
- [x] 1.2 Hide empty-but-active clusters from `getClusterSummaries()` results (they move to a separate array returned by the same call so the page can render the disclosure).
- [x] 1.3 Implement drift count per the spec (likes only; similarity floor 0.6; hidden below 30 likes).
- [x] 1.4 Add a unit-style smoke test in a disposable scratch script (`scripts/taste/smoke-read.ts`, not committed) to eyeball shapes against the real DB; delete before opening the PR.

## 2. `/taste` page (view-only)

- [x] 2.1 Scaffold `src/app/taste/page.tsx` as a React Server Component that calls `getClusterSummaries()` and `getClusterDrift()`.
- [x] 2.2 Add `src/components/taste/ClusterCard.tsx` — server component rendering one cluster row: id, label (or "(unlabeled)"), weight, member count, fuzzy count, preview strip of up to 8 thumbnails ordered by similarity desc.
- [x] 2.3 Add the "Retired" section (collapsed list of retired clusters, most-recent first).
- [x] 2.4 Add the "Empty clusters" disclosure (collapsed by default).
- [x] 2.5 Add the drift-indicator badge in the `/taste` masthead; hide when `totalLikes < 30`.
- [x] 2.6 Add a nav entry to the site masthead linking to `/taste`.
- [x] 2.7 Manual pass: visit `/taste`, confirm cluster counts match `SELECT COUNT(*) FROM video_cluster_assignments GROUP BY cluster_id`.

## 3. Edit layer

- [x] 3.1 Add `src/lib/taste-edit.ts` with `setClusterLabel`, `setClusterWeight`, `reassignVideo`, `mergeClusters`, `splitCluster`, `retireCluster` — all wrapped in `db.transaction(...)`.
- [x] 3.2 Validate inputs: weight in `[0.0, 3.0]`; merge target != source; split `k >= 2` and `k <= member count`; reassign target not retired. Throw a typed `IllegalEditError` on violations.
- [x] 3.3 Implement centroid recomputation helper (L2-normalized mean of member embeddings). Share with phase-1 code if practical rather than duplicate.
- [x] 3.4 Implement optimistic locking: each edit takes an `expectedUpdatedAt` string; throw `ConcurrentEditError` if the row's `updated_at` has moved.

## 4. Mutation API routes

- [x] 4.1 `POST /api/taste/clusters/[id]` — accepts `{ label?, weight?, expectedUpdatedAt }`; 204 on success, 422 on `IllegalEditError`, 409 on `ConcurrentEditError`.
- [x] 4.2 `POST /api/taste/clusters/[id]/merge` — body `{ into, expectedUpdatedAt }`.
- [x] 4.3 `POST /api/taste/clusters/[id]/split` — body `{ k, expectedUpdatedAt }`.
- [x] 4.4 `POST /api/taste/clusters/[id]/retire` — body `{ expectedUpdatedAt }`.
- [x] 4.5 `POST /api/taste/assignments/[videoId]` — body `{ clusterId }`; 422 if destination retired.
- [x] 4.6 Error-mapping pass: every route maps `IllegalEditError → 422`, `ConcurrentEditError → 409`, unknown → 500. Include the error `message` in the body.

## 5. Label + weight edits (client)

- [x] 5.1 `src/components/taste/ClusterLabelInput.tsx` — inline-edit text input; on blur (or Enter) POSTs the new label; optimistic-lock error surfaces as "cluster was rebuilt; reload".
- [x] 5.2 `src/components/taste/WeightSlider.tsx` — shadcn slider wired to the weight endpoint; debounce to one POST per 400ms of inactivity.
- [x] 5.3 Add a small inline note to `/taste` header: "Weights take effect when the editor agent lands in phase 3." Link to the runbook section.
- [x] 5.4 Manual pass: rename a cluster, set weight to 2.0, refresh, values persist; then run `just taste-cluster` and confirm label + weight survive.

## 6. `/taste/[clusterId]` detail page

- [x] 6.1 Scaffold `src/app/taste/[clusterId]/page.tsx` as an RSC calling `getClusterDetail()` and `getClusterMembers()`.
- [x] 6.2 Render the member list with per-video similarity, newest-published first within equal similarities.
- [x] 6.3 Add per-video `ReassignPopover` client island: dropdown of active clusters; on select, POSTs `/api/taste/assignments/[videoId]`.
- [x] 6.4 Add cluster-level action buttons: Merge, Split, Retire.

## 7. Merge / Split / Retire dialogs

- [x] 7.1 `src/components/taste/MergeDialog.tsx` — shows "Merge '<B>' (N members) into '<A>' (M members)?"; confirm → POST; disables confirm if target == source.
- [x] 7.2 `src/components/taste/SplitDialog.tsx` — shows k input (default 2, range 2..min(5, memberCount)) and, for each candidate k, a one-line silhouette/size preview. Preview is computed server-side on open (separate read endpoint `GET /api/taste/clusters/[id]/split-preview?k=N`) or batch-fetched for k ∈ [2,5].
- [x] 7.3 `src/components/taste/RetireConfirm.tsx` — inline confirm button (no modal); on click, POST retire.
- [x] 7.4 Post-mutation refresh: use `router.refresh()` to re-fetch the RSC, not a client state mirror. No optimistic updates.

## 8. Runbook + docs

- [x] 8.1 Add a "Taste lab" section to `RUNBOOK.md` covering: what `/taste` is for, how labels/weights survive rebuilds, the prospective weight semantics, how to retire a cluster you don't want, how to rebuild the map.
- [x] 8.2 Update the `Last verified` date in `RUNBOOK.md`.
- [x] 8.3 Add a "Taste lab" paragraph under Architecture in `CLAUDE.md` pointing at `src/lib/taste-edit.ts` as the only legal mutation path.
- [x] 8.4 No `justfile` change needed (reuse `taste-cluster`); confirm this in the runbook.

## 9. Verification

- [x] 9.1 Dev-server smoke: `npm run dev`, visit `/taste`, edit one label, set one weight, reassign one video, merge two small clusters, split a cluster into 2, retire an empty-ish cluster. Confirm the page reflects each change after refresh.
- [x] 9.2 Rebuild smoke: run `just taste-cluster`; confirm all edits survive.
- [x] 9.3 Optimistic-lock smoke: open `/taste` in two windows; edit the same cluster in both; confirm the second edit 409s.
- [x] 9.4 `npm run lint` clean; `npm run build` succeeds.
- [x] 9.5 Open PR; once merged, flip Phase 2 checkbox to `[x]` in the umbrella `openspec/changes/conversational-editor/tasks.md` and archive `taste-lab` with `/opsx:archive`.
