import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getDb } from '../db';
import { getClusterSummaries } from '../taste-read';
import {
  bufferToFloats,
  embed,
  getActiveEmbeddingConfig,
} from '../embeddings';
import { cosineSim, normalize } from '../taste';
import { setConsumptionStatus } from '../consumption';
import {
  createPlaylist,
  addToPlaylist,
  removeFromPlaylist,
  reorderPlaylist,
} from '../playlists';
import { setMuteToday } from '../mutes';
import { searchYoutube } from '../discovery/search';
import { YouTubeApiKeyMissingError } from '../youtube-api';
import { proposeCandidate, isAlreadyKnown } from '../discovery/candidates';
import {
  type ToolResult,
  ok,
  err,
  mapToolError,
  fromZodError,
} from './errors';

export const TOOL_NAMES = [
  'search_pool',
  'rank_by_theme',
  'get_video_detail',
  'get_taste_clusters',
  'create_playlist',
  'add_to_playlist',
  'remove_from_playlist',
  'reorder_playlist',
  'triage_inbox',
  'mute_cluster_today',
  'resurface',
  'search_youtube',
  'propose_import',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'search_pool',
    description:
      'Search the active pool (videos with consumption.status in inbox/saved/in_progress). Returns id, title, channel, duration, published date, status, and current cluster assignment. Supports a free-text substring on title/channel and/or a taste cluster filter.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Substring matched case-insensitively against title and channel. Optional.',
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
      'Embed a free-text theme under the active embedding provider/model, then return the top-K corpus videos by cosine similarity. Use this when the user describes a feeling rather than a keyword. Rejects with no_embedded_corpus if the active provider has no embeddings.',
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
      'Fetch everything known about one video: title, channel, duration, published date, summary, topic tags, first ~500 chars of the transcript, consumption status, and current cluster assignment.',
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
    name: 'create_playlist',
    description: 'Create a new playlist with the given name and optional description.',
    input_schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
  {
    name: 'add_to_playlist',
    description: 'Append a video to a playlist. Fails if the video is already a member.',
    input_schema: {
      type: 'object',
      required: ['playlist_id', 'video_id'],
      properties: {
        playlist_id: { type: 'integer' },
        video_id: { type: 'string' },
      },
    },
  },
  {
    name: 'remove_from_playlist',
    description: 'Remove a video from a playlist.',
    input_schema: {
      type: 'object',
      required: ['playlist_id', 'video_id'],
      properties: {
        playlist_id: { type: 'integer' },
        video_id: { type: 'string' },
      },
    },
  },
  {
    name: 'reorder_playlist',
    description: 'Move a playlist item to a new 1-based position.',
    input_schema: {
      type: 'object',
      required: ['playlist_id', 'video_id', 'position'],
      properties: {
        playlist_id: { type: 'integer' },
        video_id: { type: 'string' },
        position: { type: 'integer', minimum: 1 },
      },
    },
  },
  {
    name: 'triage_inbox',
    description:
      'Transition a video\'s consumption status: save (inbox→saved), archive (saved or in_progress→archived), or dismiss (inbox→dismissed).',
    input_schema: {
      type: 'object',
      required: ['video_id', 'action'],
      properties: {
        video_id: { type: 'string' },
        action: { type: 'string', enum: ['save', 'archive', 'dismiss'] },
      },
    },
  },
  {
    name: 'mute_cluster_today',
    description:
      'Toggle the per-day mute on a taste cluster — the home ranking will dampen that cluster for the rest of the local day. Calling twice in the same day un-mutes.',
    input_schema: {
      type: 'object',
      required: ['cluster_id'],
      properties: { cluster_id: { type: 'integer' } },
    },
  },
  {
    name: 'resurface',
    description: 'Move an archived video back to saved.',
    input_schema: {
      type: 'object',
      required: ['video_id'],
      properties: { video_id: { type: 'string' } },
    },
  },
  {
    name: 'search_youtube',
    description:
      'User-initiated YouTube Data API search. Only call when the user explicitly asks you to find new content (channels or videos) outside the corpus. Never auto-call to verify metadata, enrich a reply, or answer a question about an existing video — use search_pool / get_video_detail for that. Returns normalized {kind, target_id, title, channel_name} items; nothing is imported until the user approves on /inbox.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        channel_id: {
          type: 'string',
          description: 'Restrict the search to one channel id (UCxxx). Optional.',
        },
        max_results: {
          type: 'integer',
          description: 'Default 10, max 25.',
          minimum: 1,
          maximum: 25,
        },
      },
    },
  },
  {
    name: 'propose_import',
    description:
      'Stage a video or channel as a Proposed import for the user to approve on /inbox. This NEVER imports content directly — every new corpus row is gated by a user click. Use after search_youtube. Drops silently when the target is already known (in corpus, already proposed, or in the rejection list).',
    input_schema: {
      type: 'object',
      required: ['kind', 'target_id', 'source_kind'],
      properties: {
        kind: { type: 'string', enum: ['video', 'channel'] },
        target_id: {
          type: 'string',
          description:
            'YouTube video id (e.g. dQw4w9WgXcQ) or channel id (UCxxx) or @handle.',
        },
        title: { type: 'string' },
        channel_name: { type: 'string' },
        source_kind: {
          type: 'string',
          enum: ['description_link', 'description_handle', 'transcript_link'],
          description:
            'Use description_link for video search results; description_handle for channel search results; transcript_link only when the candidate came from a transcript.',
        },
      },
    },
  },
];

