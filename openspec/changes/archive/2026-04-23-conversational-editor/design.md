## Stance

Folio stops being a tool and becomes an editor-in-residence. The user hands it a YouTube corpus; it hands back a draft issue to argue with. Drag-and-drop, the previous primary interaction, is demoted to a micro-adjustment affordance. The primary interaction is conversation.

Two non-negotiable commitments frame every downstream decision:

1. **`/` is chat-first.** Opening the app drops you into a conversation, not a board. The board is visible as a rendered view of current draft state; you can switch into a board-primary view to drag, but that is a detour, not the home.
2. **The agent acts while you sleep.** A nightly run composes a skeleton draft from yesterday's imports and writes a morning brief. The user wakes up to something to push against, not a blank pool.

These are identity commitments. If either feels wrong in a later phase, the project is not done pivoting.

## The new shape of `/`

```
  ┌─────────────────────────────────────────────────────────────────┐
  │   FOLIO · 2026-04-21                                             │
  ├─────────────────────────────────────────────────────────────────┤
  │                                                                  │
  │   ┌────────────────────────────────────────────────────────┐   │
  │   │ MORNING BRIEF · 04:12                                   │   │
  │   │ 42 new imports. 2 unusual, rest filled existing clusters│   │
  │   │ I drafted around <theme>. Cover + 3 featured + 4 briefs.│   │
  │   │ [open the draft →]   [start fresh]                      │   │
  │   └────────────────────────────────────────────────────────┘   │
  │                                                                  │
  │   CHAT THREAD (for this issue)                                   │
  │   ─────────────────────────────────                             │
  │   ▸ You: what's 'unusual' mean?                                  │
  │   ▸ Agent: two videos landed between clusters. One looks like…  │
  │                                                                  │
  │   ▸ Input:  [ what are you saving me from today?           ]    │
  │                                                                  │
  │   ───                                                            │
  │   [▸ view board ]    [⚡ raw pool]    [★ taste]                  │
  └─────────────────────────────────────────────────────────────────┘
```

- **Morning brief** appears at the top until dismissed or the user opens the drafted issue.
- **Chat thread** is per-issue; opening an older issue loads its conversation.
- **View board** toggles a board-primary layout for direct drag.
- **Raw pool** is the power-user escape (equivalent of the retired `/inbox`).
- **Taste** goes to the cluster-lab surface.

## Agent architecture

The agent is a tool-using loop against Anthropic's API. It does not have free access to mutate anything — it goes through a small, audited API that mirrors the editor's own operations.

```
  SYSTEM PROMPT
    - Editorial character: restrained, specific, opinionated when asked.
    - Writes like a copy chief, not a chatbot. No emoji. No cutesy persona.
    - Has access to:
        · user's cluster map with labels and weights
        · current draft state (which slots are filled, by what)
        · pool summary (count per cluster, top candidates)
        · per-issue conversation history
        · agent memory notes (persistent jottings from prior runs)
    - Does not fabricate video content — uses get_video_detail before
      making claims about a specific video.

  TOOLS (each maps to a DB-bound server function)
    search_pool(query, k)                  → videos
    rank_pool_by_theme(theme, k)           → videos
    assign_slot(kind, index, video_id, reason)
    clear_slot(kind, index)
    swap_slots(a, b)
    get_video_detail(id)                   → title, description,
                                             duration, channel, transcript
                                             snippets, cluster membership
    propose_import(search_query)           → candidates awaiting user accept
                                             (NOT auto-imported)
    remember_note(scope, content)          → persist to agent_memory_notes
```

**Non-goals for the agent:**
- Auto-imports. Candidates always route through user approval.
- Mutating consumption state directly. Slot assignments trigger existing `inbox → saved` promotion via the same path drag uses.
- Unpublished reasoning. Every slot mutation carries a `reason` string persisted with the `issue_slots` row; the user can see why.

## The overnight job

