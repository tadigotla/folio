'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ClusterOption {
  id: number;
  label: string | null;
}

interface Props {
  videoId: string;
  currentClusterId: number;
  options: ClusterOption[];
}

export function ReassignPopover({ videoId, currentClusterId, options }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reassign(clusterId: number) {
    if (clusterId === currentClusterId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/taste/assignments/${videoId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clusterId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `error ${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={currentClusterId}
        disabled={pending}
        onChange={(e) => reassign(Number(e.target.value))}
        className="border border-rule bg-transparent px-1.5 py-0.5 font-mono text-xs text-ink focus:outline-none focus:border-oxblood/60"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            #{o.id} {o.label ?? '(unlabeled)'}
          </option>
        ))}
      </select>
      {error && (
        <span className="font-sans text-[10px] text-destructive">{error}</span>
      )}
    </span>
  );
}
