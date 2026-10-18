import { Tabs as RTabs } from 'radix-ui';
import type { ReactNode } from 'react';

export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  label: string;
  tabs: Array<{ value: string; label: ReactNode; content: ReactNode }>;
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
