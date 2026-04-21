'use client';

import { useEffect, useState } from 'react';
import { RECONNECT_EVENT } from './YouTubeImportButton';

export function YouTubeReconnectBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener(RECONNECT_EVENT, handler);
    return () => window.removeEventListener(RECONNECT_EVENT, handler);
  }, []);

  if (!visible) return null;

  return (
    <div className="mb-6 bg-oxblood/10 px-4 py-4 font-sans text-sm text-oxblood">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">
        Reconnect required
      </p>
      <p className="mt-2 italic text-ink-soft">
        The stored refresh token was rejected by Google. Your imported videos
        are untouched; reconnect to resume imports.
      </p>
      <form action="/api/youtube/oauth/authorize" className="mt-3">
        <button
          type="submit"
          className="bg-oxblood px-3 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-paper hover:bg-ink"
        >
          Reconnect YouTube
        </button>
      </form>
    </div>
  );
}
