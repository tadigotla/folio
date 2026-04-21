'use client';

import { useEffect, useRef, useState } from 'react';
import { DuotoneThumbnail } from './DuotoneThumbnail';

type YTPlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
};

type YTEvent = { target: YTPlayer; data: number };

type YTNamespace = {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string;
      playerVars?: Record<string, unknown>;
      events?: {
        onReady?: (e: YTEvent) => void;
        onStateChange?: (e: YTEvent) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('window unavailable'));
  }
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    if (window.YT && typeof window.YT.Player === 'function') {
      resolve(window.YT);
      return;
    }

    const priorHandler = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (priorHandler) priorHandler();
      if (window.YT) resolve(window.YT);
    };

    if (!document.querySelector('script[data-youtube-iframe-api]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.youtubeIframeApi = 'true';
      document.head.appendChild(script);
    }
  });

  return apiPromise;
}

function dispatchProgress(
  videoId: string,
  action: 'start' | 'tick' | 'pause' | 'end',
  position?: number,
): void {
  const body = JSON.stringify({ videoId, action, position });
  fetch('/api/consumption-progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function Player({
  videoId,
  initialPosition,
  posterSrc,
  posterAlt,
}: {
  videoId: string;
  initialPosition?: number;
  posterSrc?: string;
  posterAlt?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [iframeMounted, setIframeMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | null = null;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let startDispatched = false;

    const clearTick = () => {
      if (tickInterval !== null) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
    };

    const getPosition = (): number | undefined => {
      if (!player) return undefined;
      try {
        return player.getCurrentTime();
      } catch {
        return undefined;
      }
    };

    const sendBeaconPause = () => {
      const position = getPosition();
      const payload = JSON.stringify({ videoId, action: 'pause', position });
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/consumption-progress', blob);
      } else {
        fetch('/api/consumption-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') sendBeaconPause();
    };
    const onPageHide = () => sendBeaconPause();

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;

      const mount = document.createElement('div');
      containerRef.current.appendChild(mount);
      setIframeMounted(true);

      player = new YT.Player(mount, {
        videoId,
        playerVars: {
          autoplay: 1,
          start: Math.max(0, Math.floor(initialPosition ?? 0)),
          enablejsapi: 1,
          playsinline: 1,
        },
        events: {
          onStateChange: (event: YTEvent) => {
            const state = event.data;
            if (state === 1) {
              if (!startDispatched) {
                startDispatched = true;
                dispatchProgress(videoId, 'start');
              }
              clearTick();
              tickInterval = setInterval(() => {
                const position = getPosition();
                if (typeof position === 'number') {
                  dispatchProgress(videoId, 'tick', position);
                }
              }, 30000);
            } else if (state === 2) {
              clearTick();
              dispatchProgress(videoId, 'pause', getPosition());
            } else if (state === 0) {
              clearTick();
              dispatchProgress(videoId, 'end');
            } else {
              clearTick();
            }
          },
        },
      });

      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('pagehide', onPageHide);
    });

    return () => {
      cancelled = true;
      clearTick();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      if (player) {
        try {
          player.destroy();
        } catch {}
        player = null;
      }
    };
  }, [videoId, initialPosition]);

  return (
    <div className="relative aspect-video w-full overflow-hidden">
      {posterSrc && !iframeMounted && (
        <div className="absolute inset-0">
          <DuotoneThumbnail
            src={posterSrc}
            alt={posterAlt ?? ''}
            aspect="16/9"
            priority
          />
        </div>
      )}
      <div ref={containerRef} className="relative h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
    </div>
  );
}
