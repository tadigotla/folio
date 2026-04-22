'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ClusterOption {
  id: number;
  label: string | null;
  memberCount: number;
}

interface Props {
  source: ClusterOption;
  expectedUpdatedAt: string;
  candidates: ClusterOption[];
}

export function MergeDialog({ source, expectedUpdatedAt, candidates }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const otherCandidates = useMemo(
    () => candidates.filter((c) => c.id !== source.id),
    [candidates, source.id],
  );
  const [targetId, setTargetId] = useState<number | null>(
    otherCandidates[0]?.id ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = otherCandidates.find((c) => c.id === targetId) ?? null;

  async function submit() {
    if (target == null) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/taste/clusters/${source.id}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ into: target.id, expectedUpdatedAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `error ${res.status}`);
        return;
      }
      setOpen(false);
      // Source is now retired; bounce to the target's detail page.
      router.replace(`/taste/${target.id}`);
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
        disabled={otherCandidates.length === 0}
        className="border border-rule px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:border-oxblood hover:text-oxblood disabled:opacity-40"
      >
        Merge
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
      <div className="w-full max-w-md border border-rule bg-paper p-5">
        <h2 className="font-[var(--font-serif-display)] text-2xl italic">
          Merge cluster
        </h2>
        <p className="mt-2 font-sans text-sm text-ink-soft">
          Merge &lsquo;{source.label ?? '(unlabeled)'}&rsquo; ({source.memberCount} members) into:
        </p>
        <select
          value={targetId ?? ''}
          onChange={(e) => setTargetId(Number(e.target.value))}
          className="mt-3 w-full border border-rule bg-transparent px-2 py-1 font-mono text-sm focus:outline-none focus:border-oxblood/60"
        >
          {otherCandidates.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.id} {c.label ?? '(unlabeled)'} ({c.memberCount} members)
            </option>
          ))}
        </select>
        {target && (
          <p className="mt-3 font-sans text-xs text-ink-soft">
            Result: cluster #{target.id} will hold{' '}
            {target.memberCount + source.memberCount} members. Cluster #
            {source.id} will be retired (label preserved).
          </p>
        )}
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
            disabled={pending || target == null || target.id === source.id}
            className="bg-oxblood px-3 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper disabled:opacity-40"
          >
            {pending ? 'Merging…' : 'Confirm merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
