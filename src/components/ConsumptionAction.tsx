'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConsumptionStatus } from '../lib/types';

interface Props {
  videoId: string;
  next: ConsumptionStatus;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
}

const variantClasses: Record<NonNullable<Props['variant']>, string> = {
  primary: 'text-oxblood hover:text-ink',
  secondary: 'text-ink hover:text-oxblood',
  ghost: 'text-ink-soft hover:text-ink',
};

export function ConsumptionAction({
  videoId,
  next,
  label,
  variant = 'primary',
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, next }),
      });
      if (!res.ok) {
        setError(`Failed (${res.status})`);
        setLoading(false);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`font-sans text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors disabled:opacity-50 ${variantClasses[variant]}`}
    >
      {loading ? '…' : error ?? label}
    </button>
  );
}
