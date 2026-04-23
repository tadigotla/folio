import type { NextRequest } from 'next/server';
import { hasApiKey } from '../../../../lib/agent/client';
import { runAgentTurn, type AgentEvent } from '../../../../lib/agent/run';

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

  const { content } = (body ?? {}) as { content?: unknown };
  if (typeof content !== 'string' || content.trim().length === 0) {
    return jsonErr('invalid_payload', 400);
  }

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
        await runAgentTurn({ userContent: content, onEvent: send });
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
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
