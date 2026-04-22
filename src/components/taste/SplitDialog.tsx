'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  clusterId: number;
  memberCount: number;
  expectedUpdatedAt: string;
}

interface PreviewEntry {
  k: number;
  sizes: number[];
  silhouette: number;
}

export function SplitDialog({ clusterId, memberCount, expectedUpdatedAt }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const maxK = Math.min(5, memberCount);
  const [k, setK] = useState(2);
  const [previews, setPreviews] = useState<PreviewEntry[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreviews(null);
    const ks = [];
    for (let i = 2; i <= maxK; i++) ks.push(i);
    if (ks.length === 0) return;
    fetch(
      `/api/taste/clusters/${clusterId}/split-preview?k=${ks.join(',')}`,
    )
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        setPreviews((body as { previews: PreviewEntry[] }).previews);
      })
      .catch(() => {
        if (!cancelled) setPreviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clusterId, maxK]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/taste/clusters/${clusterId}/split`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ k, expectedUpdatedAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `error ${res.status}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={memberCount < 2}
        className="border border-rule px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:border-oxblood hover:text-oxblood disabled:opacity-40"
      >
        Split
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
      <div className="w-full max-w-md border border-rule bg-paper p-5">
        <h2 className="font-[var(--font-serif-display)] text-2xl italic">
          Split cluster
        </h2>
        <p className="mt-2 font-sans text-sm text-ink-soft">
          Partition {memberCount} members into k sub-clusters. The first child
          inherits this cluster&apos;s id and label.
        </p>
        <label className="mt-4 flex items-center gap-3">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
            k
          </span>
          <input
            type="number"
            min={2}
            max={maxK}
            value={k}
            onChange={(e) => setK(Math.max(2, Math.min(maxK, Number(e.target.value))))}
            className="w-20 border border-rule bg-transparent px-2 py-1 font-mono text-sm focus:outline-none focus:border-oxblood/60"
          />
          <span className="font-sans text-xs text-ink-soft">
            (max {maxK})
          </span>
        </label>

        <div className="mt-4 border border-rule bg-paper/40 p-2 font-mono text-xs">
          {previews === null && (
            <span className="text-ink-soft">Computing previews…</span>
          )}
          {previews?.length === 0 && (
            <span className="text-ink-soft">no previews available</span>
          )}
          {previews && previews.length > 0 && (
            <ul className="space-y-1">
              {previews.map((p) => (
                <li
                  key={p.k}
                  className={p.k === k ? 'text-oxblood' : 'text-ink-soft'}
                >
                  k={p.k} · sizes [{p.sizes.join(', ')}] · silhouette{' '}
                  {p.silhouette.toFixed(3)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="mt-2 font-sans text-xs text-destructive">{error}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={pending}
            className="border border-rule px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || k < 2 || k > maxK}
            className="bg-oxblood px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper disabled:opacity-40"
          >
            {pending ? 'Splitting…' : `Split into ${k}`}
          </button>
        </div>
      </div>
    </div>
  );
}
