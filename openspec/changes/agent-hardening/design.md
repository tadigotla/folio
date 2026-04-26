## Context

The curation agent ships in a working but loose-jointed state. The
agentic loop in the agent module persists turns and streams events
correctly, but its **boundaries** are informal:

- The `POST /api/agent/message` route validates the request body with a
  hand-written `typeof content === 'string'` check.
- Tool inputs are described to the model via JSON Schema in `tools.ts`,
  but the executor trusts whatever the model returns and feeds it
  straight into the implementation. A model-side schema is necessary,
  not sufficient — Claude can and occasionally does emit shapes that
  don't match.
- Tool failures are caught and reshaped into `{ error: string }`. The
  string is a free-form message; the model has to parse intent. There's
  no programmatic distinction between "the user gave me bad inputs",
  "this video doesn't exist", and "the database connection died".
- The only ceiling on autonomous loop work is `AGENT_MAX_TURNS`. A
  turn-bounded session can still spend an unbounded number of input
  tokens if the model keeps growing context.
- The repo has no test runner. The consumption state machine and the
  taste-edit transitions are pure, well-typed, and exactly the kind of
  module that benefits from deterministic tests — but adding vitest now
  would be a side project. This change rolls it in alongside the
  hardening work, scoped tightly to those two modules.

The patterns are inspired by qaloop's typed-boundary discipline. Folio
is not adopting qaloop's runtime, scenario format, or interpolation.

