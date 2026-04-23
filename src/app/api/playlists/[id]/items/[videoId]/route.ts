import type { NextRequest } from 'next/server';
import {
  InvalidPositionError,
  PlaylistNotFoundError,
  VideoNotFoundError,
  removeFromPlaylist,
  reorderPlaylist,
} from '../../../../../../lib/playlists';

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; videoId: string }> },
) {
  const { id: raw, videoId } = await ctx.params;
  const id = parseId(raw);
  if (id == null || !videoId) {
    return Response.json(
      { error: 'invalid id', code: 'invalid_payload' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid JSON', code: 'invalid_payload' },
      { status: 400 },
    );
  }

  const { position } = (body ?? {}) as { position?: unknown };
  if (typeof position !== 'number' || !Number.isFinite(position)) {
    return Response.json(
      { error: 'invalid position', code: 'invalid_position' },
      { status: 422 },
    );
  }

  try {
    const result = reorderPlaylist(id, videoId, position);
    return Response.json(result);
  } catch (err) {
    if (err instanceof PlaylistNotFoundError) {
      return Response.json(
        { error: err.message, code: 'playlist_not_found' },
        { status: 404 },
      );
    }
    if (err instanceof VideoNotFoundError) {
      return Response.json(
        { error: err.message, code: 'video_not_found' },
        { status: 404 },
      );
    }
    if (err instanceof InvalidPositionError) {
      return Response.json(
        { error: err.message, code: 'invalid_position' },
        { status: 422 },
      );
    }
    throw err;
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; videoId: string }> },
) {
  const { id: raw, videoId } = await ctx.params;
  const id = parseId(raw);
  if (id == null || !videoId) {
    return Response.json(
      { error: 'invalid id', code: 'invalid_payload' },
      { status: 400 },
    );
  }
  try {
    removeFromPlaylist(id, videoId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof PlaylistNotFoundError) {
      return Response.json(
        { error: err.message, code: 'playlist_not_found' },
        { status: 404 },
      );
    }
    throw err;
  }
}
