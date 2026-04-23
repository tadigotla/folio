import { getDb } from './db';
import { todayLocal } from './time';
import type { ConsumptionStatus, Video } from './types';

export const HOME_RANKING_HALF_LIFE_DAYS = 14;
export const FUZZY_PENALTY = 0.7;
export const UNKNOWN_CLUSTER_WEIGHT = 0.5;
export const UNKNOWN_FRESHNESS = 0.5;

const STATE_BOOST: Record<'inbox' | 'saved' | 'in_progress', number> = {
  inbox: 1.0,
  saved: 1.3,
  in_progress: 1.5,
};

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 2;
const MS_PER_DAY = 86_400_000;

export interface RankedCandidate {
  videoId: string;
  score: number;
  video: Video & { channel_name: string | null };
  status: Extract<ConsumptionStatus, 'inbox' | 'saved' | 'in_progress'>;
  lastPositionSeconds: number | null;
  clusterId: number | null;
  clusterLabel: string | null;
  clusterWeight: number;
  freshness: number;
  stateBoost: number;
  fuzzyPenalty: number;
}

interface Row {
  id: string;
  title: string;
  description: string | null;
  channel_id: string;
  duration_seconds: number | null;
  published_at: string | null;
  thumbnail_url: string | null;
  source_url: string;
  is_live_now: number;
  scheduled_start: string | null;
  discovered_at: string;
  last_checked_at: string;
  updated_at: string;
  first_seen_at: string;
  raw: string | null;
  channel_name: string | null;
  status: 'inbox' | 'saved' | 'in_progress';
  last_position_seconds: number | null;
  cluster_id: number | null;
  cluster_label: string | null;
  cluster_weight: number | null;
  cluster_retired_at: string | null;
  is_fuzzy: number | null;
  is_muted_today: number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function computeClusterWeight(row: {
  cluster_id: number | null;
  cluster_weight: number | null;
  cluster_retired_at: string | null;
  is_muted_today: number;
}): number {
  if (row.is_muted_today === 1) return 0;
  if (row.cluster_id == null) return UNKNOWN_CLUSTER_WEIGHT;
  if (row.cluster_retired_at !== null) return UNKNOWN_CLUSTER_WEIGHT;
  const raw = row.cluster_weight ?? UNKNOWN_CLUSTER_WEIGHT;
  return clamp(raw, WEIGHT_MIN, WEIGHT_MAX);
}

export function computeFreshness(
  publishedAt: string | null,
  now: Date,
): number {
  if (!publishedAt) return UNKNOWN_FRESHNESS;
  const ts = Date.parse(publishedAt);
  if (!Number.isFinite(ts)) return UNKNOWN_FRESHNESS;
  const ageDays = Math.max(0, (now.getTime() - ts) / MS_PER_DAY);
  return Math.exp(-ageDays / HOME_RANKING_HALF_LIFE_DAYS);
}

export function computeStateBoost(
  status: 'inbox' | 'saved' | 'in_progress',
): number {
  return STATE_BOOST[status];
}

export function computeFuzzyPenalty(isFuzzy: number | null): number {
  return isFuzzy === 1 ? FUZZY_PENALTY : 1.0;
}

export interface RankForHomeOptions {
  limit?: number;
  now?: Date;
}

const DEFAULT_LIMIT = 20;

export function rankForHome(
  opts: RankForHomeOptions = {},
): RankedCandidate[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const now = opts.now ?? new Date();
  const today = todayLocal(now);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.id, v.title, v.description, v.channel_id, v.duration_seconds,
              v.published_at, v.thumbnail_url, v.source_url, v.is_live_now,
              v.scheduled_start, v.discovered_at, v.last_checked_at,
              v.updated_at, v.first_seen_at, v.raw,
              ch.name AS channel_name,
              cons.status AS status,
              cons.last_position_seconds AS last_position_seconds,
              a.cluster_id AS cluster_id,
              a.is_fuzzy AS is_fuzzy,
              tc.label AS cluster_label,
              tc.weight AS cluster_weight,
              tc.retired_at AS cluster_retired_at,
              CASE WHEN m.cluster_id IS NOT NULL THEN 1 ELSE 0 END AS is_muted_today
         FROM consumption cons
         JOIN videos v ON v.id = cons.video_id
         LEFT JOIN channels ch ON ch.id = v.channel_id
         LEFT JOIN video_cluster_assignments a ON a.video_id = v.id
         LEFT JOIN taste_clusters tc ON tc.id = a.cluster_id
         LEFT JOIN taste_cluster_mutes m
                ON m.cluster_id = a.cluster_id
               AND m.muted_on = ?
        WHERE cons.status IN ('inbox', 'saved', 'in_progress')`,
    )
    .all(today) as Row[];

  const ranked: RankedCandidate[] = rows.map((r) => {
    const clusterWeight = computeClusterWeight(r);
    const freshness = computeFreshness(r.published_at, now);
    const stateBoost = computeStateBoost(r.status);
    const fuzzyPenalty = computeFuzzyPenalty(r.is_fuzzy);
    const score = clusterWeight * freshness * stateBoost * fuzzyPenalty;
    const video: Video & { channel_name: string | null } = {
      id: r.id,
      title: r.title,
      description: r.description,
      channel_id: r.channel_id,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      thumbnail_url: r.thumbnail_url,
      source_url: r.source_url,
      is_live_now: r.is_live_now,
      scheduled_start: r.scheduled_start,
      discovered_at: r.discovered_at,
      last_checked_at: r.last_checked_at,
      updated_at: r.updated_at,
      first_seen_at: r.first_seen_at,
      raw: r.raw,
      channel_name: r.channel_name,
    };
    return {
      videoId: r.id,
      score,
      video,
      status: r.status,
      lastPositionSeconds: r.last_position_seconds,
      clusterId: r.cluster_id,
      clusterLabel: r.cluster_label,
      clusterWeight,
      freshness,
      stateBoost,
      fuzzyPenalty,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0;
  });

  return ranked.slice(0, limit);
}
