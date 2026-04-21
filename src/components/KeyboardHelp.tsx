'use client';

import { useEffect, useState } from 'react';

interface Binding {
  keys: string[];
  help: string;
}

interface Group {
  scope: string;
  bindings: Binding[];
}

const GROUPS: Group[] = [
  {
    scope: 'Everywhere',
    bindings: [{ keys: ['?'], help: 'Toggle this help' }],
  },
  {
    scope: 'Workspace  (/)',
    bindings: [
      { keys: ['/'], help: 'Focus pool search' },
      { keys: ['Delete'], help: 'Clear focused slot' },
      { keys: ['n'], help: 'New draft (when none exists)' },
    ],
  },
  {
    scope: 'Watch  (/watch/[id])',
    bindings: [
      { keys: ['n'], help: 'Next piece in issue' },
      { keys: ['p'], help: 'Previous piece' },
      { keys: ['s'], help: 'Save (auto-advance)' },
      { keys: ['a'], help: 'Archive (auto-advance)' },
      { keys: ['d'], help: 'Dismiss (auto-advance)' },
      { keys: ['.'], help: 'Pin as today’s cover' },
      { keys: ['⌘', 'Z'], help: 'Undo the last s/a/d within 1.2s' },
    ],
  },
  {
    scope: 'Sections  (/sections)',
    bindings: [
      { keys: ['j'], help: 'Next channel row' },
      { keys: ['k'], help: 'Previous channel row' },
      { keys: ['1', '–', '9'], help: 'Assign focused channel to Nth section' },
      { keys: ['0'], help: 'Move to Unsorted' },
    ],
  },
  {
    scope: 'Taxonomy',
    bindings: [
      { keys: ['click'], help: 'Section chip — pick/create a section (1:1)' },
      { keys: ['click'], help: 'Tags chip — toggle any tags (M:N)' },
    ],
  },
];

function Kbd({ text }: { text: string }) {
  if (text === '–') return <span className="mx-0.5 text-ink-soft">–</span>;
  return (
    <kbd className="inline-block min-w-[1.5rem] bg-rule/60 px-1.5 py-0.5 text-center font-mono text-[10px] text-ink">
      {text}
    </kbd>
  );
}

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-sans text-[10px] font-medium uppercase tracking-[0.16em] text-ink-soft/70 hover:text-ink"
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-paper p-6 shadow-xl"
            style={{ border: '1px solid var(--color-rule)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-oxblood">
              Shortcuts
            </div>
            <h2 className="mt-2 font-[var(--font-serif-display)] text-3xl italic">
              Keyboard
            </h2>
            <div className="mt-6 space-y-6">
              {GROUPS.map((g) => (
                <div key={g.scope}>
                  <div className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-sage">
                    {g.scope}
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {g.bindings.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-baseline justify-between gap-4"
                      >
                        <span className="flex items-center gap-1">
                          {b.keys.map((k, j) => (
                            <Kbd key={j} text={k} />
                          ))}
                        </span>
                        <span className="italic text-ink-soft text-sm text-right">
                          {b.help}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-6 italic text-sage text-xs">
              Press <Kbd text="Esc" /> or click outside to close.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
