import type { NextRequest } from 'next/server';
import {
  addToPlaylist,
  DuplicateVideoInPlaylistError,
  InvalidPositionError,
  PlaylistNotFoundError,
  VideoNotFoundError,
} from '../../../../../lib/playlists';

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) {
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

  const { video_id, position } = (body ?? {}) as {
    video_id?: unknown;
    position?: unknown;
  };

  if (typeof video_id !== 'string' || !video_id) {
    return Response.json(
      { error: 'video_id is required', code: 'invalid_payload' },
      { status: 400 },
    );
  }

  let pos: number | undefined;
  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      return Response.json(
        { error: 'invalid position', code: 'invalid_position' },
        { status: 422 },
      );
    }
    pos = position;
  }

  try {
    const result = addToPlaylist(id, video_id, { position: pos });
    return Response.json(result, { status: 201 });
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
    if (err instanceof DuplicateVideoInPlaylistError) {
      return Response.json(
        { error: err.message, code: 'duplicate_video' },
        { status: 409 },
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
