'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Tag } from '../lib/types';

interface Props {
  channelId: string;
  currentTags: Tag[];
  allTags: Tag[];
}

export function TagsEditor({ channelId, currentTags, allTags }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Tag[]>(currentTags);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(currentTags), [currentTags]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function persist(next: Tag[]) {
    setBusy(true);
    setError(null);
    const prev = selected;
    setSelected(next);
    try {
      const res = await fetch('/api/channels/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          tagIds: next.map((t) => t.id),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
    } catch {
      setSelected(prev);
      setError('Failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function toggle(tag: Tag) {
    const has = selected.some((t) => t.id === tag.id);
    const next = has
      ? selected.filter((t) => t.id !== tag.id)
      : [...selected, tag];
    void persist(next);
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'create', name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const tag = (await res.json()) as Tag;
      setNewName('');
      await persist([...selected, tag]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-baseline gap-1.5 text-left"
        title="Edit tags"
      >
        {selected.length === 0 ? (
          <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-oxblood/70 hover:text-oxblood">
            + tags
          </span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {selected.map((t) => (
              <span
                key={t.id}
                className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-sage hover:text-ink"
              >
                #{t.name}
              </span>
            ))}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 min-w-[240px] bg-paper p-3 shadow-lg"
          style={{ border: '1px solid var(--color-rule)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Tags
          </div>
          <ul className="mb-2 max-h-52 overflow-y-auto">
            {allTags.length === 0 && (
              <li className="py-1 italic text-sage text-xs">
                No tags yet. Add one below.
              </li>
            )}
            {allTags.map((t) => {
              const has = selected.some((s) => s.id === t.id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggle(t)}
                    className={`w-full text-left py-1 font-sans text-xs ${
                      has ? 'text-ink font-semibold' : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    <span className={`mr-2 ${has ? 'text-oxblood' : 'text-rule'}`}>
                      {has ? '✓' : '•'}
                    </span>
                    {t.name}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t pt-2" style={{ borderColor: 'var(--color-rule)' }}>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New tag…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createAndAdd();
                  }
                }}
                className="flex-1 border-b bg-transparent px-0 py-1 font-sans text-xs outline-none"
                style={{ borderColor: 'var(--color-rule)' }}
              />
              <button
                type="button"
                onClick={() => void createAndAdd()}
                disabled={!newName.trim() || busy}
                className="font-sans text-[10px] uppercase tracking-[0.14em] text-oxblood disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {error && <div className="mt-1 text-[10px] text-oxblood">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
