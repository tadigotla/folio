import type { ReactNode } from 'react';

export function Kicker({
  children,
  withRule = false,
  className = '',
}: {
  children: ReactNode;
  withRule?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-oxblood"
      >
        {children}
      </span>
      {withRule && <span className="flex-1 h-px bg-rule" />}
    </div>
  );
}
