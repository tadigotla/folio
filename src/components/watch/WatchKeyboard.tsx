'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConsumptionStatus } from '../../lib/types';

interface Props {
  videoId: string;
  currentStatus: ConsumptionStatus;
  nextId: string | null;
  prevId: string | null;
}

type UndoKind = 'save' | 'archive' | 'dismiss';

const UNDO_MS = 1200;

function actionLabel(k: UndoKind): string {
  if (k === 'save') return 'Saved';
  if (k === 'archive') return 'Archived';
  return 'Dismissed';
}

function actionTarget(k: UndoKind): ConsumptionStatus {
  if (k === 'save') return 'saved';
  if (k === 'archive') return 'archived';
  return 'dismissed';
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

export function WatchKeyboard({ videoId, currentStatus, nextId, prevId }: Props) {
  const router = useRouter();
  const [strip, setStrip] = useState<{ label: string; id: number } | null>(null);
  const [endOfIssue, setEndOfIssue] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pendingRef = useRef<{
    id: number;
    kind: UndoKind;
    prevStatus: ConsumptionStatus;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashEnd = useCallback(() => {
    setEndOfIssue(true);
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = setTimeout(() => setEndOfIssue(false), 1200);
  }, []);

  const flashPinned = useCallback(() => {
    setPinned(true);
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinTimer.current = setTimeout(() => setPinned(false), 1200);
  }, []);

  const clearPending = useCallback(() => {
    if (pendingRef.current?.timer) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    setStrip(null);
  }, []);

  const doTransition = useCallback(
    async (kind: UndoKind) => {
      if (pendingRef.current) return;
      const target = actionTarget(kind);
      const prev = currentStatus;
      try {
        const res = await fetch('/api/consumption', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId, next: target }),
        });
        if (!res.ok) return;
      } catch {
        return;
      }
      const id = Date.now();
      setStrip({ label: actionLabel(kind), id });
      const timer = setTimeout(() => {
        pendingRef.current = null;
        setStrip(null);
        if (nextId) {
          router.push(`/watch/${encodeURIComponent(nextId)}`);
        } else {
          router.push('/');
        }
      }, UNDO_MS);
      pendingRef.current = { id, kind, prevStatus: prev, timer };
    },
    [currentStatus, nextId, router, videoId],
  );

  const undo = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pendingRef.current = null;
    try {
      await fetch('/api/consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, next: pending.prevStatus }),
      });
    } catch {}
    setStrip(null);
    router.refresh();
  }, [router, videoId]);

  const pinCover = useCallback(async () => {
    try {
      const res = await fetch('/api/issues/cover-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      if (res.ok) flashPinned();
    } catch {}
  }, [flashPinned, videoId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTextEntry(document.activeElement)) return;

      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        if (pendingRef.current) {
          e.preventDefault();
          void undo();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'n':
          e.preventDefault();
          if (nextId) router.push(`/watch/${encodeURIComponent(nextId)}`);
          else flashEnd();
          break;
        case 'p':
          e.preventDefault();
          if (prevId) router.push(`/watch/${encodeURIComponent(prevId)}`);
          else flashEnd();
          break;
        case 's':
          e.preventDefault();
          void doTransition('save');
          break;
        case 'a':
          e.preventDefault();
          void doTransition('archive');
          break;
        case 'd':
          e.preventDefault();
          void doTransition('dismiss');
          break;
        case '.':
          e.preventDefault();
          void pinCover();
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (endTimer.current) clearTimeout(endTimer.current);
      if (pinTimer.current) clearTimeout(pinTimer.current);
      if (pendingRef.current?.timer) clearTimeout(pendingRef.current.timer);
    };
  }, [doTransition, flashEnd, nextId, pinCover, prevId, router, undo]);

  return (
    <>
      {strip && (
        <div
          key={strip.id}
          className="fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-4 bg-oxblood px-4 py-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-paper"
        >
          <span>{strip.label}. Next in 1s.</span>
          <button
            type="button"
            onClick={() => void undo()}
            className="underline underline-offset-2 hover:text-paper/80"
          >
            ⌘Z to undo
          </button>
          <button
            type="button"
            onClick={clearPending}
            className="ml-2 text-paper/70 hover:text-paper"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {endOfIssue && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-sage px-3 py-2 font-sans text-[11px] uppercase tracking-[0.14em] text-paper">
          End of issue.
        </div>
      )}
      {pinned && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-oxblood px-3 py-2 font-sans text-[11px] uppercase tracking-[0.14em] text-paper">
          Pinned as cover.
        </div>
      )}
    </>
  );
}
