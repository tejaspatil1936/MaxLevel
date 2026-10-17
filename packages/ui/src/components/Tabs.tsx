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
      <RTabs.List aria-label={label} className="flex gap-1 border-b border-rule">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px min-h-11 border-b-2 border-transparent px-4 font-bold text-graphite data-[state=active]:border-ballpoint data-[state=active]:text-ink"
          >
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="pt-6">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}
