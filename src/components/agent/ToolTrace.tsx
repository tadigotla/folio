'use client';

import { useState } from 'react';
import type { ToolTrace as Trace } from './types';

interface Props {
  trace: Trace;
}

export function ToolTrace({ trace }: Props) {
  const [open, setOpen] = useState(false);
  const { result } = trace;
  const pending = !result;
  const summary = result?.summary ?? `${trace.name} — running…`;
  const ok = result?.ok ?? true;

  return (
    <div className="border-l-2 border-sage/40 pl-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left font-sans text-[10px] uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
      >
        <span>
          {pending ? '…' : ok ? '·' : '⚠'} {trace.name}
        </span>
        <span className="italic normal-case tracking-normal text-ink-soft/70">
          {summary}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 font-mono text-[10px] leading-snug text-ink-soft">
          <div>
            <span className="text-ink/60">args: </span>
            {JSON.stringify(trace.args)}
          </div>
        </div>
      )}
    </div>
  );
}
