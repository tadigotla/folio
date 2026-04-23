## REMOVED Requirements

### Requirement: Conversation persistence schema

**Reason**: The magazine teardown removes the `issues` table, breaking the 1:1 `conversations.issue_id` binding this requirement defines. Replaced by the `curation-agent` capability's "Per-day conversation scope" requirement.

**Migration**: `db/migrations/016_magazine_teardown.sql` rebuilds `conversations` with `scope_date TEXT UNIQUE NOT NULL` replacing `issue_id`. Existing conversation turns are repointed at the new per-day conversation row in the same transaction. See `design.md` decision 3 for the rebuild-and-repoint strategy and the documented fallback.

### Requirement: One conversation per draft

**Reason**: Draft issues no longer exist; there is nothing to be 1:1 with. The replacement is one conversation per calendar day — see `curation-agent`'s "Per-day conversation scope".

**Migration**: Applications that previously called `POST /api/agent/message` with an `issueId` SHALL now call it with no ID (the route resolves `scope_date` server-side). See `curation-agent` spec for the new contract.

### Requirement: Streaming agent message endpoint

**Reason**: The endpoint survives but its contract changes — payload loses `issueId`, loop resolves today's conversation server-side, and the tool set is the new curation set. Replaced by the identically-named requirement in `curation-agent`.

**Migration**: Clients should stop sending `issueId` in the request body. All other stream framing (`delta`, `tool_call`, `tool_result`, `error`, `done`) is unchanged.

### Requirement: Tool set

**Reason**: Seven tools are replaced with eleven; the slot tools (`assign_slot`, `swap_slots`, `clear_slot`) are removed because the `issues`/`issue_slots` tables are dropped. Replaced by the "Curation tool set" requirement in `curation-agent`.

**Migration**: No user action. The tool surface is server-side; the model is reconfigured automatically when `src/lib/agent/tools.ts` is updated (phase-3 already shipped this change — this spec delta makes the capability tree match).

### Requirement: Conversation hydration endpoint

**Reason**: The route moves from `/api/agent/conversation/[issueId]` to `/api/agent/conversation/[date]`. Replaced by the identically-named requirement in `curation-agent`.

**Migration**: Clients should replace `issueId` path params with `YYYY-MM-DD` date strings.

### Requirement: Status endpoint reports key presence

**Reason**: Survives verbatim under the new capability name. Replaced by the identically-named requirement in `curation-agent`.

**Migration**: None. The endpoint contract and URL are unchanged.

### Requirement: Slot mutations from the agent share the user mutation path

**Reason**: Slot mutation tools no longer exist and the `issue_slots` table is dropped. No replacement — slot mutations from the agent are categorically gone.

**Migration**: None. The curation-agent's mutation tools (`add_to_playlist`, `triage_inbox`, `mute_cluster_today`, etc.) continue to share code paths with their user-facing endpoints — a new requirement is not needed in `curation-agent` because that guarantee is already inherent in how those tools are wired.

### Requirement: Agent has no write access to taste tables

**Reason**: Survives (as a stricter version: `mute_cluster_today` is now the one exception, carved out explicitly). Replaced by the identically-named requirement in `curation-agent`.

**Migration**: None. The invariant on cluster definition/membership immutability is preserved.