This change is intentionally **deferred**. It will be implemented later,
likely after intervening functional work has touched `src/lib/agent/*`.
The design therefore avoids hard-coding line numbers and refers to
modules by responsibility (e.g., "the agent loop driver", "the tool
executor", "the SSE adapter") so it survives reorganization.

## Goals / Non-Goals

**Goals:**

- Make every external boundary of the agent surface (HTTP body, tool
  inputs, path params) reject malformed input with a typed, actionable
  error before any model or tool work happens.
- Replace opaque `{ error: string }` tool results with a typed envelope
  the model can branch on and the SSE consumer can render.
- Add a token-budget cap so a runaway loop is bounded by cost as well
  as turn count.
- Establish a deterministic test seam for the two pure-state-machine
  modules (`consumption`, `taste-edit`) without committing to a broader
  testing initiative.
- Keep the change implementable in a single PR even after intervening
  refactors of the agent module.

**Non-Goals:**

- Variable interpolation / `{{capture}}` chains across tool calls.
- Splitting the agent into multiple `.claude/skills/`.
- Granular `mutationScope` per tool for client-side cache invalidation.
- Broader test coverage beyond the two named modules. No tests for the
  agent loop, tool executor, ingestion pipeline, taste clustering, or
  RSC pages in this change.
- Cost dollar-tracking. Token counts are the proxy; pricing tables are
  out of scope.
- Streaming protocol redesign. The SSE event taxonomy
  (`delta | tool_call | tool_result | error | done`) stays. Only the
  `tool_result` payload shape changes.

## Decisions

### D1. Tool-error envelope shape

Tool results carry one of two shapes back to the model and to the
SSE `tool_result` consumer:

```ts
type ToolResultOk   = { ok: true;  result: unknown };
type ToolResultErr  = { ok: false; error: { code: ToolErrorCode; message: string; details?: unknown } };
```

`ToolErrorCode` is a closed union:

- `validation` — the model's tool input failed Zod validation.
- `not_found` — a referenced entity (video, playlist, cluster) does not exist.
- `conflict` — the operation collides with current state (duplicate playlist member, illegal consumption transition).
- `precondition_failed` — a runtime precondition is unmet (e.g., `rank_by_theme` without an embedded corpus).
- `permission_denied` — reserved; no tool currently produces this, but the code is reserved so the union is stable when OAuth-scoped tools land.
- `upstream_unavailable` — an external dependency (Anthropic, OpenAI embeddings, YouTube) is unreachable or returned an error.
- `internal` — uncaught exception; the executor logs the stack server-side and returns a generic message to the model.

**Rationale.** The set is borrowed from qaloop's `blocked` vs `error`
distinction, generalized to the categories actually present in folio's
tool surface. The closed union is small enough to memorize and large
enough to distinguish recovery strategies (the model can retry on
`upstream_unavailable`, must reformulate on `validation`, must abandon
on `not_found` or `conflict`).

**Alternatives considered.**

- *Status-code style ints* (e.g., 422, 404, 503): familiar but imports
  HTTP semantics into a place that isn't HTTP. Rejected.
- *Error class hierarchy thrown across the executor boundary*: the
  executor is already catching; throwing typed classes and re-shaping
  is more ceremony for the same outcome.
- *Free-form string codes*: what we have today. Hard to keep stable.

### D2. Zod at the boundaries, not in the middle

Zod schemas live in two places only:

1. Per-tool: `src/lib/agent/tools.ts` (or wherever tools are defined at
   implementation time) gains a Zod schema *alongside* each tool's
   existing JSON Schema. The executor parses tool input through Zod
   before invoking the implementation. JSON Schema stays — it's what
   the model sees.
2. Per-route: each `app/api/agent/**` route validates its request body
   and path params through a Zod schema co-located in the route file.

Zod is not added to internal helper functions, not added to RSC pages,
not added to the consumption or taste-edit modules (those have typed
function signatures and are not boundaries).

**Rationale.** Validation belongs at trust boundaries. Internal calls
between trusted typed code do not need runtime validation. This
matches qaloop's pattern: `src/config/schema.ts` and
`src/scenario/schema.ts` validate at load; downstream code consumes
typed values.

**Alternatives considered.**

- *Generate Zod from JSON Schema*: tempting, but the existing JSON
  Schemas are hand-written and small. Duplicating by hand is faster and
  keeps the model-facing schema editable independently.
- *Use only the model's JSON Schema*: doesn't catch model emissions
  that drift from schema (which Claude does occasionally for unions
  and optional fields).

### D3. Token budget computation

`AGENT_MAX_INPUT_TOKENS` and `AGENT_MAX_OUTPUT_TOKENS` are session-level
caps for one `POST /api/agent/message` invocation:

- After every loop iteration, sum the `input_tokens` and `output_tokens`
  recorded on the turns produced by *this session* (not the full
  conversation history).
- If either exceeds its cap, stop before the next iteration the same
  way the turn cap stops the loop: emit an `error` event, persist a
  final assistant turn flagging the cap, close the stream.
- The cap is checked **between iterations**, never mid-stream. A single
  turn that overshoots the cap is allowed to complete; the loop stops
  before the next one begins.

Defaults: `AGENT_MAX_INPUT_TOKENS = 200_000`, `AGENT_MAX_OUTPUT_TOKENS =
20_000`. These sit well above any reasonable single-session usage with
today's tool surface and act as a guardrail, not a throttle. Both are
optional; unset = no cap (parity with `AGENT_MAX_TURNS = 10` default
behavior).

**Rationale.** Per-session is the unit of "runaway loop". Per-day or
per-conversation would conflate normal sustained use with unbounded
recursion. Mid-stream interruption was rejected as a non-goal — by the
time you have a partial assistant turn, the cost is already incurred,
and ending mid-block would leave the model history in a malformed
state.

**Alternatives considered.**

- *Dollar-cost cap*: requires a pricing table and per-model rate
  changes. Token count is the durable proxy; conversion can happen in
  observability later.
- *Per-conversation cap*: penalizes engaged days; doesn't catch the
  thing we're trying to catch (one-shot loop runaway).

### D4. SSE wire-format change is taken now, not deferred

The `tool_result` event shape changes from `{ toolName, result }` to
`{ toolName, ok, result?, error? }`. There is exactly one consumer
(`ChatPanel`); there is no public SSE contract. We update both sides in
the same PR rather than supporting both shapes during a window. No
versioning, no compatibility shim — those are explicitly listed in
`AGENTS.md` / `CLAUDE.md` style notes as anti-patterns for this repo.

### D5. Vitest, in-memory SQLite, two modules

The test seam targets exactly:

- `src/lib/consumption.ts` — `setConsumptionStatus` legal/illegal
  transitions, `recordProgress` auto-promotion and auto-archive.
- `src/lib/taste-edit.ts` — every transition surfaced through the
  module (label, weight, reassign, merge, split, retire), including the
  `IllegalEditError` and `ConcurrentEditError` paths.

Test setup: per-test in-memory SQLite via `better-sqlite3` (`:memory:`),
running `runMigrations()` against it. No fixtures shared across files;
each test file builds the state it needs. The `getDb()` singleton is
the only seam that needs a test override — introduce a thin module
boundary if one isn't already present (`db.ts` exports a `setDbForTest()`
that the test setup calls before `runMigrations()` and clears in
`afterEach`).

