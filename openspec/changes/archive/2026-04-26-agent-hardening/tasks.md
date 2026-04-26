## 1. Reconnaissance (do not skip — code may have shifted since this change was proposed)

- [x] 1.1 Read the current `src/lib/agent/` tree top-to-bottom; note where the loop driver, tool executor, tool definitions, and turn-persistence helpers live today (file names may have moved).
- [x] 1.2 Read `src/app/api/agent/message/route.ts` and `src/app/api/agent/conversation/[date]/route.ts` and confirm both still exist with the documented contracts; if either has been replaced, reconcile with `openspec/specs/curation-agent/spec.md` before continuing.
- [x] 1.3 Read `src/lib/consumption.ts` and `src/lib/taste-edit.ts`; list every exported function and every typed error class. The test seam targets exactly these surfaces.
- [x] 1.4 Confirm `zod` is not yet in `package.json` (or note its current version); confirm `vitest` and `@vitest/coverage-v8` are absent.
- [x] 1.5 Re-read this change's `proposal.md`, `design.md`, and `specs/curation-agent/spec.md` end-to-end. If intervening functional work invalidates any decision, stop and propose an amendment rather than improvising.

## 2. Dependencies and dev plumbing

- [x] 2.1 Add `zod` to `dependencies` in `package.json`.
- [x] 2.2 Add `vitest` and `@vitest/coverage-v8` to `devDependencies` in `package.json`.
- [x] 2.3 Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `package.json`.
- [x] 2.4 Run `npm install` and confirm a clean lockfile diff.

## 3. Tool-error envelope

- [x] 3.1 Define `ToolErrorCode` as a closed string-literal union (`'validation' | 'not_found' | 'conflict' | 'precondition_failed' | 'permission_denied' | 'upstream_unavailable' | 'internal'`) and the `ToolResult` discriminated-union type, in the agent module's shared types file.
- [x] 3.2 Add a small mapper that takes a thrown error and returns a `ToolResult` of shape `{ ok: false, error: { code, message, details? } }`. Map: `IllegalTransitionError` → `conflict`, `PlaylistNotFoundError`/`VideoNotFoundError`/`ClusterNotFoundError` → `not_found`, `DuplicateVideoInPlaylistError` → `conflict`, `InvalidPositionError` → `validation`, `IllegalEditError` → `conflict`, `ConcurrentEditError` → `conflict`. Add a default `internal` branch that logs the full stack server-side and returns a generic message.
- [x] 3.3 Wrap the tool executor so every successful return is wrapped as `{ ok: true, result }` and every thrown error flows through the mapper.
- [x] 3.4 Replace the `rank_by_theme` no-embedded-corpus return path so it surfaces as `{ ok: false, error: { code: 'precondition_failed', message: 'no_embedded_corpus' } }` instead of the legacy `{ error: 'no_embedded_corpus' }`.
- [x] 3.5 Update the loop driver so the `tool_result` content block sent back to the model in the next iteration carries the new envelope verbatim.

## 4. Zod at the boundaries

- [x] 4.1 Add a Zod schema for the `POST /api/agent/message` request body alongside the route handler. Reject extra unknown fields. Configure a sensible `content` max length (e.g., 10_000 chars) and surface `{ error: { code: 'validation', message, details } }` with HTTP 400 on parse failure.
- [x] 4.2 Add a Zod schema for the `[date]` path param of `GET /api/agent/conversation/[date]` (strict `YYYY-MM-DD`). Replace the existing ad-hoc validation; surface HTTP 400 with the same error envelope shape.
- [x] 4.3 For each tool that exists at implementation time, define a Zod schema for its input. Co-locate with the tool definition.
- [x] 4.4 Modify the executor so the first thing it does upon receiving a `tool_use` block is `tool.input.safeParse(rawInput)`. On failure, return `{ ok: false, error: { code: 'validation', message: <Zod issue summary>, details: <Zod issue list> } }` without invoking the implementation.
- [x] 4.5 Audit the missing-API-key path: confirm it now returns `{ error: { code: 'precondition_failed', message: 'api_key_missing' } }` (envelope-shaped) with HTTP 412.

## 5. Token-budget cap

