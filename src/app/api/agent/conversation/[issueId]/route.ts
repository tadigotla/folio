import type { NextRequest } from 'next/server';
import {
  getConversationTurns,
  turnsToRendered,
} from '../../../../../lib/agent/turns';
import { getIssueById } from '../../../../../lib/issues';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ issueId: string }> },
) {
  const { issueId: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) {
    return Response.json({ error: 'invalid_payload' }, { status: 400 });
  }
  const issue = getIssueById(id);
  if (!issue) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const turns = getConversationTurns(id);
  return Response.json({ turns: turnsToRendered(turns) }, { status: 200 });
}
