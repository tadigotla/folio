import type Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';
import {
  assignSlot,
  swapSlots,
  clearSlot,
  type SwapFrom,
  InvalidSlotError,
  IssueFrozenError,
  IssueNotFoundError,
  SlotOccupiedError,
  VideoAlreadyOnIssueError,
  getInboxPool,
} from '../issues';
import { getClusterSummaries } from '../taste-read';
import {
  bufferToFloats,
  embed,
  getActiveEmbeddingConfig,
} from '../embeddings';
import { cosineSim, normalize } from '../taste';
import type { SlotKind } from '../types';

export const TOOL_NAMES = [
  'search_pool',
  'rank_by_theme',
  'get_video_detail',
  'get_taste_clusters',
  'assign_slot',
  'swap_slots',
  'clear_slot',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'search_pool',
    description:
      'Search the inbox pool (videos not yet placed on the current draft). Returns id, title, channel, duration, published date, and current cluster assignment. Supports a free-text substring on title/channel and/or a taste cluster filter.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Substring matched case-insensitively against title and channel name. Optional.',
        },
        cluster_id: {
          type: 'integer',
          description: 'Restrict to videos currently assigned to this cluster id. Optional.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum rows to return. Default 20, max 50.',
          minimum: 1,
          maximum: 50,
        },
      },
    },
  },
  {
    name: 'rank_by_theme',
    description:
      'Embed a free-text theme under the active embedding provider/model, then return the top-K corpus videos by cosine similarity. Use this to find "things that lean X" when the user describes a feeling rather than a keyword. Rejects with no_embedded_corpus if the active provider has no embeddings yet.',
    input_schema: {
      type: 'object',
      required: ['theme'],
      properties: {
        theme: { type: 'string' },
        limit: {
          type: 'integer',
          description: 'Top-K to return. Default 10, max 25.',
          minimum: 1,
          maximum: 25,
        },
      },
    },
  },
  {
    name: 'get_video_detail',
    description:
      'Fetch everything known about one video: title, channel, duration, published date, LLM summary, topic tags, first ~500 chars of the transcript, consumption status, and current cluster assignment.',
    input_schema: {
      type: 'object',
      required: ['video_id'],
      properties: { video_id: { type: 'string' } },
    },
  },
  {
    name: 'get_taste_clusters',
    description:
      'Return the active taste clusters (id, label, weight, member count, top members). Read-only. The user edits clusters at /taste — you cannot modify them.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'assign_slot',
    description:
      'Place a video into an empty slot on the current draft. slot_kind is one of cover|featured|brief; cover has slot_index 0, featured 0..2, brief 0..9. Assigning an inbox video auto-promotes its consumption status to saved.',
    input_schema: {
      type: 'object',
      required: ['video_id', 'slot_kind', 'slot_index'],
      properties: {
        video_id: { type: 'string' },
        slot_kind: { type: 'string', enum: ['cover', 'featured', 'brief'] },
        slot_index: { type: 'integer', minimum: 0, maximum: 9 },
      },
    },
  },
  {
    name: 'swap_slots',
    description:
      'Swap the occupant of two slots, or replace a slot with a pool video. `from` is either { kind, index } for slot→slot or { pool: video_id } for pool→slot. The target slot must currently be occupied.',
    input_schema: {
      type: 'object',
      required: ['from', 'to'],
      properties: {
        from: {
          oneOf: [
            {
              type: 'object',
              required: ['kind', 'index'],
              properties: {
                kind: { type: 'string', enum: ['cover', 'featured', 'brief'] },
                index: { type: 'integer', minimum: 0, maximum: 9 },
              },
            },
            {
              type: 'object',
              required: ['pool'],
              properties: { pool: { type: 'string' } },
            },
          ],
        },
        to: {
          type: 'object',
          required: ['kind', 'index'],
          properties: {
            kind: { type: 'string', enum: ['cover', 'featured', 'brief'] },
            index: { type: 'integer', minimum: 0, maximum: 9 },
          },
        },
      },
    },
  },
  {
    name: 'clear_slot',
    description: 'Empty one slot on the current draft.',
    input_schema: {
      type: 'object',
      required: ['slot_kind', 'slot_index'],
      properties: {
        slot_kind: { type: 'string', enum: ['cover', 'featured', 'brief'] },
        slot_index: { type: 'integer', minimum: 0, maximum: 9 },
      },
    },
  },
];

