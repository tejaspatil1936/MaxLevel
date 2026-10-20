import { RadioGroup as RRadio } from 'radix-ui';
import { useId, type KeyboardEvent } from 'react';
import { cx } from '../cx';

export interface RadioGroupProps<V extends string> {
  label: string;
  value: V;
  onValueChange: (value: V) => void;
  options: Array<{ value: V; label: string }>;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A labelled radio group; each option is a 44 px target (UX-04). All four arrow keys move to the next or previous
 * option and check it, wrapping at the ends, whatever the orientation (the ARIA radio group pattern); Home and End
 * move to the first and last option. Radix alone ignores the other axis's arrows and checks an option only while the
 * arrow key is still held when its deferred focus lands, so a quick key press could move focus without checking.
 */
export function RadioGroup<V extends string>({
  label,
  value,
  onValueChange,
  options,
  orientation = 'horizontal',
  disabled,
}: RadioGroupProps<V>) {
  const id = useId();
  const step = (e: KeyboardEvent, from: V) => {
    const by = STEP[e.key];
    if (!by || disabled) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.value === from);
    const next = options[(at + by + options.length) % options.length]!;
    onValueChange(next.value);
    document.getElementById(`${id}-${next.value}`)?.focus();
  };
  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="font-bold text-ink">
        {label}
      </span>
      <RRadio.Root
        aria-labelledby={`${id}-label`}
        value={value}
        onValueChange={(v) => onValueChange(v as V)}
        orientation={orientation}
        disabled={disabled}
        className={cx('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-wrap')}
      >
        {options.map((o) => (
          <label
            key={o.value}
            htmlFor={`${id}-${o.value}`}
            className="flex min-h-11 min-w-11 cursor-pointer items-center gap-1 rounded-control border border-rule bg-surface pr-3 has-[[data-state=checked]]:border-ballpoint has-[[data-state=checked]]:bg-ballpoint-wash"
          >
            <RRadio.Item
              id={`${id}-${o.value}`}
              value={o.value}
              onKeyDown={(e) => step(e, o.value)}
              className="group flex size-11 shrink-0 items-center justify-center rounded-control"
            >
              {/* The visible circle; the radio around it is the 44 px target (UX-04). */}
              <span className="flex size-5 items-center justify-center rounded-full border-2 border-ink bg-surface group-data-[state=checked]:border-ballpoint">
                <RRadio.Indicator className="block size-2.5 rounded-full bg-ballpoint" />
              </span>
            </RRadio.Item>
            <span>{o.label}</span>
          </label>
        ))}
      </RRadio.Root>
    </div>
  );
}
