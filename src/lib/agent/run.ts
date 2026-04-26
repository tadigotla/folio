import type Anthropic from '@anthropic-ai/sdk';
import {
  getAnthropic,
  getAgentModel,
  getAgentMaxTurns,
  getAgentMaxInputTokens,
  getAgentMaxOutputTokens,
} from './client';
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
import type { ToolResult } from './errors';

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
      toolName: string;
      ok: boolean;
      result?: unknown;
      error?: { code: string; message: string; details?: unknown };
      invalidatesBoard: boolean;
    }
  | {
      type: 'error';
      error: { code: string; message: string; details?: unknown };
    }
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
  const maxInputTokens = getAgentMaxInputTokens();
  const maxOutputTokens = getAgentMaxOutputTokens();

  let sessionInputTokens = 0;
  let sessionOutputTokens = 0;

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
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onEvent({
        type: 'error',
        error: { code: 'upstream_unavailable', message },
      });
      onEvent({ type: 'done', messageId: null });
      return;
    }

    sessionInputTokens += finalMessage.usage.input_tokens;
    sessionOutputTokens += finalMessage.usage.output_tokens;

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
      const result: ToolResult = await executeTool(use.name, args);
      const invalidatesBoard =
        result.ok && STATE_MUTATION_TOOLS.has(use.name as never);
      onEvent({
        type: 'tool_result',
        tool_use_id: use.id,
        toolName: use.name,
        ok: result.ok,
        ...(result.ok ? { result: result.result } : { error: result.error }),
        invalidatesBoard,
      });
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }
    appendTurn(conversation.id, 'tool', toolResultBlocks);

    // Token-budget cap — evaluated between iterations only.
    if (maxInputTokens > 0 && sessionInputTokens >= maxInputTokens) {
      const message = `input-token cap reached: ${sessionInputTokens} >= ${maxInputTokens}`;
      appendTurn(conversation.id, 'assistant', [
        { type: 'text', text: `Stopped — ${message}.` },
      ]);
      onEvent({
        type: 'error',
        error: {
          code: 'precondition_failed',
          message,
          details: { cap: 'AGENT_MAX_INPUT_TOKENS', limit: maxInputTokens, measured: sessionInputTokens },
        },
      });
      onEvent({ type: 'done', messageId: null });
      return;
    }
    if (maxOutputTokens > 0 && sessionOutputTokens >= maxOutputTokens) {
      const message = `output-token cap reached: ${sessionOutputTokens} >= ${maxOutputTokens}`;
      appendTurn(conversation.id, 'assistant', [
        { type: 'text', text: `Stopped — ${message}.` },
      ]);
      onEvent({
        type: 'error',
        error: {
          code: 'precondition_failed',
          message,
          details: { cap: 'AGENT_MAX_OUTPUT_TOKENS', limit: maxOutputTokens, measured: sessionOutputTokens },
        },
      });
      onEvent({ type: 'done', messageId: null });
      return;
    }
  }

  const capMessage = `max turns reached: ${maxTurns}`;
  appendTurn(conversation.id, 'assistant', [
    {
      type: 'text',
      text: `Stopped after ${maxTurns} tool-use iterations. If you'd like me to keep going, say so.`,
    },
  ]);
  onEvent({
    type: 'error',
    error: {
      code: 'precondition_failed',
      message: capMessage,
      details: { cap: 'AGENT_MAX_TURNS', limit: maxTurns },
    },
  });
  onEvent({ type: 'done', messageId: null });
}