// Mark the last tool with cache_control so the tools block joins the cached
// prefix along with the system prompt.
export function getToolsForRequest(): Anthropic.Tool[] {
  const tools = TOOL_DEFS.map((t) => ({ ...t }));
  const last = tools[tools.length - 1];
  (last as Anthropic.Tool & { cache_control?: { type: 'ephemeral' } }).cache_control = {
    type: 'ephemeral',
  };
  return tools;
}

export interface ToolContext {
  issueId: number;
}

export type ToolResult =
  | { ok: true; data: unknown; summary?: string }
  | { ok: false; error: string; summary?: string };

const VALID_KINDS: SlotKind[] = ['cover', 'featured', 'brief'];

function isSlotKind(v: unknown): v is SlotKind {
  return typeof v === 'string' && VALID_KINDS.includes(v as SlotKind);
}

// --- search_pool ----------------------------------------------------------

interface PoolSearchRow {
  id: string;
  title: string;
  channel_name: string;
  duration_seconds: number | null;
  published_at: string | null;
  status: string;
  cluster_id: number | null;
  cluster_label: string | null;
}

function execSearchPool(args: {
  query?: string;
  cluster_id?: number;
  limit?: number;
}): ToolResult {
  const db = getDb();
  const limit = Math.min(Math.max(1, args.limit ?? 20), 50);
  const q = args.query?.trim();
  const clusterId = args.cluster_id;

  const params: unknown[] = [];
  const where: string[] = [`c.status IN ('inbox','saved')`];

  let sql = `SELECT v.id, v.title, ch.name AS channel_name,
                    v.duration_seconds, v.published_at,
                    c.status,
                    a.cluster_id, tc.label AS cluster_label
               FROM videos v
               JOIN consumption c ON c.video_id = v.id
               JOIN channels ch ON ch.id = v.channel_id
          LEFT JOIN video_cluster_assignments a ON a.video_id = v.id
          LEFT JOIN taste_clusters tc ON tc.id = a.cluster_id`;

  if (q) {
    where.push(`(LOWER(v.title) LIKE ? OR LOWER(ch.name) LIKE ?)`);
    const pat = `%${q.toLowerCase()}%`;
    params.push(pat, pat);
  }
  if (clusterId != null) {
    where.push(`a.cluster_id = ?`);
    params.push(clusterId);
  }

  sql +=
    ` WHERE ${where.join(' AND ')}` +
    ` ORDER BY c.status_changed_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as PoolSearchRow[];

  return {
    ok: true,
    data: {
      count: rows.length,
      results: rows.map((r) => ({
        video_id: r.id,
        title: r.title,
        channel: r.channel_name,
        duration_seconds: r.duration_seconds,
        published_at: r.published_at,
        status: r.status,
        cluster:
          r.cluster_id != null
            ? { id: r.cluster_id, label: r.cluster_label }
            : null,
      })),
    },
    summary:
      `searched pool (${[q ? `"${q}"` : null, clusterId != null ? `cluster #${clusterId}` : null].filter(Boolean).join(', ') || 'no filter'}) — ${rows.length} hit${rows.length === 1 ? '' : 's'}`,
  };
}

// --- rank_by_theme --------------------------------------------------------

interface EmbRow {
  video_id: string;
  vec: Buffer;
  title: string;
  channel_name: string;
  duration_seconds: number | null;
}

async function execRankByTheme(args: {
  theme: string;
  limit?: number;
}): Promise<ToolResult> {
  const theme = args.theme.trim();
  if (!theme) return { ok: false, error: 'theme must be non-empty' };
  const limit = Math.min(Math.max(1, args.limit ?? 10), 25);

  const db = getDb();
  const cfg = getActiveEmbeddingConfig();

  const sample = db
    .prepare(
      `SELECT COUNT(*) AS n FROM video_embeddings
        WHERE provider = ? AND model = ?`,
    )
    .get(cfg.provider, cfg.model) as { n: number };
  if (sample.n === 0) {
    return {
      ok: false,
      error: 'no_embedded_corpus',
      summary:
        `no videos embedded under active provider ${cfg.provider}/${cfg.model}`,
    };
  }

  const [themeVec] = await embed([theme], cfg);
  const themeNorm = normalize(new Float32Array(themeVec));

  const rows = db
    .prepare(
      `SELECT emb.video_id, emb.vec, v.title, ch.name AS channel_name,
              v.duration_seconds
         FROM video_embeddings emb
         JOIN videos v ON v.id = emb.video_id
         JOIN channels ch ON ch.id = v.channel_id
        WHERE emb.provider = ? AND emb.model = ?`,
    )
    .all(cfg.provider, cfg.model) as EmbRow[];

  const scored = rows
    .map((r) => {
      const vec = normalize(bufferToFloats(r.vec));
      if (vec.length !== themeNorm.length) return null;
      return {
        video_id: r.video_id,
        title: r.title,
        channel: r.channel_name,
        duration_seconds: r.duration_seconds,
        similarity: cosineSim(themeNorm, vec),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return {
    ok: true,
    data: { theme, count: scored.length, results: scored },
    summary: `ranked ${scored.length} video${scored.length === 1 ? '' : 's'} by theme "${theme}"`,
  };
}

// --- get_video_detail -----------------------------------------------------

interface VideoDetailRow {
  id: string;
  title: string;
  description: string | null;
  channel_name: string;
  duration_seconds: number | null;
  published_at: string | null;
  source_url: string;
  summary: string | null;
  topic_tags: string | null;
  transcript_text: string | null;
  consumption_status: string | null;
  cluster_id: number | null;
  cluster_label: string | null;
  cluster_similarity: number | null;
  is_fuzzy: number | null;
}

function execGetVideoDetail(args: { video_id: string }): ToolResult {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT v.id, v.title, v.description, ch.name AS channel_name,
              v.duration_seconds, v.published_at, v.source_url,
              enr.summary, enr.topic_tags,
              tr.text AS transcript_text,
              cons.status AS consumption_status,
              a.cluster_id, tc.label AS cluster_label,
              a.similarity AS cluster_similarity,
              a.is_fuzzy
         FROM videos v
         JOIN channels ch ON ch.id = v.channel_id
    LEFT JOIN video_enrichment enr ON enr.video_id = v.id
    LEFT JOIN video_transcripts tr ON tr.video_id = v.id
    LEFT JOIN consumption cons ON cons.video_id = v.id
    LEFT JOIN video_cluster_assignments a ON a.video_id = v.id
    LEFT JOIN taste_clusters tc ON tc.id = a.cluster_id
        WHERE v.id = ?`,
    )
    .get(args.video_id) as VideoDetailRow | undefined;
  if (!row) {
    return { ok: false, error: 'video_not_found', summary: `no video ${args.video_id}` };
  }
  const transcript = row.transcript_text
    ? row.transcript_text.slice(0, 500)
    : null;
  return {
    ok: true,
    data: {
      video_id: row.id,
      title: row.title,
      channel: row.channel_name,
      duration_seconds: row.duration_seconds,
      published_at: row.published_at,
      source_url: row.source_url,
      summary: row.summary,
      topic_tags: row.topic_tags ? row.topic_tags.split(',').map((s) => s.trim()) : [],
      transcript_snippet: transcript,
      consumption_status: row.consumption_status,
      cluster:
        row.cluster_id != null
          ? {
              id: row.cluster_id,
              label: row.cluster_label,
              similarity: row.cluster_similarity,
              is_fuzzy: row.is_fuzzy === 1,
            }
          : null,
    },
    summary: `fetched detail for "${row.title}"`,
  };
}

