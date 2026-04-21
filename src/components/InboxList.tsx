'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import type { VideoWithSection } from '../lib/consumption';
import type { Section, Tag } from '../lib/types';
import { InboxCard } from './InboxCard';
import { ConsumptionAction } from './ConsumptionAction';
import { INBOX_KEYMAP, type InboxAction } from './inboxKeymap';

const CHORD_TIMEOUT_MS = 500;
const ERROR_BANNER_MS = 4000;

interface UndoEntry {
  videoId: string;
  prevStatus: 'inbox';
}

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function resolveAction(
  key: string,
  pendingG: boolean,
): { action: InboxAction | null; chordConsumed: boolean; startChord: boolean } {
  if (pendingG) {
    if (key === 'g') return { action: 'top', chordConsumed: true, startChord: false };
    return { action: null, chordConsumed: true, startChord: false };
  }
  if (key === 'g') {
    return { action: null, chordConsumed: false, startChord: true };
  }
  for (const binding of INBOX_KEYMAP) {
    if (binding.keys.length === 1 && binding.keys[0] === key) {
      return { action: binding.action, chordConsumed: false, startChord: false };
    }
  }
  return { action: null, chordConsumed: false, startChord: false };
}

export function InboxList({
  videos,
  sections,
  tagsByChannel,
}: {
  videos: VideoWithSection[];
  sections: Section[];
  tagsByChannel: Record<string, Tag[]>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [focusedVideoId, setFocusedVideoId] = useState<string | null>(
    () => videos[0]?.id ?? null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const undoStackRef = useRef<UndoEntry[]>([]);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingGRef = useRef(false);
  const pendingGTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleVideos = useMemo(
    () => videos.filter((v) => !removedIds.has(v.id)),
    [videos, removedIds],
  );

  useEffect(() => {
    if (visibleVideos.length === 0) {
      if (focusedVideoId !== null) setFocusedVideoId(null);
      return;
    }
    if (
      focusedVideoId === null ||
      !visibleVideos.some((v) => v.id === focusedVideoId)
    ) {
      setFocusedVideoId(visibleVideos[0].id);
    }
  }, [visibleVideos, focusedVideoId]);

  useEffect(() => {
    if (!focusedVideoId) return;
    const el = cardRefs.current.get(focusedVideoId);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedVideoId]);

  const flashError = useCallback((msg: string) => {
    setErrorMsg(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMsg(null), ERROR_BANNER_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (pendingGTimerRef.current) clearTimeout(pendingGTimerRef.current);
    };
  }, []);

  const moveFocus = useCallback(
    (delta: 1 | -1) => {
      setFocusedVideoId((current) => {
        if (visibleVideos.length === 0) return null;
        const idx = current
          ? visibleVideos.findIndex((v) => v.id === current)
          : -1;
        if (idx === -1) return visibleVideos[0].id;
        const next = Math.max(
          0,
          Math.min(visibleVideos.length - 1, idx + delta),
        );
        return visibleVideos[next].id;
      });
    },
    [visibleVideos],
  );

  const jumpTo = useCallback(
    (pos: 'top' | 'bottom') => {
      if (visibleVideos.length === 0) return;
      setFocusedVideoId(
        pos === 'top'
          ? visibleVideos[0].id
          : visibleVideos[visibleVideos.length - 1].id,
      );
    },
    [visibleVideos],
  );

  const postTransition = useCallback(
    async (videoId: string, next: 'saved' | 'dismissed' | 'inbox') => {
      try {
        const res = await fetch('/api/consumption', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId, next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const mutate = useCallback(
    async (videoId: string, next: 'saved' | 'dismissed') => {
      setRemovedIds((prev) => {
        const copy = new Set(prev);
        copy.add(videoId);
        return copy;
      });
      setFocusedVideoId((current) => {
        if (current !== videoId) return current;
        const idx = visibleVideos.findIndex((v) => v.id === videoId);
        if (idx === -1) return current;
        const after = visibleVideos[idx + 1];
        const before = visibleVideos[idx - 1];
        return after?.id ?? before?.id ?? null;
      });

      const ok = await postTransition(videoId, next);
      if (!ok) {
        setRemovedIds((prev) => {
          const copy = new Set(prev);
          copy.delete(videoId);
          return copy;
        });
        setFocusedVideoId(videoId);
        flashError(
          next === 'dismissed'
            ? 'Failed: could not dismiss. Press u to retry.'
            : 'Failed: could not save. Try again.',
        );
        return;
      }

      if (next === 'dismissed') {
        undoStackRef.current.push({ videoId, prevStatus: 'inbox' });
      }
      startTransition(() => router.refresh());
    },
    [flashError, postTransition, router, visibleVideos],
  );

  const undo = useCallback(async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    const ok = await postTransition(entry.videoId, 'inbox');
    if (!ok) {
      undoStackRef.current.push(entry);
      flashError('Failed: could not undo. Try again.');
      return;
    }
    setRemovedIds((prev) => {
      const copy = new Set(prev);
      copy.delete(entry.videoId);
      return copy;
    });
    startTransition(() => router.refresh());
  }, [flashError, postTransition, router]);

  const runAction = useCallback(
    (action: InboxAction) => {
      switch (action) {
        case 'next':
          moveFocus(1);
          break;
        case 'prev':
          moveFocus(-1);
          break;
        case 'top':
          jumpTo('top');
          break;
        case 'bottom':
          jumpTo('bottom');
          break;
        case 'save':
          if (focusedVideoId) void mutate(focusedVideoId, 'saved');
          break;
        case 'dismiss':
          if (focusedVideoId) void mutate(focusedVideoId, 'dismissed');
          break;
        case 'open':
          if (focusedVideoId) {
            window.open(
              `https://www.youtube.com/watch?v=${focusedVideoId}`,
              '_blank',
              'noopener',
            );
          }
          break;
        case 'undo':
          void undo();
          break;
      }
    },
    [focusedVideoId, jumpTo, moveFocus, mutate, undo],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEntry(document.activeElement)) return;

      const { action, chordConsumed, startChord } = resolveAction(
        e.key,
        pendingGRef.current,
      );

      if (chordConsumed) {
        pendingGRef.current = false;
        if (pendingGTimerRef.current) {
          clearTimeout(pendingGTimerRef.current);
          pendingGTimerRef.current = null;
        }
      }

      if (startChord) {
        pendingGRef.current = true;
        if (pendingGTimerRef.current) clearTimeout(pendingGTimerRef.current);
        pendingGTimerRef.current = setTimeout(() => {
          pendingGRef.current = false;
          pendingGTimerRef.current = null;
        }, CHORD_TIMEOUT_MS);
        e.preventDefault();
        return;
      }

      if (!action) return;

      e.preventDefault();
      runAction(action);
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runAction]);

  const registerRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) cardRefs.current.set(id, el);
      else cardRefs.current.delete(id);
    },
    [],
  );

  return (
    <>
      {errorMsg && (
        <div
          role="alert"
          className="mb-4 bg-oxblood px-3 py-2 font-sans text-[11px] uppercase tracking-[0.14em] text-paper"
        >
          {errorMsg}
        </div>
      )}
      <div className="divide-y" style={{ borderColor: 'var(--color-rule)' }}>
        {visibleVideos.map((video) => (
          <div
            key={video.id}
            className="border-b"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <InboxCard
              video={{ ...video, tags: tagsByChannel[video.channel_id] ?? [] }}
              sections={sections}
              focused={video.id === focusedVideoId}
              rootRef={registerRef(video.id)}
              action={
                <>
                  <ConsumptionAction videoId={video.id} next="saved" label="Save" />
                  <ConsumptionAction
                    videoId={video.id}
                    next="dismissed"
                    label="Dismiss"
                    variant="ghost"
                  />
                </>
              }
            />
          </div>
        ))}
      </div>
    </>
  );
}
