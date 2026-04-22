import type { NextRequest } from 'next/server';
import { splitCluster } from '../../../../../../lib/taste-edit';
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
    | { k?: unknown; expectedUpdatedAt?: unknown }
    | undefined;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const { k, expectedUpdatedAt } = body;
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 2) {
    return Response.json({ error: 'k must be an integer >= 2' }, { status: 400 });
  }
  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) {
    return Response.json(
      { error: 'expectedUpdatedAt is required' },
      { status: 400 },
    );
  }

  try {
    const out = splitCluster(id, k, { expectedUpdatedAt });
    return Response.json(out, { status: 200 });
  } catch (err) {
    const mapped = mapEditError(err);
    if (mapped) return mapped;
    throw err;
  }
}
