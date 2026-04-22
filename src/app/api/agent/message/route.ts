import type { NextRequest } from 'next/server';
import { hasApiKey } from '../../../../lib/agent/client';
import {
  runAgentTurn,
  ConversationFrozenError,
  IssueMissingError,
  type AgentEvent,
} from '../../../../lib/agent/run';
import { getIssueById } from '../../../../lib/issues';

export const dynamic = 'force-dynamic';

function jsonErr(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  if (!hasApiKey()) return jsonErr('api_key_missing', 412);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonErr('invalid_payload', 400);
  }

  const { issueId, content } = (body ?? {}) as {
    issueId?: unknown;
    content?: unknown;
  };
  if (typeof issueId !== 'number' || !Number.isInteger(issueId) || issueId <= 0) {
    return jsonErr('invalid_payload', 400);
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return jsonErr('invalid_payload', 400);
  }

  // Pre-check the issue exists and is not published. Doing this before we
  // start the SSE stream lets us respond with the right HTTP status code
  // (404/409) rather than swallowing the case into an error frame.
  const issue = getIssueById(issueId);
  if (!issue) return jsonErr('issue_not_found', 404);
  if (issue.status === 'published') return jsonErr('conversation_frozen', 409);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: AgentEvent) {
        const name = event.type;
        const data = JSON.stringify(event);
        controller.enqueue(
          encoder.encode(`event: ${name}\ndata: ${data}\n\n`),
        );
      }

      try {
        await runAgentTurn({
          issueId,
          userContent: content,
          onEvent: send,
        });
      } catch (err) {
        if (err instanceof ConversationFrozenError) {
          send({ type: 'error', message: 'conversation_frozen' });
        } else if (err instanceof IssueMissingError) {
          send({ type: 'error', message: 'issue_not_found' });
        } else {
          send({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        send({ type: 'done', messageId: null });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
