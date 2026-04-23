'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlaylistMembership } from '../../lib/playlists';

interface PlaylistOption {
  id: number;
  name: string;
  item_count: number;
}

export function AddToPlaylistButton({
  videoId,
  initialMemberships,
}: {
  videoId: string;
  initialMemberships: PlaylistMembership[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<Set<number>>(
    () => new Set(initialMemberships.map((m) => m.id)),
  );
  const [options, setOptions] = useState<PlaylistOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMemberIds(new Set(initialMemberships.map((m) => m.id)));
  }, [initialMemberships]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName('');
        setError(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setCreating(false);
        setNewName('');
        setError(null);
      }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function loadOptions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/playlists');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        playlists: PlaylistOption[];
      };
      setOptions(
        data.playlists.map((p) => ({
          id: p.id,
          name: p.name,
          item_count: p.item_count,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  function openPopover() {
    setOpen(true);
    if (!options) void loadOptions();
  }

  async function toggle(playlistId: number) {
    const isMember = memberIds.has(playlistId);
    setBusyId(playlistId);
    setError(null);
    const next = new Set(memberIds);
    if (isMember) next.delete(playlistId);
    else next.add(playlistId);
    setMemberIds(next);
    try {
      let res: Response;
      if (isMember) {
        res = await fetch(
          `/api/playlists/${playlistId}/items/${encodeURIComponent(videoId)}`,
          { method: 'DELETE' },
        );
      } else {
        res = await fetch(`/api/playlists/${playlistId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: videoId }),
        });
      }
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setMemberIds(memberIds);
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const createRes = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`);
      const created = (await createRes.json()) as {
        playlist: { id: number; name: string };
      };
      const addRes = await fetch(
        `/api/playlists/${created.playlist.id}/items`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: videoId }),
        },
      );
      if (!addRes.ok) throw new Error(`HTTP ${addRes.status}`);
      const next = new Set(memberIds);
      next.add(created.playlist.id);
      setMemberIds(next);
      setOptions((prev) => [
        { id: created.playlist.id, name: created.playlist.name, item_count: 1 },
        ...(prev ?? []),
      ]);
      setNewName('');
      setCreating(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  const memberCount = memberIds.size;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-expanded={open}
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-oxblood"
      >
        ♪ {memberCount > 0 ? `In ${memberCount}` : 'Add to playlist'}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 border border-rule bg-paper shadow-lg">
          <div className="border-b border-rule px-3 py-2 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
            Add to playlist
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {loading && options === null ? (
              <div className="px-3 py-2 italic text-sage text-xs">Loading…</div>
            ) : error ? (
              <div className="px-3 py-2 font-sans text-xs text-oxblood">
                {error}
              </div>
            ) : options && options.length === 0 ? (
              <div className="px-3 py-2 italic text-sage text-xs">
                No playlists yet.
              </div>
            ) : (
              (options ?? []).map((opt) => {
                const checked = memberIds.has(opt.id);
                const busy = busyId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={busy}
                    onClick={() => toggle(opt.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-[var(--font-serif-body)] text-sm hover:bg-rule/40 disabled:opacity-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center border ${
                        checked
                          ? 'border-oxblood bg-oxblood text-paper'
                          : 'border-rule'
                      }`}
                    >
                      {checked ? '✓' : ''}
                    </span>
                    <span className="flex-1 truncate">{opt.name}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-rule px-3 py-2">
            {creating ? (
              <form onSubmit={createAndAdd} className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="New playlist"
                  className="flex-1 border border-rule bg-paper px-2 py-1 font-[var(--font-serif-body)] text-sm focus:border-oxblood focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading || !newName.trim()}
                  className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-oxblood hover:text-ink disabled:opacity-50"
                >
                  Add
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-oxblood"
              >
                + Create new playlist
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
