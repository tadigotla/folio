import type { NextRequest } from 'next/server';
import {
  IllegalTransitionError,
  setConsumptionStatus,
} from '../../../lib/consumption';
import type { ConsumptionStatus } from '../../../lib/types';

const VALID_STATUSES: ConsumptionStatus[] = [
  'inbox',
  'saved',
  'in_progress',
  'archived',
  'dismissed',
];

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { videoId, next } = (body ?? {}) as { videoId?: unknown; next?: unknown };

  if (typeof videoId !== 'string' || !videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }

  if (typeof next !== 'string' || !VALID_STATUSES.includes(next as ConsumptionStatus)) {
    return Response.json({ error: 'invalid next status' }, { status: 400 });
  }

  try {
    setConsumptionStatus(videoId, next as ConsumptionStatus);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
