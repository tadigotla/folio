import type { NextRequest } from 'next/server';
import {
  publishIssue,
  IssueAlreadyPublishedError,
  IssueNotFoundError,
} from '../../../../../lib/issues';

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  try {
    const issue = publishIssue(id);
    return Response.json(
      { id: issue.id, status: issue.status, published_at: issue.published_at },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof IssueNotFoundError) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (err instanceof IssueAlreadyPublishedError) {
      return Response.json({ error: 'already_published' }, { status: 409 });
    }
    throw err;
  }
}
