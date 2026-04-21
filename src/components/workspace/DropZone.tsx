'use client';

import type { DragEvent, ReactNode } from 'react';
import { useState } from 'react';
import { readDragPayload, type DragPayload } from './useDragPayload';

interface Props {
  onDrop: (payload: DragPayload) => void;
  children: ReactNode;
  className?: string;
  activeClassName?: string;
  disabled?: boolean;
}

export function DropZone({
  onDrop,
  children,
  className,
  activeClassName,
  disabled,
}: Props) {
  const [over, setOver] = useState(false);

  function handleOver(e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!over) setOver(true);
  }

  function handleLeave() {
    setOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    setOver(false);
    const payload = readDragPayload(e);
    if (payload) onDrop(payload);
  }

  return (
    <div
      className={`${className ?? ''} ${over && activeClassName ? activeClassName : ''}`}
      onDragOver={handleOver}
      onDragLeave={handleLeave}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
}
