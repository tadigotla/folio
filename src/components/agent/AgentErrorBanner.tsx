'use client';

interface Props {
  message: string;
  onDismiss?: () => void;
}

export function AgentErrorBanner({ message, onDismiss }: Props) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-y border-oxblood/40 bg-oxblood/5 px-4 py-2 font-sans text-[11px] uppercase tracking-[0.16em] text-oxblood">
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-oxblood/70 hover:text-oxblood"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
