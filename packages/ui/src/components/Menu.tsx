import { DropdownMenu } from 'radix-ui';
import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';
import { rememberOpener } from './Dialog';

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Visible text under the item, also its description; says why a disabled item cannot be used. */
  hint?: ReactNode;
  /** Makes the item a checkbox item (menuitemcheckbox), for example a column picker. */
  checked?: boolean;
}

const itemClass =
  // The highlighted item gets the shared focus ring (base.css :focus-visible) as well as a tint (A11Y-04).
  'flex min-h-11 cursor-pointer flex-col justify-center rounded-control px-3 py-1 data-[highlighted]:bg-ballpoint-wash data-[disabled]:cursor-not-allowed';

function Item({ item }: { item: MenuItem }) {
  const id = useId();
  const hint = item.hint ? (
    <span id={`${id}-hint`} className="text-body-small text-graphite">
      {item.hint}
    </span>
  ) : null;
  const common = {
    disabled: item.disabled,
    'aria-describedby': item.hint ? `${id}-hint` : undefined,
    // The hint is a description, not part of the item's name.
    'aria-labelledby': item.hint ? `${id}-label` : undefined,
    className: cx(itemClass, item.destructive ? 'text-redpen' : 'text-ink', item.disabled && 'text-graphite'),
  };
  if (item.checked !== undefined) {
    return (
      <DropdownMenu.CheckboxItem
        {...common}
        checked={item.checked}
        onSelect={(e) => {
          e.preventDefault(); // keep the menu open while picking several
          item.onSelect();
        }}
      >
        <span className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-control border-2 border-ink">
            <DropdownMenu.ItemIndicator>
              <Check aria-hidden size={14} />
            </DropdownMenu.ItemIndicator>
          </span>
          {item.label}
        </span>
      </DropdownMenu.CheckboxItem>
    );
  }
  return (
    <DropdownMenu.Item {...common} onSelect={item.onSelect}>
      <span id={`${id}-label`}>{item.label}</span>
      {hint}
    </DropdownMenu.Item>
  );
}

/** Overflow menu: destructive actions live here, away from the primary action (UX-02). */
export function Menu({
  trigger,
  items,
  label,
  align = 'end',
}: {
  trigger: ReactNode;
  items: MenuItem[];
  label?: string;
  align?: 'start' | 'end';
}) {
  return (
    // A menu of checkboxes stays non-modal, so the table it changes stays visible to assistive technology.
    <DropdownMenu.Root modal={!items.some((i) => i.checked !== undefined)}>
      <DropdownMenu.Trigger
        asChild
        aria-label={label}
        onPointerDown={(e) => rememberOpener(e.currentTarget)}
        onKeyDown={(e) => rememberOpener(e.currentTarget)}
      >
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className="z-50 min-w-48 max-w-80 rounded-panel border border-rule bg-surface p-1.5 shadow-overlay"
        >
          {items.map((item, i) => (
            <Item key={i} item={item} />
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
