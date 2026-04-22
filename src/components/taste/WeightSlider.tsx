'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  clusterId: number;
  initialWeight: number;
  expectedUpdatedAt: string;
}

const DEBOUNCE_MS = 400;

export function WeightSlider({
  clusterId,
  initialWeight,
  expectedUpdatedAt,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialWeight);
  const [error, setError] = useState<string | null>(null);
  const lastSentRef = useRef(initialWeight);
  // Track the optimistic-lock stamp in a ref so sequential drags chain off
  // the prior POST's response — router.refresh() is async and would lose
  // rapid edits to a 409 race otherwise.
  const stampRef = useRef(expectedUpdatedAt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stampRef.current = expectedUpdatedAt;
  }, [expectedUpdatedAt]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function onChange(next: number) {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  }

  async function commit(weight: number) {
    if (Math.abs(weight - lastSentRef.current) < 1e-6) return;
    setError(null);
    try {
      const res = await fetch(`/api/taste/clusters/${clusterId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weight, expectedUpdatedAt: stampRef.current }),
      });
      if (res.status === 409) {
        setError('rebuilt; reload');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `error ${res.status}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { updatedAt?: string };
      if (body.updatedAt) stampRef.current = body.updatedAt;
      lastSentRef.current = weight;
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2">
        <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-ink-soft">
          weight
        </span>
        <input
          type="range"
          min={0}
          max={3}
          step={0.1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-32 accent-oxblood"
        />
        <span className="font-mono text-xs tabular-nums text-ink w-10 text-right">
          {value.toFixed(1)}
        </span>
      </label>
      {error && (
        <span className="font-sans text-[10px] text-destructive">{error}</span>
      )}
    </div>
  );
}
