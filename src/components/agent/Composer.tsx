'use client';

import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Ask for picks, swap slots, explore clusters…',
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-grow up to a reasonable ceiling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && value.trim()) onSubmit();
      }}
      className="border-t border-rule bg-paper"
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!disabled && value.trim()) onSubmit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="w-full resize-none bg-transparent px-4 py-3 font-sans text-sm leading-relaxed text-ink outline-none placeholder:text-ink-soft/60 disabled:opacity-50"
      />
    </form>
  );
}
