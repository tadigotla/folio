'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CreatePlaylistButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
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
      const data = (await res.json()) as { playlist: { id: number } };
      router.push(`/playlists/${data.playlist.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood hover:text-ink"
      >
        + New playlist
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col items-end gap-2 border border-rule bg-paper p-3"
    >
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Playlist name"
        className="w-64 border border-rule bg-paper px-2 py-1 font-[var(--font-serif-body)] text-sm focus:border-oxblood focus:outline-none"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-64 border border-rule bg-paper px-2 py-1 font-[var(--font-serif-body)] text-sm text-ink-soft focus:border-oxblood focus:outline-none"
      />
      {error && (
        <span className="font-sans text-xs text-oxblood">{error}</span>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            setOpen(false);
            setName('');
            setDescription('');
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
          {submitting ? '…' : 'Create'}
        </button>
      </div>
    </form>
  );
}
