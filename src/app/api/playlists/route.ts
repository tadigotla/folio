import type { NextRequest } from 'next/server';
import { createPlaylist, listPlaylists } from '../../../lib/playlists';

export async function GET() {
  return Response.json({ playlists: listPlaylists() });
}

export async function POST(request: NextRequest) {
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

  if (typeof name !== 'string' || !name.trim()) {
    return Response.json(
      { error: 'name is required', code: 'invalid_name' },
      { status: 422 },
    );
  }

  const playlist = createPlaylist({
    name,
    description: typeof description === 'string' ? description : null,
    show_on_home:
      show_on_home === true || show_on_home === 1 ? 1 : 0,
  });
  return Response.json({ playlist }, { status: 201 });
}
