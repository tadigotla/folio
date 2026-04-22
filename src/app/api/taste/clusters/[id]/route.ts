import type { NextRequest } from 'next/server';
import { setClusterFields } from '../../../../../lib/taste-edit';
import {
  mapEditError,
  parseClusterId,
  readJson,
} from '../../_helpers';

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
    | {
        label?: unknown;
        weight?: unknown;
        expectedUpdatedAt?: unknown;
      }
    | undefined;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const { label, weight, expectedUpdatedAt } = body;
  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) {
    return Response.json(
      { error: 'expectedUpdatedAt is required' },
      { status: 400 },
    );
  }

  const labelProvided = Object.prototype.hasOwnProperty.call(body, 'label');
  const weightProvided = Object.prototype.hasOwnProperty.call(body, 'weight');
  if (!labelProvided && !weightProvided) {
    return Response.json(
      { error: 'label or weight is required' },
      { status: 400 },
    );
  }
  if (labelProvided && label !== null && typeof label !== 'string') {
    return Response.json({ error: 'label must be string or null' }, { status: 400 });
  }
  if (weightProvided && (typeof weight !== 'number' || !Number.isFinite(weight))) {
    return Response.json({ error: 'weight must be a finite number' }, { status: 400 });
  }

  const fields: { label?: string | null; weight?: number } = {};
  if (labelProvided) fields.label = label as string | null;
  if (weightProvided) fields.weight = weight as number;

  try {
    const updatedAt = setClusterFields(id, fields, { expectedUpdatedAt });
    return Response.json({ updatedAt }, { status: 200 });
  } catch (err) {
    const mapped = mapEditError(err);
    if (mapped) return mapped;
    throw err;
  }
}
