import type { NextRequest } from 'next/server';
import { reassignVideo } from '../../../../../lib/taste-edit';
import { mapEditError, readJson } from '../../_helpers';

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await ctx.params;
  if (!videoId || typeof videoId !== 'string') {
    return Response.json({ error: 'invalid videoId' }, { status: 400 });
  }

  const body = (await readJson(request)) as
    | { clusterId?: unknown }
    | undefined;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const { clusterId } = body;
  if (
    typeof clusterId !== 'number' ||
    !Number.isInteger(clusterId) ||
    clusterId <= 0
  ) {
    return Response.json(
      { error: 'clusterId must be a positive integer' },
      { status: 400 },
    );
  }

  try {
    reassignVideo(videoId, clusterId);
    return new Response(null, { status: 204 });
  } catch (err) {
    const mapped = mapEditError(err);
    if (mapped) return mapped;
    throw err;
  }
}