// --- get_taste_clusters ---------------------------------------------------

function execGetTasteClusters(): ToolResult {
  const listing = getClusterSummaries();
  const clusters = listing.active.map((c) => ({
    id: c.id,
    label: c.label,
    weight: c.weight,
    member_count: c.memberCount,
    fuzzy_count: c.fuzzyCount,
    top_members: c.preview.slice(0, 5).map((p) => ({
      video_id: p.videoId,
      title: p.title,
      channel: p.channelName,
    })),
  }));
  return {
    ok: true,
    data: { count: clusters.length, clusters },
    summary: `fetched ${clusters.length} active cluster${clusters.length === 1 ? '' : 's'}`,
  };
}

// --- slot tools (reuse the library path) ----------------------------------

function mapSlotErr(err: unknown): ToolResult {
  if (err instanceof InvalidSlotError) {
    return { ok: false, error: 'invalid_slot' };
  }
  if (err instanceof IssueFrozenError) {
    return { ok: false, error: 'issue_frozen' };
  }
  if (err instanceof IssueNotFoundError) {
    return { ok: false, error: 'issue_not_found' };
  }
  if (err instanceof SlotOccupiedError) {
    return { ok: false, error: 'slot_occupied' };
  }
  if (err instanceof VideoAlreadyOnIssueError) {
    return { ok: false, error: 'video_already_on_issue' };
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function execAssignSlot(
  ctx: ToolContext,
  args: { video_id: string; slot_kind: SlotKind; slot_index: number },
): ToolResult {
  if (!isSlotKind(args.slot_kind)) {
    return { ok: false, error: 'invalid_slot_kind' };
  }
  try {
    assignSlot(ctx.issueId, args.video_id, args.slot_kind, args.slot_index);
    return {
      ok: true,
      data: { assigned: true },
      summary: `assigned ${args.video_id} → ${args.slot_kind}[${args.slot_index}]`,
    };
  } catch (err) {
    return mapSlotErr(err);
  }
}

interface SwapArgs {
  from: { kind?: string; index?: number; pool?: string };
  to: { kind: string; index: number };
}

function execSwapSlots(ctx: ToolContext, args: SwapArgs): ToolResult {
  if (!isSlotKind(args.to.kind) || typeof args.to.index !== 'number') {
    return { ok: false, error: 'invalid_slot' };
  }
  let from: SwapFrom;
  if (typeof args.from.pool === 'string' && args.from.pool) {
    from = { pool: args.from.pool };
  } else if (
    isSlotKind(args.from.kind) &&
    typeof args.from.index === 'number'
  ) {
    from = { kind: args.from.kind, index: args.from.index };
  } else {
    return { ok: false, error: 'invalid_swap_from' };
  }
  try {
    swapSlots(ctx.issueId, from, { kind: args.to.kind, index: args.to.index });
    return {
      ok: true,
      data: { swapped: true },
      summary:
        `swapped ${'pool' in from ? `pool:${from.pool}` : `${from.kind}[${from.index}]`} ↔ ${args.to.kind}[${args.to.index}]`,
    };
  } catch (err) {
    return mapSlotErr(err);
  }
}

function execClearSlot(
  ctx: ToolContext,
  args: { slot_kind: SlotKind; slot_index: number },
): ToolResult {
  if (!isSlotKind(args.slot_kind)) {
    return { ok: false, error: 'invalid_slot_kind' };
  }
  try {
    clearSlot(ctx.issueId, args.slot_kind, args.slot_index);
    return {
      ok: true,
      data: { cleared: true },
      summary: `cleared ${args.slot_kind}[${args.slot_index}]`,
    };
  } catch (err) {
    return mapSlotErr(err);
  }
}

// --- dispatcher -----------------------------------------------------------

export const SLOT_MUTATION_TOOLS: ReadonlySet<ToolName> = new Set([
  'assign_slot',
  'swap_slots',
  'clear_slot',
]);

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'search_pool':
        // Access pool via getInboxPool to assert draft exists — catches a
        // typo'd issueId early, but the actual query is the dedicated helper.
        getInboxPool(ctx.issueId);
        return execSearchPool(args as Parameters<typeof execSearchPool>[0]);
      case 'rank_by_theme':
        return await execRankByTheme(
          args as Parameters<typeof execRankByTheme>[0],
        );
      case 'get_video_detail':
        return execGetVideoDetail(
          args as Parameters<typeof execGetVideoDetail>[0],
        );
      case 'get_taste_clusters':
        return execGetTasteClusters();
      case 'assign_slot':
        return execAssignSlot(
          ctx,
          args as Parameters<typeof execAssignSlot>[1],
        );
      case 'swap_slots':
        return execSwapSlots(ctx, args as unknown as SwapArgs);
      case 'clear_slot':
        return execClearSlot(
          ctx,
          args as Parameters<typeof execClearSlot>[1],
        );
      default:
        return { ok: false, error: `unknown_tool:${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
