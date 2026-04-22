import {
  IllegalEditError,
  ConcurrentEditError,
} from '../../../lib/taste-edit';

export function parseClusterId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function mapEditError(err: unknown): Response | null {
  if (err instanceof IllegalEditError) {
    return Response.json({ error: err.message }, { status: 422 });
  }
  if (err instanceof ConcurrentEditError) {
    return Response.json({ error: err.message }, { status: 409 });
  }
  return null;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
