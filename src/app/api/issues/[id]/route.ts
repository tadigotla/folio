import type { NextRequest } from 'next/server';
import {
  discardDraft,
  updateIssueTitle,
  IssueFrozenError,
  IssueNotFoundError,
} from '../../../../lib/issues';

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  try {
    discardDraft(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof IssueNotFoundError) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof IssueFrozenError) {
      return Response.json({ error: 'issue_frozen' }, { status: 409 });
    }
    throw err;
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const { title } = (body ?? {}) as { title?: unknown };
  if (title !== null && typeof title !== 'string') {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  try {
    const issue = updateIssueTitle(id, title ?? null);
    return Response.json(issue, { status: 200 });
  } catch (err) {
    if (err instanceof IssueNotFoundError) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof IssueFrozenError) {
      return Response.json({ error: 'issue_frozen' }, { status: 409 });
    }
    throw err;
  }
}
