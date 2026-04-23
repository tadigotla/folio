'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlaylistItemRow } from '../../lib/playlists';
import { formatDuration, relativeTime } from '../../lib/time';

export function PlaylistItems({
  playlistId,
  items: initial,
}: {
  playlistId: number;
  items: PlaylistItemRow[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <p className="mt-10 italic text-sage">
        Empty. Add videos from the Library, the Inbox, or the watch page.
      </p>
    );
  }

  async function move(videoId: string, currentIdx: number, delta: number) {
    const targetIdx = currentIdx + delta;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const newPosition = items[targetIdx].position;

    const optimistic = [...items];
    const [moved] = optimistic.splice(currentIdx, 1);
    optimistic.splice(targetIdx, 0, moved);
    setItems(optimistic);
    setBusyVideoId(videoId);
    try {
      const res = await fetch(
        `/api/playlists/${playlistId}/items/${encodeURIComponent(videoId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: newPosition }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch {
      setItems(initial);
    } finally {
      setBusyVideoId(null);
    }
  }

  async function remove(videoId: string) {
    const optimistic = items.filter((it) => it.video_id !== videoId);
    setItems(optimistic);
    setBusyVideoId(videoId);
    try {
      const res = await fetch(
        `/api/playlists/${playlistId}/items/${encodeURIComponent(videoId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`);
      }
      router.refresh();
    } catch {
      setItems(initial);
    } finally {
      setBusyVideoId(null);
    }
  }

  return (
    <ol className="mt-8 space-y-3">
      {items.map((item, idx) => {
        const v = item.video;
        const thumb =
          v.thumbnail_url ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
        const duration = formatDuration(v.duration_seconds);
        const published = v.published_at ? relativeTime(v.published_at) : null;
        const busy = busyVideoId === item.video_id;
        return (
          <li
            key={item.video_id}
            className="flex items-start gap-4 border-b border-rule/60 pb-3"
          >
            <div className="flex w-6 shrink-0 flex-col items-center pt-2 font-mono text-xs text-sage">
              {idx + 1}
            </div>
            <Link
              href={`/watch/${encodeURIComponent(v.id)}`}
              className="group flex flex-1 gap-4"
            >
              <div className="relative aspect-video w-40 shrink-0 overflow-hidden bg-rule/40">
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbs from i.ytimg.com. */}
                <img
                  src={thumb}
                  alt={v.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {duration && (
                  <span className="absolute bottom-1 right-1 bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-paper">
                    {duration}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 font-[var(--font-serif-display)] text-lg leading-snug group-hover:text-oxblood">
                  {v.title}
                </h3>
                <div className="mt-1 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                  {item.channel_name}
                </div>
                <div className="mt-1 italic text-sage text-xs">
                  {published}
                  {item.consumption_status && (
                    <>
                      {' · '}
                      <span>{item.consumption_status.replace('_', ' ')}</span>
                    </>
                  )}
                </div>
              </div>
            </Link>
            <div className="flex shrink-0 flex-col items-end gap-2 pt-1">
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={busy || idx === 0}
                  onClick={() => move(item.video_id, idx, -1)}
                  aria-label="Move up"
                  className="font-mono text-sm text-ink-soft hover:text-oxblood disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy || idx === items.length - 1}
                  onClick={() => move(item.video_id, idx, 1)}
                  aria-label="Move down"
                  className="font-mono text-sm text-ink-soft hover:text-oxblood disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(item.video_id)}
                className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-oxblood disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