A new `just test` verb runs `vitest run`. Per the launch/deploy
invariant in `CLAUDE.md`, this means `justfile` and `RUNBOOK.md` both
update in this change.

**Rationale.** This is the smallest possible test footprint that
delivers real safety on the two modules whose bugs would be most
expensive (silent state-machine corruption and silent taste-cluster
corruption). It does not commit folio to a coverage culture.

### D6. Survives intervening refactors

Three explicit anti-fragility moves so this change stays implementable
months from now:

- The proposal and specs name **capabilities and contracts**, never
  line numbers.
- Tool list is referenced by **role** (read tools, mutation tools), not
  by enumerated names — the proposal references the existing
  curation-agent spec for the canonical list.
- The Zod-for-tools work is described as "for each tool that exists at
  implementation time", so adding/removing tools between now and
  implementation doesn't invalidate the design.

## Risks / Trade-offs

- **[Risk] Zod parse on every tool call adds latency.** → Mitigation:
  tool inputs are tiny objects; Zod parse cost is microseconds. Not
  measurable next to the network round-trip to Anthropic.

- **[Risk] Token-budget cap fires on a legitimately long session and
  surprises the user.** → Mitigation: defaults are deliberately
  generous (200k input / 20k output per session). The user can lift
  via env var. The error message names the cap explicitly so the user
  knows what happened and how to change it.

- **[Risk] The test seam grows and absorbs effort beyond the two named
  modules.** → Mitigation: scope is contractual — the change explicitly
  lists the two modules, and `tasks.md` constrains what is and isn't
  in. A future testing-expansion change is a separate proposal.

- **[Risk] Wire-format change ships without updating the client.** →
  Mitigation: client and server land in the same PR. Specs require
  ChatPanel to render the new shape. There is no compatibility window
  to forget.

- **[Risk] Deferred work goes stale: by the time we implement,
  `src/lib/agent/*` has been refactored or replaced.** → Mitigation: the
  proposal is written against capabilities (typed errors, validated
  boundaries, budget cap), not against current file shapes. As long as
  the curation-agent capability still exists in some form, this change
  is implementable.

- **[Trade-off] Adding `vitest` is the first test runner in the repo
  and changes "this project has no tests" to "this project has tests
  for two modules".** → Accepted. The alternative — keeping the testing
  question open forever — is worse than picking the smallest defensible
  starting point.

## Open Questions

- Should `permission_denied` be removed from the `ToolErrorCode` union
  given no current tool emits it? Leaning **keep**: it costs nothing to
  reserve and saves a follow-up change when OAuth-scoped tools land.
  Resolve at implementation time based on whether OAuth-scoped tools
  are imminent.
- Should the SSE `error` event itself also adopt the typed-code shape,
  or stay free-form? Current spec says `{ message: 'max turns reached' }`.
  Leaning **adopt**: same envelope for symmetry. Confirm at
  implementation time; the proposal does not commit either way.
