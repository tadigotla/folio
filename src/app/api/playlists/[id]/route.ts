import type { NextRequest } from 'next/server';
import {
  deletePlaylist,
  getPlaylist,
  PlaylistNotFoundError,
  renamePlaylist,
} from '../../../../lib/playlists';

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(
  _request: NextRequest,
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
  const detail = getPlaylist(id);
  if (!detail) {
    return Response.json(
      { error: 'playlist not found', code: 'playlist_not_found' },
      { status: 404 },
    );
  }
  return Response.json(detail);
}

export async function PATCH(
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

  const { name, description, show_on_home } = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
    show_on_home?: unknown;
  };

  const patch: {
    name?: string;
    description?: string | null;
    show_on_home?: number;
  } = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return Response.json(
        { error: 'name is required', code: 'invalid_name' },
        { status: 422 },
      );
    }
    patch.name = name;
  }
  if (description !== undefined) {
    if (description !== null && typeof description !== 'string') {
      return Response.json(
        { error: 'invalid description', code: 'invalid_payload' },
        { status: 400 },
      );
    }
    patch.description = description as string | null;
  }
  if (show_on_home !== undefined) {
    patch.show_on_home =
      show_on_home === true || show_on_home === 1 ? 1 : 0;
  }

  try {
    const playlist = renamePlaylist(id, patch);
    return Response.json({ playlist });
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

export async function DELETE(
  _request: NextRequest,
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
  try {
    deletePlaylist(id);
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
