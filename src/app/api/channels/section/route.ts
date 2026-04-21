import type { NextRequest } from 'next/server';
import { assignChannel } from '../../../../lib/sections';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { channelId, sectionId } = (body ?? {}) as {
    channelId?: unknown;
    sectionId?: unknown;
  };

  if (typeof channelId !== 'string' || !channelId) {
    return Response.json({ error: 'channelId required' }, { status: 400 });
  }
  if (sectionId !== null && typeof sectionId !== 'number') {
    return Response.json(
      { error: 'sectionId must be number or null' },
      { status: 400 },
    );
  }

  const ok = assignChannel(channelId, sectionId as number | null);
  if (!ok) return Response.json({ error: 'channel not found' }, { status: 404 });
  return new Response(null, { status: 204 });
}
