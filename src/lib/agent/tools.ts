import type Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';
import { getClusterSummaries } from '../taste-read';
import {
  bufferToFloats,
  embed,
  getActiveEmbeddingConfig,
} from '../embeddings';
import { cosineSim, normalize } from '../taste';
import {
  setConsumptionStatus,
  IllegalTransitionError,
} from '../consumption';
import {
  createPlaylist,
  addToPlaylist,
  removeFromPlaylist,
  reorderPlaylist,
  PlaylistNotFoundError,
  VideoNotFoundError,
  DuplicateVideoInPlaylistError,
  InvalidPositionError,
} from '../playlists';
import { setMuteToday, ClusterNotFoundError } from '../mutes';
import { searchYoutube } from '../discovery/search';
import { YouTubeApiKeyMissingError } from '../youtube-api';
import { proposeCandidate, isAlreadyKnown } from '../discovery/candidates';

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

export type ToolResult =
  | { ok: true; data: unknown; summary?: string }
  | { ok: false; error: string; summary?: string };

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

// --- playlist tools -------------------------------------------------------

function mapPlaylistErr(err: unknown): ToolResult {
  if (err instanceof PlaylistNotFoundError) {
    return { ok: false, error: 'playlist_not_found' };
  }
  if (err instanceof VideoNotFoundError) {
    return { ok: false, error: 'video_not_found' };
  }
  if (err instanceof DuplicateVideoInPlaylistError) {
    return { ok: false, error: 'duplicate_video' };
  }
  if (err instanceof InvalidPositionError) {
    return { ok: false, error: 'invalid_position' };
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function execCreatePlaylist(args: {
  name: string;
  description?: string;
}): ToolResult {
  try {
    const playlist = createPlaylist({
      name: args.name,
      description: args.description ?? null,
    });
    return {
      ok: true,
      data: { playlist_id: playlist.id, name: playlist.name },
      summary: `created playlist #${playlist.id} "${playlist.name}"`,
    };
  } catch (err) {
    return mapPlaylistErr(err);
  }
}

function execAddToPlaylist(args: {
  playlist_id: number;
  video_id: string;
}): ToolResult {
  try {
    const result = addToPlaylist(args.playlist_id, args.video_id);
    return {
      ok: true,
      data: { playlist_id: args.playlist_id, video_id: args.video_id, position: result.position },
      summary: `added ${args.video_id} → playlist #${args.playlist_id} at position ${result.position}`,
    };
  } catch (err) {
    return mapPlaylistErr(err);
  }
}

function execRemoveFromPlaylist(args: {
  playlist_id: number;
  video_id: string;
}): ToolResult {
  try {
    removeFromPlaylist(args.playlist_id, args.video_id);
    return {
      ok: true,
      data: { playlist_id: args.playlist_id, video_id: args.video_id },
      summary: `removed ${args.video_id} from playlist #${args.playlist_id}`,
    };
  } catch (err) {
    return mapPlaylistErr(err);
  }
}

function execReorderPlaylist(args: {
  playlist_id: number;
  video_id: string;
  position: number;
}): ToolResult {
  try {
    const result = reorderPlaylist(args.playlist_id, args.video_id, args.position);
    return {
      ok: true,
      data: { playlist_id: args.playlist_id, video_id: args.video_id, position: result.position },
      summary: `moved ${args.video_id} → position ${result.position} in playlist #${args.playlist_id}`,
    };
  } catch (err) {
    return mapPlaylistErr(err);
  }
}

// --- triage_inbox / resurface ---------------------------------------------

const TRIAGE_NEXT: Record<string, 'saved' | 'archived' | 'dismissed'> = {
  save: 'saved',
  archive: 'archived',
  dismiss: 'dismissed',
};

function execTriageInbox(args: {
  video_id: string;
  action: 'save' | 'archive' | 'dismiss';
}): ToolResult {
  const next = TRIAGE_NEXT[args.action];
  if (!next) return { ok: false, error: 'invalid_action' };
  try {
    setConsumptionStatus(args.video_id, next);
    return {
      ok: true,
      data: { video_id: args.video_id, status: next },
      summary: `${args.action}d ${args.video_id}`,
    };
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return { ok: false, error: 'illegal_transition', summary: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function execResurface(args: { video_id: string }): ToolResult {
  try {
    setConsumptionStatus(args.video_id, 'saved');
    return {
      ok: true,
      data: { video_id: args.video_id, status: 'saved' },
      summary: `resurfaced ${args.video_id} → saved`,
    };
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return { ok: false, error: 'illegal_transition', summary: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- mute_cluster_today ---------------------------------------------------

function execMuteClusterToday(args: { cluster_id: number }): ToolResult {
  try {
    const result = setMuteToday(args.cluster_id);
    return {
      ok: true,
      data: { cluster_id: args.cluster_id, muted: result.muted },
      summary: result.muted
        ? `muted cluster #${args.cluster_id} for today`
        : `un-muted cluster #${args.cluster_id} for today`,
    };
  } catch (err) {
    if (err instanceof ClusterNotFoundError) {
      return { ok: false, error: 'cluster_not_found' };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- search_youtube / propose_import --------------------------------------

async function execSearchYoutube(args: {
  query?: string;
  channel_id?: string;
  max_results?: number;
}): Promise<ToolResult> {
  const query = args.query?.trim();
  if (!query) return { ok: false, error: 'query is required' };
  try {
    const results = await searchYoutube({
      query,
      channelId: args.channel_id,
      maxResults: args.max_results,
    });
    return {
      ok: true,
      data: { count: results.length, results },
      summary: `search_youtube returned ${results.length} item${
        results.length === 1 ? '' : 's'
      }`,
    };
  } catch (err) {
    if (err instanceof YouTubeApiKeyMissingError) {
      return {
        ok: false,
        error:
          'youtube_api_key_missing: YOUTUBE_API_KEY not set. See RUNBOOK "Discovery (active)" for setup.',
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function execProposeImport(args: {
  kind?: 'video' | 'channel';
  target_id?: string;
  title?: string;
  channel_name?: string;
  source_kind?:
    | 'description_link'
    | 'description_handle'
    | 'transcript_link';
}): ToolResult {
  if (!args.kind || (args.kind !== 'video' && args.kind !== 'channel')) {
    return { ok: false, error: 'kind must be "video" or "channel"' };
  }
  const targetId = args.target_id?.trim();
  if (!targetId) return { ok: false, error: 'target_id is required' };
  if (
    !args.source_kind ||
    !['description_link', 'description_handle', 'transcript_link'].includes(
      args.source_kind,
    )
  ) {
    return {
      ok: false,
      error:
        'source_kind must be one of description_link | description_handle | transcript_link',
    };
  }
  try {
    if (isAlreadyKnown(targetId, args.kind)) {
      return {
        ok: true,
        data: { proposed: false, reason: 'already_known' },
        summary: `propose_import: ${targetId} is already known (in corpus, proposed, or rejected)`,
      };
    }
    const result = proposeCandidate({
      kind: args.kind,
      targetId,
      sourceVideoId: null,
      sourceKind: args.source_kind,
      score: 0,
      breakdown: { source: 'active_search' },
      title: args.title ?? null,
      channelName: args.channel_name ?? null,
    });
    if (!result.inserted) {
      return {
        ok: true,
        data: { proposed: false, reason: 'already_known' },
        summary: `propose_import: ${targetId} already proposed`,
      };
    }
    return {
      ok: true,
      data: { proposed: true, candidate_id: result.id },
      summary: `propose_import: staged candidate #${result.id} (${args.kind} ${targetId})`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- dispatcher -----------------------------------------------------------

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'search_pool':
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
      case 'create_playlist':
        return execCreatePlaylist(
          args as Parameters<typeof execCreatePlaylist>[0],
        );
      case 'add_to_playlist':
        return execAddToPlaylist(
          args as Parameters<typeof execAddToPlaylist>[0],
        );
      case 'remove_from_playlist':
        return execRemoveFromPlaylist(
          args as Parameters<typeof execRemoveFromPlaylist>[0],
        );
      case 'reorder_playlist':
        return execReorderPlaylist(
          args as Parameters<typeof execReorderPlaylist>[0],
        );
      case 'triage_inbox':
        return execTriageInbox(
          args as Parameters<typeof execTriageInbox>[0],
        );
      case 'mute_cluster_today':
        return execMuteClusterToday(
          args as Parameters<typeof execMuteClusterToday>[0],
        );
      case 'resurface':
        return execResurface(
          args as Parameters<typeof execResurface>[0],
        );
      case 'search_youtube':
        return await execSearchYoutube(
          args as Parameters<typeof execSearchYoutube>[0],
        );
      case 'propose_import':
        return execProposeImport(
          args as Parameters<typeof execProposeImport>[0],
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
