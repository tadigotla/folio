import type { NextRequest } from 'next/server';
import { setChannelTags } from '../../../../lib/tags';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { channelId, tagIds } = (body ?? {}) as {
    channelId?: unknown;
    tagIds?: unknown;
  };

  if (typeof channelId !== 'string' || !channelId) {
    return Response.json({ error: 'channelId required' }, { status: 400 });
  }
  if (!Array.isArray(tagIds) || tagIds.some((v) => typeof v !== 'number')) {
    return Response.json(
      { error: 'tagIds must be number[]' },
      { status: 400 },
    );
  }

  try {
    const ok = setChannelTags(channelId, tagIds as number[]);
    if (!ok) return Response.json({ error: 'channel not found' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error';
    return Response.json({ error: message }, { status: 400 });
  }
}
