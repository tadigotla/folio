'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  targetId: string;
}

export function RejectionRowActions({ targetId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/discovery/rejections/${encodeURIComponent(targetId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setError(`failed (${res.status})`);
        setBusy(false);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={clear}
        disabled={busy}
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft transition-colors hover:text-oxblood disabled:opacity-50"
      >
        {busy ? '…' : 'Clear'}
      </button>
      {error && (
        <span className="font-sans text-[10px] italic text-oxblood">
          {error}
        </span>
      )}
    </div>
  );
}

export function ClearAllRejectionsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function clearAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/discovery/rejections`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(`failed (${res.status})`);
        setBusy(false);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={clearAll}
        disabled={busy}
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-oxblood transition-colors hover:text-ink disabled:opacity-50"
      >
        {busy ? '…' : 'Clear all'}
      </button>
      {error && (
        <span className="font-sans text-[10px] italic text-oxblood">
          {error}
        </span>
      )}
    </div>
  );
}
