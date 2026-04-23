import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, getAgentModel, getAgentMaxTurns } from './client';
import { buildSystem } from './system-prompt';
import { buildSnapshotBlock } from './snapshot';
import { getToolsForRequest, executeTool, STATE_MUTATION_TOOLS } from './tools';
import {
  appendTurn,
  getConversationTurnsByConversationId,
  getOrCreateConversationForToday,
  turnsToMessages,
} from './turns';
import type { TurnContentBlock } from '../types';

export type AgentEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'tool_call';
      tool_use_id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      name: string;
      ok: boolean;
      summary: string;
      invalidatesBoard: boolean;
    }
  | { type: 'error'; message: string }
  | { type: 'done'; messageId: string | null };

export interface RunAgentTurnOptions {
  userContent: string;
  onEvent: (event: AgentEvent) => void;
}

function blockToContentBlock(
  block: Anthropic.ContentBlock,
): TurnContentBlock | null {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: (block.input ?? {}) as Record<string, unknown>,
    };
  }
  return null;
}

/**
 * Drives the multi-turn tool loop server-side for a single user message.
 * Resolves today's `scope_date` (America/New_York), persists every turn to
 * `conversation_turns`, and yields framing events to the caller via
 * `onEvent`. The only place the Anthropic client is instantiated.
 */
export async function runAgentTurn(opts: RunAgentTurnOptions): Promise<void> {
  const { userContent, onEvent } = opts;

  const anthropic = getAnthropic();
  const conversation = getOrCreateConversationForToday();

  const userBlocks: TurnContentBlock[] = [{ type: 'text', text: userContent }];
  appendTurn(conversation.id, 'user', userBlocks);

  const maxTurns = getAgentMaxTurns();

  for (let iter = 0; iter < maxTurns; iter++) {
    const history = getConversationTurnsByConversationId(conversation.id);
    const messages: Anthropic.MessageParam[] = turnsToMessages(history).map(
      (m) => ({
        role: m.role,
        content: m.content as Anthropic.MessageParam['content'],
      }),
    );

    const snapshotBlock = buildSnapshotBlock();
    const augmented: Anthropic.MessageParam[] = [
      { role: 'user', content: [snapshotBlock] },
      ...messages,
    ];

    const stream = anthropic.messages.stream({
      model: getAgentModel(),
      max_tokens: 2048,
      system: buildSystem(),
      tools: getToolsForRequest(),
      messages: augmented,
    });

    stream.on('text', (delta) => {
      onEvent({ type: 'delta', text: delta });
    });

    let finalMessage: Anthropic.Message;
    try {
      finalMessage = await stream.finalMessage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'error', message: msg });
      return;
    }

    const assistantBlocks = finalMessage.content
      .map(blockToContentBlock)
      .filter((b): b is TurnContentBlock => b !== null);
    appendTurn(conversation.id, 'assistant', assistantBlocks, {
      tokens_input: finalMessage.usage.input_tokens,
      tokens_output: finalMessage.usage.output_tokens,
      cache_read_input_tokens:
        finalMessage.usage.cache_read_input_tokens ?? null,
      cache_creation_input_tokens:
        finalMessage.usage.cache_creation_input_tokens ?? null,
    });

    const toolUses = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      onEvent({ type: 'done', messageId: finalMessage.id });
      return;
    }

    const toolResultBlocks: TurnContentBlock[] = [];
    for (const use of toolUses) {
      const args = (use.input ?? {}) as Record<string, unknown>;
      onEvent({
        type: 'tool_call',
        tool_use_id: use.id,
        name: use.name,
        args,
      });
      const result = await executeTool(use.name, args);
      const resultPayload = result.ok
        ? JSON.stringify(result.data)
        : JSON.stringify({ error: result.error });
      const invalidatesBoard =
        result.ok && STATE_MUTATION_TOOLS.has(use.name as never);
      onEvent({
        type: 'tool_result',
        tool_use_id: use.id,
        name: use.name,
        ok: result.ok,
        summary:
          result.summary ??
          (result.ok
            ? `${use.name} ok`
            : `${use.name} → ${'error' in result ? result.error : 'error'}`),
        invalidatesBoard,
      });
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: resultPayload,
        is_error: !result.ok,
      });
    }
    appendTurn(conversation.id, 'tool', toolResultBlocks);
  }

  appendTurn(conversation.id, 'assistant', [
    {
      type: 'text',
      text: `Stopped after ${maxTurns} tool-use iterations. If you'd like me to keep going, say so.`,
    },
  ]);
  onEvent({ type: 'error', message: 'max turns reached' });
  onEvent({ type: 'done', messageId: null });
}
