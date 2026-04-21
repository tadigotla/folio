'use client';

import type { DragEvent, MouseEvent } from 'react';
import { DuotoneThumbnail } from '../DuotoneThumbnail';
import { formatDuration } from '../../lib/time';
import { setDragPayload } from './useDragPayload';
import type { SlotKind } from '../../lib/types';
import type { SlotVideo } from '../../lib/issues';

interface Props {
  kind: SlotKind;
  index: number;
  slot: SlotVideo | null;
  onClear: () => void;
  size?: 'cover' | 'featured' | 'brief';
}

function slotLabel(kind: SlotKind, index: number): string {
  if (kind === 'cover') return 'Cover';
  if (kind === 'featured') return `Featured ${index + 1}`;
  return `Brief ${index + 1}`;
}

export function SlotCard({ kind, index, slot, onClear, size = 'brief' }: Props) {
  if (!slot) {
    return (
      <div
        className={`flex items-center justify-center border border-dashed border-rule bg-paper/40 text-ink-soft/70 ${
          size === 'cover'
            ? 'aspect-[16/9] text-lg'
            : size === 'featured'
              ? 'aspect-[16/9] text-sm'
              : 'min-h-[64px] text-xs'
        }`}
      >
        <span className="font-sans uppercase tracking-[0.16em]">
          {slotLabel(kind, index)}
        </span>
      </div>
    );
  }

  function onDragStart(e: DragEvent<HTMLDivElement>) {
    setDragPayload(e, {
      from: 'slot',
      videoId: slot!.video_id,
      slotKind: kind,
      slotIndex: index,
    });
  }

  function openWatch(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('[data-no-open]')) return;
    window.open(
      `/watch/${encodeURIComponent(slot!.video_id)}`,
      '_blank',
      'noreferrer',
    );
  }

  function handleClear(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onClear();
  }

  const duration = formatDuration(slot.duration_seconds);
  const thumb =
    slot.thumbnail_url ?? `https://i.ytimg.com/vi/${slot.video_id}/hqdefault.jpg`;

  const commonProps = {
    draggable: true as const,
    onDragStart,
    onClick: openWatch,
    tabIndex: 0,
    'data-slot-kind': kind,
    'data-slot-index': index,
  };

  if (size === 'cover') {
    return (
      <div
        {...commonProps}
        className="group relative cursor-grab focus:outline-none focus-visible:ring-2 focus-visible:ring-oxblood active:cursor-grabbing"
      >
        <DuotoneThumbnail src={thumb} alt={slot.title} aspect="16/9" />
        {duration && (
          <span className="absolute bottom-2 right-2 bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-paper">
            {duration}
          </span>
        )}
        <button
          type="button"
          data-no-open
          onClick={handleClear}
          title="Clear slot"
          className="absolute top-2 right-2 bg-ink/60 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-paper opacity-0 transition-opacity group-hover:opacity-100 hover:bg-oxblood"
        >
          ×
        </button>
        <div className="mt-2">
          <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            {slot.channel_name}
          </div>
          <h3 className="mt-1 font-[var(--font-serif-display)] text-2xl italic leading-tight">
            {slot.title}
          </h3>
        </div>
      </div>
    );
  }

  if (size === 'featured') {
    return (
      <div
        {...commonProps}
        className="group relative cursor-grab focus:outline-none focus-visible:ring-2 focus-visible:ring-oxblood active:cursor-grabbing"
      >
        <DuotoneThumbnail src={thumb} alt={slot.title} aspect="16/9" />
        {duration && (
          <span className="absolute bottom-1.5 right-1.5 bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-paper">
            {duration}
          </span>
        )}
        <button
          type="button"
          data-no-open
          onClick={handleClear}
          title="Clear slot"
          className="absolute top-1.5 right-1.5 bg-ink/60 px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-paper opacity-0 transition-opacity group-hover:opacity-100 hover:bg-oxblood"
        >
          ×
        </button>
        <div className="mt-1.5">
          <div className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            {slot.channel_name}
          </div>
          <h4 className="font-[var(--font-serif-display)] text-sm leading-snug">
            {slot.title}
          </h4>
        </div>
      </div>
    );
  }

  return (
    <div
      {...commonProps}
      className="group relative flex cursor-grab gap-3 bg-paper px-3 py-2 hover:bg-rule/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-oxblood active:cursor-grabbing"
    >
      <div className="w-[80px] shrink-0">
        <DuotoneThumbnail src={thumb} alt={slot.title} aspect="16/9" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-sans text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {slot.channel_name}
        </div>
        <h4 className="line-clamp-2 font-[var(--font-serif-display)] text-sm leading-snug">
          {slot.title}
        </h4>
        {duration && (
          <div className="mt-1 font-mono text-[10px] text-ink-soft">{duration}</div>
        )}
      </div>
      <button
        type="button"
        data-no-open
        onClick={handleClear}
        title="Clear slot"
        className="opacity-0 transition-opacity group-hover:opacity-100 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft hover:text-oxblood"
      >
        ×
      </button>
    </div>
  );
}
