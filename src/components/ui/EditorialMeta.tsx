import type { ReactNode } from 'react';

export function EditorialMeta({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`italic text-sage text-sm leading-snug ${className}`}>
      {children}
    </p>
  );
}
