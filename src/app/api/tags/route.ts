import type { NextRequest } from 'next/server';
import {
  createTag,
  deleteTag,
  DuplicateTagError,
  renameTag,
} from '../../../lib/tags';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { op } = (body ?? {}) as { op?: string };

  try {
    if (op === 'create') {
      const { name } = body as { name?: unknown };
      if (typeof name !== 'string' || !name.trim()) {
        return Response.json({ error: 'name is required' }, { status: 400 });
      }
      const tag = createTag(name);
      return Response.json(tag, { status: 201 });
    }

    if (op === 'rename') {
      const { id, newName } = body as { id?: unknown; newName?: unknown };
      if (typeof id !== 'number' || typeof newName !== 'string') {
        return Response.json(
          { error: 'id (number) and newName (string) required' },
          { status: 400 },
        );
      }
      const updated = renameTag(id, newName);
      if (!updated) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json(updated);
    }

    if (op === 'delete') {
      const { id } = body as { id?: unknown };
      if (typeof id !== 'number') {
        return Response.json({ error: 'id (number) required' }, { status: 400 });
      }
      deleteTag(id);
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: `unknown op: ${op}` }, { status: 400 });
  } catch (err) {
    if (err instanceof DuplicateTagError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
