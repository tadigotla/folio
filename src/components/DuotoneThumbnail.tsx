import type { CSSProperties } from 'react';

interface Props {
  src: string;
  alt: string;
  aspect?: string;
  className?: string;
  priority?: boolean;
}

export function DuotoneThumbnail({
  src,
  alt,
  aspect = '16/9',
  className = '',
  priority = false,
}: Props) {
  const style: CSSProperties = { aspectRatio: aspect };
  return (
    <div
      className={`relative w-full overflow-hidden bg-rule ${className}`}
      style={style}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- YouTube i.ytimg.com is externally hosted and cached at the CDN; next/image's optimizer adds no value. */}
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        className="h-full w-full object-cover"
        style={{ filter: 'contrast(0.92) sepia(0.15)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundColor: 'var(--color-paper)',
          mixBlendMode: 'multiply',
          opacity: 0.3,
        }}
      />
    </div>
  );
}
