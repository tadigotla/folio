'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RECONNECT_EVENT, YouTubeImportButton } from './YouTubeImportButton';

interface Playlist {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl: string | null;
}

interface Props {
  lastImports: Record<string, string>;
}

export function YouTubePlaylists({ lastImports }: Props) {
  const router = useRouter();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/youtube/import/playlists');
      if (res.status === 409) {
        window.dispatchEvent(new CustomEvent(RECONNECT_EVENT));
        setError('Reconnect required');
        return;
      }
      const body = (await res.json()) as { playlists?: Playlist[]; error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setPlaylists(body.playlists ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => router.refresh();
    window.addEventListener(RECONNECT_EVENT, handler);
    return () => window.removeEventListener(RECONNECT_EVENT, handler);
  }, [router]);

  if (playlists === null) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="bg-ink px-3 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-oxblood disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load my playlists'}
        </button>
        {error && <span className="font-sans text-xs text-oxblood">{error}</span>}
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <div className="font-sans text-sm text-ink-soft italic">
        No playlists found on this account.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-sage/40">
      {playlists.map((p) => {
        const last = lastImports[p.id];
        return (
          <li key={p.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-[var(--font-serif-display)] text-lg">
                {p.title}
              </div>
              <div className="font-sans text-xs text-ink-soft">
                {p.itemCount} videos
                {last ? ` · last imported ${last.slice(0, 19).replace('T', ' ')}Z` : ''}
              </div>
            </div>
            <YouTubeImportButton
              endpoint={`/api/youtube/import/playlists/${encodeURIComponent(p.id)}`}
              label="Import"
            />
          </li>
        );
      })}
    </ul>
  );
}
