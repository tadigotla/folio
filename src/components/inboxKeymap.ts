export type InboxAction =
  | 'next'
  | 'prev'
  | 'top'
  | 'bottom'
  | 'save'
  | 'dismiss'
  | 'open'
  | 'undo';

export interface InboxKeyBinding {
  keys: readonly string[];
  action: InboxAction;
  help: string;
}

export const INBOX_KEYMAP: readonly InboxKeyBinding[] = [
  { keys: ['j'], action: 'next', help: 'Next video' },
  { keys: ['k'], action: 'prev', help: 'Previous video' },
  { keys: ['g', 'g'], action: 'top', help: 'Jump to top' },
  { keys: ['G'], action: 'bottom', help: 'Jump to bottom' },
  { keys: ['s'], action: 'save', help: 'Save focused video' },
  { keys: ['d'], action: 'dismiss', help: 'Dismiss focused video' },
  { keys: ['o'], action: 'open', help: 'Open in new tab (YouTube)' },
  { keys: ['u'], action: 'undo', help: 'Undo last dismiss' },
] as const;
