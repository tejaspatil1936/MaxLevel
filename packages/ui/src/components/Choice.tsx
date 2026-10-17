import { Checkbox as RCheckbox, Switch as RSwitch } from 'radix-ui';
import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** Checkbox with its label; the whole row is a 44 px target (UX-04). */
export function Checkbox({ label, checked, onCheckedChange, disabled, className }: CheckboxProps) {
  const id = useId();
  return (
    <div className={cx('flex min-h-11 items-center gap-3', className)}>
      <RCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="flex size-6 items-center justify-center rounded-control border-2 border-ink bg-surface data-[state=checked]:border-ballpoint data-[state=checked]:bg-ballpoint"
      >
        <RCheckbox.Indicator>
          <Check aria-hidden size={16} className="text-on-ballpoint" />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <label htmlFor={id} className="cursor-pointer">
        {label}
      </label>
    </div>
  );
}

export interface SwitchProps {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Text after the track, so the state is never shown by colour alone (UI-02), e.g. "On" / "Off". */
  stateText?: ReactNode;
}

export function Switch({ label, checked, onCheckedChange, disabled, stateText }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3">
      <RSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="relative h-7 w-12 rounded-full border-2 border-ink bg-surface-sunken transition-colors duration-(--duration-small) data-[state=checked]:border-ballpoint data-[state=checked]:bg-ballpoint"
      >
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-ink transition-transform duration-(--duration-small) data-[state=checked]:translate-x-5 data-[state=checked]:bg-on-ballpoint" />
      </RSwitch.Root>
      <label htmlFor={id} className="cursor-pointer">
        {label}
      </label>
      {stateText ? <span className="text-graphite">{stateText}</span> : null}
    </div>
  );
}