A scheduled task that runs at a user-configured hour (default 04:00):

```
  1. pull_recent_imports()        → subscription-upload delta
  2. enrich_new_videos()          → local Gemma: per-video 50-word summary
                                    + 3 topic tags. Writes to video columns
                                    or a companion table.
  3. embed_new_videos()           → OpenAI text-embedding-3-small (or BGE
                                    local). Writes video_embeddings.
  4. update_clusters()            → incremental reassignment + cluster
                                    drift detection.
  5. if has_user_authored_draft():
        write_brief_only(summary)  → morning brief notes, no slot writes
     else:
        compose_draft_issue()      → agent run with a "draft tomorrow's
                                    issue" directive. 6 slots typical
                                    (cover + 3 featured + 2 briefs),
                                    leaving room for the human.
        write_brief_with_draft(summary, draft_id)
```

**"Don't clobber" rule:** the agent never modifies an existing draft. If a draft is in progress, the agent can only describe what's new; the user-authored draft remains untouched until the user publishes or discards it.

**Why partial drafts, not full:** leaving 6+ slots open keeps the user as editor-in-chief. The agent proposes a shape, the human fills the room.

**Scheduling mechanism:** on macOS, a launchd user agent that invokes `just nightly`. On Linux, cron. Do NOT schedule from within the Next.js process. The runbook documents install/uninstall verbs.

## Agent character and voice

A restrained editorial voice. Guidelines captured in the system prompt:

- Specific over general. "This video opens with a five-minute anecdote about…" not "an interesting take."
- Opinionated when asked, quiet otherwise. Doesn't hedge. Doesn't praise effusively.
- Uses the user's cluster labels when referring to themes, not its own re-framings.
- Never cute. No emoji. No "Let me know how I can help!" closers.
- Admits uncertainty plainly: "I don't have a transcript for this one; the title suggests X but I can't tell."

**No name, no persona branding.** The agent is "the editor" in copy, "agent" internally. Giving it a name makes it feel like a chatbot mascot; withholding one keeps it feeling like an extension of the app.

## Memory model

Three persistence surfaces:

```
  conversations                   one per issue (incl. draft issues)
  conversation_turns              append-only history of chat + tool calls
  agent_memory_notes              durable cross-conversation jottings
                                  the agent writes to itself via tool
```

**Retrieval:** at conversation start, we load (a) recent turns from the current conversation, (b) top-K memory notes by embedding similarity to the user's opening message, (c) the taste profile snapshot, (d) current draft state. Context window stays bounded; older turns summarized into memory notes if needed.

**Conversations freeze when their issue publishes.** Matches the published-issue freeze invariant. You can still read the thread but can't continue it.

## Taste-profile mechanics

The engine under both the agent and the `/taste` UI:

```
  1. Per-video: title + description + transcript → embedding (3-small
     or BGE-M3).
  2. Likes form the seed set; cluster with HDBSCAN or K-means on the
     likes only, k chosen by silhouette.
  3. All other videos assigned to the nearest cluster by cosine; below
     a similarity floor, assigned to a "fuzzy" bucket.
  4. User labels, weights, merges, splits persist in taste_clusters
     table; cluster centroids are recomputed from label-accepted
     members on each run.
  5. Weights propagate into pool ranking (higher-weight cluster members
     surface more) and agent prompt (agent emphasizes higher-weight
     themes when drafting).
```

Cluster labels are **the human-in-the-loop**. A cluster without a user label is treated as suggested-not-confirmed; the agent can reference it by index ("cluster 4") but prefers user-labeled ones in its prose.

## Provider allocation

```
  Editorial agent              Anthropic Sonnet 4.6 (default)
                               Opus 4.7 for hard conversations (opt-in)

  Embeddings                   OpenAI text-embedding-3-small (default)
                               BGE-M3 local (fallback, equal quality)

  Bulk enrichment              Ollama + Gemma (or similar) overnight
  (summaries, topic tags)      Not interactive. Cost-free.

  Transcripts                  youtube-transcript-api (free; no API key)
                               Whisper local for videos w/o captions
                               (optional, heavy)
```

