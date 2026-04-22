'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  clusterId: number;
  initialLabel: string | null;
  expectedUpdatedAt: string;
}

export function ClusterLabelInput({
  clusterId,
  initialLabel,
  expectedUpdatedAt,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialLabel ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastCommittedRef = useRef(initialLabel ?? null);
  const stampRef = useRef(expectedUpdatedAt);

  useEffect(() => {
    stampRef.current = expectedUpdatedAt;
  }, [expectedUpdatedAt]);

  async function commit() {
    const normalized = value.trim() || null;
    if (normalized === lastCommittedRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/taste/clusters/${clusterId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: value, expectedUpdatedAt: stampRef.current }),
      });
      if (res.status === 409) {
        setError('cluster was rebuilt; reload');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `error ${res.status}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { updatedAt?: string };
      if (body.updatedAt) stampRef.current = body.updatedAt;
      lastCommittedRef.current = normalized;
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <input
        type="text"
        value={value}
        placeholder="(unlabeled)"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        disabled={saving}
        className="bg-transparent font-[var(--font-serif-display)] text-xl italic outline-none border-b border-transparent focus:border-oxblood/60 placeholder:text-ink-soft/50 min-w-[12ch]"
      />
      {error && (
        <span className="mt-0.5 font-sans text-[10px] text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
