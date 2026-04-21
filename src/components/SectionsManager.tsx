'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Section, Tag } from '../lib/types';
import { SectionChip } from './SectionChip';
import { TagsEditor } from './TagsEditor';

interface ChannelRow {
  id: string;
  name: string;
  handle: string | null;
  sectionId: number | null;
  sectionName: string | null;
  inboxCount: number;
  lastChecked: string | null;
  recent: Array<{ id: string; title: string }>;
  tags: Tag[];
}

interface Props {
  channels: ChannelRow[];
  sections: Section[];
  allTags: Tag[];
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

export function SectionsManager({ channels, sections, allTags }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [focusIdx, setFocusIdx] = useState(0);
  const [localChannels, setLocalChannels] = useState(channels);
  const [toast, setToast] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setLocalChannels(channels), [channels]);

  useEffect(() => {
    const row = localChannels[focusIdx];
    if (!row) return;
    const el = rowRefs.current.get(row.id);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, localChannels]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  const assignByKey = useCallback(
    async (channel: ChannelRow, n: number) => {
      let sectionId: number | null;
      let sectionName: string | null;
      if (n === 0) {
        sectionId = null;
        sectionName = null;
      } else {
        const sec = sections[n - 1];
        if (!sec) {
          flash(`No section ${n}`);
          return;
        }
        sectionId = sec.id;
        sectionName = sec.name;
      }
      setLocalChannels((prev) =>
        prev.map((c) =>
          c.id === channel.id ? { ...c, sectionId, sectionName } : c,
        ),
      );
      try {
        const res = await fetch('/api/channels/section', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: channel.id, sectionId }),
        });
        if (!res.ok) throw new Error();
        flash(sectionName ? `→ ${sectionName}` : '→ Unsorted');
        startTransition(() => router.refresh());
      } catch {
        setLocalChannels((prev) =>
          prev.map((c) =>
            c.id === channel.id
              ? { ...c, sectionId: channel.sectionId, sectionName: channel.sectionName }
              : c,
          ),
        );
        flash('Failed');
      }
    },
    [sections, flash, router],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEntry(document.activeElement)) return;
      if (e.key === 'j') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(localChannels.length - 1, i + 1));
        return;
      }
      if (e.key === 'k') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        const row = localChannels[focusIdx];
        if (row) {
          e.preventDefault();
          void assignByKey(row, Number(e.key));
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [localChannels, focusIdx, assignByKey]);

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-ink px-3 py-2 font-sans text-xs text-paper">
          {toast}
        </div>
      )}

      <div className="mb-4">
        <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Section keys
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs">
          {sections.length === 0 ? (
            <span className="italic text-sage">
              No sections yet. Create one via the chip on any channel row.
            </span>
          ) : (
            sections.slice(0, 9).map((s, i) => (
              <span key={s.id}>
                <kbd className="font-mono text-oxblood">{i + 1}</kbd>{' '}
                <span className="text-ink">{s.name}</span>
              </span>
            ))
          )}
          <span>
            <kbd className="font-mono text-oxblood">0</kbd>{' '}
            <span className="text-ink-soft">Unsorted</span>
          </span>
        </div>
      </div>

      <div>
        {localChannels.map((c, i) => (
          <div
            key={c.id}
            ref={(el) => {
              if (el) rowRefs.current.set(c.id, el);
              else rowRefs.current.delete(c.id);
            }}
            data-focused={i === focusIdx ? 'true' : undefined}
            className="relative flex items-center justify-between gap-4 border-b py-3 pl-4 data-[focused=true]:bg-rule/40"
            style={{ borderColor: 'var(--color-rule)' }}
            onClick={() => setFocusIdx(i)}
          >
            {i === focusIdx && (
              <div
                aria-hidden="true"
                className="absolute left-0 top-2 bottom-2 w-0.5 bg-oxblood"
              />
            )}
            <div className="flex-1 min-w-0 pr-4">
              <div className="flex items-baseline gap-2">
                <div className="truncate font-[var(--font-serif-body)] text-base">
                  {c.name}
                </div>
                <a
                  href={`https://www.youtube.com/channel/${encodeURIComponent(c.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 font-sans text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft hover:text-oxblood"
                  title="Open on YouTube"
                >
                  ↗
                </a>
              </div>
              <div className="mt-1 italic text-sage text-xs">
                {c.inboxCount} inbox{c.lastChecked ? ` · last ${c.lastChecked}` : ''}
              </div>
              {c.recent.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {c.recent.map((r) => (
                    <li key={r.id} className="truncate font-[var(--font-serif-body)] text-sm leading-snug text-ink-soft">
                      <span className="mr-2 text-oxblood/60">·</span>
                      {r.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="shrink-0 self-start mt-1 flex flex-col items-end gap-2">
              <SectionChip
                channelId={c.id}
                currentSectionId={c.sectionId}
                currentSectionName={c.sectionName}
                sections={sections}
              />
              <TagsEditor
                channelId={c.id}
                currentTags={c.tags}
                allTags={allTags}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
