// Scripted answers (an auto-answer extension or a script pasted into the page): the browser marks every event a
// script makes as untrusted (`isTrusted` false), while a person's mouse, keyboard, touch and assistive technology
// always give trusted events. The exam's answer controls and its keyboard shortcuts act on trusted events only: an
// untrusted one is stopped before the page sees it, so a script cannot answer, and the first one is reported as an
// `automated_input` strike. Later ones in the same exam session are stopped without another report, so an extension
// that keeps sending events never runs a student out of strikes.

/** The events a script would make to answer: keys (the A to D shortcuts) and clicks or changes on an option. */
const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;
const ANSWER_EVENTS = ['click', 'input', 'change', 'pointerdown', 'mousedown', 'mouseup'] as const;

interface GuardTarget {
  matches?: (selector: string) => boolean;
  closest?: (selector: string) => unknown;
}

export interface GuardEvent {
  type: string;
  isTrusted: boolean;
  target: unknown;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

export interface InputGuardDeps {
  doc: {
    addEventListener(type: string, fn: (e: GuardEvent) => void, options: { capture: true }): void;
    removeEventListener(type: string, fn: (e: GuardEvent) => void, options: { capture: true }): void;
  };
  report: (type: 'automated_input', details: Record<string, string>) => void;
}

const RADIO = 'input[type="radio"]';

/** An answer option: the radio itself or anything inside its label. */
function onAnswer(target: unknown): boolean {
  const t = target as GuardTarget | null;
  if (!t) return false;
  if (t.matches?.(RADIO)) return true;
  const label = t.closest?.('label') as { querySelector?: (s: string) => unknown } | null | undefined;
  return !!label?.querySelector?.(RADIO);
}

/** Installs the guard on the exam document; returns the function that removes it. */
export function installInputGuard(deps: InputGuardDeps): () => void {
  let reported = false;
  const stop = (e: GuardEvent, kind: 'key' | 'answer') => {
    e.stopImmediatePropagation();
    e.preventDefault();
    if (reported) return;
    reported = true;
    deps.report('automated_input', { event: e.type, kind });
  };
  const onKey = (e: GuardEvent) => {
    if (!e.isTrusted) stop(e, 'key');
  };
  const onPointer = (e: GuardEvent) => {
    if (!e.isTrusted && onAnswer(e.target)) stop(e, 'answer');
  };
  for (const type of KEY_EVENTS) deps.doc.addEventListener(type, onKey, { capture: true });
  for (const type of ANSWER_EVENTS) deps.doc.addEventListener(type, onPointer, { capture: true });
  return () => {
    for (const type of KEY_EVENTS) deps.doc.removeEventListener(type, onKey, { capture: true });
    for (const type of ANSWER_EVENTS) deps.doc.removeEventListener(type, onPointer, { capture: true });
  };
}