- [x] 5.1 Read `AGENT_MAX_INPUT_TOKENS` and `AGENT_MAX_OUTPUT_TOKENS` from process env at loop start (defaults `200000` and `20000`; treat unset or `0` as disabled).
- [x] 5.2 In the loop driver, after each iteration's assistant turn is persisted, sum `input_tokens` and `output_tokens` for the turns produced **in this session only** (not the full conversation history). Use the conversation-turn IDs / timestamps you produced this session as the filter.
- [x] 5.3 If either cap is exceeded, before beginning the next iteration: emit an SSE `error` event identifying the cap and the measured value, persist a final assistant turn flagging the cap, close the stream. Do not interrupt the in-flight turn.
- [x] 5.4 Confirm the cap path coexists cleanly with the existing `AGENT_MAX_TURNS` cap path (same shutdown shape).
- [x] 5.5 Update `.env.example` with `AGENT_MAX_INPUT_TOKENS` and `AGENT_MAX_OUTPUT_TOKENS` (commented, showing defaults).

## 6. SSE wire-format change and client renderer

- [x] 6.1 Update the SSE adapter so the `tool_result` event payload carries `{ toolName, ok, result?, error? }` matching the typed envelope.
- [x] 6.2 Update `src/components/agent/ChatPanel.tsx` (or the current ChatPanel location) to render the new envelope: success path renders `result`; failure path renders the error code and message visibly so the user can see why a tool failed.
- [x] 6.3 Quick manual smoke in `/chat`: run a query that succeeds, run one that triggers a `validation` error (e.g., a malformed tool input by handcrafting a test message), confirm both render correctly.

## 7. Test seam — vitest + in-memory SQLite

- [x] 7.1 Add a minimal `vitest.config.ts` (test environment `node`, no globals).
- [x] 7.2 In `src/lib/db.ts`, add a test-only `setDbForTest(db)` export that swaps the singleton, plus a `clearDbForTest()` companion. Confirm production code paths are unchanged.
- [x] 7.3 Create `src/lib/__tests__/setup.ts` (or equivalent) that builds a fresh `:memory:` SQLite via `better-sqlite3`, runs `runMigrations()` against it, calls `setDbForTest`, and exposes a per-test `beforeEach`/`afterEach` lifecycle.
- [x] 7.4 Write `src/lib/__tests__/consumption.test.ts` covering: every legal `setConsumptionStatus` transition, every illegal transition raising `IllegalTransitionError` with no row mutation, `recordProgress({ action: 'start' })` auto-promotion paths from `inbox`, `saved`, and `archived`, `recordProgress({ action: 'tick' | 'pause' })` writing `last_position_seconds`, and `recordProgress({ action: 'end' })` auto-archiving and clearing `last_position_seconds`.
- [x] 7.5 Write `src/lib/__tests__/taste-edit.test.ts` covering: each exported transition (label, weight, reassign, merge, split, retire) for happy path, the `IllegalEditError` path for at least one invalid edit per category, the `ConcurrentEditError` path with stale `expectedUpdatedAt`.
- [x] 7.6 Run `npm run test` and confirm a green suite. Iterate on any flakiness — tests SHALL be deterministic, never order-dependent.

## 8. Operational invariants (CLAUDE.md launch/deploy rule)

- [x] 8.1 Add `test` to the verbs in `justfile` if not already present, wired to `npm run test`.
- [x] 8.2 Update `RUNBOOK.md`: add a "Tests" subsection naming the two covered modules, the `just test` verb, and the explicit non-coverage of everything else. Document `AGENT_MAX_INPUT_TOKENS` and `AGENT_MAX_OUTPUT_TOKENS` env vars in the curation-agent section. Bump the `Last verified` date.
- [x] 8.3 Confirm `.env.example`, `justfile`, and `RUNBOOK.md` are all touched in a single commit per the launch/deploy invariant.

## 9. Spec sync

- [x] 9.1 Run `openspec validate agent-hardening --strict` (or the local equivalent) and resolve any structural issues.
- [x] 9.2 Once green and merged, run `/opsx:archive` to fold the delta into `openspec/specs/curation-agent/spec.md`.

## 10. Verification before declaring done

- [x] 10.1 `npm run build` passes.
- [x] 10.2 `npm run lint` passes.
- [x] 10.3 `npm run test` passes.
- [x] 10.4 Manually exercise `/chat`: send one ordinary message, send one that triggers a tool with invalid input (handcrafted via dev tools or a temporary test tool), confirm the typed envelope renders for both success and failure cases.
- [x] 10.5 Manually exercise the cap by setting `AGENT_MAX_TURNS=1` temporarily and confirming the error envelope is produced cleanly. Restore the env after.
