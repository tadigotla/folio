## Umbrella — no direct tasks

This is a holding change. Concrete tasks live in the phase-specific sub-changes, each proposed when the prior phase is close to shipping.

- [ ] Phase 1 — `playlists` (not yet proposed)
- [ ] Phase 2 — `taste-ranking-loop` (not yet proposed)
- [ ] Phase 3 — `consumption-home` (not yet proposed)
- [ ] Phase 4 — `magazine-teardown` (not yet proposed; requires phase 3 burn-in)
- [ ] Phase 5 — `overnight-enrichment` (not yet proposed; supersedes the deleted `overnight-brief`)
- [ ] Phase 6 — `discovery` (not yet proposed; description-graph nightly feeder + direct-search agent tool, both feeding a user-gated Proposed rail on `/inbox`)

## Locked decisions (reflected in design.md)

- ✅ In-flight `overnight-brief` change **deleted** (2026-04-23). Phase 5 starts fresh.
- ✅ Taste-weight scale **0.0–2.0, default 1.0** (multiplicative modulator; 0.0 = muted, 2.0 = boosted).
- ✅ Conversation scope **per-day** in `America/New_York` (one `conversations` row per calendar date, created lazily on first agent turn of the day).

## Cleanup inventory

Phase 4's teardown checklist lives in [cleanup-inventory.md](cleanup-inventory.md). That file enumerates every file, table, column, route, component, doc paragraph, and spec that must be removed, reshaped, or rewritten when the magazine surface comes down. Any phase-4 sub-change must satisfy every unchecked item there before being marked complete.

## Phase ordering rationale

1. **Playlists first** — pure addition, no teardown, usable immediately alongside existing magazine surface. Lowest risk.
2. **Taste ranking loop** — also pure addition (behind a flag). Closes the most important open loop while the old home still works.
3. **Consumption home** — the user-visible flip. Requires phases 1 and 2. Old home remains accessible for burn-in.
4. **Magazine teardown** — the one-way door. Must come after phase 3 has been live long enough to trust. Cleanup inventory is the checklist.
5. **Overnight enrichment** — can technically land anytime after phase 2, but fits cleanly before discovery so phase 6's description-graph feeder can piggyback on the nightly pipeline without reshaping it.
6. **Discovery** — lands last because (a) it depends on phase 5's nightly job to run 6a, (b) it depends on phase 3's reshaped agent to host the `search_youtube` tool, and (c) it's the only phase introducing a new external service (YouTube Data API key), which is cleaner to isolate.

Each phase's proposal/design will specify its own task list.
