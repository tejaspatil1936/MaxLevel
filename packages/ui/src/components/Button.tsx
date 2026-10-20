import type { ButtonHTMLAttributes, Ref } from 'react';
import { cx } from '../cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ballpoint text-on-ballpoint border-ballpoint hover:bg-ink hover:border-ink',
  secondary: 'bg-surface text-ink border-rule hover:bg-ballpoint-wash',
  ghost: 'bg-transparent text-ballpoint border-transparent hover:bg-ballpoint-wash',
  danger: 'bg-surface text-redpen border-redpen hover:bg-redpen-wash',
  /** The confirming button of a destructive dialog (UX-02): solid red pen. */
  destructive: 'bg-redpen text-on-redpen border-redpen hover:bg-ink hover:border-ink',
};

/** Buttons keep the 120 ms small-feedback colour transition (UI-10); reduced motion makes it instant (UI-12). */
export function Button({ variant = 'primary', size = 'md', className, type = 'button', ref, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-control border font-sans font-bold',
        'transition-colors duration-(--duration-small) ease-standard',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'md' ? 'min-h-11 min-w-11 px-4 text-body' : 'min-h-14 min-w-14 px-6 text-heading-3',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}
