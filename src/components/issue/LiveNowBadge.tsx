'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { VideoWithConsumption } from '../../lib/consumption';

export function LiveNowBadge({
  videos,
}: {
  videos: VideoWithConsumption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood hover:text-ink"
      >
        ● Live now · {videos.length}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-72 bg-paper p-3 shadow-lg"
          style={{ border: '1px solid var(--color-rule)' }}
        >
          <ul className="space-y-2">
            {videos.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/watch/${encodeURIComponent(v.id)}`}
                  className="block hover:text-oxblood"
                >
                  <div className="font-[var(--font-serif-body)] text-sm leading-snug line-clamp-2">
                    {v.title}
                  </div>
                  <div className="mt-1 italic text-sage text-xs">
                    {v.channel_name}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
