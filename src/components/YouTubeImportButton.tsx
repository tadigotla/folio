'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface ImportResult {
  videos_new: number;
  videos_updated: number;
  channels_new: number;
}

interface Props {
  endpoint: string;
  method?: 'POST';
  label: string;
  className?: string;
}

export const RECONNECT_EVENT = 'folio:needs-reconnect';

export function YouTubeImportButton({
  endpoint,
  method = 'POST',
  label,
  className,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(endpoint, { method });
      if (res.status === 409) {
        window.dispatchEvent(new CustomEvent(RECONNECT_EVENT));
        setError('Reconnect required');
        return;
      }
      const body = (await res.json()) as Partial<ImportResult> & {
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult({
        videos_new: body.videos_new ?? 0,
        videos_updated: body.videos_updated ?? 0,
        channels_new: body.channels_new ?? 0,
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [endpoint, method, router]);

  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ''}`}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="bg-oxblood px-3 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-paper hover:bg-ink disabled:opacity-50"
      >
        {busy ? 'Importing…' : label}
      </button>
      {result && (
        <span className="font-sans text-xs text-ink-soft">
          +{result.videos_new} new · {result.videos_updated} updated
          {result.channels_new > 0 ? ` · +${result.channels_new} channels` : ''}
        </span>
      )}
      {error && (
        <span className="font-sans text-xs text-oxblood">{error}</span>
      )}
    </span>
  );
}
