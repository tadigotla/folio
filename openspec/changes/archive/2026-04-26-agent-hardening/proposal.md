## Why

The curation agent's runtime trusts its inputs more than it should. The
HTTP request body is checked with `typeof`, per-tool argument shapes
ride entirely on the model's compliance with JSON Schema, every tool
failure collapses into a single SSE `error` event regardless of cause,
and the only autonomy ceiling is `AGENT_MAX_TURNS` — there is no token
or cost cap. None of these are bugs today (the agent is well-shaped and
the user is the only operator), but each is a sharp edge that gets more
expensive to file down later. Capturing the change now means the work is
shovel-ready whenever the agent surface is touched next, even if
intervening functional or architectural changes have moved code around.

The patterns are inspired by qaloop (`src/scenario/executor.ts` for
typed `blocked` vs. `error`; `src/config/schema.ts` and
`src/scenario/schema.ts` for Zod-at-the-edge; `src/verification/` for
deterministic checks). Folio is **not** adopting qaloop's runtime — only
the discipline of typed boundaries.

## What Changes

- Introduce a typed **tool-error taxonomy** (`validation | not_found | conflict | precondition_failed | permission_denied | upstream_unavailable | internal`) carried on every `tool_result` block sent back to the model and emitted on the SSE `tool_result` event. Today every tool failure is shaped as an opaque `{ error: string }`; the new shape is `{ error: { code, message, details? } }`.
- Add **Zod validation at every external boundary** of the agent surface:
  - `POST /api/agent/message` request body.
  - Each tool's `input` parameters, validated server-side before the executor runs (the model's schema is necessary but not sufficient).
  - `GET /api/agent/conversation/[date]` path param (already partially validated — formalize).
  Validation failures map to HTTP 400 (route boundary) or to a `validation` tool error (tool boundary).
- Add an **agent-loop budget cap** alongside `AGENT_MAX_TURNS`: configurable `AGENT_MAX_INPUT_TOKENS` and `AGENT_MAX_OUTPUT_TOKENS` per user-message session, computed from the per-turn token counts already persisted on `conversation_turns`. When either ceiling is crossed before the next iteration, the loop stops the same way the turn cap stops it: emit a structured SSE `error`, persist a final assistant turn flagging the cap, close the stream. Counters are **per user-message session** (one `POST /api/agent/message` invocation), not per conversation-day.
- **BREAKING (wire format only):** SSE `tool_result` event payload changes from `{ toolName, result }` to `{ toolName, ok: boolean, result?, error?: { code, message, details? } }`. The `ChatPanel` client renderer is updated in the same change.
- **Lower priority, same change, gated last:** introduce a deterministic test seam (vitest) for the consumption state machine (`src/lib/consumption.ts`) and the taste-edit transitions (`src/lib/taste-edit.ts`). In-memory SQLite, no Anthropic, no network. This is the **first** test runner in the repo — `CLAUDE.md` says "do not add one unless asked"; this proposal is the ask. Scope is strictly the two pure-state-machine modules; no broader coverage push.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `curation-agent`: tighten the `POST /api/agent/message` and tool-result contracts. Today's spec describes tool failures as opaque `{ error: 'duplicate_video' }` and the loop cap only as `AGENT_MAX_TURNS`; both grow new requirements (typed error envelope, token-budget cap). The streaming-message and tool-set requirements gain new scenarios; the per-day conversation, hydration, status, and taste-write-isolation requirements are unchanged.

## Impact

- **Code:** `src/lib/agent/run.ts`, `src/lib/agent/tools.ts`, `src/lib/agent/turns.ts`, `src/app/api/agent/message/route.ts`, `src/app/api/agent/conversation/[date]/route.ts`, `src/components/agent/ChatPanel.tsx` (renderer for the new `tool_result` shape).
- **APIs:** `POST /api/agent/message` SSE `tool_result` payload changes (breaking for any external SSE consumer; folio has none today). HTTP status surface for `POST /api/agent/message` gains 400 for malformed body.
- **Dependencies:** add `zod` (already in tree if shadcn pulled it; otherwise a single new dep) and `vitest` + `@vitest/coverage-v8` (dev). No production runtime additions beyond `zod`.
- **Config / env:** new optional `AGENT_MAX_INPUT_TOKENS` and `AGENT_MAX_OUTPUT_TOKENS` (with sensible defaults). `.env.example`, `RUNBOOK.md`, and `justfile` updated per the launch/deploy invariant in `CLAUDE.md`. New `just test` verb wired to vitest.
- **Database:** none. Token counts are already on `conversation_turns`.
- **Out of scope (explicitly):** variable interpolation / `{{capture}}`, multi-skill split into `.claude/skills/`, granular `mutationScope` per tool, broader test coverage beyond the two named modules.
