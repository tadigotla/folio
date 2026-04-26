import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { hasApiKey } from '../../../../lib/agent/client';
import { runAgentTurn, type AgentEvent } from '../../../../lib/agent/run';

export const dynamic = 'force-dynamic';

const MessageBody = z
  .object({
    content: z.string().trim().min(1).max(10000),
  })
  .strict();

interface RouteError {
  code: string;
  message: string;
  details?: unknown;
}

function jsonErr(error: RouteError, status: number): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  if (!hasApiKey()) {
    return jsonErr(
      { code: 'precondition_failed', message: 'api_key_missing' },
      412,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonErr(
      { code: 'validation', message: 'request body is not valid JSON' },
      400,
    );
  }

  const parsed = MessageBody.safeParse(body);
  if (!parsed.success) {
    return jsonErr(
      {
        code: 'validation',
        message: parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; '),
        details: parsed.error.issues,
      },
      400,
    );
  }

  const { content } = parsed.data;
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
      } catch (e) {
        send({
          type: 'error',
          error: {
            code: 'internal',
            message: e instanceof Error ? e.message : String(e),
          },
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
