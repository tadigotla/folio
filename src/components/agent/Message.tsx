'use client';

import type { TurnContentBlock, TurnRole } from '../../lib/types';
import { ToolTrace } from './ToolTrace';
import type { ToolTrace as Trace } from './types';

interface Props {
  role: TurnRole;
  blocks: TurnContentBlock[];
  traces?: Trace[];
}

export function Message({ role, blocks, traces }: Props) {
  if (role === 'tool') {
    // Tool turns are rendered as part of the preceding assistant message via
    // the `traces` prop; we don't render them standalone.
    return null;
  }

  const text = blocks
    .filter((b): b is Extract<TurnContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n');

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-rule/40 px-3 py-2 font-sans text-sm leading-relaxed text-ink">
          {text}
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="space-y-2">
      {text && (
        <div className="font-[var(--font-serif-display)] text-[17px] italic leading-snug text-ink">
          {text}
        </div>
      )}
      {traces && traces.length > 0 && (
        <div className="space-y-1">
          {traces.map((t) => (
            <ToolTrace key={t.tool_use_id} trace={t} />
          ))}
        </div>
      )}
    </div>
  );
}
