'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export function NewDraftButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/issues', { method: 'POST' });
      if (res.status === 201) {
        router.refresh();
        return;
      }
      if (res.status === 409) {
        router.refresh();
        return;
      }
      const msg = await res.json().catch(() => ({ error: 'error' }));
      setError((msg as { error?: string }).error ?? `HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void create();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [create]);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'New issue'}
      </button>
      <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-ink-soft">
        press <kbd className="bg-rule/60 px-1.5 py-0.5 font-mono text-[10px]">n</kbd>
      </span>
      {error && (
        <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-oxblood">
          {error}
        </span>
      )}
    </div>
  );
}
