import type { NextRequest } from 'next/server';
import { retireCluster } from '../../../../../../lib/taste-edit';
import {
  mapEditError,
  parseClusterId,
  readJson,
} from '../../../_helpers';

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseClusterId(raw);
  if (id == null) {
    return Response.json({ error: 'invalid cluster id' }, { status: 400 });
  }

  const body = (await readJson(request)) as
    | { expectedUpdatedAt?: unknown }
    | undefined;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const { expectedUpdatedAt } = body;
  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) {
    return Response.json(
      { error: 'expectedUpdatedAt is required' },
      { status: 400 },
    );
  }

  try {
    retireCluster(id, { expectedUpdatedAt });
    return new Response(null, { status: 204 });
  } catch (err) {
    const mapped = mapEditError(err);
    if (mapped) return mapped;
    throw err;
  }
}
