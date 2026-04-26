'use client';

import { useState } from 'react';
import type { ToolTrace as Trace } from './types';

interface Props {
  trace: Trace;
}

function summarizeResult(name: string, result: Trace['result']): {
  label: string;
  ok: boolean;
  detail: string | null;
} {
  if (!result) return { label: `${name} — running…`, ok: true, detail: null };
  if (result.ok) {
    const r = result.result as { count?: number } | unknown;
    if (
      r &&
      typeof r === 'object' &&
      typeof (r as { count?: unknown }).count === 'number'
    ) {
      const count = (r as { count: number }).count;
      return {
        label: `${name} — ${count} hit${count === 1 ? '' : 's'}`,
        ok: true,
        detail: null,
      };
    }
    return { label: `${name} — ok`, ok: true, detail: null };
  }
  return {
    label: `${name} → ${result.error.code}`,
    ok: false,
    detail: result.error.message,
  };
}

export function ToolTrace({ trace }: Props) {
  const [open, setOpen] = useState(false);
  const { label, ok, detail } = summarizeResult(trace.name, trace.result);
  const pending = !trace.result;

  return (
    <div
      className={`border-l-2 pl-3 ${ok ? 'border-sage/40' : 'border-oxblood/60'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left font-sans text-[10px] uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
      >
        <span>
          {pending ? '…' : ok ? '·' : '⚠'} {trace.name}
        </span>
        <span className="italic normal-case tracking-normal text-ink-soft/70">
          {label}
        </span>
      </button>
      {!ok && detail && (
        <div className="mt-1 font-sans text-[11px] not-italic leading-snug text-oxblood">
          {detail}
        </div>
      )}
      {open && (
        <div className="mt-1 space-y-1 font-mono text-[10px] leading-snug text-ink-soft">
          <div>
            <span className="text-ink/60">args: </span>
            {JSON.stringify(trace.args)}
          </div>
          {trace.result?.ok && (
            <div className="break-all">
              <span className="text-ink/60">result: </span>
              {JSON.stringify(trace.result.result)}
            </div>
          )}
          {trace.result && !trace.result.ok && trace.result.error.details !== undefined && (
            <div className="break-all">
              <span className="text-ink/60">details: </span>
              {JSON.stringify(trace.result.error.details)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