**Why the split:** interactive quality demands cloud (Sonnet's tool-use is better than current local models at 30B). Embeddings are commodity. Bulk enrichment is embarrassingly parallel and cost-dominant if pushed to an API.

## Privacy posture

1. Video transcripts → embeddings API: content is public. No concern.
2. Agent conversation logs accumulate a taste self-portrait. Anthropic retains API calls ~30 days for trust-and-safety, then purges; does not train on API data. Acceptable for this user's stated risk tolerance.
3. Local-only fallback remains available (Ollama + BGE-M3). A later preference toggle could route all inference locally at cost of interactive quality. Not in scope for any current phase; documented here so the door stays open.

## Success

The single north-star is qualitative: **"I'm seeing videos I couldn't have found."**

End-of-issue reflection at `/reflect`: one sentence, a 1–5 "feels like me" rating. Small, honest, hard to game.

Quantitative health checks exist only to detect the design's failure, not to optimize:
- Chat vs. drag slot-assignment ratio — if drag dominates, the conversation is not useful.
- Published-issue watched vs. archived-unwatched rate — if many picks are dismissed post-publish, agent quality is off.
- `/taste` label completeness — if the user never labels a cluster, the loop is missing its human input.

Explicitly NOT tracked: output velocity, engagement time, retention. This is a personal tool; those are SaaS instincts that lie about quality.

## Phasing

1. **taste-substrate** — data plane only. Enrichment, embeddings, clustering. No UI changes.
2. **taste-lab** — `/taste` renders clusters, user labels / merges / splits / weights.
3. **conversational-editor-ui** — `/` becomes chat-first. Agent with tools. Interactive only.
4. **overnight-brief** — scheduled job + morning brief surface + "don't clobber" rule.
5. **discovery-tools** — description-graph + `propose_import` tool closes the loop on the anti-algorithm goal.

Each is shippable alone. Phase 1–2 are infrastructure that pays off across everything. Phase 3 is the UX earthquake. Phase 4 completes the editor-in-residence promise. Phase 5 is the original discovery thesis.

## Open questions to revisit per phase

- **Cluster count:** fixed k or auto-selected? (Probably auto with user-driven merges as the real controller.)
- **Morning-brief persistence:** one per day, ephemeral past that, or durable archive? (Leaning durable; it becomes a diary of the agent's thinking.)
- **Reflect journaling:** same page as the published issue, or dedicated surface? (Probably inline on `/issues/[id]` with a small "how did this one feel?" prompt.)
- **Chat UI treatment:** full-width conversation or narrow column alongside a shrunken board? (Chat-forward says full-width; answer when we build it.)
- **Cost ceiling:** do we surface cost-per-month in the UI? (Useful honesty; easy to add; decide at build time.)

## Risks

- **Agent produces drafts the user always overrides.** Signals a bad taste-profile or a mis-tuned system prompt. Mitigation: the reflect journal + the chat-vs-drag ratio are early-warning instruments.
- **Overnight job fails silently.** No brief in the morning is a bad outcome because the whole product is built around the morning delivery. Mitigation: a visible "last nightly run: OK / failed" status on `/`; `just nightly` usable manually to recover.
- **Cloud dependency becomes a single point of failure.** Anthropic outage = no editor. Mitigation: the draft and data are local; a fallback to drag-primary mode is trivial because the board still works.
- **Taste profile ossifies.** User never re-labels; clusters stale. Mitigation: `/taste` shows "last refreshed" + a drift indicator ("3 new likes didn't fit existing clusters").
- **Conversation corpus becomes a psychological self-portrait the user doesn't want to keep.** Mitigation: export + delete verbs on `/taste` or a `/privacy` page. Not in phase 1 but noted.
