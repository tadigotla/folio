import type { DragEvent } from 'react';
import type { SlotKind } from '../../lib/types';

export const DRAG_MIME = 'application/x-folio-drop';

export type DragPayload =
  | { from: 'pool'; videoId: string }
  | { from: 'slot'; videoId: string; slotKind: SlotKind; slotIndex: number };

export function setDragPayload(
  event: DragEvent<HTMLElement>,
  payload: DragPayload,
): void {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'move';
}

export function readDragPayload(
  event: DragEvent<HTMLElement>,
): DragPayload | null {
  const raw = event.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed.from !== 'pool' && parsed.from !== 'slot') return null;
    if (typeof parsed.videoId !== 'string' || !parsed.videoId) return null;
    return parsed;
  } catch {
    return null;
  }
}
