import type { NextRequest } from 'next/server';
import { rankForHome } from '../../../../lib/home-ranking';

function parseLimit(raw: string | null): number | 'invalid' | undefined {
  if (raw == null) return undefined;
  if (!/^-?\d+$/.test(raw)) return 'invalid';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) return 'invalid';
  return n;
}

function parseDebug(raw: string | null): boolean {
  if (raw == null) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = parseLimit(rawLimit);
  if (limit === 'invalid') {
    return Response.json(
      { error: 'limit must be an integer between 1 and 100' },
      { status: 400 },
    );
  }
  const debug = parseDebug(url.searchParams.get('debug'));

  const ranked = rankForHome(limit === undefined ? {} : { limit });

  if (!debug) {
    return Response.json({
      candidates: ranked.map((c) => ({ videoId: c.videoId, score: c.score })),
    });
  }

  return Response.json({
    candidates: ranked.map((c) => ({
      videoId: c.videoId,
      score: c.score,
      clusterWeight: c.clusterWeight,
      freshness: c.freshness,
      stateBoost: c.stateBoost,
      fuzzyPenalty: c.fuzzyPenalty,
      clusterId: c.clusterId,
      clusterLabel: c.clusterLabel,
    })),
  });
}
