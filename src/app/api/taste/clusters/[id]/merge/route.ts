import type { NextRequest } from 'next/server';
import { mergeClusters } from '../../../../../../lib/taste-edit';
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
  const sourceId = parseClusterId(raw);
  if (sourceId == null) {
    return Response.json({ error: 'invalid cluster id' }, { status: 400 });
  }

  const body = (await readJson(request)) as
    | { into?: unknown; expectedUpdatedAt?: unknown }
    | undefined;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const { into, expectedUpdatedAt } = body;
  if (typeof into !== 'number' || !Number.isInteger(into) || into <= 0) {
    return Response.json({ error: 'into must be a positive integer' }, { status: 400 });
  }
  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) {
    return Response.json(
      { error: 'expectedUpdatedAt is required' },
      { status: 400 },
    );
  }

  try {
    mergeClusters(sourceId, into, { expectedUpdatedAt });
    return new Response(null, { status: 204 });
  } catch (err) {
    const mapped = mapEditError(err);
    if (mapped) return mapped;
    throw err;
  }
}
