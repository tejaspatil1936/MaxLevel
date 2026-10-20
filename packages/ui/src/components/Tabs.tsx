import { Tabs as RTabs } from 'radix-ui';
import type { KeyboardEvent, ReactNode } from 'react';

export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  label: string;
  tabs: Array<{ value: string; label: ReactNode; content: ReactNode }>;
}

/** The tab a key moves to, from the tab at `at` of `count`; the arrows wrap at the ends. */
const MOVE: Record<string, (at: number, count: number) => number> = {
  ArrowRight: (at, n) => (at + 1) % n,
  ArrowLeft: (at, n) => (at - 1 + n) % n,
  Home: () => 0,
  PageUp: () => 0,
  End: (_, n) => n - 1,
  PageDown: (_, n) => n - 1,
};

/**
 * Arrow keys, Home and End move focus to a tab, which selects it, during the key press itself. Radix moves focus in
 * a timer, so a press that comes before that timer runs (a busy machine, a held key) goes to the tab being left and
 * is lost.
 */
function moveFocus(e: KeyboardEvent<HTMLButtonElement>) {
  const move = MOVE[e.key];
  if (!move || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  e.preventDefault();
  const tabs = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
  const at = tabs.indexOf(e.currentTarget);
  tabs[move(at, tabs.length)]?.focus();
}

export function Tabs({ value, onValueChange, label, tabs }: TabsProps) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      {/* A11Y-15: on a narrow screen the tab row scrolls on its own, never the page; arrow keys scroll it to the focus. */}
      <div className="overflow-x-auto">
        <RTabs.List aria-label={label} className="flex w-max min-w-full gap-1 border-b border-rule">
          {tabs.map((t) => (
            <RTabs.Trigger
              key={t.value}
              value={t.value}
              onKeyDown={moveFocus}
              className="-mb-px min-h-11 shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 font-bold text-graphite data-[state=active]:border-ballpoint data-[state=active]:text-ink"
            >
              {t.label}
            </RTabs.Trigger>
          ))}
        </RTabs.List>
      </div>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="pt-6">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}
