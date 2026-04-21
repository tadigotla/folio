'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EditorBoard } from './EditorBoard';
import { EditorPool } from './EditorPool';
import type { SlotKind, Issue } from '../../lib/types';
import type { SlotVideo, PoolVideo } from '../../lib/issues';
import type { DragPayload } from './useDragPayload';

interface Props {
  initialIssue: Issue;
  initialSlots: SlotVideo[];
  initialPool: PoolVideo[];
}

type SlotsResponse = {
  issue: Issue | null;
  slots: SlotVideo[];
  pool: PoolVideo[];
};

function findSlot(
  slots: SlotVideo[],
  kind: SlotKind,
  index: number,
): SlotVideo | null {
  return (
    slots.find((s) => s.slot_kind === kind && s.slot_index === index) ?? null
  );
}

export function EditorWorkspace({
  initialIssue,
  initialSlots,
  initialPool,
}: Props) {
  const router = useRouter();
  const [issue, setIssue] = useState<Issue>(initialIssue);
  const [slots, setSlots] = useState<SlotVideo[]>(initialSlots);
  const [pool, setPool] = useState<PoolVideo[]>(initialPool);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState<string>(initialIssue.title ?? '');
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filledCount = slots.length;

  const postSlotAction = useCallback(
    async (body: unknown) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/issues/${issue.id}/slots`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const msg = await res.json().catch(() => ({ error: 'error' }));
          setError((msg as { error?: string }).error ?? `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as SlotsResponse;
        setSlots(data.slots);
        setPool(data.pool);
        if (data.issue) setIssue(data.issue);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [issue.id],
  );

  const onDropTarget = useCallback(
    (target: { kind: SlotKind; index: number }, payload: DragPayload) => {
      const occupant = findSlot(slots, target.kind, target.index);
      if (occupant) {
        if (payload.from === 'slot') {
          if (
            payload.slotKind === target.kind &&
            payload.slotIndex === target.index
          ) {
            return;
          }
          void postSlotAction({
            action: 'swap',
            from: { kind: payload.slotKind, index: payload.slotIndex },
            to: { kind: target.kind, index: target.index },
          });
          return;
        }
        void postSlotAction({
          action: 'swap',
          from: { pool: payload.videoId },
          to: { kind: target.kind, index: target.index },
        });
        return;
      }
      if (payload.from === 'slot') {
        void (async () => {
          await postSlotAction({
            action: 'clear',
            kind: payload.slotKind,
            index: payload.slotIndex,
          });
          await postSlotAction({
            action: 'assign',
            videoId: payload.videoId,
            kind: target.kind,
            index: target.index,
          });
        })();
        return;
      }
      void postSlotAction({
        action: 'assign',
        videoId: payload.videoId,
        kind: target.kind,
        index: target.index,
      });
    },
    [slots, postSlotAction],
  );

  const onDropToPool = useCallback(
    (payload: DragPayload) => {
      if (payload.from !== 'slot') return;
      void postSlotAction({
        action: 'clear',
        kind: payload.slotKind,
        index: payload.slotIndex,
      });
    },
    [postSlotAction],
  );

  const onClearSlot = useCallback(
    (kind: SlotKind, index: number) => {
      void postSlotAction({ action: 'clear', kind, index });
    },
    [postSlotAction],
  );

  const onDismissed = useCallback((videoId: string) => {
    setPool((prev) => prev.filter((v) => v.id !== videoId));
  }, []);

  async function onPublish() {
    if (!confirm('Publish this issue? Published issues cannot be edited.')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}/publish`, {
        method: 'POST',
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: 'error' }));
        setError((msg as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/issues/${issue.id}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onDiscard() {
    if (!confirm('Discard this draft? All slot assignments will be lost.')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/issues/${issue.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const msg = await res.json().catch(() => ({ error: 'error' }));
        setError((msg as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function onTitleChange(value: string) {
    setTitle(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      void fetch(`/api/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: value }),
      });
    }, 300);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as HTMLElement).isContentEditable);

      if (e.key === '/' && !isEditing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && target) {
        const el = target.closest('[data-slot-kind]') as HTMLElement | null;
        if (el) {
          const kind = el.dataset.slotKind as SlotKind | undefined;
          const idxRaw = el.dataset.slotIndex;
          const index = idxRaw != null ? Number(idxRaw) : NaN;
          if (kind && Number.isInteger(index)) {
            e.preventDefault();
            onClearSlot(kind, index);
          }
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClearSlot]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4 border-b border-rule pb-4">
        <div className="flex-1 min-w-[200px]">
          <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-oxblood">
            Draft issue · {filledCount} of 14 slots
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Untitled issue"
            className="mt-1 w-full border-none bg-transparent font-[var(--font-serif-display)] text-3xl italic tracking-tight outline-none placeholder:text-ink-soft/50"
          />
        </div>
        <div className="flex items-center gap-3">
          {saving && (
            <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-ink-soft">
              Saving…
            </span>
          )}
          {error && (
            <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-oxblood">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-oxblood disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={saving || filledCount === 0}
            className="bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-50"
          >
            Publish
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          <EditorBoard
            slots={slots}
            onDrop={onDropTarget}
            onClear={onClearSlot}
          />
        </div>
        <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <EditorPool
            pool={pool}
            onDropToPool={onDropToPool}
            onDismissed={onDismissed}
            searchRef={searchRef}
          />
        </div>
      </div>
    </div>
  );
}
