'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Playlist } from '../../lib/playlists';

export function PlaylistHeader({ playlist }: { playlist: Playlist }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        setError(`Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setEditing(false);
      setSubmitting(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSubmitting(false);
    }
  }

  async function destroy() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError(`Failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      router.push('/playlists');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSubmitting(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-6 flex flex-col gap-3">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full max-w-xl border border-rule bg-paper px-2 py-2 font-[var(--font-serif-display)] text-3xl italic focus:border-oxblood focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full max-w-xl border border-rule bg-paper px-2 py-1 font-[var(--font-serif-body)] text-sm text-ink-soft focus:border-oxblood focus:outline-none"
        />
        {error && (
          <span className="font-sans text-xs text-oxblood">{error}</span>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setName(playlist.name);
              setDescription(playlist.description ?? '');
              setError(null);
            }}
            className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-oxblood hover:text-ink disabled:opacity-50"
          >
            {submitting ? '…' : 'Save'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <header className="mt-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-[var(--font-serif-display)] text-4xl italic leading-tight">
          {playlist.name}
        </h1>
        {playlist.description && (
          <p className="mt-2 font-[var(--font-serif-body)] text-base text-ink-soft">
            {playlist.description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-oxblood"
        >
          Edit
        </button>
        {confirming ? (
          <>
            <span className="font-sans text-[10px] uppercase tracking-[0.16em] text-ink-soft">
              Sure?
            </span>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink"
            >
              No
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={destroy}
              className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-oxblood hover:text-ink disabled:opacity-50"
            >
              {submitting ? '…' : 'Delete'}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-oxblood"
          >
            Delete
          </button>
        )}
      </div>
    </header>
  );
}
