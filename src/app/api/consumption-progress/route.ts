import type { NextRequest } from 'next/server';
import {
  IllegalTransitionError,
  recordProgress,
  type ProgressAction,
} from '../../../lib/consumption';

const VALID_ACTIONS: ProgressAction[] = ['start', 'tick', 'pause', 'end'];

export async function POST(request: NextRequest) {
  const text = await request.text();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { videoId, action, position } = (body ?? {}) as {
    videoId?: unknown;
    action?: unknown;
    position?: unknown;
  };

  if (typeof videoId !== 'string' || !videoId) {
    return Response.json({ error: 'videoId is required' }, { status: 400 });
  }

  if (typeof action !== 'string' || !VALID_ACTIONS.includes(action as ProgressAction)) {
    return Response.json({ error: 'invalid action' }, { status: 400 });
  }

  let numericPosition: number | undefined;
  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
      return Response.json({ error: 'invalid position' }, { status: 400 });
    }
    numericPosition = position;
  }

  try {
    recordProgress({
      videoId,
      action: action as ProgressAction,
      position: numericPosition,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
