'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  videoId: string | null;
  pinned?: boolean;
  label?: string;
  className?: string;
}

export function PinCoverAction({
  videoId,
  pinned = false,
  label,
  className = '',
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/issues/cover-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const text = label ?? (pinned ? 'Unpin cover' : 'Pin as cover');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-oxblood hover:text-ink disabled:opacity-40 ${className}`}
      title={pinned ? 'Clear the cover pin' : 'Pin this piece as today’s cover'}
    >
      {busy ? '…' : text}
    </button>
  );
}
