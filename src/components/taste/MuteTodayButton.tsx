'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  clusterId: number;
  initiallyMuted: boolean;
}

export function MuteTodayButton({ clusterId, initiallyMuted }: Props) {
  const router = useRouter();
  const [muted, setMuted] = useState(initiallyMuted);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function toggle() {
    setError(null);
    try {
      const res = await fetch(
        `/api/taste/clusters/${clusterId}/mute-today`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `error ${res.status}`);
        return;
      }
      const body = (await res.json()) as { muted: boolean };
      setMuted(body.muted);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={muted}
        className={
          'font-sans text-[10px] uppercase tracking-[0.16em] border px-2 py-1 transition-colors ' +
          (muted
            ? 'border-oxblood bg-oxblood text-paper hover:bg-ink hover:border-ink'
            : 'border-rule text-ink-soft hover:border-oxblood hover:text-oxblood')
        }
      >
        {muted ? 'Muted today' : 'Mute today'}
      </button>
      {error && (
        <span className="font-sans text-[10px] text-destructive">{error}</span>
      )}
    </div>
  );
}
