'use client';

import { useMemo, useState } from 'react';
import { DropZone } from './DropZone';
import { PoolCard } from './PoolCard';
import type { PoolVideo } from '../../lib/issues';
import type { DragPayload } from './useDragPayload';

interface Props {
  pool: PoolVideo[];
  onDropToPool: (payload: DragPayload) => void;
  onDismissed: (videoId: string) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}

export function EditorPool({ pool, onDropToPool, onDismissed, searchRef }: Props) {
    const [q, setQ] = useState('');

    const filtered = useMemo(() => {
      const needle = q.trim().toLowerCase();
      if (!needle) return pool;
      return pool.filter(
        (v) =>
          v.title.toLowerCase().includes(needle) ||
          v.channel_name.toLowerCase().includes(needle),
      );
    }, [pool, q]);

    return (
      <div className="flex h-full flex-col">
        <div className="mb-3 flex items-center gap-3">
          <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
            Pool
          </div>
          <span className="font-mono text-[10px] text-ink-soft">
            {filtered.length}/{pool.length}
          </span>
          <input
            ref={searchRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…  ( / )"
            className="ml-auto w-56 border-b border-rule bg-transparent px-1 py-1 font-sans text-xs text-ink outline-none placeholder:text-ink-soft/60 focus:border-oxblood"
          />
        </div>
        <DropZone
          onDrop={(payload) => {
            if (payload.from === 'slot') onDropToPool(payload);
          }}
          activeClassName="bg-rule/30"
          className="flex-1 overflow-y-auto border border-rule bg-paper/60"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full min-h-[200px] items-center justify-center p-8 text-center font-[var(--font-serif-display)] italic text-ink-soft">
              {q ? 'No matches.' : 'Pool is empty.'}
            </div>
          ) : (
            <div className="divide-y divide-rule">
              {filtered.map((v) => (
                <PoolCard key={v.id} video={v} onDismissed={onDismissed} />
              ))}
            </div>
          )}
        </DropZone>
      </div>
    );
}
