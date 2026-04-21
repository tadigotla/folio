'use client';

import { DropZone } from './DropZone';
import { SlotCard } from './SlotCard';
import type { SlotKind } from '../../lib/types';
import type { SlotVideo } from '../../lib/issues';
import type { DragPayload } from './useDragPayload';

interface Props {
  slots: SlotVideo[];
  onDrop: (target: { kind: SlotKind; index: number }, payload: DragPayload) => void;
  onClear: (kind: SlotKind, index: number) => void;
}

function findSlot(
  slots: SlotVideo[],
  kind: SlotKind,
  index: number,
): SlotVideo | null {
  return (
    slots.find((s) => s.slot_kind === kind && s.slot_index === index) ?? null
  );
}

function Cell({
  kind,
  index,
  slots,
  onDrop,
  onClear,
  size,
}: {
  kind: SlotKind;
  index: number;
  slots: SlotVideo[];
  size: 'cover' | 'featured' | 'brief';
  onDrop: (target: { kind: SlotKind; index: number }, payload: DragPayload) => void;
  onClear: (kind: SlotKind, index: number) => void;
}) {
  const slot = findSlot(slots, kind, index);
  return (
    <DropZone
      onDrop={(payload) => onDrop({ kind, index }, payload)}
      activeClassName="ring-2 ring-oxblood"
    >
      <SlotCard
        kind={kind}
        index={index}
        slot={slot}
        size={size}
        onClear={() => onClear(kind, index)}
      />
    </DropZone>
  );
}

export function EditorBoard({ slots, onDrop, onClear }: Props) {
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Cover
        </div>
        <Cell
          kind="cover"
          index={0}
          size="cover"
          slots={slots}
          onDrop={onDrop}
          onClear={onClear}
        />
      </section>

      <section>
        <div className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Featured
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Cell
              key={i}
              kind="featured"
              index={i}
              size="featured"
              slots={slots}
              onDrop={onDrop}
              onClear={onClear}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Briefs
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 10 }, (_, i) => (
            <Cell
              key={i}
              kind="brief"
              index={i}
              size="brief"
              slots={slots}
              onDrop={onDrop}
              onClear={onClear}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
