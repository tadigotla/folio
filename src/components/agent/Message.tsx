'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TurnContentBlock, TurnRole } from '../../lib/types';
import { ToolTrace } from './ToolTrace';
import type { ToolTrace as Trace } from './types';

interface Props {
  role: TurnRole;
  blocks: TurnContentBlock[];
  traces?: Trace[];
}

// Shared table/list/code styling for both roles — these should always read as
// editorial sidebar typography regardless of whether the surrounding prose
// is serif-italic (assistant) or sans (user).
const structuralComponents: Components = {
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse font-sans text-[12px] italic-none leading-snug">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-rule/80 not-italic">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="not-italic">{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-rule/40 last:border-b-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold uppercase tracking-[0.12em] text-[10px] text-ink-soft">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1 align-top text-ink">{children}</td>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 space-y-0.5 not-italic font-sans text-[13px] text-ink">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 space-y-0.5 not-italic font-sans text-[13px] text-ink">
      {children}
    </ol>
  ),
  code: ({ children }) => (
    <code className="bg-rule/50 px-1 py-[1px] font-mono text-[12px] not-italic">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto bg-rule/30 p-2 font-mono text-[12px] not-italic leading-snug">
      {children}
    </pre>
  ),
};

const assistantComponents: Components = {
  ...structuralComponents,
  p: ({ children }) => (
    <p className="font-[var(--font-serif-display)] text-[17px] italic leading-snug text-ink">
      {children}
    </p>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
};

const userComponents: Components = {
  ...structuralComponents,
  p: ({ children }) => <p>{children}</p>,
};

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
        <div className="max-w-[85%] bg-rule/40 px-3 py-2 font-sans text-sm leading-relaxed text-ink space-y-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={userComponents}>
            {text}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="space-y-2">
      {text && (
        <div className="space-y-2">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={assistantComponents}
          >
            {text}
          </ReactMarkdown>
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
