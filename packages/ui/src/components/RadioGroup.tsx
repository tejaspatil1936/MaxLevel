import { RadioGroup as RRadio } from 'radix-ui';
import { useId } from 'react';
import { cx } from '../cx';

export interface RadioGroupProps<V extends string> {
  label: string;
  value: V;
  onValueChange: (value: V) => void;
  options: Array<{ value: V; label: string }>;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
}

/** A labelled radio group navigable with the arrow keys; each option is a 44 px target (UX-04). */
export function RadioGroup<V extends string>({
  label,
  value,
  onValueChange,
  options,
  orientation = 'horizontal',
  disabled,
}: RadioGroupProps<V>) {
  const id = useId();
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
