import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** Overflow menu: destructive actions live here, away from the primary action (UX-02). */
export function Menu({ trigger, items, label }: { trigger: ReactNode; items: MenuItem[]; label: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild aria-label={label}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="min-w-48 rounded-panel border border-rule bg-surface p-1 shadow-overlay"
        >
          {items.map((item, i) => (
            <DropdownMenu.Item
              key={i}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cx(
                'flex min-h-11 cursor-pointer items-center rounded-control px-3 outline-none data-[highlighted]:bg-ballpoint-wash data-[disabled]:opacity-60',
                item.destructive ? 'text-redpen' : 'text-ink',
              )}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
