import type { NextRequest } from 'next/server';
import { setCoverPin } from '../../../../lib/issue';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { videoId } = (body ?? {}) as { videoId?: unknown };
  if (videoId !== null && typeof videoId !== 'string') {
    return Response.json(
      { error: 'videoId must be string or null' },
      { status: 400 },
    );
  }

  const issue = setCoverPin(videoId as string | null);
  if (!issue) return Response.json({ error: 'no issue exists' }, { status: 404 });
  return new Response(null, { status: 204 });
}