export function getToolsForRequest(): Anthropic.Tool[] {
  const tools = TOOL_DEFS.map((t) => ({ ...t }));
  const last = tools[tools.length - 1];
  (last as Anthropic.Tool & { cache_control?: { type: 'ephemeral' } }).cache_control = {
    type: 'ephemeral',
  };
  return tools;
}

// Tools whose success should prompt the client to refresh consumption-affecting
// surfaces (rails, library, playlists). Used by the SSE adapter to flag
// `invalidatesBoard` for backwards compat with the existing client.
export const STATE_MUTATION_TOOLS: ReadonlySet<ToolName> = new Set([
  'create_playlist',
  'add_to_playlist',
  'remove_from_playlist',
  'reorder_playlist',
  'triage_inbox',
  'mute_cluster_today',
  'resurface',
  'propose_import',
]);

// --- Per-tool Zod input schemas ------------------------------------------

const SearchPoolInput = z
  .object({
    query: z.string().optional(),
    cluster_id: z.number().int().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const RankByThemeInput = z
  .object({
    theme: z.string().min(1),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

const GetVideoDetailInput = z
  .object({ video_id: z.string().min(1) })
  .strict();

const GetTasteClustersInput = z.object({}).strict();

const CreatePlaylistInput = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

const AddToPlaylistInput = z
  .object({
    playlist_id: z.number().int(),
    video_id: z.string().min(1),
  })
  .strict();

const RemoveFromPlaylistInput = AddToPlaylistInput;

const ReorderPlaylistInput = z
  .object({
    playlist_id: z.number().int(),
    video_id: z.string().min(1),
    position: z.number().int().min(1),
  })
  .strict();

const TriageInboxInput = z
  .object({
    video_id: z.string().min(1),
    action: z.enum(['save', 'archive', 'dismiss']),
  })
  .strict();

const MuteClusterTodayInput = z
  .object({ cluster_id: z.number().int() })
  .strict();

const ResurfaceInput = z.object({ video_id: z.string().min(1) }).strict();

const SearchYoutubeInput = z
  .object({
    query: z.string().min(1),
    channel_id: z.string().optional(),
    max_results: z.number().int().min(1).max(25).optional(),
  })
  .strict();

const ProposeImportInput = z
  .object({
    kind: z.enum(['video', 'channel']),
    target_id: z.string().min(1),
    title: z.string().optional(),
    channel_name: z.string().optional(),
    source_kind: z.enum([
      'description_link',
      'description_handle',
      'transcript_link',
    ]),
  })
  .strict();

const TOOL_INPUT_SCHEMAS: Record<ToolName, z.ZodType<unknown>> = {
  search_pool: SearchPoolInput,
  rank_by_theme: RankByThemeInput,
  get_video_detail: GetVideoDetailInput,
  get_taste_clusters: GetTasteClustersInput,
  create_playlist: CreatePlaylistInput,
  add_to_playlist: AddToPlaylistInput,
  remove_from_playlist: RemoveFromPlaylistInput,
  reorder_playlist: ReorderPlaylistInput,
  triage_inbox: TriageInboxInput,
  mute_cluster_today: MuteClusterTodayInput,
  resurface: ResurfaceInput,
  search_youtube: SearchYoutubeInput,
  propose_import: ProposeImportInput,
};

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

function execSearchPool(args: z.infer<typeof SearchPoolInput>): ToolResult {
  const db = getDb();
  const limit = args.limit ?? 20;
  const q = args.query?.trim();
  const clusterId = args.cluster_id;

  const params: unknown[] = [];
  const where: string[] = [`c.status IN ('inbox','saved','in_progress')`];

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

  return ok({
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
  });
}

// --- rank_by_theme --------------------------------------------------------

interface EmbRow {
  video_id: string;
  vec: Buffer;
  title: string;
  channel_name: string;
  duration_seconds: number | null;
}

async function execRankByTheme(
  args: z.infer<typeof RankByThemeInput>,
): Promise<ToolResult> {
  const theme = args.theme.trim();
  if (!theme) return err('validation', 'theme must be non-empty');
  const limit = args.limit ?? 10;

  const db = getDb();
  const cfg = getActiveEmbeddingConfig();

  const sample = db
    .prepare(
      `SELECT COUNT(*) AS n FROM video_embeddings
        WHERE provider = ? AND model = ?`,
    )
    .get(cfg.provider, cfg.model) as { n: number };
  if (sample.n === 0) {
    return err('precondition_failed', 'no_embedded_corpus', {
      provider: cfg.provider,
      model: cfg.model,
    });
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

  return ok({ theme, count: scored.length, results: scored });
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

function execGetVideoDetail(
  args: z.infer<typeof GetVideoDetailInput>,
): ToolResult {
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
    return err('not_found', `no video ${args.video_id}`);
  }
  const transcript = row.transcript_text
    ? row.transcript_text.slice(0, 500)
    : null;
  return ok({
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
  });
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
  return ok({ count: clusters.length, clusters });
}

// --- playlist tools -------------------------------------------------------

function execCreatePlaylist(
  args: z.infer<typeof CreatePlaylistInput>,
): ToolResult {
  const playlist = createPlaylist({
    name: args.name,
    description: args.description ?? null,
  });
  return ok({ playlist_id: playlist.id, name: playlist.name });
}

function execAddToPlaylist(
  args: z.infer<typeof AddToPlaylistInput>,
): ToolResult {
  const result = addToPlaylist(args.playlist_id, args.video_id);
  return ok({
    playlist_id: args.playlist_id,
    video_id: args.video_id,
    position: result.position,
  });
}

function execRemoveFromPlaylist(
  args: z.infer<typeof RemoveFromPlaylistInput>,
): ToolResult {
  removeFromPlaylist(args.playlist_id, args.video_id);
  return ok({ playlist_id: args.playlist_id, video_id: args.video_id });
}

function execReorderPlaylist(
  args: z.infer<typeof ReorderPlaylistInput>,
): ToolResult {
  const result = reorderPlaylist(args.playlist_id, args.video_id, args.position);
  return ok({
    playlist_id: args.playlist_id,
    video_id: args.video_id,
    position: result.position,
  });
}

// --- triage_inbox / resurface ---------------------------------------------

const TRIAGE_NEXT: Record<string, 'saved' | 'archived' | 'dismissed'> = {
  save: 'saved',
  archive: 'archived',
  dismiss: 'dismissed',
};

function execTriageInbox(
  args: z.infer<typeof TriageInboxInput>,
): ToolResult {
  const next = TRIAGE_NEXT[args.action];
  setConsumptionStatus(args.video_id, next);
  return ok({ video_id: args.video_id, status: next });
}

function execResurface(args: z.infer<typeof ResurfaceInput>): ToolResult {
  setConsumptionStatus(args.video_id, 'saved');
  return ok({ video_id: args.video_id, status: 'saved' });
}

// --- mute_cluster_today ---------------------------------------------------

function execMuteClusterToday(
  args: z.infer<typeof MuteClusterTodayInput>,
): ToolResult {
  const result = setMuteToday(args.cluster_id);
  return ok({ cluster_id: args.cluster_id, muted: result.muted });
}

// --- search_youtube / propose_import --------------------------------------

async function execSearchYoutube(
  args: z.infer<typeof SearchYoutubeInput>,
): Promise<ToolResult> {
  try {
    const results = await searchYoutube({
      query: args.query,
      channelId: args.channel_id,
      maxResults: args.max_results,
    });
    return ok({ count: results.length, results });
  } catch (e) {
    if (e instanceof YouTubeApiKeyMissingError) {
      return err(
        'precondition_failed',
        'YOUTUBE_API_KEY not set. See RUNBOOK "Discovery (active)" for setup.',
        { code: 'youtube_api_key_missing' },
      );
    }
    throw e;
  }
}

function execProposeImport(
  args: z.infer<typeof ProposeImportInput>,
): ToolResult {
  if (isAlreadyKnown(args.target_id, args.kind)) {
    return ok({ proposed: false, reason: 'already_known' });
  }
  const result = proposeCandidate({
    kind: args.kind,
    targetId: args.target_id,
    sourceVideoId: null,
    sourceKind: args.source_kind,
    score: 0,
    breakdown: { source: 'active_search' },
    title: args.title ?? null,
    channelName: args.channel_name ?? null,
  });
  if (!result.inserted) {
    return ok({ proposed: false, reason: 'already_known' });
  }
  return ok({ proposed: true, candidate_id: result.id });
}

// --- dispatcher -----------------------------------------------------------

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

async function dispatch(
  name: ToolName,
  args: unknown,
): Promise<ToolResult> {
  switch (name) {
    case 'search_pool':
      return execSearchPool(args as z.infer<typeof SearchPoolInput>);
    case 'rank_by_theme':
      return await execRankByTheme(args as z.infer<typeof RankByThemeInput>);
    case 'get_video_detail':
      return execGetVideoDetail(args as z.infer<typeof GetVideoDetailInput>);
    case 'get_taste_clusters':
      return execGetTasteClusters();
    case 'create_playlist':
      return execCreatePlaylist(args as z.infer<typeof CreatePlaylistInput>);
    case 'add_to_playlist':
      return execAddToPlaylist(args as z.infer<typeof AddToPlaylistInput>);
    case 'remove_from_playlist':
      return execRemoveFromPlaylist(
        args as z.infer<typeof RemoveFromPlaylistInput>,
      );
    case 'reorder_playlist':
      return execReorderPlaylist(args as z.infer<typeof ReorderPlaylistInput>);
    case 'triage_inbox':
      return execTriageInbox(args as z.infer<typeof TriageInboxInput>);
    case 'mute_cluster_today':
      return execMuteClusterToday(
        args as z.infer<typeof MuteClusterTodayInput>,
      );
    case 'resurface':
      return execResurface(args as z.infer<typeof ResurfaceInput>);
    case 'search_youtube':
      return await execSearchYoutube(
        args as z.infer<typeof SearchYoutubeInput>,
      );
    case 'propose_import':
      return execProposeImport(args as z.infer<typeof ProposeImportInput>);
  }
}

export async function executeTool(
  name: string,
  rawInput: unknown,
): Promise<ToolResult> {
  if (!isToolName(name)) {
    return err('not_found', `unknown tool: ${name}`);
  }
  const schema = TOOL_INPUT_SCHEMAS[name];
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return fromZodError(parsed.error);
  }
  try {
    return await dispatch(name, parsed.data);
  } catch (e) {
    return mapToolError(e);
  }
}
