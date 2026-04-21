'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Section } from '../lib/types';

interface Props {
  channelId: string;
  currentSectionId: number | null;
  currentSectionName: string | null;
  sections: Section[];
  compact?: boolean;
}

export function SectionChip({
  channelId,
  currentSectionId,
  currentSectionName,
  sections,
  compact = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [optimisticId, setOptimisticId] = useState<number | null | undefined>(undefined);
  const [optimisticName, setOptimisticName] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

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

  const effectiveSectionId = optimisticId === undefined ? currentSectionId : optimisticId;
  const effectiveName = optimisticName === undefined ? currentSectionName : optimisticName;

  async function assign(sectionId: number | null, name: string | null) {
    setError(null);
    setOptimisticId(sectionId);
    setOptimisticName(name);
    try {
      const res = await fetch('/api/channels/section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, sectionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => router.refresh());
      setOpen(false);
    } catch {
      setOptimisticId(currentSectionId);
      setOptimisticName(currentSectionName);
      setError('Failed. Try again.');
    }
  }

  async function createAndAssign() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await fetch('/api/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'create', name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const section = (await res.json()) as Section;
      await assign(section.id, section.name);
      setNewName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const baseBtn = 'font-sans text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors';
  const chipClass = effectiveSectionId
    ? `${baseBtn} text-sage hover:text-ink`
    : `${baseBtn} text-oxblood/70 hover:text-oxblood`;

  return (
    <div ref={rootRef} className={`relative inline-block ${compact ? '' : ''}`}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={chipClass}
      >
        {effectiveSectionId ? effectiveName : '+ assign'}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-2 min-w-[220px] bg-paper p-3 shadow-lg"
          style={{ border: '1px solid var(--color-rule)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Assign section
          </div>
          <ul className="mb-2 max-h-48 overflow-y-auto">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => assign(s.id, s.name)}
                  className={`w-full text-left py-1 font-sans text-xs ${
                    s.id === effectiveSectionId ? 'text-ink font-semibold' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {s.name}
                </button>
              </li>
            ))}
            {effectiveSectionId !== null && (
              <li>
                <button
                  type="button"
                  onClick={() => assign(null, null)}
                  className="w-full text-left py-1 font-sans text-xs text-oxblood/80 hover:text-oxblood"
                >
                  — Unsorted
                </button>
              </li>
            )}
          </ul>
          <div className="border-t pt-2" style={{ borderColor: 'var(--color-rule)' }}>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="New section…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createAndAssign();
                  }
                }}
                className="flex-1 border-b bg-transparent px-0 py-1 font-sans text-xs outline-none"
                style={{ borderColor: 'var(--color-rule)' }}
              />
              <button
                type="button"
                onClick={() => void createAndAssign()}
                disabled={!newName.trim()}
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
