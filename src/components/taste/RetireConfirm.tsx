'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  clusterId: number;
  expectedUpdatedAt: string;
}

export function RetireConfirm({ clusterId, expectedUpdatedAt }: Props) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/taste/clusters/${clusterId}/retire`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `error ${res.status}`);
        return;
      }
      router.replace('/taste');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setPending(false);
    }
  }

  if (!arming) {
    return (
      <button
        type="button"
        onClick={() => setArming(true)}
        className="border border-rule px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:border-destructive hover:text-destructive"
      >
        Retire
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="bg-destructive/10 px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-destructive hover:bg-destructive/20"
      >
        {pending ? 'Retiring…' : 'Confirm retire'}
      </button>
      <button
        type="button"
        onClick={() => setArming(false)}
        disabled={pending}
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
      >
        Cancel
      </button>
      {error && (
        <span className="font-sans text-[10px] text-destructive">{error}</span>
      )}
    </span>
  );
}
