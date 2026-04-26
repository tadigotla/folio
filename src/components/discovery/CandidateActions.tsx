'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  candidateId: number;
}

export function CandidateActions({ candidateId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function run(action: 'approve' | 'dismiss') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/discovery/candidates/${candidateId}/${action}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        let message = `failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          /* ignore */
        }
        setError(message);
        setBusy(null);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => run('approve')}
        disabled={busy !== null}
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-oxblood transition-colors hover:text-ink disabled:opacity-50"
      >
        {busy === 'approve' ? '…' : 'Approve'}
      </button>
      <button
        type="button"
        onClick={() => run('dismiss')}
        disabled={busy !== null}
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
      >
        {busy === 'dismiss' ? '…' : 'Dismiss'}
      </button>
      {error && (
        <span className="font-sans text-[10px] italic text-oxblood">
          {error}
        </span>
      )}
    </div>
  );
}
